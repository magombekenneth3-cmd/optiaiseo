/**
 * Phase C — Autonomous Executor (Inngest)
 *
 * The orchestration loop that discovers, evaluates, and executes
 * autonomous SEO optimizations.
 *
 * Triggers: cron (every 15 min) OR event (opportunity.scored)
 *
 * Execution order (from the revised spec):
 *   1. Load site + operating mode
 *   2. Query OPEN opportunities ordered by score DESC
 *   3. For each opportunity:
 *      a. Validate opportunity still OPEN
 *      b. Generate / load existing proposal
 *      c. Calculate risk
 *      d. Determine safety tier
 *      e. Pass through AUTONOMY GATE (policy-gate.ts)
 *      f. If AUTHORIZED: execute via Phase B mutation lifecycle
 *      g. If NEEDS_APPROVAL: create pending proposal, notify user
 *      h. If BLOCKED: log reason, skip
 *   4. Record execution trace
 *
 * INVARIANT: The LLM proposes. The deterministic policy engine authorizes.
 * The LLM has zero authority over operating mode, safety tier, budget,
 * concurrency, approval requirements, circuit-breaker state, or retry authorization.
 */

import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { isReportOnly } from "@/lib/autonomy/operating-modes";
import { authorize, type AuthorizationRequest } from "@/lib/autonomy/policy-gate";
import { consumeReservation, releaseReservation } from "@/lib/autonomy/budget-enforcer";
import {
  completeClaim,
  releaseClaim,
  getWorkerId,
  verifyClaimBeforeExecution,
  StaleExecutionError,
} from "@/lib/autonomy/execution-claim";
import {
  recordSuccess as recordCircuitSuccess,
  recordFailure as recordCircuitFailure,
  type CircuitChannel,
} from "@/lib/autonomy/circuit-breaker";
import { classifyFailure } from "@/lib/autonomy/failure-classifier";
import { decideRetry } from "@/lib/autonomy/retry-policy";
import {
  createTrace,
  recordAuthorization,
  recordExecution,
  type TraceInit,
} from "@/lib/autonomy/execution-trace";
import { getSafetyTier, type ActionType } from "@/lib/proposals/types";
import { effectiveTierLimit } from "@/lib/autonomy/operating-modes";

// ── Channel Mapping ─────────────────────────────────────────────────────────

/**
 * Maps action types to their execution channel for circuit breaker scoping.
 * Default is "wordpress" (CMS) since most mutations target the site CMS.
 */
function actionToChannel(actionType: string): CircuitChannel {
  const mapping: Record<string, CircuitChannel> = {
    // GitHub-targeted actions
    FIX_BROKEN_LINK: "github",
    ADD_INTERNAL_LINKS: "github",
    // IndexNow-targeted actions
    // (IndexNow is triggered as a secondary effect, not a primary channel)
  };
  return mapping[actionType] ?? "wordpress";
}

// ── Cron-Triggered Executor ─────────────────────────────────────────────────

export const autonomousExecutorCron = inngest.createFunction(
  {
    id: "autonomous-executor-cron",
    name: "Autonomous Executor: Cron Sweep",
    retries: 1,
    concurrency: { limit: 3 },
    triggers: [{ cron: "*/15 * * * *" }], // Every 15 minutes
  },
  async ({ step }: { step: any }) => {
    // Find all sites with autonomous modes enabled
    const sites = await step.run("find-autonomous-sites", async () => {
      const { prisma } = await import("@/lib/prisma");

      const results = await (prisma as any).site.findMany({
        where: {
          operatingMode: { in: ["SUPERVISED", "AUTOPILOT"] },
          automationsPaused: false,
        },
        select: { id: true, operatingMode: true },
      });

      return results as { id: string; operatingMode: string }[];
    });

    logger.info("[AutonomousExecutor] Cron sweep started", {
      sitesCount: sites.length,
    });

    // Trigger per-site executor for each
    for (const site of sites) {
      await step.sendEvent(`execute-site-${site.id}`, {
        name: "autonomous.execute-site",
        data: {
          siteId: site.id,
          triggerType: "CRON",
        },
      });
    }

    return {
      status: "COMPLETED",
      sitesQueued: sites.length,
    };
  }
);

// ── Per-Site Executor (Event-Triggered) ─────────────────────────────────────

