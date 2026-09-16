import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { generateAeoFixInternal as generateAeoFix, validateFixInternal as validateFixWithQA } from "@/lib/aeo/fix-engine";
import { z } from "zod";
import { scoreHealingActions } from "./confidence";
import { measureFixImpact } from "./measure-impact";
import { createHash } from "crypto";
import { createAutoFixPR } from "@/lib/github";
import { getGitHubToken } from "@/lib/github/token";

const ModelResultSchema = z.object({
    model: z.string(),
    score: z.number().default(0),
}).strip();

const CheckResultSchema = z.object({
    id: z.string(),
    label: z.string(),
    passed: z.boolean(),
    impact: z.enum(["high", "medium", "low"]).catch("low"),
}).strip();

const parseChecks = (data: unknown) => {
    const res = z.array(CheckResultSchema).safeParse(data);
    return res.success ? res.data : [];
};

const parseModelResults = (data: unknown) => {
    const res = z.array(ModelResultSchema).safeParse(data);
    return res.success ? res.data : [];
};

export interface HealingAction {
    type: "PR" | "CONTENT" | "SCHEMA" | "ALERT";
    description: string;
    targetId?: string; // e.g., checkId
    fix?: string;
    filePath?: string;
}

function actionFingerprint(action: HealingAction): string {
    return createHash("sha256")
        .update(JSON.stringify({ type: action.type, targetId: action.targetId, filePath: action.filePath, fix: action.fix }))
        .digest("hex");
}

/** A repeated monitor run must not create a new model call/PR for the same fix. */
export async function filterDuplicateHealingActions(siteId: string, actions: HealingAction[]): Promise<HealingAction[]> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.selfHealingLog.findMany({
        where: { siteId, createdAt: { gte: since } },
        select: { metadata: true },
    });
    const existing = new Set(
        recent.map((log) => (log.metadata as { fingerprint?: unknown } | null)?.fingerprint).filter((v): v is string => typeof v === "string"),
    );
    return actions.filter((action) => !existing.has(actionFingerprint(action)));
}

export async function detectGsovDrop(
    siteId: string
): Promise<{ dropped: boolean; currentGsov: number; prevGsov: number }> {
    const reports = await prisma.aeoReport.findMany({
        where: { siteId },
        orderBy: { createdAt: "desc" },
        take: 2,
    });

    if (reports.length < 2) return { dropped: false, currentGsov: 0, prevGsov: 0 };

    const current = reports[0].generativeShareOfVoice ?? 0;
    const prev    = reports[1].generativeShareOfVoice ?? 0;

    if (prev === 0) return { dropped: false, currentGsov: current, prevGsov: prev };

    const absoluteDrop = prev - current;
    const relativeDrop = absoluteDrop / prev;

    const isDrop =
        prev >= 20
            ? absoluteDrop >= 10
            : relativeDrop >= 0.15;

    return { dropped: isDrop, currentGsov: current, prevGsov: prev };
}

