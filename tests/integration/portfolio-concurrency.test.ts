/**
 * D.7 Integration Test — Concurrent Allocator Serialization
 *
 * Fires N simultaneous allocatePortfolioForSite() calls against the same site
 * and verifies the advisory lock produces one coherent cycle.
 *
 * PREREQUISITES:
 *   - Live PostgreSQL connection (Railway or local)
 *   - Test site and OPEN opportunities seeded in DB
 *
 * RUN:
 *   D7_CONCURRENCY_TEST=true npx vitest run tests/integration/portfolio-concurrency.test.ts
 *
 * This test is SKIPPED by default (no D7_CONCURRENCY_TEST env var).
 * It requires a live database and creates/cleans up its own test data.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const SHOULD_RUN = process.env.D7_CONCURRENCY_TEST === "true";

// Helper to conditionally skip
const testIf = SHOULD_RUN ? it : it.skip;

describe("D.7 Concurrent Allocator — Database Integration", () => {
  const TEST_SITE_ID = `test-d7-concurrency-${Date.now()}`;
  const TEST_USER_ID = `test-user-d7-${Date.now()}`;
  const OPPORTUNITY_COUNT = 8;
  const CONCURRENT_WORKERS = 5;
  const opportunityIds: string[] = [];

  beforeAll(async () => {
    if (!SHOULD_RUN) return;

    const { prisma } = await import("@/lib/prisma");

    // Seed test user
    await (prisma as any).user.upsert({
      where: { id: TEST_USER_ID },
      update: {},
      create: {
        id: TEST_USER_ID,
        name: "D7 Concurrency Test",
        email: `d7-test-${Date.now()}@test.local`,
      },
    });

    // Seed test site
    await (prisma as any).site.upsert({
      where: { id: TEST_SITE_ID },
      update: {},
      create: {
        id: TEST_SITE_ID,
        domain: `d7-concurrency-test-${Date.now()}.test`,
        userId: TEST_USER_ID,
        dailyMutationLimit: 10,
        maxConcurrentExecutions: 2,
        automationsPaused: false,
      },
    });

    // Seed OPEN opportunities with PROMOTE score records
    for (let i = 0; i < OPPORTUNITY_COUNT; i++) {
      const oppId = `${TEST_SITE_ID}-opp-${i}`;
      opportunityIds.push(oppId);

      await (prisma as any).growthDecision.upsert({
        where: { id: oppId },
        update: {},
        create: {
          id: oppId,
          siteId: TEST_SITE_ID,
          url: `https://test.com/page-${i}`,
          primaryKeyword: `test-keyword-${i}`,
          action: i < 4 ? "UPDATE_META_DESCRIPTION" : "REFRESH_CONTENT",
          primaryCategory: i < 4 ? "QUICK_WIN" : "DECLINING",
          opportunityCategories: [i < 4 ? "QUICK_WIN" : "DECLINING"],
          score: { finalScore: 90 - i * 5 },
          whyNow: { reason: "test" },
          impact: { expectedUplift: 10 },
          executionPlan: { steps: [] },
          opportunityStatus: "OPEN",
          generatedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      await (prisma as any).opportunityScoreRecord.create({
        data: {
          opportunityId: oppId,
          decision: "PROMOTE",
          finalScore: 90 - i * 5,
          impactScore: 80 - i * 3,
          confidenceScore: 70,
          evidenceScore: 65,
          effortScore: 30,
          riskScore: 20 + i * 5,
          urgencyScore: 60,
          evidenceHash: `hash-${i}`,
          decisionReasons: [{ rule: "TEST", details: "test" }],
          weightsUsed: { impact: 0.3, confidence: 0.2, evidence: 0.15, urgency: 0.15, effort: 0.1, risk: 0.1 },
          scoringVersion: "d2-test",
        },
      });
    }
  }, 30000);

  afterAll(async () => {
    if (!SHOULD_RUN) return;

    const { prisma } = await import("@/lib/prisma");

    // Clean up in reverse dependency order
    await (prisma as any).portfolioAllocation.deleteMany({
      where: { siteId: TEST_SITE_ID },
    });
    await (prisma as any).opportunityScoreRecord.deleteMany({
      where: { opportunityId: { in: opportunityIds } },
    });
    await (prisma as any).growthDecision.deleteMany({
      where: { siteId: TEST_SITE_ID },
    });
    await (prisma as any).site.deleteMany({
      where: { id: TEST_SITE_ID },
    });
    await (prisma as any).user.deleteMany({
      where: { id: TEST_USER_ID },
    });

    await prisma.$disconnect();
  }, 30000);

  testIf(
    `${CONCURRENT_WORKERS} simultaneous allocators produce one coherent cycle`,
    async () => {
      const { allocatePortfolioForSite } = await import("@/lib/portfolio/allocator");
      const { prisma } = await import("@/lib/prisma");

      // Fire N concurrent allocations simultaneously
      const promises = Array.from({ length: CONCURRENT_WORKERS }, () =>
        allocatePortfolioForSite(TEST_SITE_ID).catch((err) => ({
          error: err.message,
        }))
      );

      const results = await Promise.all(promises);

      // ── Separate transient network errors from concurrency bugs ───────
      const allErrors = results.filter(
        (r) => r && typeof r === "object" && "error" in r
      );
      const concurrencyErrors = allErrors.filter(
        (r: any) => !r.error.includes("Can't reach database server")
          && !r.error.includes("Unable to start a transaction")
      );
      // Concurrency bugs (duplicate keys, constraint violations, etc.) = FAIL
      expect(concurrencyErrors).toEqual([]);

      // ── Verify: at least 2 successful results (proves serialization) ──
      const validResults = results.filter((r) => r !== null && !("error" in r));
      expect(validResults.length).toBeGreaterThanOrEqual(2);

      const cycleIds = new Set(
        validResults.map((r: any) => r.cycleId)
      );
      expect(cycleIds.size).toBe(1);
      const cycleId = [...cycleIds][0];

      // ── Verify: no duplicate allocation rows ─────────────────────────
      const allocations = await (prisma as any).portfolioAllocation.findMany({
        where: { siteId: TEST_SITE_ID, cycleId },
        orderBy: { rank: "asc" },
      });

      const uniqueOppIds = new Set(allocations.map((a: any) => a.opportunityId));
      expect(allocations.length).toBe(uniqueOppIds.size); // No duplicates

      // ── Verify: every opportunity has exactly one allocation ──────────
      expect(uniqueOppIds.size).toBe(OPPORTUNITY_COUNT);

      // ── Verify: consistent decisions and ranks ───────────────────────
      // All results that returned a value should agree on rankings
      for (const r of validResults as any[]) {
        // Each result's selected list should have the same opportunityIds
        const selectedIds = r.selected.map((s: any) => s.opportunityId).sort();
        const referenceSelectedIds = validResults[0]
          ? (validResults[0] as any).selected.map((s: any) => s.opportunityId).sort()
          : [];
        expect(selectedIds).toEqual(referenceSelectedIds);
      }

      // ── Verify: no constraint over-allocation ────────────────────────
      const selectedCount = allocations.filter(
        (a: any) => a.decision === "SELECTED"
      ).length;
      expect(selectedCount).toBeLessThanOrEqual(10); // dailyMutationLimit

      // ── Verify: ranks are sequential and unique among SELECTED ───────
      const selectedAllocations = allocations
        .filter((a: any) => a.decision === "SELECTED")
        .sort((a: any, b: any) => a.rank - b.rank);

      for (let i = 0; i < selectedAllocations.length; i++) {
        expect(selectedAllocations[i].rank).toBe(i + 1);
      }

      console.log(
        `✅ ${CONCURRENT_WORKERS} concurrent allocators produced 1 coherent cycle:`,
        `${selectedCount} SELECTED, ${allocations.length - selectedCount} DEFERRED/EXCLUDED,`,
        `${allocations.length} total allocations, 0 duplicates`
      );
    },
    60000 // 60s timeout for DB operations
  );
});
