import type {
  PlanningInput,
  ActionPlan,
  PlanningDecision,
  PlanningReason,
} from "./types";
import { isActionAllowedForCategory } from "./action-taxonomy";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  decision: PlanningDecision;
  reasons: PlanningReason[];
}

// ── Public API ──────────────────────────────────────────────────────────────

export function validatePlanningInput(
  input: PlanningInput,
  now: Date = new Date()
): ValidationResult {
  const reasons: PlanningReason[] = [];
  let decision: PlanningDecision | null = null;

  // 1. Opportunity must be OPEN
  if (input.opportunity.opportunityStatus !== "OPEN") {
    reasons.push({
      rule: "NOT_OPEN",
      details: `Opportunity is ${input.opportunity.opportunityStatus}, not OPEN`,
    });
    if (!decision) decision = "REJECT";
  }

  // 2. Opportunity must not be expired
  if (input.opportunity.expiresAt && input.opportunity.expiresAt.getTime() <= now.getTime()) {
    reasons.push({
      rule: "EXPIRED",
      details: `Opportunity expired at ${input.opportunity.expiresAt.toISOString()}`,
    });
    if (!decision) decision = "REJECT";
  }

  // 3. Evidence must be fresh (at least one evidence item)
  if (input.evidence.length === 0) {
    reasons.push({
      rule: "NO_EVIDENCE",
      details: "No evidence items available",
    });
    if (!decision) decision = "DEFER";
  }

  // 4. Score record must exist
  if (!input.scoreRecord) {
    reasons.push({
      rule: "NO_SCORE_RECORD",
      details: "No D.2 score record found",
    });
    if (!decision) decision = "DEFER";
  }

  // 5. Score decision must be PROMOTE
  if (input.scoreRecord && input.scoreRecord.decision !== "PROMOTE") {
    reasons.push({
      rule: "SCORE_NOT_PROMOTE",
      details: `Score decision is ${input.scoreRecord.decision}, not PROMOTE`,
    });
    if (!decision) decision = "DEFER";
  }

  // All pre-conditions passed
  if (!decision) {
    decision = "PLAN";
  }

  return {
    valid: decision === "PLAN",
    decision,
    reasons,
  };
}

/**
 * Validates a generated plan before persistence.
 * Checks action compatibility, parameters, and resource targeting.
 */
export function validatePlan(
  plan: ActionPlan,
  input: PlanningInput
): ValidationResult {
  const reasons: PlanningReason[] = [];
  let decision: PlanningDecision | null = null;

  // 6. Action type must be allowed for category
  if (!isActionAllowedForCategory(plan.actionType, input.opportunity.category)) {
    reasons.push({
      rule: "ACTION_NOT_ALLOWED",
      details: `Action ${plan.actionType} is not allowed for category ${input.opportunity.category}`,
    });
    if (!decision) decision = "REJECT";
  }

  // 7. Target resource must exist (non-empty)
  if (!plan.resourceId) {
    reasons.push({
      rule: "NO_TARGET_RESOURCE",
      details: "Target resource ID is empty",
    });
    if (!decision) decision = "DEFER";
  }

  // 8. Target resource must belong to correct site
  if (plan.siteId !== input.opportunity.siteId) {
    reasons.push({
      rule: "SITE_MISMATCH",
      details: `Plan siteId ${plan.siteId} doesn't match opportunity siteId ${input.opportunity.siteId}`,
    });
    if (!decision) decision = "REJECT";
  }

  // 9. Required parameters must exist
  if (!plan.parameters || Object.keys(plan.parameters).length === 0) {
    reasons.push({
      rule: "MISSING_PARAMETERS",
      details: "Plan has no parameters",
    });
    if (!decision) decision = "REJECT";
  }

  // 10. Evidence must support the action (at least one evidence ID)
  if (plan.evidenceIds.length === 0) {
    reasons.push({
      rule: "NO_SUPPORTING_EVIDENCE",
      details: "Plan has no supporting evidence IDs",
    });
    if (!decision) decision = "DEFER";
  }

  if (!decision) {
    decision = "PLAN";
  }

  return {
    valid: decision === "PLAN",
    decision,
    reasons,
  };
}
