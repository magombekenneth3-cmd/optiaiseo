/**
 * Phase C — Autonomous Verifier (Inngest)
 *
 * Runs after execution to measure outcomes. OBSERVATIONAL ONLY.
 *
 * Does NOT auto-rollback. On DEGRADED:
 *   1. Marks as rollback candidate
 *   2. Creates proposal for human review
 *   3. Does NOT auto-rollback
 *
 * SEO metrics are noisy. A ranking drop 24–72h later does not
 * necessarily mean the mutation caused it.
 *
 * Autonomous rollback is deferred to a future phase once attribution
 * and safeguards are proven.
 */

import { inngest } from "../client";
import { logger } from "@/lib/logger";
import {
  recordVerification,
  type VerificationStatus,
} from "@/lib/autonomy/execution-trace";

// ── Per-Action-Type Verification Windows ────────────────────────────────────

const VERIFICATION_WINDOWS_MS: Record<string, number> = {
  UPDATE_META_DESCRIPTION: 24 * 3600_000,  // 24h
  UPDATE_TITLE_TAG:        24 * 3600_000,
  FIX_HEADING_HIERARCHY:   24 * 3600_000,
  ADD_SCHEMA_MARKUP:       24 * 3600_000,
  ADD_CANONICAL_TAG:       24 * 3600_000,
  FIX_BROKEN_LINK:         24 * 3600_000,
  ADD_INTERNAL_LINKS:      72 * 3600_000,  // 72h
  CHANGE_CANONICAL:        72 * 3600_000,
  MODIFY_ROBOTS_META:      72 * 3600_000,
  REDIRECT_URL:            72 * 3600_000,
  CHANGE_PAGE_TITLE:       72 * 3600_000,
  PUBLISH_CONTENT:         72 * 3600_000,
  REFRESH_CONTENT:         72 * 3600_000,
  GENERATE_CONTENT_BRIEF:  72 * 3600_000,
};

const DEFAULT_VERIFICATION_WINDOW_MS = 72 * 3600_000; // 72h default

/**
 * Returns the verification window in milliseconds for a given action type.
 */
export function getVerificationWindowMs(actionType: string): number {
  return VERIFICATION_WINDOWS_MS[actionType] ?? DEFAULT_VERIFICATION_WINDOW_MS;
}

// ── Verification Scheduler ──────────────────────────────────────────────────

/**
 * Schedules a verification check after execution.
 * Called by the autonomous executor after successful execution.
 */
export async function scheduleVerification(
  traceId: string,
  siteId: string,
  actionType: string
): Promise<void> {
  const delayMs = getVerificationWindowMs(actionType);

  await inngest.send({
    name: "autonomous.verify",
    data: {
      traceId,
      siteId,
      actionType,
    },
    // Inngest supports delayed delivery
    ts: Date.now() + delayMs,
  });

  logger.info("[AutonomousVerifier] Verification scheduled", {
    traceId,
    siteId,
    actionType,
    verifyAfterMs: delayMs,
    verifyAt: new Date(Date.now() + delayMs).toISOString(),
  });
}

// ── Verification Job ────────────────────────────────────────────────────────

export const autonomousVerifierJob = inngest.createFunction(
  {
    id: "autonomous-verifier",
    name: "Autonomous Verifier: Outcome Measurement",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: "autonomous.verify" }],
  },
  async ({
    event,
    step,
  }: {
    event: { data: { traceId: string; siteId: string; actionType: string } };
    step: any;
  }) => {
    const { traceId, siteId, actionType } = event.data;

    // ── Step 1: Load execution trace ──────────────────────────────────────
    const trace = await step.run("load-trace", async () => {
      const { prisma } = await import("@/lib/prisma");

      return (prisma as any).executionTrace.findUnique({
        where: { id: traceId },
        select: {
          id: true,
          operationId: true,
          executionResult: true,
          metricsBaseline: true,
          actionType: true,
          siteId: true,
        },
      });
    });

    if (!trace) {
      logger.warn("[AutonomousVerifier] Trace not found", { traceId });
      return { status: "TRACE_NOT_FOUND" };
    }

    if (trace.executionResult !== "SUCCESS") {
      logger.info("[AutonomousVerifier] Skipping — execution was not successful", {
        traceId,
        executionResult: trace.executionResult,
      });
      return { status: "SKIPPED", reason: "Execution was not successful" };
    }

    // ── Step 2: Collect current metrics ───────────────────────────────────
    const metrics = await step.run("collect-metrics", async () => {
      return collectCurrentMetrics(siteId, trace.operationId, actionType);
    });

    // ── Step 3: Compare and determine verification status ─────────────────
    const verification = await step.run("evaluate-outcome", async () => {
      const baseline = trace.metricsBaseline as Record<string, number> | null;
      return evaluateOutcome(baseline, metrics);
    });

    // ── Step 4: Record verification result (append-only) ──────────────────
    await step.run("record-verification", async () => {
      await recordVerification(traceId, {
        verificationStatus: verification.status,
        metricsBaseline: trace.metricsBaseline as Record<string, number> ?? undefined,
        metricsAfter: metrics,
      });
    });

    // ── Step 5: Handle degradation (observational only) ───────────────────
    if (verification.status === "DEGRADED") {
      await step.run("flag-rollback-candidate", async () => {
        const { prisma } = await import("@/lib/prisma");

        // Mark the operation as a rollback candidate via audit event
        if (trace.operationId) {
          await (prisma as any).mutationOperation.update({
            where: { id: trace.operationId },
            data: {
              auditLog: {
                push: {
                  event: "ROLLBACK_CANDIDATE",
                  timestamp: new Date().toISOString(),
                  reason: verification.reason,
                  verificationStatus: verification.status,
                },
              },
            },
          }).catch(() => {
            // Mutation operation might not support JSON push — log instead
            logger.warn("[AutonomousVerifier] Could not flag rollback candidate in DB", {
              operationId: trace.operationId,
            });
          });
        }

        logger.warn("[AutonomousVerifier] DEGRADED outcome — flagged as rollback candidate", {
          traceId,
          operationId: trace.operationId,
          reason: verification.reason,
        });

        // DO NOT auto-rollback. Create a notification for human review.
      });
    }

    logger.info("[AutonomousVerifier] Verification complete", {
      traceId,
      status: verification.status,
      reason: verification.reason,
    });

    return {
      traceId,
      status: verification.status,
      reason: verification.reason,
    };
  }
);

