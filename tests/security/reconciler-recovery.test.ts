/**
 * Phase B.2.5b — Reconciler Recovery Tests
 *
 * Verifies the version-aware recovery logic in reconcileEffects().
 * Tests the three crash cases:
 *   §1 — Genuinely abandoned: version unchanged → APPROVED (safe to retry)
 *   §2 — Committed but unacknowledged: version bumped → COMMITTED (do NOT re-execute)
 *   §3 — Version check failure: fail closed → FAILED (human investigates)
 *   §4 — Lease expiry check correctness: uses executionLeaseExpiresAt, not claimedAt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const _db = {
  mutationEffect: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  mutationOperation: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  blog: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: _db,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock appendAuditEvent to capture recovery actions
const auditEvents: Array<{ operationId: string; eventType: string; details: any }> = [];
vi.mock("@/lib/mutations/audit", () => ({
  appendAuditEvent: vi.fn(async (opId: string, eventType: string, _actor: string, details: any) => {
    auditEvents.push({ operationId: opId, eventType, details });
  }),
}));

vi.mock("@/lib/mutations/operation", () => ({
  checkOperationCompletion: vi.fn().mockResolvedValue(null),
}));

function makeStuckOp(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-stuck-1",
    executionClaimedBy: "crashed-worker",
    executionClaimedAt: new Date(Date.now() - 300_000), // 5 min ago
    executionLeaseExpiresAt: new Date(Date.now() - 240_000), // expired 4 min ago
    targetModel: "Blog",
    targetId: "blog-1",
    expectedVersion: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditEvents.length = 0;
});

// ══════════════════════════════════════════════════════════════════════════════
// §1 — Genuinely abandoned: version unchanged → APPROVED
// ══════════════════════════════════════════════════════════════════════════════

describe("§1 Genuinely abandoned — version unchanged → APPROVED", () => {
  it("resets to APPROVED when target version matches expectedVersion", async () => {
    const stuck = makeStuckOp();
    _db.mutationEffect.findMany.mockResolvedValue([]); // No stale effects
    _db.mutationOperation.findMany.mockResolvedValue([stuck]); // One stuck op
    _db.blog.findUnique.mockResolvedValue({ version: 3 }); // Version unchanged
    _db.mutationOperation.update.mockResolvedValue({ ...stuck, status: "APPROVED" });

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    // Should update to APPROVED
    expect(_db.mutationOperation.update).toHaveBeenCalledWith({
      where: { id: "op-stuck-1" },
      data: expect.objectContaining({
        status: "APPROVED",
        executionClaimedBy: null,
        executionClaimedAt: null,
        executionLeaseExpiresAt: null,
      }),
    });

    // Audit event should say APPROVED
    const recoveryEvent = auditEvents.find(e => e.eventType === "EXECUTION_RECOVERED");
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent!.details.recoveryAction).toContain("APPROVED");
    expect(recoveryEvent!.details.recoveryAction).toContain("mutation never applied");
  });

  it("target version exactly equal to expectedVersion → mutation did not apply", async () => {
    const stuck = makeStuckOp({ expectedVersion: 5 });
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([stuck]);
    _db.blog.findUnique.mockResolvedValue({ version: 5 }); // Exactly matches expected
    _db.mutationOperation.update.mockResolvedValue({ ...stuck, status: "APPROVED" });

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    expect(_db.mutationOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED" }),
      })
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — Committed but unacknowledged: version bumped → COMMITTED
// ══════════════════════════════════════════════════════════════════════════════

describe("§2 Committed but unacknowledged — version bumped → COMMITTED", () => {
  it("advances to COMMITTED when target version > expectedVersion", async () => {
    const stuck = makeStuckOp({ expectedVersion: 3 });
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([stuck]);
    _db.blog.findUnique.mockResolvedValue({ version: 4 }); // Version bumped!
    _db.mutationOperation.update.mockResolvedValue({ ...stuck, status: "COMMITTED" });

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    expect(_db.mutationOperation.update).toHaveBeenCalledWith({
      where: { id: "op-stuck-1" },
      data: expect.objectContaining({
        status: "COMMITTED", // NOT APPROVED!
        executionClaimedBy: null,
      }),
    });

    const recoveryEvent = auditEvents.find(e => e.eventType === "EXECUTION_RECOVERED");
    expect(recoveryEvent!.details.recoveryAction).toContain("COMMITTED");
    expect(recoveryEvent!.details.recoveryAction).toContain("version check confirmed");
  });

  it("prevents duplicate mutation — does NOT reset to APPROVED when committed", async () => {
    const stuck = makeStuckOp({ expectedVersion: 1 });
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([stuck]);
    _db.blog.findUnique.mockResolvedValue({ version: 2 }); // Committed
    _db.mutationOperation.update.mockResolvedValue({ ...stuck, status: "COMMITTED" });

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    // Verify APPROVED is NOT the target status
    const updateCall = _db.mutationOperation.update.mock.calls[0];
    expect(updateCall[0].data.status).not.toBe("APPROVED");
    expect(updateCall[0].data.status).toBe("COMMITTED");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — Version check failure → FAILED (fail closed)
// ══════════════════════════════════════════════════════════════════════════════

describe("§3 Version check failure → FAILED (fail closed)", () => {
  it("fails closed when blog.findUnique throws", async () => {
    const stuck = makeStuckOp();
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([stuck]);
    _db.blog.findUnique.mockRejectedValue(new Error("DB connection lost"));
    _db.mutationOperation.update.mockResolvedValue({ ...stuck, status: "FAILED" });

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    expect(_db.mutationOperation.update).toHaveBeenCalledWith({
      where: { id: "op-stuck-1" },
      data: expect.objectContaining({
        status: "FAILED", // NOT APPROVED — fail closed
        completedAt: expect.any(Date),
      }),
    });

    const recoveryEvent = auditEvents.find(e => e.eventType === "EXECUTION_RECOVERED");
    expect(recoveryEvent!.details.recoveryAction).toContain("FAILED");
    expect(recoveryEvent!.details.recoveryAction).toContain("fail closed");
  });

  it("unknown target model fails closed (not APPROVED)", async () => {
    const stuck = makeStuckOp({ targetModel: "UnknownModel" });
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([stuck]);
    _db.mutationOperation.update.mockResolvedValue({ ...stuck, status: "FAILED" });

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    expect(_db.mutationOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — Lease expiry check uses executionLeaseExpiresAt
// ══════════════════════════════════════════════════════════════════════════════

describe("§4 Lease expiry check", () => {
  it("reconciler queries executionLeaseExpiresAt, not executionClaimedAt", async () => {
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([]); // No stuck ops

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    // Check the WHERE clause used for findMany
    const call = _db.mutationOperation.findMany.mock.calls[0];
    expect(call[0].where).toHaveProperty("executionLeaseExpiresAt");
    expect(call[0].where).not.toHaveProperty("executionClaimedAt");
  });

  it("target entity not found → version check returns null → APPROVED (never applied)", async () => {
    const stuck = makeStuckOp();
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([stuck]);
    _db.blog.findUnique.mockResolvedValue(null); // Entity doesn't exist
    _db.mutationOperation.update.mockResolvedValue({ ...stuck, status: "APPROVED" });

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    await reconcileEffects(0, 0);

    // null target → version is not > expectedVersion → mutation never applied → APPROVED
    expect(_db.mutationOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED" }),
      })
    );
  });

  it("no stuck operations → no recovery attempted", async () => {
    _db.mutationEffect.findMany.mockResolvedValue([]);
    _db.mutationOperation.findMany.mockResolvedValue([]);

    const { reconcileEffects } = await import("@/lib/mutations/reconciliation");
    const result = await reconcileEffects(0, 0);

    expect(result.stuckOperationsRecovered).toBe(0);
    expect(_db.mutationOperation.update).not.toHaveBeenCalled();
  });
});