export const autonomousExecutorSite = inngest.createFunction(
  {
    id: "autonomous-executor-site",
    name: "Autonomous Executor: Per-Site",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [
      { event: "autonomous.execute-site" },
      { event: "opportunity.scored" },
    ],
  },
  async ({
    event,
    step,
  }: {
    event: { data: { siteId: string; triggerType?: string; opportunityId?: string } };
    step: any;
  }) => {
    const { siteId, triggerType = "EVENT", opportunityId: specificOpportunityId } = event.data;

    // ── Step 1: Load site + validate mode ─────────────────────────────────
    const site = await step.run("load-site", async () => {
      const { prisma } = await import("@/lib/prisma");

      return (prisma as any).site.findUnique({
        where: { id: siteId },
        select: {
          id: true,
          operatingMode: true,
          automationsPaused: true,
          dailyMutationLimit: true,
          maxConcurrentExecutions: true,
        },
      });
    });

    if (!site) {
      logger.warn("[AutonomousExecutor] Site not found", { siteId });
      return { status: "SITE_NOT_FOUND" };
    }

    if (isReportOnly(site.operatingMode)) {
      return { status: "REPORT_ONLY", siteId };
    }

    if (site.automationsPaused) {
      return { status: "PAUSED", siteId };
    }

    // ── Step 2: Query open opportunities ──────────────────────────────────
    const opportunities = await step.run("query-opportunities", async () => {
      const { prisma } = await import("@/lib/prisma");

      const where: any = {
        siteId,
        opportunityStatus: "OPEN",
      };

      // If triggered by a specific opportunity, only process that one
      if (specificOpportunityId) {
        where.id = specificOpportunityId;
      }

      return (prisma as any).growthDecision.findMany({
        where,
        orderBy: { score: "desc" },
        take: 5, // Process up to 5 per cycle
        select: {
          id: true,
          score: true,
          category: true,
          actionProposals: {
            where: {
              status: { in: ["PENDING_APPROVAL", "APPROVED", "EXECUTING"] },
            },
            select: { id: true, status: true, actionType: true },
            take: 1,
          },
        },
      });
    });

    if (!opportunities || opportunities.length === 0) {
      return { status: "NO_OPPORTUNITIES", siteId };
    }

    // ── Step 3: Process each opportunity ──────────────────────────────────
    const results: any[] = [];

    for (const opp of opportunities) {
      const result = await step.run(`process-opportunity-${opp.id}`, async () => {
        return processOpportunity({
          siteId,
          site,
          opportunity: opp,
          triggerType: triggerType as "CRON" | "EVENT" | "MANUAL",
        });
      });

      results.push(result);

      // Stop if budget is exhausted
      if (result.failedGate === "budget") {
        logger.info("[AutonomousExecutor] Budget exhausted — stopping", { siteId });
        break;
      }
    }

    return {
      status: "COMPLETED",
      siteId,
      processed: results.length,
      authorized: results.filter((r: any) => r.decision === "AUTO_EXECUTE").length,
      needsApproval: results.filter((r: any) => r.decision === "NEEDS_APPROVAL").length,
      blocked: results.filter((r: any) => r.decision === "BLOCKED").length,
    };
  }
);

// ── Opportunity Processing ──────────────────────────────────────────────────

interface ProcessOpportunityParams {
  siteId: string;
  site: { operatingMode: string };
  opportunity: {
    id: string;
    score: number;
    category: string;
    actionProposals: { id: string; status: string; actionType: string }[];
  };
  triggerType: "CRON" | "EVENT" | "MANUAL";
}

