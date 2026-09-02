// =============================================================================
// SAFETY POLICY — Tiered Classification & Auto-Approve Logic
//
// Determines whether an ActionProposal can be auto-approved and auto-executed,
// or whether it requires human review.
//
// Tier 0 — Read only (analyze, report, recommend). No mutation.
// Tier 1 — Low-risk automatic. Can auto-execute under policy.
// Tier 2 — Approval required. Human must approve.
// Tier 3 — High-risk. Explicit approval + stronger verification.
// =============================================================================

import { createHash } from "crypto";
import { logger } from "@/lib/logger";
import {
  type ActionType,
  type SafetyTier,
  type ProposedChange,
  getSafetyTier,
  requiresHumanApproval,
  RETRY_POLICIES,
} from "./types";

// ── Policy Decision ─────────────────────────────────────────────────────────

export interface PolicyDecision {
  /** Whether this proposal can auto-approve */
  autoApprove: boolean;
  /** Whether this proposal can auto-execute (Tier 1 only) */
  autoExecute: boolean;
  /** The safety tier classification */
  tier: SafetyTier;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** Approval TTL in minutes (0 = no expiry) */
  approvalTtlMinutes: number;
  /** Human-readable reason for the decision */
  reason: string;
}


const APPROVAL_TTL_MINUTES: Record<SafetyTier, number> = {
  1: 60,
  2: 1440,
  3: 4320,
};

/**
 * Evaluates the safety policy for a proposed action.
 *
 * Rules:
 * - Tier 1: auto-approve + auto-execute
 * - Tier 2: auto-approve = false, requires human approval
 * - Tier 3: auto-approve = false, requires human approval, 1 attempt max
 */
export function evaluatePolicy(actionType: ActionType): PolicyDecision {
  const tier = getSafetyTier(actionType);
  const retryPolicy = RETRY_POLICIES[tier];
  const needsApproval = requiresHumanApproval(tier);

  return {
    autoApprove: !needsApproval,
    autoExecute: tier === 1,
    tier,
    maxAttempts: retryPolicy.maxAttempts,
    approvalTtlMinutes: APPROVAL_TTL_MINUTES[tier],
    reason: needsApproval
      ? `Tier ${tier} action "${actionType}" requires human approval`
      : `Tier ${tier} action "${actionType}" auto-approved by policy`,
  };
}

// ── Proposal Hash ───────────────────────────────────────────────────────────

/**
 * Creates a deterministic hash of the proposed changes.
 * Used to verify that the proposal hasn't been modified after approval.
 *
 * The hash covers:
 *   - actionType
 *   - targetUrl
 *   - Each proposed change (field, currentValue, proposedValue)
 *
 * Object keys are sorted for deterministic serialization.
 */
export function hashProposedChanges(
  actionType: ActionType,
  targetUrl: string,
  changes: ProposedChange[]
): string {
  const canonical = {
    actionType,
    targetUrl,
    changes: changes
      .map((c) => ({
        field: c.field,
        currentValue: c.currentValue,
        proposedValue: c.proposedValue,
      }))
      .sort((a, b) => a.field.localeCompare(b.field)),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

// ── Proposal Idempotency Key ────────────────────────────────────────────────

/**
 * Generates an idempotency key for an ActionProposal.
 *
 * Prevents duplicate proposals for the same opportunity + action type + target.
 * A new proposal CAN be generated after a previous one was REJECTED or FAILED.
 *
 * Format: prop:{sha256(siteId:decisionId:actionType:targetUrl).slice(0,16)}
 */
export function generateProposalIdempotencyKey(
  siteId: string,
  decisionId: string,
  actionType: ActionType,
  targetUrl: string
): string {
  const hash = createHash("sha256")
    .update(`${siteId}:${decisionId}:${actionType}:${targetUrl}`)
    .digest("hex")
    .slice(0, 16);

  return `prop:${hash}`;
}

// ── Approval Validation ─────────────────────────────────────────────────────

export interface ApprovalValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates that a proposal's approval is still valid.
 *
 * Checks:
 * 1. approvedBy is present
 * 2. approvalExpiresAt > now()
 * 3. approvalHash matches current proposedChanges hash
 */
export function validateProposalApproval(proposal: {
  approvedBy: string | null;
  approvalExpiresAt: Date | null;
  approvalHash: string | null;
  actionType: string;
  targetUrl: string;
  proposedChanges: ProposedChange[];
}): ApprovalValidationResult {
  if (!proposal.approvedBy) {
    return { valid: false, reason: "No approver recorded" };
  }

  if (
    proposal.approvalExpiresAt &&
    proposal.approvalExpiresAt < new Date()
  ) {
    return { valid: false, reason: "Approval TTL has expired" };
  }

  if (proposal.approvalHash) {
    const currentHash = hashProposedChanges(
      proposal.actionType as ActionType,
      proposal.targetUrl,
      proposal.proposedChanges
    );
    if (currentHash !== proposal.approvalHash) {
      return {
        valid: false,
        reason: "Proposed changes were modified after approval (hash mismatch)",
      };
    }
  }

  return { valid: true };
}
