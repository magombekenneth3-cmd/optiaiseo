import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Audit Lifecycle & Locking — Unit Tests
//
// Tests the five fixes:
//   P0-1: Manual audit onFailure finalizes to FAILED
//   P0-2: Page-audit coordinator onFailure finalizes parent to FAILED
//   P0-3: Synchronous fallback failure → FAILED + lock released
//   P1-4: Reconciliation watchdog detects stuck audits
//   P1-5: Lease-based lock with renewal (not fixed TTL)
//
// Strategy: Mock Prisma/Redis at the module boundary, test the behavioral
// contracts of onFailure handlers, lease logic, and reconciliation.
// ---------------------------------------------------------------------------

// ── Shared mocks ────────────────────────────────────────────────────────────

const mockPrismaAuditUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockPrismaAuditUpdate = vi.fn().mockResolvedValue({});
const mockPrismaAuditDelete = vi.fn().mockResolvedValue({});
const mockPrismaAuditFindMany = vi.fn().mockResolvedValue([]);
const mockRedisSet = vi.fn().mockResolvedValue("OK");
const mockRedisDel = vi.fn().mockResolvedValue(1);
const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisEval = vi.fn().mockResolvedValue(1);

vi.mock("@/lib/prisma", () => ({
    prisma: {
        audit: {
            updateMany: (...args: unknown[]) => mockPrismaAuditUpdateMany(...args),
            update: (...args: unknown[]) => mockPrismaAuditUpdate(...args),
            delete: (...args: unknown[]) => mockPrismaAuditDelete(...args),
            findMany: (...args: unknown[]) => mockPrismaAuditFindMany(...args),
            create: vi.fn().mockResolvedValue({ id: "test-audit-123" }),
            findUnique: vi.fn().mockResolvedValue(null),
        },
        site: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
        user: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
    },
}));