async function processOpportunity(params: ProcessOpportunityParams) {
  const { siteId, site, opportunity, triggerType } = params;

  // Skip opportunities that already have active proposals
  if (opportunity.actionProposals.length > 0) {
    return {
      opportunityId: opportunity.id,
      decision: "SKIPPED",
      reason: "Active proposal already exists",
    };
  }

  // Determine action type from opportunity category
  const actionType = mapCategoryToActionType(opportunity.category);
  if (!actionType) {
    return {
      opportunityId: opportunity.id,
      decision: "SKIPPED",
      reason: `No action type mapping for category: ${opportunity.category}`,
    };
  }

  const safetyTier = getSafetyTier(actionType);
  const channel = actionToChannel(actionType);

  // Create execution trace
  const traceId = await createTrace({
    siteId,
    triggerType,
    opportunityId: opportunity.id,
    opportunityScore: opportunity.score,
    actionType,
    safetyTier,
    operatingMode: site.operatingMode,
    effectiveTierLimit: effectiveTierLimit(site),
    actorType: "SYSTEM",
    actorId: `system:autonomous-executor:${triggerType.toLowerCase()}`,
    discoveredAt: new Date(),
  });

  // Build authorization request
  const authReq: AuthorizationRequest = {
    siteId,
    opportunityId: opportunity.id,
    proposalId: `pending-${opportunity.id}`, // Will be replaced with real proposal ID
    actionType,
    safetyTier,
    riskLevel: "LOW", // Will be refined after proposal generation
    riskScore: 0,
    channel,
    actorType: "SYSTEM",
    actorId: `system:autonomous-executor:${triggerType.toLowerCase()}`,
    traceId,
  };

  // Pass through the autonomy gate
  const decision = await authorize(authReq);

  // Record authorization in trace
  await recordAuthorization(traceId, {
    policyDecision: decision.authorized ? "AUTO_EXECUTE" : (decision as any).action,
    policyReason: decision.reason,
    budgetReservationId: decision.authorized ? decision.reservationId : undefined,
    circuitBreakerState: decision.authorized ? decision.circuitBreakerState : undefined,
  });

  if (!decision.authorized) {
    const nonAuth = decision as { action: string; reason: string; failedGate: string };

    // If NEEDS_APPROVAL, trigger proposal generation for human review
    if (nonAuth.action === "NEEDS_APPROVAL") {
      logger.info("[AutonomousExecutor] Needs approval — generating proposal", {
        opportunityId: opportunity.id,
        reason: nonAuth.reason,
      });

      // Proposal generation will be handled by the existing proposal.generate flow
    }

    return {
      opportunityId: opportunity.id,
      decision: nonAuth.action,
      reason: nonAuth.reason,
      failedGate: nonAuth.failedGate,
    };
  }

  // ── AUTHORIZED: Execute ─────────────────────────────────────────────────
  const auth = decision as {
    authorized: true;
    reservationId: string;
    claimId: string;
    workerId: string;
    generation: number;
    circuitBreakerState: string;
    isProbe: boolean;
  };

  try {
    // Import proposal generator
    const { generateProposal, runAction } = await import("@/lib/proposals");

    // Generate proposal
    const proposal = await generateProposal({
      decisionId: opportunity.id,
      actorId: `system:autonomous-executor:${triggerType.toLowerCase()}`,
    });

    if (!proposal.proposalId) {
      throw new Error("Proposal generation returned no proposalId");
    }

    // ── FENCING CHECK — immediately before Phase B mutation boundary ────
    // If our claim was released by the reconciler during proposal generation
    // (e.g., slow LLM work > 10 min), a new worker may have re-acquired the
    // claim with a higher generation. This check blocks stale execution.
    await verifyClaimBeforeExecution(auth.claimId, auth.workerId, auth.generation);

    // Execute the action (Phase B mutation boundary)
    const actionResult = await runAction({ proposalId: proposal.proposalId });

    // Success path
    await consumeReservation(auth.reservationId, actionResult.operationId ?? proposal.proposalId);
    await completeClaim(auth.claimId, auth.workerId, auth.generation);
    await recordCircuitSuccess(siteId, channel);

    // Record execution in trace
    await recordExecution(traceId, {
      operationId: actionResult.operationId ?? "",
      proposalId: proposal.proposalId,
      attemptNumber: 1,
      executionResult: "SUCCESS",
      retryCount: 0,
    });

    logger.info("[AutonomousExecutor] Execution successful", {
      opportunityId: opportunity.id,
      proposalId: proposal.proposalId,
      operationId: actionResult.operationId,
    });

    return {
      opportunityId: opportunity.id,
      decision: "AUTO_EXECUTE",
      result: "SUCCESS",
      proposalId: proposal.proposalId,
    };
  } catch (err) {
    // Failure path — classify and handle
    const error = err as Error;
    const failureClass = classifyFailure(error, { errorMessage: error.message });
    const retryDecision = decideRetry(failureClass, 1);

    // Release reservations
    await releaseReservation(auth.reservationId, `Execution failed: ${failureClass}`);
    await releaseClaim(auth.claimId, auth.workerId, auth.generation, `Execution failed: ${failureClass}`);
    await recordCircuitFailure(siteId, channel);

    // Record execution failure in trace
    await recordExecution(traceId, {
      operationId: "",
      attemptNumber: 1,
      executionResult: "FAILED",
      failureClass,
      retryCount: 0,
    });

    logger.error("[AutonomousExecutor] Execution failed", {
      opportunityId: opportunity.id,
      failureClass,
      retryDecision: retryDecision.reason,
      error: error.message,
    });

    return {
      opportunityId: opportunity.id,
      decision: "AUTO_EXECUTE",
      result: "FAILED",
      failureClass,
      retryable: retryDecision.shouldRetry,
    };
  }
}

// ── Category → ActionType Mapping ───────────────────────────────────────────

/**
 * Maps growth opportunity categories to actionable action types.
 * Returns null for categories that don't have a direct action mapping.
 */
function mapCategoryToActionType(category: string): ActionType | null {
  const mapping: Record<string, ActionType> = {
    missing_meta_description: "UPDATE_META_DESCRIPTION",
    weak_meta_description: "UPDATE_META_DESCRIPTION",
    missing_title_tag: "UPDATE_TITLE_TAG",
    weak_title_tag: "UPDATE_TITLE_TAG",
    heading_hierarchy: "FIX_HEADING_HIERARCHY",
    missing_schema: "ADD_SCHEMA_MARKUP",
    missing_canonical: "ADD_CANONICAL_TAG",
    broken_links: "FIX_BROKEN_LINK",
    internal_linking: "ADD_INTERNAL_LINKS",
    duplicate_canonical: "CHANGE_CANONICAL",
    robots_meta: "MODIFY_ROBOTS_META",
    redirect_needed: "REDIRECT_URL",
    content_refresh: "REFRESH_CONTENT",
    content_brief: "GENERATE_CONTENT_BRIEF",
  };
  return mapping[category] ?? null;
}
