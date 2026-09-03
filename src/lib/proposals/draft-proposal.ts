/**
 * Phase D.3 — Pure Draft Proposal Creation
 *
 * Extracted from generator.ts as a safe persistence boundary for D.3.
 *
 * INVARIANTS:
 *   1. Always creates proposals in DRAFT status
 *   2. Never auto-approves (regardless of safety tier)
 *   3. Never transitions opportunityStatus
 *   4. Never reserves budget or invokes execution
 *   5. Never imports from mutations/ or autonomy/
 *
 * D.3 calls this; Phase B's generator calls this internally too
 * (the generator adds auto-approve and lifecycle transitions on top).
 */

import { logger } from "@/lib/logger";
import type { ActionType, ProposedChange, VerificationCriterion } from "./types";
import { getSafetyTier, VERIFICATION_CRITERIA_MAP, RETRY_POLICIES } from "./types";
import {
  hashProposedChanges,
  generateProposalIdempotencyKey,
} from "./safety-policy";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DraftProposalInput {
  siteId: string;
  decisionId: string;
  actionType: ActionType;
  targetUrl: string;
  targetModel: "Blog" | "Page" | "Site";
  targetId: string;
  proposedChanges: ProposedChange[];
  expectedOutcome: string;
  confidence: number;
  generatedBy: string;
  verificationUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface DraftProposalResult {
  proposalId: string | null;
  status: "CREATED" | "IDEMPOTENT_HIT" | "ERROR";
  reason: string;
  idempotencyKey: string;
}

// ── Active Proposal Statuses ────────────────────────────────────────────────

/**
 * Statuses that indicate an active (non-terminal) proposal.
 * Used for idempotency: if an active proposal exists for an opportunity,
 * D.3 should not create another one.
 */
export const ACTIVE_PROPOSAL_STATUSES = [
  "DRAFT",
  "READY",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "VERIFYING",
] as const;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Creates a DRAFT ActionProposal.
 *
 * This is the pure persistence boundary:
 *   - Always DRAFT status
 *   - No auto-approve
 *   - No opportunityStatus transitions
 *   - Idempotency via unique key
 *   - Concurrent-safe: unique constraint on idempotencyKey
 *
 * Returns IDEMPOTENT_HIT if a proposal already exists for this
 * opportunity + action combination.
 */
export async function createDraftProposal(
  input: DraftProposalInput
): Promise<DraftProposalResult> {
  const { prisma } = await import("@/lib/prisma");

  const idempotencyKey = generateProposalIdempotencyKey(
    input.siteId,
    input.decisionId,
    input.actionType,
    input.targetUrl
  );

  // 1. Check for existing active proposal (concurrent-planner protection)
  const existingActive = await (prisma as any).actionProposal.findFirst({
    where: {
      decisionId: input.decisionId,
      status: { in: [...ACTIVE_PROPOSAL_STATUSES] },
    },
    select: { id: true, status: true, actionType: true },
  });

  if (existingActive) {
    logger.info("[DraftProposal] Active proposal already exists", {
      existingProposalId: existingActive.id,
      existingStatus: existingActive.status,
      decisionId: input.decisionId,
    });
    return {
      proposalId: existingActive.id,
      status: "IDEMPOTENT_HIT",
      reason: `Active proposal ${existingActive.id} already exists (${existingActive.status})`,
      idempotencyKey,
    };
  }

  // 2. Build verification criteria
  const baseCriteria = VERIFICATION_CRITERIA_MAP[input.actionType] ?? [];
  const verificationCriteria = populateCriteriaValues(baseCriteria, input.proposedChanges);

  // 3. Compute approval hash (for later approval verification)
  const approvalHash = hashProposedChanges(
    input.actionType,
    input.targetUrl,
    input.proposedChanges
  );

  // 4. Determine safety tier and retry policy
  const safetyTier = getSafetyTier(input.actionType);
  const retryPolicy = RETRY_POLICIES[safetyTier];
  const riskLevel = safetyTier <= 1 ? "LOW" : safetyTier === 2 ? "MEDIUM" : "HIGH";

  // 5. Atomic create with unique constraint protection
  try {
    const proposal = await (prisma as any).actionProposal.create({
      data: {
        siteId: input.siteId,
        decisionId: input.decisionId,
        idempotencyKey,
        actionType: input.actionType,
        targetUrl: input.targetUrl,
        verificationUrl: input.verificationUrl,
        targetModel: input.targetModel,
        targetId: input.targetId,
        // INVARIANT: Always DRAFT — never auto-approve in this boundary
        status: "DRAFT",
        proposedChanges: input.proposedChanges,
        expectedOutcome: input.expectedOutcome,
        riskLevel,
        safetyTier,
        confidence: input.confidence,
        requiresApproval: true, // Always true from D.3 — Phase C decides approval
        verificationCriteria,
        attemptCount: 0,
        maxAttempts: retryPolicy.maxAttempts,
        generatedBy: input.generatedBy,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      select: { id: true },
    });

    logger.info("[DraftProposal] DRAFT proposal created", {
      proposalId: proposal.id,
      decisionId: input.decisionId,
      actionType: input.actionType,
      safetyTier,
    });

    return {
      proposalId: proposal.id,
      status: "CREATED",
      reason: `DRAFT proposal created (tier ${safetyTier})`,
      idempotencyKey,
    };
  } catch (err: unknown) {
    // Handle unique constraint violation (concurrent planner race)
    if ((err as any)?.code === "P2002") {
      // Re-fetch the existing proposal
      const existing = await (prisma as any).actionProposal.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });

      return {
        proposalId: existing?.id ?? null,
        status: "IDEMPOTENT_HIT",
        reason: "Concurrent planner created proposal first",
        idempotencyKey,
      };
    }

    logger.error("[DraftProposal] Failed to create draft", {
      decisionId: input.decisionId,
      error: (err as Error)?.message,
    });

    return {
      proposalId: null,
      status: "ERROR",
      reason: (err as Error)?.message ?? "Unknown error",
      idempotencyKey,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Populates expectedValue fields in verification criteria from proposed changes.
 */
function populateCriteriaValues(
  criteria: VerificationCriterion[],
  changes: ProposedChange[]
): VerificationCriterion[] {
  const changeMap = new Map<string, string>();
  for (const c of changes) {
    changeMap.set(c.field, c.proposedValue);
  }

  return criteria.map((criterion) => {
    if (criterion.expectedValue) return criterion;

    const fieldMap: Record<string, string> = {
      META_DESCRIPTION_MATCHES: "metaDescription",
      TITLE_MATCHES: "title",
      CANONICAL_MATCHES: "canonicalUrl",
    };

    const field = fieldMap[criterion.check];
    if (field && changeMap.has(field)) {
      return { ...criterion, expectedValue: changeMap.get(field) };
    }

    return criterion;
  });
}
