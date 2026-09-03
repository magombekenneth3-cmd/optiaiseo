/**
 * Phase D.3 — Planner Orchestrator
 *
 * The main entry point for autonomous action planning.
 *
 * Flow:
 *   loadPlanningInput(opportunityId)
 *     ↓
 *   validatePlanningInput() — 5 pre-checks
 *     ↓
 *   selectActionType(category, action) — deterministic
 *     ↓
 *   planner.canPlan(input)?
 *     ↓
 *   planner.plan(input) → ActionPlan
 *     ↓
 *   validatePlan() — 5 post-checks
 *     ↓
 *   verifyPlanningEvidenceFence()
 *     ↓
 *   D.4 enhancePlanWithLLM() — optional, fail-safe
 *     ↓
 *   createDraftProposal() → ActionProposal(DRAFT)
 *
 * INVARIANT: D.3 stops at DRAFT. It does NOT:
 *   - Set APPROVED
 *   - Reserve budget
 *   - Invoke execution
 *   - Import from mutations/ or autonomy/execution-claim
 *
 * D.4 is optional and fail-safe:
 *   - LLM disabled → exact D.3 template path
 *   - LLM failure → D.3 template fallback
 *   - LLM success → enhanced ProposedChange[] (still DRAFT)
 */

import { logger } from "@/lib/logger";
import type { PlanningInput, PlanningResult, PlanningReason } from "./types";
import type { ProposedChange } from "@/lib/proposals/types";
import { PLANNING_VERSION } from "./types";
import { selectActionType } from "./action-taxonomy";
import { getPlanner } from "./action-planners";
import { validatePlanningInput, validatePlan } from "./validator";
import { verifyPlanningEvidenceFence } from "./planning-fence";
import {
  createDraftProposal,
  type DraftProposalResult,
} from "@/lib/proposals/draft-proposal";
import { enhancePlanWithLLM } from "@/lib/llm-boundary";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlanOpportunityResult extends PlanningResult {
  proposalId: string | null;
  proposalStatus: string | null;
}

// ── Data Loading ────────────────────────────────────────────────────────────

/**
 * Loads the full planning input for an opportunity from the database.
 */
