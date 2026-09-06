/**
 * D.8.1.1 — Infrastructure Assertions
 *
 * DB-backed assertions for D.8 test suites.
 * All assertions throw on failure with a descriptive message.
 *
 * Infrastructure: LIVE_DB
 */

import { expect } from "vitest";

// ── Portfolio / Allocation Assertions ─────────────────────────────────────────

/** Assert exactly one SELECTED allocation exists for the opportunity today */
export async function assertSelectedAllocation(
  db: any,
  opportunityId: string,
  options: { evidenceHash?: string; scoreRecordId?: string } = {}
): Promise<void> {
  const allocs = await db.portfolioAllocation.findMany({
    where: { opportunityId, decision: "SELECTED" },
  });

  expect(allocs.length).toBe(1);

  if (options.evidenceHash !== undefined) {
    expect(allocs[0].evidenceHash).toBe(options.evidenceHash);
  }
  if (options.scoreRecordId !== undefined) {
    expect(allocs[0].scoreRecordId).toBe(options.scoreRecordId);
  }
}

/** Assert no SELECTED allocation exists for the opportunity */
export async function assertNoSelectedAllocation(
  db: any,
  opportunityId: string
): Promise<void> {
  const count = await db.portfolioAllocation.count({
    where: { opportunityId, decision: "SELECTED" },
  });
  expect(count).toBe(0);
}

/** Assert the allocation fence is valid (evidence/score not stale) */
export async function assertAllocationFenceValid(
  db: any,
  opportunityId: string,
  currentEvidenceHash: string,
  currentScoreRecordId: string
): Promise<void> {
  const alloc = await db.portfolioAllocation.findFirst({
    where: { opportunityId, decision: "SELECTED" },
  });

  expect(alloc).not.toBeNull();
  expect(alloc.evidenceHash).toBe(currentEvidenceHash);
  expect(alloc.scoreRecordId).toBe(currentScoreRecordId);
  expect(new Date(alloc.expiresAt).getTime()).toBeGreaterThan(Date.now());
}

// ── Proposal Assertions ────────────────────────────────────────────────────────

/** Assert exactly one ActionProposal exists for the opportunity */
export async function assertOneProposal(
  db: any,
  opportunityId: string,
  options: { status?: string } = {}
): Promise<string> {
  const where: any = { decisionId: opportunityId };
  if (options.status) where.status = options.status;

  const proposals = await db.actionProposal.findMany({ where });
  expect(proposals.length).toBe(1);
  return proposals[0].id;
}

/** Assert no ActionProposal exists for the opportunity */
export async function assertNoProposal(
  db: any,
  opportunityId: string
): Promise<void> {
  const count = await db.actionProposal.count({ where: { decisionId: opportunityId } });
  expect(count).toBe(0);
}

/** Assert no duplicate proposals (idempotency) */
export async function assertNoDuplicateProposals(
  db: any,
  opportunityId: string
): Promise<void> {
  const proposals = await db.actionProposal.findMany({
    where: { decisionId: opportunityId },
  });
  const keys = proposals.map((p: any) => p.idempotencyKey);
  const uniqueKeys = new Set(keys);
  expect(uniqueKeys.size).toBe(keys.length);
}

// ── Execution Claim Assertions ────────────────────────────────────────────────

/** Assert exactly one ACTIVE claim exists for the opportunity */
export async function assertOneClaim(
  db: any,
  opportunityId: string
): Promise<{ claimId: string; workerId: string; generation: number }> {
  const claims = await db.autonomousExecutionClaim.findMany({
    where: { opportunityId, status: "ACTIVE" },
  });
  expect(claims.length).toBe(1);
  return {
    claimId: claims[0].id,
    workerId: claims[0].claimedBy,
    generation: claims[0].generation,
  };
}

