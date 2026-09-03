/**
 * Config Enforcement Tests — PR.2B
 *
 * Proves that env-validator config (kill switch, rate limit) is consumed
 * by the runtime enforcement path (policy-gate authorize()).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ActionType } from "@/lib/proposals/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAuthRequest(overrides: Partial<any> = {}) {
  return {
    siteId: "site-config-test",
    opportunityId: "opp-1",
    proposalId: "prop-1",
    actionType: "UPDATE_META_DESCRIPTION" as ActionType,
    safetyTier: 1 as const,
    riskLevel: "LOW" as const,
    riskScore: 10,
    channel: "wordpress" as const,
    actorType: "SYSTEM" as const,
    actorId: "system:autonomous",
    traceId: "trace-config-1",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PR.2B — Config enforcement: env-validator → policy-gate", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Test 1: Kill switch blocks authorization ─────────────────────────────

  it("AUTONOMOUS_GLOBAL_KILL_SWITCH=true → authorize returns BLOCKED with failedGate=kill_switch", async () => {
    process.env.AUTONOMOUS_GLOBAL_KILL_SWITCH = "true";

    // Force re-read of config
    const { getAutonomousConfig } = await import("@/lib/config/env-validator");
    const config = getAutonomousConfig();
    expect(config.globalKillSwitch).toBe(true);

    // Mock prisma so we don't need DB — kill switch fires before DB calls
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        $transaction: vi.fn(),
        site: { findUnique: vi.fn() },
      },
    }));

    const { authorize } = await import("@/lib/autonomy/policy-gate");
    const result = await authorize(makeAuthRequest());

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.failedGate).toBe("kill_switch");
      expect(result.action).toBe("BLOCKED");
      expect(result.reason).toContain("kill switch");
    }
  });

  // ── Test 2: Rate limit blocks when exceeded ──────────────────────────────

  it("maxProposalsPerHour exceeded → authorize returns BLOCKED with failedGate=rate_limit", async () => {
    process.env.AUTONOMOUS_GLOBAL_KILL_SWITCH = "false";
    process.env.AUTONOMOUS_MAX_PROPOSALS_PER_HOUR = "5";

    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        $transaction: vi.fn(),
        site: {
          findUnique: vi.fn().mockResolvedValue({
            operatingMode: "AUTOPILOT",
            dailyMutationLimit: 100,
            maxConcurrentExecutions: 5,
          }),
        },
        actionProposal: {
          count: vi.fn().mockResolvedValue(6), // 6 > max of 5
        },
      },
    }));

    const { authorize } = await import("@/lib/autonomy/policy-gate");
    const result = await authorize(makeAuthRequest());

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.failedGate).toBe("rate_limit");
      expect(result.action).toBe("BLOCKED");
      expect(result.reason).toContain("rate limit");
      expect(result.reason).toContain("6/5");
    }
  });

  // ── Test 3: Kill switch off + under limit → proceeds past Gate 0 + 1.5 ──

  it("kill switch off + under rate limit → authorize proceeds to Gate 2 (tier check)", async () => {
    process.env.AUTONOMOUS_GLOBAL_KILL_SWITCH = "false";
    process.env.AUTONOMOUS_MAX_PROPOSALS_PER_HOUR = "20";

    // Tier 3 action on SUPERVISED site → should fail at Gate 2 (tier_limit), NOT kill_switch
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        $transaction: vi.fn(),
        site: {
          findUnique: vi.fn().mockResolvedValue({
            operatingMode: "SUPERVISED",
            dailyMutationLimit: 100,
            maxConcurrentExecutions: 5,
          }),
        },
        actionProposal: {
          count: vi.fn().mockResolvedValue(2), // well under limit
        },
      },
    }));

    const { authorize } = await import("@/lib/autonomy/policy-gate");
    const result = await authorize(
      makeAuthRequest({
        actionType: "DELETE_PAGE",
        safetyTier: 3,
      })
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      // Prove it got past kill_switch and rate_limit to reach tier_limit
      expect(result.failedGate).toBe("tier_limit");
    }
  });

  // ── Test 4: Default config → authorize proceeds normally ─────────────────

  it("default config (no env overrides) → authorize proceeds past Gate 0 + 1.5", async () => {
    // Clear all autonomous env vars to use defaults
    delete process.env.AUTONOMOUS_GLOBAL_KILL_SWITCH;
    delete process.env.AUTONOMOUS_MAX_PROPOSALS_PER_HOUR;
    delete process.env.AUTONOMOUS_BUDGET_CEILING_CENTS;

    // With defaults: kill_switch=false, maxPerHour=20
    // T1 action on AUTONOMOUS_TIER1 site → should pass gates 0, 1, 1.5, 2
    // Will fail at Gate 3 (budget) since we mock no budget row
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        $transaction: vi.fn(),
        site: {
          findUnique: vi.fn().mockResolvedValue({
            operatingMode: "SUPERVISED",
            dailyMutationLimit: 10,
            maxConcurrentExecutions: 2,
          }),
        },
        actionProposal: {
          count: vi.fn().mockResolvedValue(0),
        },
      },
    }));

    // Mock budget to fail — proves we got past kill_switch, rate_limit, tier_limit
    vi.doMock("@/lib/autonomy/budget-enforcer", () => ({
      reserveBudget: vi.fn().mockResolvedValue(null),
      releaseReservation: vi.fn(),
    }));

    const { authorize } = await import("@/lib/autonomy/policy-gate");
    const result = await authorize(makeAuthRequest());

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      // Prove it got past kill_switch (Gate 0), rate_limit (Gate 1.5),
      // operating_mode (Gate 1), and tier_limit (Gate 2) to reach budget (Gate 3)
      expect(result.failedGate).toBe("budget");
    }
  });
});
