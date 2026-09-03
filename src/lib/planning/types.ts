/**
 * Phase D.3 — Planning Types
 *
 * Defines the planning contract: what goes in, what comes out.
 *
 * D.3 consumes:
 *   OPEN GrowthDecision + D.1 evidence + D.2 score record + site context
 *
 * D.3 produces:
 *   Typed ActionPlan → delegates to draft-proposal.ts for persistence
 *
 * INVARIANT: No D.3 type includes authorization, execution, or mutation fields.
 */

import type { ActionType } from "@/lib/proposals/types";

// ── Planning Version ────────────────────────────────────────────────────────

export const PLANNING_VERSION = "d3-v1";

// ── Planning Input ──────────────────────────────────────────────────────────

/** Data loaded for planning a single OPEN opportunity */
export interface PlanningInput {
  opportunity: {
    id: string;
    siteId: string;
    url: string;
    primaryKeyword: string;
    category: string;
    action: string;
    opportunityStatus: string;
    expiresAt: Date | null;
    discoveryConfidence: number | null;
  };
  scoreRecord: {
    id: string;
    finalScore: number;
    decision: string;
    evidenceHash: string;
    scoringVersion: string;
    impactScore: number;
    confidenceScore: number;
    urgencyScore: number;
  } | null;
  evidence: PlanningEvidence[];
  site: {
    id: string;
    domain: string;
  };
}

export interface PlanningEvidence {
  id: string;
  sourceType: string;
  metric?: string;
  value?: string;
  observedAt: Date;
}

// ── Action Plan ─────────────────────────────────────────────────────────────

/** The typed output of a deterministic planner */
export interface ActionPlan {
  opportunityId: string;
  siteId: string;
  actionType: ActionType;
  resourceType: "PAGE" | "BLOG" | "SITE";
  resourceId: string;
  targetUrl: string;
  rationale: PlanningReason[];
  evidenceIds: string[];
  expectedOutcome: string;
  constraints: PlanningConstraints;
  parameters: Record<string, unknown>;
  planningVersion: string;
  evidenceHash: string;
}

export interface PlanningReason {
  rule: string;
  details: string;
}

export interface PlanningConstraints {
  maxContentLengthDelta?: number;
  preserveExistingLinks?: boolean;
  requireCanonicalPreservation?: boolean;
  safetyTier: number;
}

// ── Planning Decision ───────────────────────────────────────────────────────

export type PlanningDecision = "PLAN" | "DEFER" | "REJECT";

export interface PlanningResult {
  decision: PlanningDecision;
  plan: ActionPlan | null;
  reasons: PlanningReason[];
  opportunityId: string;
}

// ── Action Planner Interface ────────────────────────────────────────────────

export interface ActionPlanner {
  /** The action type this planner handles */
  actionType: ActionType;

  /** Can this planner produce a plan for the given input? */
  canPlan(input: PlanningInput): boolean;

  /** Produce a typed action plan */
  plan(input: PlanningInput): ActionPlan;
}