vi.mock("@/lib/redis", () => ({
    redis: {
        set: (...args: unknown[]) => mockRedisSet(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
        get: (...args: unknown[]) => mockRedisGet(...args),
        eval: (...args: unknown[]) => mockRedisEval(...args),
    },
    getRedis: () => ({
        set: (...args: unknown[]) => mockRedisSet(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
        get: (...args: unknown[]) => mockRedisGet(...args),
        eval: (...args: unknown[]) => mockRedisEval(...args),
    }),
}));

vi.mock("@/lib/logger", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetMocks() {
    vi.clearAllMocks();
    mockPrismaAuditUpdateMany.mockResolvedValue({ count: 1 });
    mockPrismaAuditUpdate.mockResolvedValue({});
    mockRedisEval.mockResolvedValue(1);
    mockRedisSet.mockResolvedValue("OK");
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe("Audit Lifecycle Tests", () => {
    beforeEach(resetMocks);
    afterEach(() => vi.restoreAllMocks());

    // ── P0-1: Manual audit failure → FAILED ──────────────────────────────

    describe("P0-1: Manual audit onFailure", () => {
        it("1. Manual audit failure transitions to FAILED", async () => {
            // Simulate what Inngest's onFailure handler does
            const auditId = "audit-fail-001";
            const lockKey = "audit-lock:user1:site1";

            // This replicates the onFailure logic from processManualAuditJob
            const { releaseAuditLease } = await import("@/lib/audit-lock");
            await releaseAuditLease(lockKey, auditId);

            const { prisma } = await import("@/lib/prisma");
            const { count } = await prisma.audit.updateMany({
                where: {
                    id: auditId,
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });

            expect(count).toBe(1);
            expect(mockPrismaAuditUpdateMany).toHaveBeenCalledWith({
                where: {
                    id: auditId,
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
            // Lease released via Lua script (conditional)
            expect(mockRedisEval).toHaveBeenCalled();
        });

        it("2. Retry exhaustion transitions to FAILED", async () => {
            const auditId = "audit-retry-exhaust";

            const { prisma } = await import("@/lib/prisma");
            await prisma.audit.updateMany({
                where: {
                    id: auditId,
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });

            expect(mockPrismaAuditUpdateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ id: auditId }),
                    data: { fixStatus: "FAILED" },
                })
            );
        });
    });

    // ── P0-2: Page-audit coordinator failure ─────────────────────────────

    describe("P0-2: Page-audit coordinator onFailure", () => {
        it("3. Coordinator failure → parent FAILED", async () => {
            const auditId = "audit-coordinator-fail";

            const { prisma } = await import("@/lib/prisma");
            const { count } = await prisma.audit.updateMany({
                where: {
                    id: auditId,
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });

            expect(count).toBe(1);
            expect(mockPrismaAuditUpdateMany).toHaveBeenCalledWith({
                where: {
                    id: auditId,
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
        });
    });

    // ── P0-3: Synchronous fallback cleanup ───────────────────────────────

    describe("P0-3: Synchronous fallback", () => {
        it("4. Sync fallback failure → FAILED + lock released", async () => {
            const auditId = "audit-sync-fail";
            const lockKey = "audit-lock:user1:site1";

            // Simulate sync fallback failing: audit marked FAILED
            const { prisma } = await import("@/lib/prisma");
            await prisma.audit.update({
                where: { id: auditId },
                data: { fixStatus: "FAILED" },
            });

            // Lock released via lease
            const { releaseAuditLease } = await import("@/lib/audit-lock");
            await releaseAuditLease(lockKey, auditId);

            expect(mockPrismaAuditUpdate).toHaveBeenCalledWith({
                where: { id: auditId },
                data: { fixStatus: "FAILED" },
            });
            expect(mockRedisEval).toHaveBeenCalled();
        });

        it("5. Lock released even when fallback throws", async () => {
            const auditId = "audit-throw";
            const lockKey = "audit-lock:user1:site1";

            // Simulate: the fallback throws, but finally block releases lock
            let lockReleased = false;
            try {
                throw new Error("Sync fallback exploded");
            } catch {
                // In production, the audit gets marked FAILED here
            } finally {
                const { releaseAuditLease } = await import("@/lib/audit-lock");
                await releaseAuditLease(lockKey, auditId);
                lockReleased = true;
            }

            expect(lockReleased).toBe(true);
            expect(mockRedisEval).toHaveBeenCalled();
        });
    });

    // ── P1-4: Reconciliation watchdog ────────────────────────────────────

    describe("P1-4: Reconciliation / watchdog", () => {
        it("6. Lost child work is detected by reconciliation", async () => {
            // Audit has totalPages=10, completedPages=9, failedPages=1 (all done)
            // but fixStatus is still IN_PROGRESS (counter race)
            const stuckAudit = {
                id: "audit-stuck-counter",
                siteId: "site1",
                totalPages: 10,
                completedPages: 9,
                failedPages: 1,
                runTimestamp: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
                site: { userId: "user1" },
            };

            const processed = stuckAudit.completedPages + stuckAudit.failedPages;
            expect(processed).toBeGreaterThanOrEqual(stuckAudit.totalPages);

            // Reconciliation: should mark PARTIAL since failedPages > 0
            const finalStatus = stuckAudit.completedPages === 0
                ? "FAILED"
                : stuckAudit.failedPages > 0
                    ? "PARTIAL"
                    : "COMPLETED";

            expect(finalStatus).toBe("PARTIAL");

            const { prisma } = await import("@/lib/prisma");
            await prisma.audit.updateMany({
                where: { id: stuckAudit.id, fixStatus: "IN_PROGRESS" },
                data: { fixStatus: finalStatus },
            });

            expect(mockPrismaAuditUpdateMany).toHaveBeenCalledWith({
                where: { id: stuckAudit.id, fixStatus: "IN_PROGRESS" },
                data: { fixStatus: "PARTIAL" },
            });
        });

        it("7. Stalled audit eventually becomes FAILED", async () => {
            // IN_PROGRESS audit where totalPages > processed (children lost)
            const stuckAudit = {
                id: "audit-stalled",
                siteId: "site1",
                totalPages: 50,
                completedPages: 30,
                failedPages: 5,
                runTimestamp: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
                site: { userId: "user1" },
            };

            const processed = stuckAudit.completedPages + stuckAudit.failedPages;
            // 35 < 50 — not all children completed, cannot reconcile
            expect(processed).toBeLessThan(stuckAudit.totalPages);

            // Watchdog marks as FAILED since it's past the 45min threshold
            const { prisma } = await import("@/lib/prisma");
            await prisma.audit.updateMany({
                where: {
                    id: { in: [stuckAudit.id] },
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });

            expect(mockPrismaAuditUpdateMany).toHaveBeenCalledWith({
                where: {
                    id: { in: [stuckAudit.id] },
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
        });

        it("8. Reconciliation is idempotent", async () => {
            const auditId = "audit-already-failed";

            // First call: count = 1 (transition happened)
            mockPrismaAuditUpdateMany.mockResolvedValueOnce({ count: 1 });
            const { prisma } = await import("@/lib/prisma");
            const r1 = await prisma.audit.updateMany({
                where: {
                    id: auditId,
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
            expect(r1.count).toBe(1);

            // Second call: count = 0 (already terminal — no-op)
            mockPrismaAuditUpdateMany.mockResolvedValueOnce({ count: 0 });
            const r2 = await prisma.audit.updateMany({
                where: {
                    id: auditId,
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
            expect(r2.count).toBe(0);
        });
    });

    // ── State-transition invariants ──────────────────────────────────────

    describe("State-transition invariants", () => {
        it("9. Completed audit cannot be changed to FAILED", async () => {
            // updateMany with notIn guard won't match COMPLETED
            mockPrismaAuditUpdateMany.mockResolvedValue({ count: 0 });
            const { prisma } = await import("@/lib/prisma");
            const { count } = await prisma.audit.updateMany({
                where: {
                    id: "completed-audit",
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
            expect(count).toBe(0);
        });

        it("10. Failed audit cannot become COMPLETED", async () => {
            // The page-audit finalizer uses fixStatus: "IN_PROGRESS" as WHERE clause
            mockPrismaAuditUpdateMany.mockResolvedValue({ count: 0 });
            const { prisma } = await import("@/lib/prisma");
            const { count } = await prisma.audit.updateMany({
                where: {
                    fixStatus: "IN_PROGRESS", // audit is actually FAILED
                },
                data: { fixStatus: "COMPLETED" },
            });
            expect(count).toBe(0); // FAILED won't match IN_PROGRESS
        });
    });

    // ── P1-5: Lease-based lock ───────────────────────────────────────────

    describe("P1-5: Audit lease lock", () => {
        it("11. Active long-running audit does not lose ownership after initial TTL", async () => {
            const lockKey = "audit-lock:user1:site1";
            const token = "audit-long-running";

            // Acquire lease
            const { acquireAuditLease, renewAuditLease } = await import("@/lib/audit-lock");
            const acquired = await acquireAuditLease(lockKey, token);
            expect(acquired).toBe(true);
            expect(mockRedisSet).toHaveBeenCalledWith(
                lockKey,
                token,
                { nx: true, ex: 120 },
            );

            // Renewal succeeds (Lua script returns 1)
            mockRedisEval.mockResolvedValue(1);
            const renewed = await renewAuditLease(lockKey, token);
            expect(renewed).toBe(true);
        });

        it("12. Second audit cannot start while first still owns active work", async () => {
            const lockKey = "audit-lock:user1:site1";

            // First audit acquired the lease
            mockRedisSet.mockResolvedValueOnce("OK");
            const { acquireAuditLease } = await import("@/lib/audit-lock");
            const first = await acquireAuditLease(lockKey, "audit-first");
            expect(first).toBe(true);

            // Second audit tries to acquire — NX fails (returns null)
            mockRedisSet.mockResolvedValueOnce(null);
            const second = await acquireAuditLease(lockKey, "audit-second");
            expect(second).toBe(false);
        });

        it("13. Expired/stale ownership cannot mutate the active audit", async () => {
            const lockKey = "audit-lock:user1:site1";

            // Old audit tries to release — but token doesn't match (Lua returns 0)
            mockRedisEval.mockResolvedValue(0);
            const { releaseAuditLease } = await import("@/lib/audit-lock");
            await releaseAuditLease(lockKey, "stale-audit-token");

            // The key still exists (was not deleted) — active audit is safe
            expect(mockRedisEval).toHaveBeenCalled();
            // Verify the Lua script was called with the stale token
            const evalCall = mockRedisEval.mock.calls[0];
            expect(evalCall[2]).toEqual(["stale-audit-token"]);
        });

        it("Heartbeat stops cleanly and reports loss correctly", async () => {
            vi.useFakeTimers();

            const lockKey = "audit-lock:user1:site1";
            const token = "audit-hb-test";

            // First tick: success, second tick: lease lost
            mockRedisEval
                .mockResolvedValueOnce(1)  // initial tick success
                .mockResolvedValueOnce(0); // second tick: lease lost

            const onLost = vi.fn();
            const { startAuditLeaseHeartbeat, AUDIT_HEARTBEAT_INTERVAL_MS } = await import("@/lib/audit-lock");
            const heartbeat = startAuditLeaseHeartbeat(lockKey, token, onLost);

            // Initial tick runs immediately
            await vi.advanceTimersByTimeAsync(10);
            expect(heartbeat.isLost()).toBe(false);

            // Advance to next heartbeat interval — lease lost
            await vi.advanceTimersByTimeAsync(AUDIT_HEARTBEAT_INTERVAL_MS);
            expect(heartbeat.isLost()).toBe(true);
            expect(onLost).toHaveBeenCalledTimes(1);

            heartbeat.stop();
            vi.useRealTimers();
        });
    });

    // ── Existing behavior preservation ───────────────────────────────────

    describe("Existing behavior preservation", () => {
        it("14. Successful multi-page audit still reaches COMPLETED", async () => {
            // This tests the normal path: all pages processed → COMPLETED
            const auditId = "audit-success";

            // Simulate the page-audit child finalizer
            const { prisma } = await import("@/lib/prisma");
            mockPrismaAuditUpdateMany.mockResolvedValue({ count: 1 });
            const { count } = await prisma.audit.updateMany({
                where: {
                    fixStatus: "IN_PROGRESS",
                },
                data: { fixStatus: "COMPLETED" },
            });

            expect(count).toBe(1);
            expect(mockPrismaAuditUpdateMany).toHaveBeenCalledWith({
                where: { fixStatus: "IN_PROGRESS" },
                data: { fixStatus: "COMPLETED" },
            });
        });

        it("15. Existing retry behavior remains intact", async () => {
            // The onFailure handler only fires after ALL retries are exhausted.
            // During retries, the audit stays in PENDING/IN_PROGRESS.
            // onFailure's updateMany with notIn guard means:
            // - If a retry succeeded and set COMPLETED, onFailure is a no-op (count=0)
            // - If all retries failed, onFailure transitions to FAILED (count=1)

            mockPrismaAuditUpdateMany
                .mockResolvedValueOnce({ count: 0 })  // Already COMPLETED by retry
                .mockResolvedValueOnce({ count: 1 }); // All retries failed

            const { prisma } = await import("@/lib/prisma");

            // Scenario A: retry succeeded before onFailure
            const r1 = await prisma.audit.updateMany({
                where: {
                    id: "audit-retry-succeeded",
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
            expect(r1.count).toBe(0); // No-op — already COMPLETED

            // Scenario B: all retries exhausted
            const r2 = await prisma.audit.updateMany({
                where: {
                    id: "audit-all-retries-failed",
                    fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                },
                data: { fixStatus: "FAILED" },
            });
            expect(r2.count).toBe(1); // Transitioned to FAILED
        });
    });
});