export async function loadPlanningInput(
  opportunityId: string
): Promise<PlanningInput | null> {
  const { prisma } = await import("@/lib/prisma");

  const decision = await (prisma as any).growthDecision.findUnique({
    where: { id: opportunityId },
    include: {
      site: { select: { id: true, domain: true } },
      sourceFindings: {
        include: {
          finding: {
            select: {
              id: true,
              type: true,
              severity: true,
              confidence: true,
            },
          },
        },
      },
      scoreRecords: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!decision) return null;

  // Build evidence from source findings
  const evidence = (decision.sourceFindings ?? []).map(
    (sf: { finding: { id: string; type: string; confidence: number | null }; createdAt: Date }) => ({
      id: sf.finding.id,
      sourceType: sf.finding.type,
      metric: undefined,
      value: undefined,
      observedAt: sf.createdAt,
    })
  );

  // Get the latest score record
  const scoreRecord = decision.scoreRecords?.[0] ?? null;

  return {
    opportunity: {
      id: decision.id,
      siteId: decision.siteId,
      url: decision.url,
      primaryKeyword: decision.primaryKeyword ?? "",
      category: decision.category ?? decision.action,
      action: decision.action,
      opportunityStatus: decision.opportunityStatus ?? "OPEN",
      expiresAt: decision.expiresAt,
      discoveryConfidence: decision.discoveryConfidence ?? null,
    },
    scoreRecord: scoreRecord
      ? {
          id: scoreRecord.id,
          finalScore: scoreRecord.finalScore,
          decision: scoreRecord.decision,
          evidenceHash: scoreRecord.evidenceHash,
          scoringVersion: scoreRecord.scoringVersion,
          impactScore: scoreRecord.impactScore,
          confidenceScore: scoreRecord.confidenceScore,
          urgencyScore: scoreRecord.urgencyScore,
        }
      : null,
    evidence,
    site: {
      id: decision.site?.id ?? decision.siteId,
      domain: decision.site?.domain ?? "",
    },
  };
}

// ── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Plans an action for an OPEN opportunity.
 *
 * Returns PLAN + proposalId if successful.
 * Returns DEFER/REJECT + reasons if not.
 *
 * Does NOT fall through to alternative actions if the preferred fails.
 */
export async function planOpportunity(
  opportunityId: string
): Promise<PlanOpportunityResult> {
  // 1. Load planning input
  const input = await loadPlanningInput(opportunityId);

  if (!input) {
    return {
      decision: "REJECT",
      plan: null,
      reasons: [{
        rule: "NOT_FOUND",
        details: `Opportunity ${opportunityId} not found`,
      }],
      opportunityId,
      proposalId: null,
      proposalStatus: null,
    };
  }

  // 2. Validate planning input (checks 1-5)
  const inputValidation = validatePlanningInput(input);
  if (!inputValidation.valid) {
    logger.info("[Planner] Input validation failed", {
      opportunityId,
      decision: inputValidation.decision,
      reasons: inputValidation.reasons,
    });
    return {
      decision: inputValidation.decision,
      plan: null,
      reasons: inputValidation.reasons,
      opportunityId,
      proposalId: null,
      proposalStatus: null,
    };
  }

  // 3. Select action type (deterministic, no fallthrough)
  const actionType = selectActionType(
    input.opportunity.category,
    input.opportunity.action
  );

  if (!actionType) {
    return {
      decision: "REJECT",
      plan: null,
      reasons: [{
        rule: "NO_ACTION_TYPE",
        details: `No action type found for category ${input.opportunity.category}`,
      }],
      opportunityId,
      proposalId: null,
      proposalStatus: null,
    };
  }

  // 4. Get the planner for this action type
  const planner = getPlanner(actionType);
  if (!planner) {
    return {
      decision: "REJECT",
      plan: null,
      reasons: [{
        rule: "NO_PLANNER",
        details: `No planner registered for action ${actionType}`,
      }],
      opportunityId,
      proposalId: null,
      proposalStatus: null,
    };
  }

  // 5. Check if planner can plan
  if (!planner.canPlan(input)) {
    return {
      decision: "DEFER",
      plan: null,
      reasons: [{
        rule: "PLANNER_CANNOT_PLAN",
        details: `Planner for ${actionType} cannot plan with current evidence`,
      }],
      opportunityId,
      proposalId: null,
      proposalStatus: null,
    };
  }

  // 6. Generate the plan
  const plan = planner.plan(input);

  // 7. Validate the plan (checks 6-10)
  const planValidation = validatePlan(plan, input);
  if (!planValidation.valid) {
    logger.info("[Planner] Plan validation failed", {
      opportunityId,
      actionType,
      decision: planValidation.decision,
      reasons: planValidation.reasons,
    });
    return {
      decision: planValidation.decision,
      plan: null,
      reasons: planValidation.reasons,
      opportunityId,
      proposalId: null,
      proposalStatus: null,
    };
  }

  // 8. Evidence fence — verify evidence hasn't changed since scoring
  if (input.scoreRecord && plan.evidenceHash) {
    const fence = verifyPlanningEvidenceFence(input, plan.evidenceHash);
    if (!fence.valid) {
      logger.warn("[Planner] Evidence fence failed", {
        opportunityId,
        reason: fence.reason,
      });
      return {
        decision: "DEFER",
        plan: null,
        reasons: [fence.reason!],
        opportunityId,
        proposalId: null,
        proposalStatus: null,
      };
    }
  }

  // 9. D.4 LLM Enhancement (optional, fail-safe)
  // Build D.3 template changes as fallback
  const templateChanges: ProposedChange[] = plan.rationale.map((r) => ({
    field: r.rule,
    currentValue: null,
    proposedValue: r.details,
    reasoning: r.details,
  }));

  let finalChanges: readonly ProposedChange[] = templateChanges;
  let proposalMetadata: Record<string, unknown> | undefined;

  const enhancement = await enhancePlanWithLLM(plan, input, templateChanges);

  switch (enhancement.outcome) {
    case "ENHANCED":
      finalChanges = enhancement.changes;
      if (enhancement.audit) {
        proposalMetadata = { llm: enhancement.audit };
      }
      logger.info("[Planner] D.4 LLM enhancement applied", {
        opportunityId,
        actionType,
        confidence: enhancement.audit?.confidence,
      });
      break;

    case "FALLBACK":
      // LLM failed/rejected — use D.3 template changes
      finalChanges = templateChanges;
      if (enhancement.audit) {
        proposalMetadata = { llm: enhancement.audit };
      }
      logger.info("[Planner] D.4 LLM fallback to D.3 template", {
        opportunityId,
        reason: enhancement.reason,
      });
      break;

    case "DEFER":
      // Evidence changed during LLM call — discard, replan later
      logger.warn("[Planner] D.4 evidence changed during LLM call, deferring", {
        opportunityId,
        reason: enhancement.reason,
      });
      return {
        decision: "DEFER",
        plan: null,
        reasons: [{
          rule: "EVIDENCE_CHANGED_DURING_LLM",
          details: enhancement.reason,
        }],
        opportunityId,
        proposalId: null,
        proposalStatus: null,
      };

    case "SKIPPED":
      // LLM disabled or action not enhanceable — use D.3 template
      finalChanges = templateChanges;
      break;
  }

  // 10. Persist as DRAFT proposal via pure persistence boundary
  const draftResult = await createDraftProposal({
    siteId: plan.siteId,
    decisionId: plan.opportunityId,
    actionType: plan.actionType,
    targetUrl: plan.targetUrl,
    targetModel: plan.resourceType === "BLOG" ? "Blog" : plan.resourceType === "SITE" ? "Site" : "Page",
    targetId: plan.resourceId,
    proposedChanges: [...finalChanges],
    expectedOutcome: plan.expectedOutcome,
    confidence: input.scoreRecord?.finalScore
      ? input.scoreRecord.finalScore / 100
      : 0.5,
    generatedBy: `system:d3-planner/${PLANNING_VERSION}`,
    metadata: proposalMetadata,
  });

  logger.info("[Planner] Planning complete", {
    opportunityId,
    actionType,
    decision: "PLAN",
    proposalId: draftResult.proposalId,
    proposalStatus: draftResult.status,
    llmEnhanced: enhancement.outcome === "ENHANCED",
  });

  return {
    decision: "PLAN",
    plan,
    reasons: [{
      rule: "PLAN_CREATED",
      details: `${actionType} plan created as DRAFT proposal ${draftResult.proposalId}`,
    }],
    opportunityId,
    proposalId: draftResult.proposalId,
    proposalStatus: draftResult.status,
  };
}