/** Assert no ACTIVE claim exists for the opportunity */
export async function assertNoClaim(
  db: any,
  opportunityId: string
): Promise<void> {
  const count = await db.autonomousExecutionClaim.count({
    where: { opportunityId, status: "ACTIVE" },
  });
  expect(count).toBe(0);
}

// ── Budget Assertions ─────────────────────────────────────────────────────────

/** Assert a budget reservation was released */
export async function assertReservationReleased(
  db: any,
  reservationId: string
): Promise<void> {
  const res = await db.budgetReservation.findUnique({ where: { id: reservationId } });
  expect(res).not.toBeNull();
  expect(res.status).toBe("RELEASED");
}

/** Assert a budget reservation was consumed */
export async function assertReservationConsumed(
  db: any,
  reservationId: string
): Promise<void> {
  const res = await db.budgetReservation.findUnique({ where: { id: reservationId } });
  expect(res).not.toBeNull();
  expect(res.status).toBe("CONSUMED");
}

/** Assert the site has remaining budget (reservation count < limit) */
export async function assertBudgetAvailable(
  db: any,
  siteId: string
): Promise<void> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { dailyMutationLimit: true },
  });
  const oneDayAgo = new Date(Date.now() - 86400_000);
  const consumed = await db.budgetReservation.count({
    where: { siteId, status: "CONSUMED", consumedAt: { gte: oneDayAgo } },
  });
  expect(consumed).toBeLessThan(site.dailyMutationLimit);
}

// ── Execution Trace Assertions ─────────────────────────────────────────────────

/** Assert the trace has all required fields populated */
export async function assertTraceComplete(
  db: any,
  traceId: string,
  options: {
    expectVerification?: boolean;
    expectProposal?: boolean;
  } = {}
): Promise<void> {
  const trace = await db.executionTrace.findUnique({ where: { id: traceId } });
  expect(trace).not.toBeNull();

  // Core fields always present
  expect(trace.siteId).toBeTruthy();
  expect(trace.opportunityId).toBeTruthy();
  expect(trace.actionType).toBeTruthy();
  expect(trace.operatingMode).toBeTruthy();
  expect(trace.policyDecision).toBeTruthy();
  expect(trace.discoveredAt).not.toBeNull();

  if (options.expectProposal) {
    expect(trace.proposalId).not.toBeNull();
    expect(trace.executionResult).not.toBeNull();
    expect(trace.executedAt).not.toBeNull();
  }

  if (options.expectVerification) {
    expect(trace.verificationStatus).not.toBeNull();
    expect(trace.verificationAt).not.toBeNull();
  }
}

/** Assert the trace records a BLOCKED decision */
export async function assertTraceBlocked(
  db: any,
  traceId: string,
  expectedGate?: string
): Promise<void> {
  const trace = await db.executionTrace.findUnique({ where: { id: traceId } });
  expect(trace).not.toBeNull();
  expect(["BLOCKED", "NEEDS_APPROVAL"]).toContain(trace.policyDecision);
  if (expectedGate) {
    expect(trace.policyReason).toContain(expectedGate);
  }
}

// ── Opportunity Lifecycle Assertions ──────────────────────────────────────────

/** Assert the opportunity is in the expected status */
export async function assertOpportunityStatus(
  db: any,
  opportunityId: string,
  expectedStatus: string
): Promise<void> {
  const opp = await db.growthDecision.findUnique({
    where: { id: opportunityId },
    select: { opportunityStatus: true },
  });
  expect(opp).not.toBeNull();
  expect(opp.opportunityStatus).toBe(expectedStatus);
}

// ── Phase B Mutation Boundary Assertion ───────────────────────────────────────

/**
 * Assert no MutationOperation was created for the opportunity.
 * Used to prove Phase B was never reached when a gate blocks.
 */
export async function assertNoMutation(
  db: any,
  proposalId: string
): Promise<void> {
  const count = await db.mutationOperation.count({
    where: { proposalId },
  });
  expect(count).toBe(0);
}