export async function generateHealingPlan(siteId: string, currentGsov: number, prevGsov: number): Promise<HealingAction[]> {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return [];

    // 1. Identify what changed in the AEO Audit
    const reports = await prisma.aeoReport.findMany({
        where: { siteId },
        orderBy: { createdAt: "desc" },
        take: 2,
    });

    // The detector may have read two reports just before retention removes one.
    if (reports.length < 2) return [];
    const currentChecks = parseChecks(reports[0].checks);
    const prevChecks = parseChecks(reports[1].checks);
     
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentModelResults = parseModelResults((reports[0] as any).multiModelResults || []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prevModelResults = parseModelResults((reports[1] as any).multiModelResults || []);

    const actions: HealingAction[] = [];

    // 2. Model-Specific Healing: Check for drops in specific AI engines
    for (const currModel of currentModelResults) {
        const prevModel = prevModelResults.find(m => m.model === currModel.model);
        if (prevModel && currModel.score < prevModel.score - 20) {
            // Significant drop in specific model
            actions.push({
                type: "ALERT",
                description: `Citation drop in ${currModel.model} from ${prevModel.score}% to ${currModel.score}%.`,
                targetId: `model_${currModel.model}`,
                fix: `Analyze recent content for ${currModel.model} specific citation patterns.`
            });
        }
    }

    // 3. Technical Regression Healing
    for (const curr of currentChecks) {
        const prev = prevChecks.find(c => c.id === curr.id);
        if (prev?.passed && !curr.passed) {
            // This is a regression
            if (curr.impact === "high" || curr.impact === "medium") {
                const fixRes = await generateAeoFix(curr, site.domain, site.githubRepoUrl ?? undefined);
                if (fixRes.success) {
                    actions.push({
                        type: site.githubRepoUrl ? "PR" : "CONTENT",
                        description: `Restore ${curr.label} optimization.`,
                        targetId: curr.id,
                        fix: fixRes.fix,
                        filePath: fixRes.filePath,
                    });
                }
            }
        }
    }

    // Default: If GSoV dropped but no technical check failed, it might be competitor movement
    if (actions.length === 0) {
        actions.push({
            type: "ALERT",
            description: `Significant GSoV drop from ${prevGsov}% to ${currentGsov}%. No immediate technical regressions found. Recommend reviewing competitor movements.`,
        });
    }

    return filterDuplicateHealingActions(siteId, actions);
}

export async function executeHealing(siteId: string, actions: HealingAction[]) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site || site.operatingMode !== "AUTOPILOT") return;

    const scoredActions = await scoreHealingActions(siteId, actions);

    for (const action of scoredActions) {
        try {
            if (action.fix) {
                const qaResult = await validateFixWithQA(action.fix, action.description);
                if (!qaResult.valid) {
                    logger.warn(`[Self-Healing QA Failed] ${qaResult.feedback}`);
                    action.type = "ALERT";
                    action.description += ` (QA Failed: ${qaResult.feedback}. Fix requires manual review.)`;
                }
            }

            let logRecord: any = null;

            if (action.type === "PR" && site.githubRepoUrl && action.fix && action.filePath) {
                // Background workers cannot call a browser-session server action.
                // Resolve the owner's OAuth credential and execute through the
                // shared GitHub engine, including its site kill-switch check.
                const token = await getGitHubToken(site.userId);
                const res = token
                    ? await createAutoFixPR(
                        site.githubRepoUrl,
                        [{ path: action.filePath, content: action.fix, description: action.description }],
                        site.domain,
                        token,
                        site.user?.email ?? undefined,
                        undefined,
                        siteId,
                    )
                    : { success: false, error: "GitHub OAuth is not connected for this site owner." };
                const fingerprint = actionFingerprint(action);

                logRecord = await prisma.selfHealingLog.create({
                    data: {
                        siteId,
                        issueType: "GSOV_DROP",
                        description: action.description,
                        actionTaken: "DEPLOYED_GITHUB_PR",
                        impactScore: 15,
                        status: res.success ? "COMPLETED" : "FAILED",
                        metadata: (res.success
                            ? { prUrl: res.prUrl, fingerprint }
                            : { error: res.error, fingerprint }
                        ) as any,
                    }
                });
            } else if (action.type === "CONTENT" || action.type === "SCHEMA") {
                logRecord = await prisma.selfHealingLog.create({
                    data: {
                        siteId,
                        issueType: "GSOV_DROP",
                        description: action.description,
                        actionTaken: "GENERATED_MANUAL_FIX",
                        impactScore: 10,
                        status: "PENDING",
                        metadata: { fix: action.fix, filePath: action.filePath, fingerprint: actionFingerprint(action) } as any,
                    }
                });
            } else if (action.type === "ALERT") {
                logRecord = await prisma.selfHealingLog.create({
                    data: {
                        siteId,
                        issueType: "GSOV_DROP",
                        description: action.description,
                        actionTaken: "LOGGED_ALERT",
                        impactScore: 5,
                        status: "COMPLETED",
                        metadata: { fix: action.fix, fingerprint: actionFingerprint(action) } as any,
                    }
                });
            }

            if (logRecord && action.type !== "ALERT") {
                await measureFixImpact(logRecord.id, siteId);
            }
        } catch (error: unknown) {
            logger.error(`[Self-Healing] Execution failed for site ${siteId}:`, { error: (error as Error)?.message || String(error) });
        }
    }
}
