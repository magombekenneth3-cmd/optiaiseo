
import { describe, it, expect, beforeEach } from "vitest";
import "./helpers/setup";
import { stores } from "./helpers/setup";
import {
  createSite,
  createAeoReport,
  createSelfHealingLog,
} from "./helpers/factories";

// ── Group I: Self-Healing Lifecycle ───────────────────────────────────────

describe("Group I: Self-Healing Lifecycle", () => {
  const SITE_ID = "site_healing_test";

  beforeEach(() => {
    createSite({ id: SITE_ID, operatingMode: "AUTOPILOT" });
  });

  it("I1: GSoV drop detected (absolute ≥10) → detectGsovDrop returns dropped=true", async () => {
    const { detectGsovDrop } = await import("@/lib/self-healing/engine");

    // Create two reports: prev=50%, current=35% → absolute drop of 15
    createAeoReport({
      siteId: SITE_ID,
      generativeShareOfVoice: 35,
      createdAt: new Date(), // Most recent
    });
    createAeoReport({
      siteId: SITE_ID,
      generativeShareOfVoice: 50,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    });

    const result = await detectGsovDrop(SITE_ID);

    expect(result.dropped).toBe(true);
    expect(result.currentGsov).toBe(35);
    expect(result.prevGsov).toBe(50);
  });

  it("I2: No drop → detectGsovDrop returns dropped=false", async () => {
    const { detectGsovDrop } = await import("@/lib/self-healing/engine");

    // Create two reports: prev=50%, current=48% → drop of 2 (below thresholds)
    createAeoReport({
      siteId: SITE_ID,
      generativeShareOfVoice: 48,
      createdAt: new Date(),
    });
    createAeoReport({
      siteId: SITE_ID,
      generativeShareOfVoice: 50,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    const result = await detectGsovDrop(SITE_ID);

    expect(result.dropped).toBe(false);
    expect(result.currentGsov).toBe(48);
    expect(result.prevGsov).toBe(50);
  });

  it("I3: Low confidence score (<40) → action DROPPED, logged with DROPPED status", async () => {
    const { scoreHealingActions } = await import("@/lib/self-healing/confidence");

    // ALERT-only action with short fix → score will be low
    const actions = [{
      type: "ALERT" as const,
      description: "Minor fluctuation detected.",
      // No fix, no known issue type → very low score
    }];

    const scored = await scoreHealingActions(SITE_ID, actions);

    expect(scored).toHaveLength(1);
    expect(scored[0].confidence).toBeLessThan(40);
    expect(scored[0].confidenceDecision).toBe("DROP");
  });

  it("I4: Medium confidence (40-74) → QUEUED with PENDING_REVIEW status", async () => {
    const { scoreHealingActions } = await import("@/lib/self-healing/confidence");

    // CONTENT fix with specific fix text → medium score
    const actions = [{
      type: "CONTENT" as const,
      description: "GSOV_DROP regression in meta description check",
      fix: "Add comprehensive meta description with primary keyword and compelling CTA for improved click-through rates in search results.",
      targetId: "meta_description",
    }];

    const scored = await scoreHealingActions(SITE_ID, actions);

    expect(scored).toHaveLength(1);
    expect(scored[0].confidence).toBeGreaterThanOrEqual(40);
    expect(scored[0].confidence).toBeLessThan(75);
    expect(scored[0].confidenceDecision).toBe("QUEUE");
  });

  it("I5: Non-AUTOPILOT mode → executeHealing returns immediately", async () => {
    const { executeHealing } = await import("@/lib/self-healing/engine");

    // Create a SUPERVISED site (not AUTOPILOT)
    const supervisedSiteId = "site_supervised";
    createSite({ id: supervisedSiteId, operatingMode: "SUPERVISED" });

    const actions = [{
      type: "PR" as const,
      description: "Auto-fix for schema regression",
      fix: "<script type='application/ld+json'>{}</script>",
      filePath: "app/layout.tsx",
    }];

    // Should return without creating any SelfHealingLog entries
    const healingLogsBefore = stores.selfHealingLog.count();
    await executeHealing(supervisedSiteId, actions);
    const healingLogsAfter = stores.selfHealingLog.count();

    // No logs created because site is not AUTOPILOT
    expect(healingLogsAfter).toBe(healingLogsBefore);
  });
});

// ── Group J: Self-Healing Isolation Invariant ─────────────────────────────

describe("Group J: Self-Healing Isolation (Documented Architectural Gap)", () => {
  const SITE_ID = "site_isolation_test";

  beforeEach(() => {
    createSite({ id: SITE_ID, operatingMode: "AUTOPILOT" });
  });

  it("J1: Self-healing does NOT create BudgetReservation", async () => {
    const { executeHealing } = await import("@/lib/self-healing/engine");

    const actions = [{
      type: "ALERT" as const,
      description: "GSoV dropped, no technical regression found",
    }];

    const budgetsBefore = stores.budgetReservation.count();
    await executeHealing(SITE_ID, actions);
    const budgetsAfter = stores.budgetReservation.count();

    // Self-healing bypasses budget system entirely
    expect(budgetsAfter).toBe(budgetsBefore);
  });

  it("J2: Self-healing does NOT create ExecutionTrace", async () => {
    const { executeHealing } = await import("@/lib/self-healing/engine");

    const actions = [{
      type: "CONTENT" as const,
      description: "Schema regression fix",
      fix: "Updated schema markup",
    }];

    const tracesBefore = stores.executionTrace.count();
    await executeHealing(SITE_ID, actions);
    const tracesAfter = stores.executionTrace.count();

    // Self-healing bypasses ExecutionTrace entirely
    expect(tracesAfter).toBe(tracesBefore);
  });

  it("J3: Self-healing does NOT interact with CircuitBreaker", async () => {
    const { executeHealing } = await import("@/lib/self-healing/engine");

    const actions = [{
      type: "ALERT" as const,
      description: "Citation drop in GPT-4o",
    }];

    const circuitsBefore = stores.circuitBreaker.count();
    await executeHealing(SITE_ID, actions);
    const circuitsAfter = stores.circuitBreaker.count();

    // Self-healing bypasses circuit breaker entirely
    expect(circuitsAfter).toBe(circuitsBefore);
  });

  it("J4: Self-healing DOES write to SelfHealingLog (its own audit trail)", async () => {
    const { executeHealing } = await import("@/lib/self-healing/engine");

    const actions = [{
      type: "ALERT" as const,
      description: "GSoV dropped by 15 points. No technical regressions found.",
    }];

    await executeHealing(SITE_ID, actions);

    const logs = stores.selfHealingLog.findMany({ where: { siteId: SITE_ID } });
    expect(logs.length).toBeGreaterThan(0);
    expect((logs[0] as any).actionTaken).toBe("LOGGED_ALERT");
  });
});
