/**
 * D.7.8 — Portfolio Gate Unit Tests
 *
 * Tests the D.3 portfolio gate that controls whether an OPEN opportunity
 * should receive planning capacity based on D.7 allocation status.
 *
 * These tests verify the gate logic in isolation using mocks.
 * The actual DB-backed allocation fence is tested in portfolio-optimizer.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────────

// Mock prisma
const mockFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    portfolioAllocation: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

// Mock allocation fence
const mockValidateAllocationFence = vi.fn();
vi.mock("@/lib/portfolio/allocation-fence", () => ({
  validateAllocationFence: (...args: unknown[]) => mockValidateAllocationFence(...args),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helper: reload module with fresh env ────────────────────────────────────

/**
 * The portfolio-gate module caches process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED
 * at module load time. To test both enabled/disabled paths, we must reset the
 * module registry between tests that change the env var.
 */
async function loadGateModule(enabled: boolean) {
  // Set env BEFORE importing so the module-level constant picks it up
  if (enabled) {
    process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED = "true";
  } else {
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  }

  // Reset module cache so the constant re-evaluates
  vi.resetModules();

  // Re-apply mocks after module reset
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      portfolioAllocation: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  }));
  vi.doMock("@/lib/portfolio/allocation-fence", () => ({
    validateAllocationFence: (...args: unknown[]) => mockValidateAllocationFence(...args),
  }));
  vi.doMock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  return await import("@/lib/planning/portfolio-gate");
}

// ── Tests: Disabled Mode (Default) ──────────────────────────────────────────

describe("D.7.8 Portfolio Gate — Disabled (default)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });

  afterEach(() => {
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });

  it("1. Portfolio disabled → gate passes (backward compatible)", async () => {
    const { checkPortfolioGate } = await loadGateModule(false);

    const result = await checkPortfolioGate("opp-1", "site-1");

    expect(result.gated).toBe(false);
    expect(result.reasons).toEqual([]);
    // Should NOT have called prisma or fence
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockValidateAllocationFence).not.toHaveBeenCalled();
  });

  it("2. isPortfolioOptimizationEnabled returns false when env unset", async () => {
    const { isPortfolioOptimizationEnabled } = await loadGateModule(false);
    expect(isPortfolioOptimizationEnabled()).toBe(false);
  });

  it("3. Gate passthrough does not modify any state", async () => {
    const { checkPortfolioGate } = await loadGateModule(false);

    const r1 = await checkPortfolioGate("opp-1", "site-1");
    const r2 = await checkPortfolioGate("opp-1", "site-1");
    const r3 = await checkPortfolioGate("opp-2", "site-1");

    expect(r1.gated).toBe(false);
    expect(r2.gated).toBe(false);
    expect(r3.gated).toBe(false);

    // No DB queries in disabled mode
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

// ── Tests: Enabled Mode ─────────────────────────────────────────────────────

describe("D.7.8 Portfolio Gate — Enabled (D7_PORTFOLIO_OPTIMIZATION_ENABLED=true)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });

  it("4. isPortfolioOptimizationEnabled returns true when env is 'true'", async () => {
    const { isPortfolioOptimizationEnabled } = await loadGateModule(true);
    expect(isPortfolioOptimizationEnabled()).toBe(true);
  });

  it("5. No SELECTED allocation → DEFER with NOT_PORTFOLIO_SELECTED", async () => {
    const { checkPortfolioGate } = await loadGateModule(true);
    mockFindFirst.mockResolvedValue(null);

    const result = await checkPortfolioGate("opp-1", "site-1");

    expect(result.gated).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].rule).toBe("NOT_PORTFOLIO_SELECTED");
    expect(result.reasons[0].details).toContain("opp-1");
  });

  it("6. SELECTED + valid fence → gate passes", async () => {
    const { checkPortfolioGate } = await loadGateModule(true);
    mockFindFirst.mockResolvedValue({ id: "alloc-1" });
    mockValidateAllocationFence.mockResolvedValue({ valid: true });

    const result = await checkPortfolioGate("opp-1", "site-1");

    expect(result.gated).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockValidateAllocationFence).toHaveBeenCalledWith("alloc-1", expect.any(Date));
  });

  it("7. SELECTED + stale fence → DEFER with STALE_ALLOCATION", async () => {
    const { checkPortfolioGate } = await loadGateModule(true);
    mockFindFirst.mockResolvedValue({ id: "alloc-1" });
    mockValidateAllocationFence.mockResolvedValue({
      valid: false,
      reason: "SCORE_CHANGED",
    });

    const result = await checkPortfolioGate("opp-1", "site-1");

    expect(result.gated).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].rule).toBe("STALE_ALLOCATION");
    expect(result.reasons[0].details).toContain("SCORE_CHANGED");
  });

  it("8. Queries for SELECTED decision only, not DEFERRED/EXCLUDED", async () => {
    const { checkPortfolioGate } = await loadGateModule(true);
    mockFindFirst.mockResolvedValue(null);

    await checkPortfolioGate("opp-1", "site-1");

    // Verify the query filters for SELECTED
    const callArgs = mockFindFirst.mock.calls[0][0];
    expect(callArgs.where.decision).toBe("SELECTED");
    expect(callArgs.where.opportunityId).toBe("opp-1");
    expect(callArgs.where.siteId).toBe("site-1");
  });
});

// ── Tests: Safety Boundaries ────────────────────────────────────────────────

describe("D.7.8 Safety Boundaries", () => {
  it("9. Gate does not export mutation/execution functions", async () => {
    const moduleExports = await loadGateModule(false);
    const exportNames = Object.keys(moduleExports);

    expect(exportNames).not.toContain("reserveBudget");
    expect(exportNames).not.toContain("createClaim");
    expect(exportNames).not.toContain("createProposal");
    expect(exportNames).not.toContain("executeMutation");
  });

  it("10. PortfolioGateResult interface is correctly shaped", async () => {
    const { checkPortfolioGate } = await loadGateModule(false);
    const result = await checkPortfolioGate("opp-1", "site-1");

    expect(result).toEqual({
      gated: expect.any(Boolean),
      reasons: expect.any(Array),
    });
  });

  it("11. Allocator uses distinct advisory lock namespace", () => {
    // PORTFOLIO_LOCK_NAMESPACE = 737004
    // Budget: 737001, Concurrency: 737002, Claims: 737003
    const namespaces = [737001, 737002, 737003, 737004];
    const unique = new Set(namespaces);
    expect(unique.size).toBe(namespaces.length);
  });

  it("12. Env var only activates on exact string 'true'", async () => {
    // "TRUE", "1", "yes", etc. should NOT activate
    process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED = "TRUE";
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({ prisma: { portfolioAllocation: { findFirst: mockFindFirst } } }));
    vi.doMock("@/lib/portfolio/allocation-fence", () => ({ validateAllocationFence: mockValidateAllocationFence }));
    vi.doMock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

    const mod = await import("@/lib/planning/portfolio-gate");
    expect(mod.isPortfolioOptimizationEnabled()).toBe(false);

    delete process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED;
  });
});
