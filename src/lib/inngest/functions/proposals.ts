/**
 * Phase B — Inngest Background Jobs for Action Proposals
 *
 * Jobs:
 *   1. proposalGeneratorJob   — Triggered by `proposal.generate` event
 *   2. actionRunnerJob        — Triggered by `proposal.execute` event
 *   3. proposalVerificationJob — Triggered by `proposal.verify` event
 *   4. proposalExpireCron     — Cron (every 15 min): expires stale approvals
 */

import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  generateProposal,
  runAction,
  verifyProposal,
  getVerificationDelay,
  type ActionType,
} from "@/lib/proposals";
import { transitionOpportunity } from "@/lib/proposals/opportunity-lifecycle";
import type { OpportunityStatus } from "@/lib/proposals/types";

// ── 1. Proposal Generator Job ───────────────────────────────────────────────

export const proposalGeneratorJob = inngest.createFunction(
  {
    id: "proposal-generator",
    name: "Proposal Generator: Opportunity to Action",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: "proposal.generate" }],
  },
  async ({ event, step }: { event: { data: { decisionId: string; siteId: string } }; step: any }) => {
    const { decisionId, siteId } = event.data;

    const result = await step.run("generate-proposal", async () => {
      return generateProposal({
        decisionId,
        actorId: "system:inngest:proposal-generator",
      });
    });

    logger.info("[ProposalInngest] Generation result", {
      siteId,
      decisionId,
      result,
    });

    // If auto-approved, trigger execution immediately
    if (result.autoApproved && result.proposalId) {
      await step.sendEvent("trigger-execution", {
        name: "proposal.execute",
        data: {
          proposalId: result.proposalId,
          siteId,
        },
      });
    }

    return result;
  }
);

// ── 2. Action Runner Job ────────────────────────────────────────────────────

export const actionRunnerJob = inngest.createFunction(
  {
    id: "action-runner",
    name: "Action Runner: Execute Proposal",
    retries: 1,
    concurrency: { limit: 2 },
    triggers: [{ event: "proposal.execute" }],
  },
  async ({ event, step }: { event: { data: { proposalId: string; siteId: string } }; step: any }) => {
    const { proposalId, siteId } = event.data;

    const result = await step.run("run-action", async () => {
      return runAction({
        proposalId,
        workerId: "system:inngest:action-runner",
      });
    });

    logger.info("[ProposalInngest] Action runner result", {
      siteId,
      proposalId,
      result,
    });

    if (result.status === "EXECUTED") {
      // Fetch actionType to determine verification delay
      const proposal = await (prisma as any).actionProposal.findUnique({
        where: { id: proposalId },
        select: { actionType: true },
      });

      const delayMs = proposal
        ? getVerificationDelay(proposal.actionType as ActionType)
        : 5 * 60 * 1000;

      // Schedule verification after delay
      await step.sendEvent("trigger-verification", {
        name: "proposal.verify",
        data: {
          proposalId,
          siteId,
        },
        ts: Date.now() + delayMs,
      });
    }

    return result;
  }
);

// ── 3. Verification Job ─────────────────────────────────────────────────────

export const proposalVerificationJob = inngest.createFunction(
  {
    id: "proposal-verifier",
    name: "Proposal Verifier: Outcome Verification Loop",
    retries: 2,
    concurrency: { limit: 3 },
    triggers: [{ event: "proposal.verify" }],
  },
  async ({ event, step }: { event: { data: { proposalId: string; siteId: string } }; step: any }) => {
    const { proposalId, siteId } = event.data;

    const result = await step.run("verify-proposal", async () => {
      return verifyProposal({ proposalId });
    });

    logger.info("[ProposalInngest] Verification result", {
      siteId,
      proposalId,
      outcome: result.outcome,
      durationMs: result.durationMs,
    });

    return result;
  }
);

// ── 4. Approval Expiration Cron Job ─────────────────────────────────────────

export const proposalExpireCron = inngest.createFunction(
  {
    id: "proposal-expire-cron",
    name: "Proposal Expire Cron",
    retries: 1,
    triggers: [{ cron: "*/15 * * * *" }], // Every 15 minutes
  },
  async ({ step }: { step: any }) => {
    return await step.run("expire-stale-approvals", async () => {
      const now = new Date();

      // Find proposals where approval has expired
      const staleProposals = await (prisma as any).actionProposal.findMany({
        where: {
          status: { in: ["READY", "APPROVED"] },
          approvalExpiresAt: { lte: now },
        },
        select: { id: true, decisionId: true, status: true },
      });

      let expiredCount = 0;
      for (const prop of staleProposals) {
        // 1. Mark proposal as EXPIRED
        await (prisma as any).actionProposal.update({
          where: { id: prop.id },
          data: {
            status: "EXPIRED",
            completedAt: now,
          },
        });

        // 2. Transition opportunity through the state machine guard.
        //    PROPOSED → EXPIRED and APPROVED → EXPIRED are valid transitions.
        //    We attempt both possible source states — only one will match
        //    due to the CAS guard inside transitionOpportunity().
        const eligibleFromStatuses: OpportunityStatus[] = ["PROPOSED", "APPROVED"];
        for (const fromStatus of eligibleFromStatuses) {
          try {
            const transitioned = await transitionOpportunity({
              decisionId: prop.decisionId,
              from: fromStatus,
              to: "EXPIRED",
              actorId: "system:inngest:expire-cron",
              reason: `Approval expired for proposal ${prop.id}`,
              proposalId: prop.id,
            });
            if (transitioned) break; // One source matched — no need to try the other
          } catch {
            // assertValidOpportunityTransition throws if the transition is invalid.
            // This means the opportunity was already in a different state — log and skip.
            logger.warn("[ProposalInngest] Could not transition opportunity to EXPIRED", {
              decisionId: prop.decisionId,
              attemptedFrom: fromStatus,
              proposalId: prop.id,
            });
          }
        }

        expiredCount++;
      }

      logger.info("[ProposalInngest] Expired stale approvals", {
        count: expiredCount,
      });

      return { expiredCount };
    });
  }
);
