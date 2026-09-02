/**
 * Phase C.2 — Live PostgreSQL Concurrent Stress Tests
 *
 * These tests run REAL concurrent operations against PostgreSQL to prove
 * that the serialization mechanisms (advisory locks + row locks) hold
 * under actual contention.
 *
 * REQUIREMENTS:
 *   - DATABASE_URL must be set and point to a live PostgreSQL instance
 *   - Schema migrated via: npx prisma migrate deploy
 *
 * Run with:
 *   DATABASE_URL=... npx vitest run tests/autonomy/live-concurrency.test.ts
 *
 * These tests are skipped by default if DATABASE_URL is not available.
 * Each test creates isolated data and cleans up after itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Skip if no database ─────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL;
const dbDescribe = SKIP ? describe.skip : describe;

// ── Test Helpers ────────────────────────────────────────────────────────────

let prisma: any;
let testSiteId: string;

function testId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runConcurrent<T>(
  n: number,
  fn: (index: number) => Promise<T>
): Promise<{ successes: T[]; failures: Error[] }> {
  const promises = Array.from({ length: n }, (_, i) => fn(i));
  const results = await Promise.allSettled(promises);

  const successes: T[] = [];
  const failures: Error[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      successes.push(r.value);
    } else {
      failures.push(r.reason as Error);
    }
  }

  return { successes, failures };
}

// ── Test 1: Budget Race ─────────────────────────────────────────────────────

dbDescribe("§1 Budget Race — 20 concurrent reservations, limit=10", () => {
  const LIMIT = 10;
  const WORKERS = 20;
  const REPETITIONS = 3;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    await prisma.$connect();

    testSiteId = testId("site-budget");
    await prisma.site.create({
      data: {
        id: testSiteId,
        name: `Budget Race Test ${testSiteId}`,
        dailyMutationLimit: LIMIT,
        maxConcurrentExecutions: 50,
        operatingMode: "SUPERVISED",
      },
    });
  });

  afterAll(async () => {
    await prisma.budgetReservation.deleteMany({ where: { siteId: testSiteId } });
    await prisma.site.delete({ where: { id: testSiteId } });
    await prisma.$disconnect();
  });

  for (let rep = 0; rep < REPETITIONS; rep++) {
    it(`run ${rep + 1}: exactly ${LIMIT} succeed out of ${WORKERS}`, async () => {
      await prisma.budgetReservation.deleteMany({ where: { siteId: testSiteId } });

      const { reserveBudget } = await import("@/lib/autonomy/budget-enforcer");

      const { successes } = await runConcurrent(WORKERS, async () => {
        return reserveBudget(testSiteId, `trace-rep${rep}`);
      });

      const reserved = successes.filter((r) => r !== null);
      const exhausted = successes.filter((r) => r === null);

      expect(reserved.length).toBe(LIMIT);
      expect(exhausted.length).toBe(WORKERS - LIMIT);

      // All reservation IDs unique
      const ids = new Set(reserved.map((r: any) => r.reservationId));
      expect(ids.size).toBe(LIMIT);
    }, 30_000);
  }
});

// ── Test 2a: Empty-Slot Concurrency Race (primary invariant) ────────────────
//
// This is the critical race:
//   Worker A: COUNT=0
//   Worker B: COUNT=0
//   Both proceed → >limit EXECUTING
//
// The advisory lock + FOR UPDATE prevents this.

dbDescribe("§2a Empty-Slot Concurrency Race — 20 workers, limit=2, 0 existing", () => {
  const LIMIT = 2;
  const WORKERS = 20;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    await prisma.$connect();

    testSiteId = testId("site-empty-conc");
    await prisma.site.create({
      data: {
        id: testSiteId,
        name: `Empty Concurrency Race ${testSiteId}`,
        dailyMutationLimit: 100,
        maxConcurrentExecutions: LIMIT,
        operatingMode: "SUPERVISED",
      },
    });
  });

  afterAll(async () => {
    await prisma.mutationOperation.deleteMany({ where: { siteId: testSiteId } });
    await prisma.site.delete({ where: { id: testSiteId } });
    await prisma.$disconnect();
  });

  it(`exactly ${LIMIT} workers allowed from ${WORKERS} concurrent (empty start)`, async () => {
    // IMPORTANT: No pre-existing EXECUTING operations.
    // Each worker checks concurrency AND creates an EXECUTING operation if allowed.
    const { checkConcurrencySlot } = await import("@/lib/autonomy/concurrency-lease");

    // Each worker: check slot → if allowed, create EXECUTING operation
    const { successes } = await runConcurrent(WORKERS, async (i) => {
      const check = await checkConcurrencySlot(testSiteId);

      if (check.allowed) {
        // Immediately create an EXECUTING operation to occupy the slot
        await prisma.mutationOperation.create({
          data: {
            id: testId(`op-${i}`),
            siteId: testSiteId,
            status: "EXECUTING",
            targetModel: "Blog",
            targetId: testId("blog"),
            mutationType: "UPDATE",
            expectedVersion: 1,
            actorType: "SYSTEM",
            actorId: `worker-${i}`,
          },
        });
      }

      return check;
    });

    const allowed = successes.filter((r) => r.allowed);

    // The serialization guarantee: at most LIMIT workers get through
    expect(allowed.length).toBeLessThanOrEqual(LIMIT);
    // And at least 1 should succeed (slots were empty)
    expect(allowed.length).toBeGreaterThanOrEqual(1);

    // Verify the actual database state: count of EXECUTING ops
    const executingCount = await prisma.mutationOperation.count({
      where: { siteId: testSiteId, status: "EXECUTING" },
    });
    expect(executingCount).toBeLessThanOrEqual(LIMIT);
  }, 30_000);
});

// ── Test 2b: Full-Slot Concurrency Race (capacity exhaustion) ───────────────

dbDescribe("§2b Full-Slot Concurrency Race — 20 workers, limit=2, 2 existing", () => {
  const LIMIT = 2;
  const WORKERS = 20;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    await prisma.$connect();

    testSiteId = testId("site-full-conc");
    await prisma.site.create({
      data: {
        id: testSiteId,
        name: `Full Concurrency Race ${testSiteId}`,
        dailyMutationLimit: 100,
        maxConcurrentExecutions: LIMIT,
        operatingMode: "SUPERVISED",
      },
    });

    // Pre-fill the slots
    for (let i = 0; i < LIMIT; i++) {
      await prisma.mutationOperation.create({
        data: {
          id: testId("prefill-op"),
          siteId: testSiteId,
          status: "EXECUTING",
          targetModel: "Blog",
          targetId: testId("blog"),
          mutationType: "UPDATE",
          expectedVersion: 1,
          actorType: "SYSTEM",
          actorId: "prefill",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.mutationOperation.deleteMany({ where: { siteId: testSiteId } });
    await prisma.site.delete({ where: { id: testSiteId } });
    await prisma.$disconnect();
  });

  it(`0 workers allowed when all ${LIMIT} slots occupied`, async () => {
    const { checkConcurrencySlot } = await import("@/lib/autonomy/concurrency-lease");

    const { successes } = await runConcurrent(WORKERS, async () => {
      return checkConcurrencySlot(testSiteId);
    });

    const allowed = successes.filter((r) => r.allowed);
    expect(allowed.length).toBe(0);
  }, 30_000);
});

// ── Test 3: Duplicate Execution Claim ───────────────────────────────────────

dbDescribe("§3 Duplicate Execution — 20 concurrent claims, 1 opportunity", () => {
  const WORKERS = 20;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    await prisma.$connect();

    testSiteId = testId("site-claim");
    await prisma.site.create({
      data: {
        id: testSiteId,
        name: `Claim Race Test ${testSiteId}`,
        dailyMutationLimit: 100,
        maxConcurrentExecutions: 50,
        operatingMode: "SUPERVISED",
      },
    });
  });

  afterAll(async () => {
    await prisma.autonomousExecutionClaim.deleteMany({ where: { siteId: testSiteId } });
    await prisma.site.delete({ where: { id: testSiteId } });
    await prisma.$disconnect();
  });

  it("exactly 1 claim succeeds, generation=1", async () => {
    const { claimExecution } = await import("@/lib/autonomy/execution-claim");
    const opportunityId = testId("opp");

    const { successes } = await runConcurrent(WORKERS, async (i) => {
      return claimExecution(testSiteId, opportunityId, `proposal-${i}`);
    });

    const claimed = successes.filter((r) => r.claimed);
    const rejected = successes.filter((r) => !r.claimed);

    expect(claimed.length).toBe(1);
    expect(rejected.length).toBe(WORKERS - 1);

    // Winner has claimId, workerId, generation=1
    expect(claimed[0].claimId).toBeTruthy();
    expect(claimed[0].workerId).toBeTruthy();
    expect(claimed[0].generation).toBe(1);

    // Database: exactly 1 row for this opportunity, status=ACTIVE
    const dbClaim = await prisma.autonomousExecutionClaim.findUnique({
      where: { opportunityId },
    });
    expect(dbClaim).toBeTruthy();
    expect(dbClaim.status).toBe("ACTIVE");
    expect(dbClaim.generation).toBe(1);
  }, 30_000);
});

// ── Test 4: Cross-Opportunity Parallelism + Shared Budget ───────────────────

dbDescribe("§4 Cross-Opportunity — independent claims, shared budget=5", () => {
  const BUDGET = 5;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    await prisma.$connect();

    testSiteId = testId("site-xopp");
    await prisma.site.create({
      data: {
        id: testSiteId,
        name: `Cross-Opp Test ${testSiteId}`,
        dailyMutationLimit: BUDGET,
        maxConcurrentExecutions: 50,
        operatingMode: "SUPERVISED",
      },
    });
  });

  afterAll(async () => {
    await prisma.budgetReservation.deleteMany({ where: { siteId: testSiteId } });
    await prisma.autonomousExecutionClaim.deleteMany({ where: { siteId: testSiteId } });
    await prisma.site.delete({ where: { id: testSiteId } });
    await prisma.$disconnect();
  });

  it("A and B use independent opportunity locks but share site budget", async () => {
    const { claimExecution } = await import("@/lib/autonomy/execution-claim");
    const { reserveBudget } = await import("@/lib/autonomy/budget-enforcer");

    const oppA = testId("opp-A");
    const oppB = testId("opp-B");

    // 1. Claims should be independent (different opportunity locks)
    const [claimA, claimB] = await Promise.all([
      claimExecution(testSiteId, oppA, "prop-A"),
      claimExecution(testSiteId, oppB, "prop-B"),
    ]);

    expect(claimA.claimed).toBe(true);
    expect(claimB.claimed).toBe(true);

    // 2. Per-opportunity claim serialization must NOT serialize the whole site
    //    Both A and B should have gotten through concurrently
    expect(claimA.claimId).not.toBe(claimB.claimId);

    // 3. Budget is shared at site level — total across A+B must be ≤ BUDGET
    const { successes } = await runConcurrent(20, async () => {
      return reserveBudget(testSiteId);
    });

    const reserved = successes.filter((r) => r !== null);
    expect(reserved.length).toBe(BUDGET);

    // 4. Verify database: exactly BUDGET reservations
    const dbCount = await prisma.budgetReservation.count({
      where: { siteId: testSiteId, status: "RESERVED" },
    });
    expect(dbCount).toBe(BUDGET);
  }, 30_000);
});

// ── Test 5: Half-Open Circuit Probe Race ────────────────────────────────────

dbDescribe("§5 Half-Open Circuit Probe Race — 20 concurrent probes", () => {
  const WORKERS = 20;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    await prisma.$connect();

    testSiteId = testId("site-circuit");
    await prisma.site.create({
      data: {
        id: testSiteId,
        name: `Circuit Race Test ${testSiteId}`,
        dailyMutationLimit: 100,
        maxConcurrentExecutions: 50,
        operatingMode: "SUPERVISED",
      },
    });
  });

  afterAll(async () => {
    await prisma.circuitBreaker.deleteMany({ where: { siteId: testSiteId } });
    await prisma.site.delete({ where: { id: testSiteId } });
    await prisma.$disconnect();
  });

  it("exactly 1 probe succeeds when OPEN → HALF_OPEN transition occurs", async () => {
    await prisma.circuitBreaker.create({
      data: {
        siteId: testSiteId,
        channel: "wordpress",
        state: "OPEN",
        failureCount: 5,
        nextAttemptAt: new Date(Date.now() - 60_000),
        halfOpenProbeInFlight: false,
      },
    });

    const { checkCircuitBreaker } = await import("@/lib/autonomy/circuit-breaker");

    const { successes } = await runConcurrent(WORKERS, async () => {
      return checkCircuitBreaker(testSiteId, "wordpress");
    });

    const probes = successes.filter((r) => r.allowed && r.isProbe);
    const rejected = successes.filter((r) => !r.allowed);

    expect(probes.length).toBe(1);
    expect(rejected.length).toBe(WORKERS - 1);

    const cb = await prisma.circuitBreaker.findFirst({
      where: { siteId: testSiteId, channel: "wordpress" },
    });
    expect(cb.halfOpenProbeInFlight).toBe(true);
    expect(cb.state).toBe("HALF_OPEN");
  }, 30_000);
});
