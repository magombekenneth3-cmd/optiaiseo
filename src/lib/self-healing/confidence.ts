import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import type { HealingAction } from "./engine";
import { dispatchWebhooks } from "@/lib/alerts/webhook-dispatcher";

export type ConfidenceDecision = "AUTO_APPLY" | "QUEUE" | "DROP";

export interface ScoredHealingAction extends HealingAction {
  confidence:         number;
  confidenceDecision: ConfidenceDecision;
  confidenceReasons:  string[];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export async function scoreHealingActions(
  siteId:  string,
  actions: HealingAction[],
): Promise<ScoredHealingAction[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [successfulLogs, recentFailures] = await Promise.all([
    prisma.selfHealingLog.count({
      where: { siteId, status: "COMPLETED", impactScore: { gt: 0 } },
    }),
    prisma.selfHealingLog.count({
      where: { siteId, status: "FAILED", createdAt: { gte: sevenDaysAgo } },
    }),
  ]);

  return actions.map((action) => {
    let score = 0;
    const reasons: string[] = [];

    if (action.type === "ALERT") {
      score = clamp(score + 20);
      reasons.push("+20 ALERT only — no code changes");
    } else if (action.type === "CONTENT" || action.type === "SCHEMA") {
      score = clamp(score + 30);
      reasons.push(`+30 ${action.type} fix — safe, reversible change`);
    }

    if (action.fix && action.fix.length > 50) {
      score = clamp(score + 25);
      reasons.push("+25 specific fix produced (>50 chars)");
    } else if (action.fix && action.fix.length > 0) {
      score = clamp(score + 10);
      reasons.push("+10 short fix present");
    }

    const knownIssueTypes = ["GSOV_DROP", "TITLE_MISSING", "META_MISSING", "SCHEMA_INVALID", "HTTPS_MISSING"];
    if (knownIssueTypes.some((t) => action.description.includes(t) || (action.targetId ?? "").includes(t.toLowerCase()))) {
      score = clamp(score + 15);
      reasons.push("+15 known issue type with established fix pattern");
    }

    if (successfulLogs >= 3) {
      score = clamp(score + 10);
      reasons.push(`+10 site has ${successfulLogs} successful heals (track record)`);
    }

    if (action.type === "PR") {
      score = clamp(score - 20);
      reasons.push("-20 PR type — high blast radius (GitHub push)");
    }

    if (action.fix && /TODO|\[NEEDS SOURCE\]|\[ADD/i.test(action.fix)) {
      score = clamp(score - 15);
      reasons.push("-15 fix contains incomplete placeholder");
    }

    if (recentFailures > 0) {
      score = clamp(score - 10);
      reasons.push(`-10 ${recentFailures} recent failure(s) in last 7 days`);
    }

    const decision: ConfidenceDecision =
      score >= 75 ? "AUTO_APPLY" :
      score >= 40 ? "QUEUE"      :
                    "DROP";

    return { ...action, confidence: score, confidenceDecision: decision, confidenceReasons: reasons };
  });
}

export async function executeHealingWithConfidenceGate(
  siteId:  string,
  actions: HealingAction[],
): Promise<{ applied: number; queued: number; dropped: number }> {
  if (actions.length === 0) return { applied: 0, queued: 0, dropped: 0 };

  const scored = await scoreHealingActions(siteId, actions);

  const site = await prisma.site.findUnique({
    where:  { id: siteId },
    select: { id: true, domain: true, slackWebhookUrl: true, zapierWebhookUrl: true },
  });

  let applied = 0;
  let queued  = 0;
  let dropped = 0;

  for (const action of scored) {
    logger.info("[HealingGate] Decision", {
      siteId,
      type:       action.type,
      confidence: action.confidence,
      decision:   action.confidenceDecision,
      reasons:    action.confidenceReasons,
    });

    if (action.confidenceDecision === "AUTO_APPLY") {
      const { executeHealing } = await import("./engine");
      await executeHealing(siteId, [action]);
      applied++;

      if (site) {
        await dispatchWebhooks(site, {
          event:   "healing_queued",
          summary: `Auto-applied healing: ${action.description} (confidence: ${action.confidence}/100)`,
          details: { type: action.type, confidence: action.confidence, decision: "AUTO_APPLY" },
        });
      }

    } else if (action.confidenceDecision === "QUEUE") {
      await prisma.selfHealingLog.create({
        data: {
          siteId,
          issueType:   "GSOV_DROP",
          description: action.description,
          actionTaken: "QUEUED_PENDING_REVIEW",
          impactScore: null,
          status:      "PENDING_REVIEW",
          metadata:    {
            type:              action.type,
            fix:               action.fix,
            filePath:          action.filePath,
            confidence:        action.confidence,
            confidenceReasons: action.confidenceReasons,
          },
        },
      });
      queued++;

      if (site) {
        await dispatchWebhooks(site, {
          event:   "healing_queued",
          summary: `Healing queued for review: ${action.description} (confidence: ${action.confidence}/100)`,
          details: {
            type:       action.type,
            confidence: action.confidence,
            decision:   "QUEUE",
            fix:        action.fix?.slice(0, 120) ?? null,
          },
        });
      }

    } else {
      await prisma.selfHealingLog.create({
        data: {
          siteId,
          issueType:   "GSOV_DROP",
          description: action.description,
          actionTaken: "DROPPED_LOW_CONFIDENCE",
          impactScore: 0,
          status:      "DROPPED",
          metadata:    {
            type:              action.type,
            confidence:        action.confidence,
            confidenceReasons: action.confidenceReasons,
          },
        },
      });
      dropped++;
    }
  }

  logger.info("[HealingGate] Batch complete", { siteId, applied, queued, dropped });
  return { applied, queued, dropped };
}
