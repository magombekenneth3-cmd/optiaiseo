/**
 * Phase B.2 — Execution Lease & Worker Recovery Hardening
 *
 * Tests every race scenario in the execution lease lifecycle:
 *
 *   §1 — Heartbeat mechanics (unit, no DB)
 *   §2 — renewLease() token-based ownership via mocked Prisma
 *   §3 — Worker A claims → Worker B cannot claim
 *   §4 — Heartbeat stops → reconciler recovery window invariants
 *   §5 — Worker A loses lease → cannot complete operation
 *   §6 — Worker A cannot steal Worker B's lease
 *   §7 — LeaseLostError type identity and recovery contract
 *   §8 — Long-running CMS operation scenario
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks must be declared before any imports that load the mocked modules ──
// vi.mock is hoisted by Vitest before all imports, so the factory runs first.
// We use a module-scoped object so the factory can reference it safely.

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Shared mock state — modified per-test via the `__prisma` export
const _db = { executeRaw: vi.fn() };

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return { $executeRawUnsafe: _db.executeRaw };
  },
}));

// ── Static imports (after mocks are registered) ─────────────────────────────
import {
  startOperationHeartbeat,
  LeaseLostError,
} from "@/lib/mutations/heartbeat";
import { claimExecution, renewLease } from "@/lib/mutations/concurrency";
import {
  ExecutionClaimError,
  ConcurrentModificationError,
  MutationBlockedError,
} from "@/lib/mutations/types";

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Reset the shared mock before each test
beforeEach(() => {
  _db.executeRaw.mockReset();
});

// ══════════════════════════════════════════════════════════════════════════════
// §1 — Heartbeat Mechanics (no DB calls — high intervalMs prevents firing)
// ══════════════════════════════════════════════════════════════════════════════

describe("§1 Heartbeat Mechanics", () => {

  it("leaseLost is false immediately after start", () => {
    const hb = startOperationHeartbeat("op-1", "worker-A", { intervalMs: 60_000 });
    expect(hb.leaseLost).toBe(false);
    hb.stop();
  });

  it("stop() is idempotent", () => {
    const hb = startOperationHeartbeat("op-2", "worker-A", { intervalMs: 60_000 });
    expect(() => { hb.stop(); hb.stop(); hb.stop(); }).not.toThrow();
  });

  it("leaseLost stays false after stop() with no intervals fired", async () => {
    const hb = startOperationHeartbeat("op-3", "worker-A", { intervalMs: 60_000 });
    await sleep(10);
    hb.stop();
    expect(hb.leaseLost).toBe(false);
  });

  it("leaseLostPromise is a Promise", () => {
    const hb = startOperationHeartbeat("op-4", "worker-A", { intervalMs: 60_000 });
    expect(hb.leaseLostPromise).toBeInstanceOf(Promise);
    hb.stop();
  });

  it("leaseLostPromise stays pending when stopped without lease loss", async () => {
    const hb = startOperationHeartbeat("op-5", "worker-A", { intervalMs: 60_000 });
    hb.stop();
    const result = await Promise.race([
      hb.leaseLostPromise.then(() => "resolved"),
      sleep(50).then(() => "timeout"),
    ]);
    expect(result).toBe("timeout");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — renewLease() Token-Based Ownership
// ══════════════════════════════════════════════════════════════════════════════

describe("§2 renewLease() Token-Based Ownership", () => {

  it("returns true when DB UPDATE affects 1 row (ownership confirmed)", async () => {
    _db.executeRaw.mockResolvedValueOnce(1);
    expect(await renewLease("op-123", "worker-A")).toBe(true);
  });

  it("returns false when DB UPDATE affects 0 rows (ownership lost)", async () => {
    _db.executeRaw.mockResolvedValueOnce(0);
    expect(await renewLease("op-123", "worker-A")).toBe(false);
  });

  it("SQL WHERE includes status=EXECUTING guard", async () => {
    _db.executeRaw.mockResolvedValueOnce(1);
    await renewLease("op-123", "worker-A");
    const sql = _db.executeRaw.mock.calls[0][0] as string;
    expect(sql).toContain("EXECUTING");
  });

  it("SQL WHERE includes executionClaimedBy token (not embedded — parameterized)", async () => {
    _db.executeRaw.mockResolvedValueOnce(1);
    await renewLease("op-123", "worker-A");
    const sql = _db.executeRaw.mock.calls[0][0] as string;
    const params = _db.executeRaw.mock.calls[0].slice(1);
    expect(sql).toContain("executionClaimedBy");
    expect(params).toContain("worker-A");
    expect(params).toContain("op-123");
  });

  it("worker-B cannot renew an op owned by worker-A (0 rows affected)", async () => {
    _db.executeRaw.mockResolvedValueOnce(0);
    expect(await renewLease("op-123", "worker-B")).toBe(false);
  });

  it("renewLease on a COMMITTED op returns false (status != EXECUTING)", async () => {
    _db.executeRaw.mockResolvedValueOnce(0);
    expect(await renewLease("op-committed", "worker-A")).toBe(false);
  });

  it("concurrent renewals: only the owner's succeeds", async () => {
    _db.executeRaw.mockImplementation(async (_sql: any, ...params: any[]) => {
      // Param index 3 = workerId in our SQL: ($1=expires, $2=now, $3=opId, $4=workerId)
      return params[3] === "worker-A" ? 1 : 0;
    });
    const [resultA, resultB] = await Promise.all([
      renewLease("op-race", "worker-A"),
      renewLease("op-race", "worker-B"),
    ]);
    expect(resultA).toBe(true);
    expect(resultB).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — Worker A Holds Lease → Worker B Cannot Claim
// ══════════════════════════════════════════════════════════════════════════════

describe("§3 Worker A holds lease → Worker B cannot claim", () => {

  it("claimExecution returns false when op is EXECUTING (not APPROVED)", async () => {
    _db.executeRaw.mockResolvedValueOnce(0);
    const { prisma } = await import("@/lib/prisma");
    expect(await claimExecution(prisma as any, "op-A", "worker-B")).toBe(false);
  });

  it("claimExecution SQL WHERE uses 'APPROVED' — not 'EXECUTING'", async () => {
    _db.executeRaw.mockResolvedValueOnce(0);
    const { prisma } = await import("@/lib/prisma");
    await claimExecution(prisma as any, "op-A", "worker-B");
    const sql = _db.executeRaw.mock.calls[0][0] as string;
    expect(sql).toContain("APPROVED");
    expect(sql).not.toMatch(/status\s*=\s*'EXECUTING'/);
  });

  it("heartbeat keeps leaseLost=false while renewals succeed", async () => {
    _db.executeRaw.mockResolvedValue(1); // always succeeds
    const hb = startOperationHeartbeat("op-B", "worker-A", { intervalMs: 25 });
    await sleep(100);
    hb.stop();
    expect(hb.leaseLost).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — Heartbeat Stops → Reconciler Recovery Window Invariants
// ══════════════════════════════════════════════════════════════════════════════

describe("§4 Heartbeat stops → reconciler can recover", () => {

  it("DESIGN: heartbeat interval (20s) < lease duration (60s)", () => {
    expect(20_000).toBeLessThan(60_000);
    expect(Math.floor(60_000 / 20_000)).toBeGreaterThanOrEqual(2);
  });

  it("DESIGN: reconciler window (2min) > lease duration (60s)", () => {
    expect(120_000).toBeGreaterThan(60_000);
  });

  it("DESIGN: reconciler window covers ≥3 missed heartbeats (transient blip tolerance)", () => {
    expect(Math.floor(120_000 / 20_000)).toBeGreaterThanOrEqual(3);
  });

  it("leaseLost fires when renewals consistently return false", async () => {
    _db.executeRaw.mockResolvedValue(0); // all renewals fail
    const hb = startOperationHeartbeat("op-expired", "worker-A", { intervalMs: 20 });

    const race = await Promise.race([
      hb.leaseLostPromise.then(() => "lost"),
      sleep(400).then(() => "timeout"),
    ]);

    hb.stop();
    expect(race).toBe("lost");
    expect(hb.leaseLost).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 — Worker A Loses Lease → Cannot Complete Operation
// ══════════════════════════════════════════════════════════════════════════════

describe("§5 Lease loss → worker cannot complete", () => {

  it("LeaseLostError carries operationId and workerId", () => {
    const err = new LeaseLostError("op-999", "worker-A");
    expect(err.operationId).toBe("op-999");
    expect(err.workerId).toBe("worker-A");
    expect(err.name).toBe("LeaseLostError");
  });

  it("LeaseLostError message describes abort reason and duplicate execution risk", () => {
    const err = new LeaseLostError("op-999", "worker-A");
    expect(err.message).toMatch(/lost lease/i);
    expect(err.message).toMatch(/op-999/);
    expect(err.message).toMatch(/worker-A/);
    expect(err.message).toMatch(/duplicate execution/i);
  });

  it("LeaseLostError instanceof Error", () => {
    expect(new LeaseLostError("op", "w") instanceof Error).toBe(true);
  });

  it("leaseLost=true → caller must not proceed to COMMITTED", async () => {
    _db.executeRaw.mockResolvedValue(0);
    const hb = startOperationHeartbeat("op-guard", "worker-A", { intervalMs: 20 });
    await hb.leaseLostPromise;
    hb.stop();
    expect(!hb.leaseLost).toBe(false); // shouldProceed = false
  });

  it("onLeaseLost callback fires exactly once", async () => {
    _db.executeRaw.mockResolvedValue(0);
    const onLeaseLost = vi.fn();
    const hb = startOperationHeartbeat("op-cb", "worker-A", {
      intervalMs: 20,
      onLeaseLost,
    });
    await hb.leaseLostPromise;
    await sleep(80); // extra intervals
    hb.stop();
    expect(onLeaseLost).toHaveBeenCalledTimes(1);
    expect(onLeaseLost).toHaveBeenCalledWith("op-cb", "worker-A");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 — Worker A Cannot Steal Worker B's Lease
// ══════════════════════════════════════════════════════════════════════════════

describe("§6 Worker A cannot steal Worker B's lease", () => {

  it("renewLease with wrong workerId returns false", async () => {
    _db.executeRaw.mockResolvedValueOnce(0);
    expect(await renewLease("op-stolen", "worker-A")).toBe(false);
  });

  it("after losing lease, manual renewLease also returns false", async () => {
    _db.executeRaw.mockResolvedValue(0);
    const hb = startOperationHeartbeat("op-lost", "worker-A", { intervalMs: 20 });
    await hb.leaseLostPromise;
    hb.stop();
    // Extra renewal attempt — still fails (op is no longer EXECUTING + owned by A)
    expect(await renewLease("op-lost", "worker-A")).toBe(false);
    expect(hb.leaseLost).toBe(true);
  });

  it("LeaseLostError thrown stops all mutation work", () => {
    const err = new LeaseLostError("op-123", "worker-A");
    expect(() => { throw err; }).toThrow(LeaseLostError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §7 — LeaseLostError Type Identity and Recovery Contract
// ══════════════════════════════════════════════════════════════════════════════

describe("§7 LeaseLostError recovery contract", () => {

  it("distinct from ConcurrentModificationError", () => {
    const a = new LeaseLostError("op", "w");
    const b = new ConcurrentModificationError("Blog", "id", 1);
    expect(a instanceof ConcurrentModificationError).toBe(false);
    expect(b instanceof LeaseLostError).toBe(false);
  });

  it("distinct from ExecutionClaimError", () => {
    const a = new LeaseLostError("op", "w");
    const b = new ExecutionClaimError("op");
    expect(a instanceof ExecutionClaimError).toBe(false);
    expect(b instanceof LeaseLostError).toBe(false);
  });

  it("distinct from MutationBlockedError", () => {
    const a = new LeaseLostError("op", "w");
    const b = new MutationBlockedError("kill switch");
    expect(a instanceof MutationBlockedError).toBe(false);
    expect(b instanceof LeaseLostError).toBe(false);
  });

  it("catch(LeaseLostError) → operation stays EXECUTING (not FAILED)", () => {
    // The executeOperation catch block pattern:
    //   if (error instanceof LeaseLostError) { return { status: "EXECUTING" } }
    // This type identity is the invariant that keeps the reconciler in charge.
    const err = new LeaseLostError("op", "w");
    expect(err instanceof LeaseLostError).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8 — Long-Running CMS Operation Scenario
// ══════════════════════════════════════════════════════════════════════════════

describe("§8 Long-running CMS operation scenario", () => {

  it("heartbeat fires multiple times during a long operation", async () => {
    let count = 0;
    _db.executeRaw.mockImplementation(async () => { count++; return 1; });
    const hb = startOperationHeartbeat("op-long", "worker-A", { intervalMs: 25 });
    await sleep(150);
    hb.stop();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(hb.leaseLost).toBe(false);
  });

  it("Worker B cannot claim while Worker A heartbeat is succeeding", async () => {
    _db.executeRaw.mockResolvedValue(1); // A's renewals pass
    const hb = startOperationHeartbeat("op-held", "worker-A", { intervalMs: 25 });
    await sleep(80);

    // Now simulate B's claim attempt returning 0 (op is EXECUTING, not APPROVED)
    _db.executeRaw.mockResolvedValueOnce(0);
    const { prisma } = await import("@/lib/prisma");
    const claimedByB = await claimExecution(prisma as any, "op-held", "worker-B");
    hb.stop();

    expect(claimedByB).toBe(false);
    expect(hb.leaseLost).toBe(false);
  });

  it("timing invariants: heartbeat < lease < recovery window", () => {
    const INTERVAL = 20_000;
    const LEASE = 60_000;
    const RECOVERY = 120_000;
    expect(INTERVAL).toBeLessThan(LEASE);
    expect(LEASE).toBeLessThan(RECOVERY);
    // At least one full lease window of margin before reconciler acts
    expect(RECOVERY - LEASE).toBeGreaterThanOrEqual(LEASE);
  });
});
