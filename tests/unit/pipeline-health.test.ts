/**
 * Week 5.3 — Pipeline Health Unit Tests
 *
 * Tests each health function independently with controlled state.
 * Verifies the strict current-state vs windowed-activity distinction.
 */

import { describe, it, expect, beforeEach } from "vitest";
import "../integration/helpers/setup";
import { stores } from "../integration/helpers/setup";
import {
  createSite,
  createExecutionTrace,
  createMutationOperation,
  createCircuitBreaker,
  createBudgetReservation,
  createExperiment,
  createLearnedSignal,
  createSelfHealingLog,
} from "../integration/helpers/factories";

describe("Pipeline Health: Authorization", () => {
  const SITE_ID = "site_health_auth";

  beforeEach(() => {
    createSite({ id: SITE_ID });
  });

  it("counts authorization decisions within window", async () => {
    const { getAuthorizationHealth } = await import("@/lib/autonomy/pipeline-health");

    // 2 authorized, 1 denied within window
    createExecutionTrace({ siteId: SITE_ID, policyDecision: "AUTHORIZED" });
    createExecutionTrace({ siteId: SITE_ID, policyDecision: "AUTHORIZED" });
    createExecutionTrace({ siteId: SITE_ID, policyDecision: "BLOCKED" });

    // 1 outside window (created 48h ago)
    stores.executionTrace.create({
      data: {
        id: "trace_old",
        siteId: SITE_ID,
        policyDecision: "AUTHORIZED",
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        opportunityId: "opp_old",
        actionType: "TEST",
        safetyTier: 1,
        operatingMode: "SUPERVISED",
        policyReason: "test",
        effectiveTierLimit: 1,
        triggerType: "CRON",
        actorType: "SYSTEM",
        opportunityScore: 50,
        discoveredAt: new Date(),
      },
    });

    const health = await getAuthorizationHealth(SITE_ID, 24);

    expect(health.authorized).toBe(2);
    expect(health.denied).toBe(1);
    expect(health.lastDecisionAt).toBeInstanceOf(Date);
  });

  it("returns zeros when no traces exist", async () => {
    const { getAuthorizationHealth } = await import("@/lib/autonomy/pipeline-health");

    const health = await getAuthorizationHealth(SITE_ID, 24);

    expect(health.authorized).toBe(0);
    expect(health.denied).toBe(0);
    expect(health.needsApproval).toBe(0);
    expect(health.lastDecisionAt).toBeNull();
  });
});

describe("Pipeline Health: Mutation", () => {
  const SITE_ID = "site_health_mutation";

  beforeEach(() => {
    createSite({ id: SITE_ID });
  });

  it("separates current executing from windowed completed/failed", async () => {
    const { getMutationHealth } = await import("@/lib/autonomy/pipeline-health");

    // Current: 1 executing
    createMutationOperation({ siteId: SITE_ID, status: "EXECUTING" });

    // Windowed: 3 completed, 1 failed
    createMutationOperation({ siteId: SITE_ID, status: "COMPLETED" });
    createMutationOperation({ siteId: SITE_ID, status: "COMPLETED" });
    createMutationOperation({ siteId: SITE_ID, status: "COMPLETED_WITH_ERRORS" });
    createMutationOperation({ siteId: SITE_ID, status: "FAILED" });

    const health = await getMutationHealth(SITE_ID, 24);

    expect(health.executing).toBe(1);
    expect(health.completed).toBe(3); // COMPLETED + COMPLETED_WITH_ERRORS
    expect(health.failed).toBe(1);
    expect(health.completionRate).toBeCloseTo(0.75, 2); // 3/4
  });

  it("completionRate is null when no terminal operations", async () => {
    const { getMutationHealth } = await import("@/lib/autonomy/pipeline-health");

    createMutationOperation({ siteId: SITE_ID, status: "EXECUTING" });

    const health = await getMutationHealth(SITE_ID, 24);

    expect(health.executing).toBe(1);
    expect(health.completionRate).toBeNull();
  });
});

describe("Pipeline Health: Circuit Breaker", () => {
  const SITE_ID = "site_health_circuit";

  beforeEach(() => {
    createSite({ id: SITE_ID });
  });

  it("returns current state per channel", async () => {
    const { getCircuitHealth } = await import("@/lib/autonomy/pipeline-health");

    createCircuitBreaker({
      siteId: SITE_ID,
      channel: "wordpress",
      state: "CLOSED",
      consecutiveFailures: 0,
    });
    createCircuitBreaker({
      siteId: SITE_ID,
      channel: "github",
      state: "OPEN",
      consecutiveFailures: 5,
      openedAt: new Date(),
    });

    const health = await getCircuitHealth(SITE_ID);

    expect(health.channels).toHaveLength(2);
    const wp = health.channels.find(c => c.channel === "wordpress");
    expect(wp?.state).toBe("CLOSED");
    const gh = health.channels.find(c => c.channel === "github");
    expect(gh?.state).toBe("OPEN");
    expect(gh?.consecutiveFailures).toBe(5);
  });
});

