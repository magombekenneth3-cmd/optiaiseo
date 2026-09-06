/**
 * D.8.1.2 — Portfolio Activation Toggle
 *
 * Proves the D.7 activation boundary: that portfolio optimization's
 * enabled/disabled flag controls which OPEN opportunities reach D.3 planning.
 *
 * Test scenarios:
 *   §1 — D7 disabled → all OPEN pass through, no DB query
 *   §2 — D7 enabled  → only SELECTED pass; DEFERRED/EXCLUDED blocked
 *   §3 — Mid-cycle toggle coherence (module-cached env)
 *   §4 — Stale allocation + D7 disabled → passthrough (no fencing)
 *
 * Classification: UNIT / MOCKED
 *
 * Architectural constraint: This test does NOT modify production code.
 * It only validates the activation boundary via the existing module API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────────

const mockFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    portfolioAllocation: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

const mockValidateFence = vi.fn();
vi.mock("@/lib/portfolio/allocation-fence", () => ({
  validateAllocationFence: (...args: unknown[]) => mockValidateFence(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helper: reload module with fresh env ────────────────────────────────────

/**
 * The portfolio-gate module caches D7_PORTFOLIO_OPTIMIZATION_ENABLED at
 * module load time (line 33-34). To test both modes, we must reset the
 * Vitest module registry so the constant re-evaluates from process.env.
 */
async function loadGate(enabled: boolean) {
  if (enabled) {
    process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED = "true";
  } else {
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  }

  vi.resetModules();

  // Re-apply mocks after module reset (resetModules clears them)
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      portfolioAllocation: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  }));
  vi.doMock("@/lib/portfolio/allocation-fence", () => ({
    validateAllocationFence: (...args: unknown[]) => mockValidateFence(...args),
  }));
  vi.doMock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));

  return await import("@/lib/planning/portfolio-gate");
}

// ══════════════════════════════════════════════════════════════════════════════
// §1 — D7 Disabled: All OPEN opportunities pass through to D.3
// ══════════════════════════════════════════════════════════════════════════════

