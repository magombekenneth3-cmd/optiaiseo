// =============================================================================
// STALE RUN CLEANUP — Inngest cron task for recovering stuck runs
//
// Triggers every 15 minutes. Identifies AgentRuns stuck in QUEUED or RUNNING
// state by checking lastHeartbeatAt (preferred) or startedAt (fallback).
// Marks them FAILED and force-expires their analysis locks.
//
// Why lastHeartbeatAt?
//   A run that started 40 minutes ago but has a lastHeartbeatAt of 2 minutes ago
//   is healthy — it's a legitimately long crawl. Only runs whose heartbeat has
//   stopped are truly stale.
// =============================================================================

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { forceExpireAnalysisLock } from "@/lib/agents/analysis-lock";


const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export const staleRunCleanup = inngest.createFunction(
  {
    id: "stale-run-cleanup",
    name: "Stale Run Cleanup Cron",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const staleRuns = await step.run("find-stale-runs", async () => {
      return prisma.agentRun.findMany({
        where: {
          status: { in: ["QUEUED", "RUNNING"] },
          OR: [
            // Heartbeat stopped: last heartbeat exceeds threshold
            { lastHeartbeatAt: { lt: cutoff } },
            // Never got a heartbeat AND started long ago (crashed before first heartbeat)
            { lastHeartbeatAt: null, startedAt: { lt: cutoff } },
            // Queued but never started (startedAt is null) and created long ago
            { lastHeartbeatAt: null, startedAt: null, createdAt: { lt: cutoff } },
          ],
        },
        select: { id: true, siteId: true, agentType: true, startedAt: true, lastHeartbeatAt: true },
      });
    });

    if (staleRuns.length === 0) {
      return { cleanedCount: 0 };
    }

    logger.warn("[StaleRunCleanup] Found stale agent runs", {
      count: staleRuns.length,
      runs: staleRuns.map((r) => ({
        id: r.id,
        agentType: r.agentType,
        startedAt: String(r.startedAt ?? "null"),
        lastHeartbeatAt: String(r.lastHeartbeatAt ?? "null"),
      })),
    });

    await step.run("cleanup-stale-runs", async () => {
      const siteIdsToUnlock = new Set<string>();

      for (const run of staleRuns) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            metadata: {
              fatalError: "stale_run_timeout",
              lastHeartbeatAt: run.lastHeartbeatAt ?? null,
              startedAt: run.startedAt ?? null,
              detectedAt: new Date().toISOString(),
            } as object,
          },
        });

        if (run.agentType === "ORCHESTRATOR") {
          siteIdsToUnlock.add(run.siteId);
        }
      }

      // Force expire locks for sites with stuck orchestrators
      for (const siteId of siteIdsToUnlock) {
        await forceExpireAnalysisLock(siteId);
      }
    });

    return { cleanedCount: staleRuns.length };
  },
);