describe("Pipeline Health: Budget", () => {
  const SITE_ID = "site_health_budget";

  beforeEach(() => {
    createSite({ id: SITE_ID, dailyBudgetUnits: 10 });
  });

  it("counts active reservations and windowed consumption", async () => {
    const { getBudgetHealth } = await import("@/lib/autonomy/pipeline-health");

    // Active reservations
    createBudgetReservation({ siteId: SITE_ID, status: "RESERVED" });
    createBudgetReservation({ siteId: SITE_ID, status: "RESERVED" });

    // Consumed and released
    createBudgetReservation({ siteId: SITE_ID, status: "CONSUMED" });
    createBudgetReservation({ siteId: SITE_ID, status: "RELEASED" });

    const health = await getBudgetHealth(SITE_ID, 24);

    expect(health.activeReservations).toBe(2);
    expect(health.consumed).toBe(1);
    expect(health.released).toBe(1);
    expect(health.dailyLimit).toBe(10);
  });
});

describe("Pipeline Health: Learning", () => {
  const SITE_ID = "site_health_learning";

  beforeEach(() => {
    createSite({ id: SITE_ID });
  });

  it("counts active signals by type", async () => {
    const { getLearningHealth } = await import("@/lib/autonomy/pipeline-health");

    createLearnedSignal({
      siteId: SITE_ID,
      signalType: "RISK_ADJUSTMENT",
      status: "ACTIVE",
    });
    createLearnedSignal({
      siteId: SITE_ID,
      signalType: "CONFIDENCE_ADJUSTMENT",
      status: "ACTIVE",
    });
    // Superseded signal — should not be counted
    createLearnedSignal({
      siteId: SITE_ID,
      signalType: "RISK_ADJUSTMENT",
      actionType: "OLD_ACTION",
      status: "SUPERSEDED",
    });

    const health = await getLearningHealth(SITE_ID);

    expect(health.activeSignals).toBe(2);
    expect(health.riskAdjustments).toBe(1);
    expect(health.confidenceAdjustments).toBe(1);
    expect(health.lastActivatedAt).toBeInstanceOf(Date);
  });
});

describe("Pipeline Health: Healing", () => {
  const SITE_ID = "site_health_healing";

  beforeEach(() => {
    createSite({ id: SITE_ID });
  });

  it("counts healing actions by status within window", async () => {
    const { getHealingHealth } = await import("@/lib/autonomy/pipeline-health");

    createSelfHealingLog({ siteId: SITE_ID, status: "COMPLETED" });
    createSelfHealingLog({ siteId: SITE_ID, status: "COMPLETED" });
    createSelfHealingLog({ siteId: SITE_ID, status: "FAILED" });
    createSelfHealingLog({ siteId: SITE_ID, status: "PENDING_REVIEW" });
    createSelfHealingLog({ siteId: SITE_ID, status: "DROPPED" });

    const health = await getHealingHealth(SITE_ID, 24);

    expect(health.completed).toBe(2);
    expect(health.failed).toBe(1);
    expect(health.pending).toBe(1);
    expect(health.dropped).toBe(1);
    expect(health.lastActionAt).toBeInstanceOf(Date);
  });
});

describe("Pipeline Health: Composition", () => {
  const SITE_ID = "site_health_full";

  beforeEach(() => {
    createSite({ id: SITE_ID, dailyBudgetUnits: 5 });
  });

  it("getAutonomyPipelineHealth composes all subsystems", async () => {
    const { getAutonomyPipelineHealth } = await import("@/lib/autonomy/pipeline-health");

    // Seed minimal state
    createExecutionTrace({ siteId: SITE_ID, policyDecision: "AUTHORIZED" });
    createMutationOperation({ siteId: SITE_ID, status: "COMPLETED" });
    createCircuitBreaker({ siteId: SITE_ID, channel: "wordpress", state: "CLOSED" });
    createBudgetReservation({ siteId: SITE_ID, status: "CONSUMED" });
    createLearnedSignal({ siteId: SITE_ID, status: "ACTIVE" });
    createSelfHealingLog({ siteId: SITE_ID, status: "COMPLETED" });

    const health = await getAutonomyPipelineHealth(SITE_ID, 24);

    expect(health.siteId).toBe(SITE_ID);
    expect(health.windowHours).toBe(24);
    expect(health.queriedAt).toBeInstanceOf(Date);
    expect(health.authorization.authorized).toBe(1);
    expect(health.mutation.completed).toBe(1);
    expect(health.circuit.channels).toHaveLength(1);
    expect(health.budget.consumed).toBe(1);
    expect(health.learning.activeSignals).toBe(1);
    expect(health.healing.completed).toBe(1);
  });

  it("empty state returns zeros (not null) for everything", async () => {
    const { getAutonomyPipelineHealth } = await import("@/lib/autonomy/pipeline-health");

    const health = await getAutonomyPipelineHealth(SITE_ID, 24);

    expect(health.authorization.authorized).toBe(0);
    expect(health.authorization.denied).toBe(0);
    expect(health.mutation.executing).toBe(0);
    expect(health.mutation.completed).toBe(0);
    expect(health.circuit.channels).toEqual([]);
    expect(health.budget.activeReservations).toBe(0);
    expect(health.experiment.running).toBe(0);
    expect(health.learning.activeSignals).toBe(0);
    expect(health.healing.completed).toBe(0);
  });
});
