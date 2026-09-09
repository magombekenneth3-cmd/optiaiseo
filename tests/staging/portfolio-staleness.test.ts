/**
 * D.8.1.3 — Staleness / Fencing
 *
 * Proves that the allocation fence (allocation-fence.ts) correctly rejects
 * stale or invalid allocations under five concrete scenarios, each backed
 * by real DB state.
 *
 * Test scenarios:
 *   §1 — Evidence hash mutation          → fence returns EVIDENCE_HASH_CHANGED
 *   §2 — Score record / version mutation → fence returns SCORE_RECORD_CHANGED
 *   §3 — Allocation expiry               → fence returns ALLOCATION_EXPIRED
 *   §4 — D.5 experiment conflict         → fence returns D5_EXPERIMENT_CONFLICT_AFTER_ALLOCATION
 *   §5 — Compound staleness              → first failing check short-circuits
 *
 * Classification: INTEGRATION / LIVE_DB
 *
 * Architectural constraint:
 *   These tests invoke validateAllocationFence() against REAL persisted records.
 *   No mocks — the function reads from the live staging DB.
 *   Every test creates its own isolated context and cleans up in afterAll.
 *   No Phase B/C side effects — fencing is read-only.
 *
 * Guard: D8_LIVE_DB=true + assertStagingDatabase()
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { validateAllocationFence } from "@/lib/portfolio/allocation-fence";
import {
  assertStagingDatabase,
  isLiveDbAvailable,
  makeTestContext,
  seedUser,
  seedSite,
  seedOpportunity,
  seedScoreRecord,
  seedAllocation,
  seedExperiment,
  cleanupContext,
  type TestContext,
} from "../harness";

// ── Guard ────────────────────────────────────────────────────────────────────

const SKIP = !isLiveDbAvailable();

// ══════════════════════════════════════════════════════════════════════════════
// §1 — Evidence Hash Mutation
//
// Allocation was created with evidence hash A.
// The score record's evidence hash is then updated to B.
// Fence must return { valid: false, reason: "EVIDENCE_HASH_CHANGED" }.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§1 Evidence hash mutation — fence rejects stale evidence", () => {
  const ctx: TestContext = makeTestContext("stale-evidence");
  let allocationId: string;

  beforeAll(async () => {
    assertStagingDatabase();

    // Seed the baseline: user → site → OPEN opportunity → PROMOTE score record
    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);
    const oppId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-ev"),
    });

    // Score record with evidence hash "hash-original"
    const scoreId = await seedScoreRecord(prisma as any, oppId, {
      scoreRecordId: ctx.id("score-ev"),
      evidenceHash: "hash-original",
    });

    // Allocation references the same evidence hash
    allocationId = await seedAllocation(prisma as any, ctx, oppId, scoreId, {
      evidenceHash: "hash-original",
    });

    // ── Mutate evidence: update the score record's evidence hash ──
    await (prisma as any).opportunityScoreRecord.update({
      where: { id: scoreId },
      data: { evidenceHash: "hash-mutated" },
    });
  }, 30_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  });

  it("1.1 fence returns valid=false with reason EVIDENCE_HASH_CHANGED", async () => {
    const result = await validateAllocationFence(allocationId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("EVIDENCE_HASH_CHANGED");
  });

  it("1.2 allocation record itself is unchanged — fence is read-only", async () => {
    const alloc = await (prisma as any).portfolioAllocation.findUnique({
      where: { id: allocationId },
      select: { evidenceHash: true, decision: true },
    });
    expect(alloc.evidenceHash).toBe("hash-original");
    expect(alloc.decision).toBe("SELECTED");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — Score Record / Version Mutation
//
// Allocation was created against score record A.
// A newer PROMOTE score record B is created for the same opportunity.
// Fence must return { valid: false, reason: "SCORE_RECORD_CHANGED" }
// because the latest PROMOTE score is now B, not A.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§2 Score record mutation — fence rejects outdated score provenance", () => {
  const ctx: TestContext = makeTestContext("stale-score");
  let allocationId: string;

  beforeAll(async () => {
    assertStagingDatabase();

    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);
    const oppId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-sc"),
    });

    // Score record A — the one the allocation binds to
    const scoreIdA = await seedScoreRecord(prisma as any, oppId, {
      scoreRecordId: ctx.id("score-A"),
      evidenceHash: "hash-score-A",
      scoringVersion: "d2-v1",
    });

    // Allocation references score A
    allocationId = await seedAllocation(prisma as any, ctx, oppId, scoreIdA, {
      evidenceHash: "hash-score-A",
    });

    // ── Create a newer PROMOTE score record B ──
    // The fence's findFirst(orderBy: scoredAt desc) will now return B
    await seedScoreRecord(prisma as any, oppId, {
      scoreRecordId: ctx.id("score-B"),
      evidenceHash: "hash-score-B",
      scoringVersion: "d2-v2",
    });
  }, 30_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  });

  it("2.1 fence returns valid=false with reason SCORE_RECORD_CHANGED", async () => {
    const result = await validateAllocationFence(allocationId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("SCORE_RECORD_CHANGED");
  });

  it("2.2 the newer score record is now the authoritative PROMOTE record", async () => {
    const latest = await (prisma as any).opportunityScoreRecord.findFirst({
      where: {
        opportunityId: ctx.id("opp-sc"),
        decision: "PROMOTE",
      },
      orderBy: { scoredAt: "desc" },
      select: { id: true },
    });
    expect(latest.id).toBe(ctx.id("score-B"));
  });

  it("2.3 allocation still references old score A — fence is read-only", async () => {
    const alloc = await (prisma as any).portfolioAllocation.findUnique({
      where: { id: allocationId },
      select: { scoreRecordId: true },
    });
    expect(alloc.scoreRecordId).toBe(ctx.id("score-A"));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — Allocation Expiry (Real Timestamp)
//
// Persist SELECTED allocation with expiresAt in the past.
// Fence must reject with ALLOCATION_EXPIRED.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§3 Allocation expiry — fence rejects expired allocations", () => {
  const ctx: TestContext = makeTestContext("stale-expiry");
  let allocationId: string;

  beforeAll(async () => {
    assertStagingDatabase();

    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);
    const oppId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-ex"),
    });

    const scoreId = await seedScoreRecord(prisma as any, oppId, {
      scoreRecordId: ctx.id("score-ex"),
      evidenceHash: "hash-expiry",
    });

    // Allocation with expiresAt 1 hour in the past
    allocationId = await seedAllocation(prisma as any, ctx, oppId, scoreId, {
      evidenceHash: "hash-expiry",
      expiresAt: new Date(Date.now() - 3_600_000),
    });
  }, 30_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  });

  it("3.1 fence returns valid=false with reason ALLOCATION_EXPIRED", async () => {
    const result = await validateAllocationFence(allocationId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("ALLOCATION_EXPIRED");
  });

  it("3.2 expiresAt is genuinely in the past — not synthetic", async () => {
    const alloc = await (prisma as any).portfolioAllocation.findUnique({
      where: { id: allocationId },
      select: { expiresAt: true },
    });
    expect(new Date(alloc.expiresAt).getTime()).toBeLessThan(Date.now());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — Conflicting D.5 Experiment After Allocation
//
// Create a valid SELECTED allocation, then create a D.5 experiment on
// the same resource with createdAt AFTER the allocation's allocatedAt.
// Fence must return D5_EXPERIMENT_CONFLICT_AFTER_ALLOCATION.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§4 D.5 experiment conflict — fence rejects on post-allocation experiment", () => {
  const ctx: TestContext = makeTestContext("stale-d5");
  let allocationId: string;

  beforeAll(async () => {
    assertStagingDatabase();

    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);

    const targetUrl = `https://${ctx.siteId}.d8-test.local/page`;
    const oppId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-d5"),
      url: targetUrl,
    });

    const scoreId = await seedScoreRecord(prisma as any, oppId, {
      scoreRecordId: ctx.id("score-d5"),
      evidenceHash: "hash-d5",
    });

    // Allocation created "5 minutes ago" — everything valid at allocation time
    const allocatedAt = new Date(Date.now() - 300_000);
    allocationId = await seedAllocation(prisma as any, ctx, oppId, scoreId, {
      evidenceHash: "hash-d5",
      allocatedAt,
      candidateSnapshot: {
        finalScore: 80,
        riskScore: 20,
        resourceType: "PAGE",
        resourceId: targetUrl,
      },
    });

    // ── D.5 experiment created AFTER allocation ──
    // The fence checks: experiment.createdAt > allocation.allocatedAt
    // AND experiment.targetUrl === allocation.candidateSnapshot.resourceId
    // AND experiment.status IN ('DRAFT', 'RUNNING')
    await seedExperiment(prisma as any, ctx, oppId, {
      experimentId: ctx.id("exp-d5"),
      status: "RUNNING",
      targetUrl,
    });
  }, 30_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  });

  it("4.1 fence returns valid=false with reason containing D5_EXPERIMENT_CONFLICT", async () => {
    const result = await validateAllocationFence(allocationId);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("D5_EXPERIMENT_CONFLICT_AFTER_ALLOCATION");
  });

  it("4.2 the conflicting experiment ID is included in the reason", async () => {
    const result = await validateAllocationFence(allocationId);
    expect(result.reason).toContain(ctx.id("exp-d5"));
  });

  it("4.3 a COMPLETED experiment does NOT trigger conflict", async () => {
    // Transition the experiment to COMPLETED — should no longer conflict
    // Use raw SQL — live DB Experiment schema doesn't match Prisma model
    await (prisma as any).$executeRawUnsafe(
      `UPDATE "Experiment" SET "status" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      "COMPLETED",
      ctx.id("exp-d5"),
    );

    const result = await validateAllocationFence(allocationId);
    // Should now pass all checks (experiment is no longer DRAFT/RUNNING)
    expect(result.valid).toBe(true);

    // Restore for other tests
    await (prisma as any).$executeRawUnsafe(
      `UPDATE "Experiment" SET "status" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      "RUNNING",
      ctx.id("exp-d5"),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 — Compound Staleness (Multiple Fence Violations)
//
// An allocation that is BOTH expired AND has a mutated evidence hash.
// The fence must reject — and the first failing check wins
// (allocation-fence.ts evaluates checks sequentially).
//
// Check order in allocation-fence.ts:
//   1. decision === SELECTED
//   2. expiresAt > now
//   3. opportunity still OPEN
//   4. siteId matches
//   5. latestScore.id === allocation.scoreRecordId
//   6. evidenceHash matches
//   7. no D.5 experiment conflict
//
// So expired (check 2) should fire before evidence hash (check 6).
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§5 Compound staleness — first failing check short-circuits", () => {
  const ctx: TestContext = makeTestContext("stale-compound");
  let allocationId: string;

  beforeAll(async () => {
    assertStagingDatabase();

    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);
    const oppId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-cmp"),
    });

    const scoreId = await seedScoreRecord(prisma as any, oppId, {
      scoreRecordId: ctx.id("score-cmp"),
      evidenceHash: "hash-cmp-original",
    });

    // Allocation is BOTH expired AND has mismatched evidence
    allocationId = await seedAllocation(prisma as any, ctx, oppId, scoreId, {
      evidenceHash: "hash-cmp-original",
      expiresAt: new Date(Date.now() - 3_600_000), // expired 1 hour ago
    });

    // Mutate evidence hash so check 6 would also fail
    await (prisma as any).opportunityScoreRecord.update({
      where: { id: scoreId },
      data: { evidenceHash: "hash-cmp-mutated" },
    });
  }, 30_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  });

  it("5.1 fence returns valid=false", async () => {
    const result = await validateAllocationFence(allocationId);
    expect(result.valid).toBe(false);
  });

  it("5.2 reason is ALLOCATION_EXPIRED (check 2 fires before check 6)", async () => {
    const result = await validateAllocationFence(allocationId);
    // Expiry check is evaluated before evidence hash check in the fence
    expect(result.reason).toBe("ALLOCATION_EXPIRED");
  });

  it("5.3 fixing expiry still fails on evidence hash", async () => {
    // Update allocation to be non-expired
    await (prisma as any).portfolioAllocation.update({
      where: { id: allocationId },
      data: { expiresAt: new Date(Date.now() + 86400_000) },
    });

    const result = await validateAllocationFence(allocationId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("EVIDENCE_HASH_CHANGED");

    // Restore expired state for determinism
    await (prisma as any).portfolioAllocation.update({
      where: { id: allocationId },
      data: { expiresAt: new Date(Date.now() - 3_600_000) },
    });
  });
});
