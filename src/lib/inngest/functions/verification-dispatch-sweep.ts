import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { computeDeploymentIdempotencyKey } from "@/lib/seo-audit/lifecycle";

const LEASE_TIMEOUT_MS = 2 * 60 * 1000;

export const verificationDispatchSweepJob = inngest.createFunction(
  {
    id: "verification-dispatch-sweep",
    name: "Sweep Undispatched Verification Obligations",
    retries: 1,
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
    const leaseExpiry = new Date(Date.now() - LEASE_TIMEOUT_MS);

    await step.run("reclaim-stale-dispatching", async () => {
      const reclaimed = await prisma.seoFixProposal.updateMany({
        where: {
          status: "DEPLOYED",
          verificationStatus: "DISPATCHING",
          updatedAt: { lte: leaseExpiry },
        },
        data: { verificationStatus: "PENDING" },
      });
      if (reclaimed.count > 0) {
        logger.warn("[VerificationSweep] Reclaimed stale DISPATCHING records", {
          count: reclaimed.count,
        });
      }
      return { reclaimed: reclaimed.count };
    });

    const undispatched = await step.run("find-undispatched", async () => {
      const rows = await prisma.seoFixProposal.findMany({
        where: {
          status: "DEPLOYED",
          diagnosticFindingId: { not: null },
          verificationStatus: "PENDING",
          deployedAt: { lte: staleThreshold },
        },
        select: {
          id: true,
          siteId: true,
          diagnosticFindingId: true,
          findingFingerprint: true,
          deploymentUrl: true,
          deploymentCommitSha: true,
          deploymentId: true,
          verificationCriteria: true,
        },
        take: 20,
      });
      return rows;
    });

    if (undispatched.length === 0) {
      return { recovered: 0, failed: 0, skipped: 0, total: 0 };
    }

    logger.info("[VerificationSweep] Found undispatched verification obligations", {
      count: undispatched.length,
    });

    const results: Array<{ proposalId: string; status: "recovered" | "failed" | "skipped" }> = [];

    for (const proposal of undispatched) {
      if (!proposal.diagnosticFindingId) continue;

      const deploymentRevision = proposal.deploymentCommitSha ?? proposal.deploymentId ?? proposal.id;

      const result = await step.run(`recover-${proposal.id}`, async () => {
        const claimed = await prisma.seoFixProposal.updateMany({
          where: {
            id: proposal.id,
            verificationStatus: "PENDING",
          },
          data: { verificationStatus: "DISPATCHING" },
        });

        if (claimed.count === 0) {
          return { proposalId: proposal.id, status: "skipped" as const };
        }

        try {
          await inngest.send({
            name: "seo/fix.deployed",
            data: {
              siteId: proposal.siteId,
              findingDbId: proposal.diagnosticFindingId,
              findingFingerprint: proposal.findingFingerprint,
              url: proposal.deploymentUrl,
              deploymentRevision,
              proposalId: proposal.id,
              verificationCriteria: proposal.verificationCriteria ?? [],
              idempotencyKey: computeDeploymentIdempotencyKey(
                proposal.siteId,
                proposal.diagnosticFindingId!,
                deploymentRevision,
              ),
            },
          });

          await prisma.seoFixProposal.update({
            where: { id: proposal.id },
            data: { verificationStatus: "DISPATCHED" },
          });

          return { proposalId: proposal.id, status: "recovered" as const };
        } catch (err) {
          logger.error("[VerificationSweep] Recovery dispatch failed — will retry on next sweep", {
            proposalId: proposal.id,
            error: (err as Error)?.message,
          });
          return { proposalId: proposal.id, status: "failed" as const };
        }
      });

      results.push(result);
    }

    const recovered = results.filter((r) => r.status === "recovered").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    if (failed > 0) {
      logger.error("[VerificationSweep] Some obligations remain undispatched", { failed, recovered, skipped });
    }

    return { recovered, failed, skipped, total: undispatched.length };
  },
);