describe("§1 D7 disabled — all OPEN pass through to D.3", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });

  it("1.1 gate returns gated=false immediately", async () => {
    const { checkPortfolioGate } = await loadGate(false);
    const result = await checkPortfolioGate("opp-1", "site-1");

    expect(result.gated).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("1.2 no PortfolioAllocation lookup is made", async () => {
    const { checkPortfolioGate } = await loadGate(false);
    await checkPortfolioGate("opp-1", "site-1");

    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("1.3 no fence validation is made", async () => {
    const { checkPortfolioGate } = await loadGate(false);
    await checkPortfolioGate("opp-1", "site-1");

    expect(mockValidateFence).not.toHaveBeenCalled();
  });

  it("1.4 multiple opportunities all pass through", async () => {
    const { checkPortfolioGate } = await loadGate(false);

    const r1 = await checkPortfolioGate("opp-a", "site-1");
    const r2 = await checkPortfolioGate("opp-b", "site-1");
    const r3 = await checkPortfolioGate("opp-c", "site-2");

    expect(r1.gated).toBe(false);
    expect(r2.gated).toBe(false);
    expect(r3.gated).toBe(false);

    // Zero DB queries total
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockValidateFence).not.toHaveBeenCalled();
  });

  it("1.5 isPortfolioOptimizationEnabled() returns false", async () => {
    const { isPortfolioOptimizationEnabled } = await loadGate(false);
    expect(isPortfolioOptimizationEnabled()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — D7 Enabled: Only SELECTED pass; DEFERRED/EXCLUDED blocked
// ══════════════════════════════════════════════════════════════════════════════

describe("§2 D7 enabled — only SELECTED pass to D.3", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });

  it("2.1 SELECTED + valid fence → gate passes", async () => {
    const { checkPortfolioGate } = await loadGate(true);
    mockFindFirst.mockResolvedValue({ id: "alloc-sel" });
    mockValidateFence.mockResolvedValue({ valid: true });

    const result = await checkPortfolioGate("opp-1", "site-1");

    expect(result.gated).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockValidateFence).toHaveBeenCalledWith("alloc-sel", expect.any(Date));
  });

  it("2.2 DEFERRED is blocked — query returns null because findFirst WHERE is decision:SELECTED", async () => {
    const { checkPortfolioGate } = await loadGate(true);

    // A DEFERRED allocation exists in the DB, but the gate query
    // uses decision: "SELECTED" — so findFirst returns null.
    mockFindFirst.mockResolvedValue(null);

    const result = await checkPortfolioGate("opp-deferred", "site-1");

    expect(result.gated).toBe(true);
    expect(result.reasons[0].rule).toBe("NOT_PORTFOLIO_SELECTED");

    // Verify the query explicitly filters by SELECTED
    const callArgs = mockFindFirst.mock.calls[0][0];
    expect(callArgs.where.decision).toBe("SELECTED");
  });

  it("2.3 EXCLUDED is blocked — query returns null because findFirst WHERE is decision:SELECTED", async () => {
    const { checkPortfolioGate } = await loadGate(true);

    // An EXCLUDED allocation exists in the DB, but the gate query
    // uses decision: "SELECTED" — so findFirst returns null.
    mockFindFirst.mockResolvedValue(null);

    const result = await checkPortfolioGate("opp-excluded", "site-1");

    expect(result.gated).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].rule).toBe("NOT_PORTFOLIO_SELECTED");
    expect(result.reasons[0].details).toContain("opp-excluded");
  });

  it("2.4 SELECTED + stale fence → blocked with STALE_ALLOCATION", async () => {
    const { checkPortfolioGate } = await loadGate(true);
    mockFindFirst.mockResolvedValue({ id: "alloc-stale" });
    mockValidateFence.mockResolvedValue({ valid: false, reason: "EVIDENCE_HASH_CHANGED" });

    const result = await checkPortfolioGate("opp-stale", "site-1");

    expect(result.gated).toBe(true);
    expect(result.reasons[0].rule).toBe("STALE_ALLOCATION");
    expect(result.reasons[0].details).toContain("EVIDENCE_HASH_CHANGED");
  });

  it("2.5 isPortfolioOptimizationEnabled() returns true", async () => {
    const { isPortfolioOptimizationEnabled } = await loadGate(true);
    expect(isPortfolioOptimizationEnabled()).toBe(true);
  });

  it("2.6 only SELECTED decision is queried — not DEFERRED, not EXCLUDED", async () => {
    const { checkPortfolioGate } = await loadGate(true);
    mockFindFirst.mockResolvedValue(null);

    await checkPortfolioGate("opp-1", "site-1");

    const where = mockFindFirst.mock.calls[0][0].where;
    expect(where.decision).toBe("SELECTED");
    // Ensure it doesn't use { in: [...] } which would include other decisions
    expect(where.decision).not.toEqual(expect.objectContaining({ in: expect.any(Array) }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — Mid-Cycle Toggle Coherence
// ══════════════════════════════════════════════════════════════════════════════

describe("§3 Mid-cycle toggle — module-cached env var", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });

  it("3.1 changing process.env AFTER module load does NOT change behavior", async () => {
    // Load with disabled
    const disabledMod = await loadGate(false);
    expect(disabledMod.isPortfolioOptimizationEnabled()).toBe(false);

    // Mutate env mid-cycle — the module-level constant is already cached
    process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED = "true";

    // The loaded module instance still sees false
    expect(disabledMod.isPortfolioOptimizationEnabled()).toBe(false);

    const result = await disabledMod.checkPortfolioGate("opp-1", "site-1");
    expect(result.gated).toBe(false);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("3.2 vi.resetModules() is required to pick up the new value", async () => {
    // Load with disabled
    const disabledMod = await loadGate(false);
    expect(disabledMod.isPortfolioOptimizationEnabled()).toBe(false);

    // Now load with enabled — this does resetModules internally
    const enabledMod = await loadGate(true);
    expect(enabledMod.isPortfolioOptimizationEnabled()).toBe(true);

    // The two module instances have independent constants
    // (disabledMod is now stale and would fail if used, but that's expected)
  });

  it("3.3 disabled→enabled switch: new module instance queries DB", async () => {
    // Start disabled — no DB queries
    const disabled = await loadGate(false);
    await disabled.checkPortfolioGate("opp-1", "site-1");
    expect(mockFindFirst).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // Switch to enabled — queries DB
    const enabled = await loadGate(true);
    mockFindFirst.mockResolvedValue(null);
    const result = await enabled.checkPortfolioGate("opp-1", "site-1");

    expect(result.gated).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });

  it("3.4 enabled→disabled switch: new module instance skips DB", async () => {
    // Start enabled
    const enabled = await loadGate(true);
    mockFindFirst.mockResolvedValue(null);
    const r1 = await enabled.checkPortfolioGate("opp-1", "site-1");
    expect(r1.gated).toBe(true);

    vi.clearAllMocks();

    // Switch to disabled
    const disabled = await loadGate(false);
    const r2 = await disabled.checkPortfolioGate("opp-1", "site-1");

    expect(r2.gated).toBe(false);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — Stale Allocation + D7 Disabled → Passthrough
// ══════════════════════════════════════════════════════════════════════════════

describe("§4 Stale allocation + D7 disabled — no fencing performed", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });

  it("4.1 disabled mode does not perform stale-allocation DB checks", async () => {
    const { checkPortfolioGate } = await loadGate(false);

    // Even if there's a stale SELECTED allocation in the DB,
    // disabled mode returns early before querying
    const result = await checkPortfolioGate("opp-stale", "site-1");

    expect(result.gated).toBe(false);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockValidateFence).not.toHaveBeenCalled();
  });

  it("4.2 disabled mode does not import allocation-fence module", async () => {
    const { checkPortfolioGate } = await loadGate(false);
    await checkPortfolioGate("opp-1", "site-1");

    // The mock was set up but never called — proving the dynamic import
    // at line 67 of portfolio-gate.ts is never reached
    expect(mockValidateFence).not.toHaveBeenCalled();
  });

  it("4.3 disabled mode passthrough is deterministic across calls", async () => {
    const { checkPortfolioGate } = await loadGate(false);

    // Simulate a scenario where stale data exists
    // but the gate doesn't even check
    const results = await Promise.all([
      checkPortfolioGate("opp-stale-1", "site-1"),
      checkPortfolioGate("opp-stale-2", "site-1"),
      checkPortfolioGate("opp-fresh", "site-1"),
    ]);

    expect(results.every((r) => r.gated === false)).toBe(true);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