// ── Metrics Collection ──────────────────────────────────────────────────────

async function collectCurrentMetrics(
  siteId: string,
  operationId: string | null,
  actionType: string
): Promise<Record<string, number>> {
  // Collect available metrics from GSC, rank trackers, etc.
  // This is a baseline implementation — extend with real data sources.
  const { prisma } = await import("@/lib/prisma");

  const metrics: Record<string, number> = {};

  try {
    // Latest GSC performance data
    const latestGsc = await (prisma as any).gscDailyPerformance.findFirst({
      where: { siteId },
      orderBy: { date: "desc" },
      select: { clicks: true, impressions: true, position: true, ctr: true },
    });

    if (latestGsc) {
      metrics.gsc_clicks = latestGsc.clicks ?? 0;
      metrics.gsc_impressions = latestGsc.impressions ?? 0;
      metrics.gsc_position = latestGsc.position ?? 0;
      metrics.gsc_ctr = latestGsc.ctr ?? 0;
    }

    // Count of indexed pages (from IndexNow logs)
    const indexedCount = await (prisma as any).indexingLog.count({
      where: { siteId, status: "SUCCESS" },
    });
    metrics.indexed_pages = indexedCount;
  } catch (err) {
    logger.warn("[AutonomousVerifier] Error collecting metrics", {
      siteId,
      error: (err as Error)?.message,
    });
  }

  return metrics;
}

// ── Outcome Evaluation ──────────────────────────────────────────────────────

interface OutcomeEvaluation {
  status: VerificationStatus;
  reason: string;
}

function evaluateOutcome(
  baseline: Record<string, number> | null,
  current: Record<string, number>
): OutcomeEvaluation {
  // Insufficient data
  if (!baseline || Object.keys(baseline).length === 0) {
    return {
      status: "INSUFFICIENT_DATA",
      reason: "No baseline metrics available for comparison",
    };
  }

  if (Object.keys(current).length === 0) {
    return {
      status: "INSUFFICIENT_DATA",
      reason: "No current metrics available for comparison",
    };
  }

  // Compare key metrics
  const clicksDelta = (current.gsc_clicks ?? 0) - (baseline.gsc_clicks ?? 0);
  const impressionsDelta = (current.gsc_impressions ?? 0) - (baseline.gsc_impressions ?? 0);
  const positionDelta = (current.gsc_position ?? 0) - (baseline.gsc_position ?? 0);

  // Position: lower is better, so negative delta = improvement
  const positionImproved = positionDelta < -0.5;
  const positionDegraded = positionDelta > 1.0;

  const clicksImproved = clicksDelta > 0;
  const impressionsImproved = impressionsDelta > 0;

  // Significant degradation: position worsened AND clicks/impressions dropped
  if (positionDegraded && clicksDelta < 0) {
    return {
      status: "DEGRADED",
      reason: `Position degraded by ${positionDelta.toFixed(1)} and clicks dropped by ${Math.abs(clicksDelta)}`,
    };
  }

  // Clear improvement
  if (positionImproved || (clicksImproved && impressionsImproved)) {
    return {
      status: "IMPROVED",
      reason: `Position delta: ${positionDelta.toFixed(1)}, clicks delta: ${clicksDelta}, impressions delta: ${impressionsDelta}`,
    };
  }

  // Minor changes — inconclusive
  if (Math.abs(positionDelta) <= 0.5 && Math.abs(clicksDelta) <= 2) {
    return {
      status: "UNCHANGED",
      reason: `Metrics within noise threshold (position Δ${positionDelta.toFixed(1)}, clicks Δ${clicksDelta})`,
    };
  }

  return {
    status: "INCONCLUSIVE",
    reason: `Mixed signals: position Δ${positionDelta.toFixed(1)}, clicks Δ${clicksDelta}, impressions Δ${impressionsDelta}`,
  };
}
