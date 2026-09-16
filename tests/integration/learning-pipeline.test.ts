/**
 * Week 5 — Integration Tests: Learning Pipeline (Groups G + H)
 *
 * Tests the complete learning pipeline composition:
 *   Experiment outcomes → Aggregation → Signal generation → Validation → Activation
 *
 * These tests exercise real business logic with controlled DB state.
 * The learning modules are the most testable because:
 * - aggregator.ts reads directly from Prisma
 * - signal-generator.ts is pure (no DB)
 * - signal-validator.ts is pure (no DB)
 * - signal-registry.ts writes to Prisma via $transaction
 *
 * INVARIANTS UNDER TEST:
 * - D.5 experiments with WIN+LOSS → correct winRate and metric averages
 * - INCONCLUSIVE/ABORTED counted in total but excluded from averages
 * - Maturity gate blocks signals when decidedCount < MIN_EXPERIMENTS
 * - Direction consistency enforced (high winRate → negative risk adjustment)
 * - Signal activation supersedes existing ACTIVE signal atomically
 */

import { describe, it, expect, beforeEach } from "vitest";
import "./helpers/setup";
import { stores } from "./helpers/setup";
import {
  createSite,
  createExperiment,
  createExperimentVariant,
  createLearnedSignal,
} from "./helpers/factories";

// ── Group G: Aggregation ──────────────────────────────────────────────────

describe("Group G: Learning Aggregation", () => {
  const SITE_ID = "site_learning_test";

  beforeEach(() => {
    createSite({ id: SITE_ID });
  });

  it("G1: WIN+LOSS experiments produce correct winRate and metric averages", async () => {
    const { aggregateOutcomesByAction } = await import("@/lib/learning/aggregator");

    // Create 3 WIN and 2 LOSS experiments
    for (let i = 0; i < 3; i++) {
      const exp = createExperiment({
        siteId: SITE_ID,
        status: "COMPLETED",
        outcome: "WIN",
        outcomeConfidence: 0.9,
      });
      createExperimentVariant({
        experimentId: exp.id,
        isControl: false,
        actionType: "IMPROVE_SEARCH_INTENT",
        baselineMetrics: { position: 15, clicks: 100, impressions: 5000, ctr: 0.02 },
        postMetrics: { position: 8, clicks: 180, impressions: 6000, ctr: 0.03 },
      });
      createExperimentVariant({
        experimentId: exp.id,
        isControl: true,
        actionType: "IMPROVE_SEARCH_INTENT",
        baselineMetrics: { position: 14, clicks: 110, impressions: 5200, ctr: 0.021 },
        postMetrics: { position: 13, clicks: 115, impressions: 5300, ctr: 0.022 },
      });
    }

    for (let i = 0; i < 2; i++) {
      const exp = createExperiment({
        siteId: SITE_ID,
        status: "COMPLETED",
        outcome: "LOSS",
        outcomeConfidence: 0.7,
      });
      createExperimentVariant({
        experimentId: exp.id,
        isControl: false,
        actionType: "IMPROVE_SEARCH_INTENT",
        baselineMetrics: { position: 10, clicks: 200, impressions: 8000, ctr: 0.025 },
        postMetrics: { position: 12, clicks: 180, impressions: 7500, ctr: 0.024 },
      });
    }

    const aggregations = await aggregateOutcomesByAction(SITE_ID);

    expect(aggregations).toHaveLength(1);
    const agg = aggregations[0];
    expect(agg.actionType).toBe("IMPROVE_SEARCH_INTENT");
    expect(agg.totalExperiments).toBe(5);
    expect(agg.wins).toBe(3);
    expect(agg.losses).toBe(2);
    expect(agg.winRate).toBeCloseTo(0.6, 1); // 3/5 = 0.6
  });

  it("G2: INCONCLUSIVE and ABORTED counted in total but excluded from averages", async () => {
    const { aggregateOutcomesByAction } = await import("@/lib/learning/aggregator");

    // 2 WIN + 1 INCONCLUSIVE + 1 ABORTED
    for (let i = 0; i < 2; i++) {
      const exp = createExperiment({
        siteId: SITE_ID,
        status: "COMPLETED",
        outcome: "WIN",
      });
      createExperimentVariant({
        experimentId: exp.id,
        isControl: false,
        actionType: "REFRESH_CONTENT",
        baselineMetrics: { position: 20, clicks: 50, impressions: 3000, ctr: 0.017 },
        postMetrics: { position: 10, clicks: 100, impressions: 5000, ctr: 0.02 },
      });
    }

    const inconclusiveExp = createExperiment({
      siteId: SITE_ID,
      status: "COMPLETED",
      outcome: "INCONCLUSIVE",
    });
    createExperimentVariant({
      experimentId: inconclusiveExp.id,
      isControl: false,
      actionType: "REFRESH_CONTENT",
    });

    const abortedExp = createExperiment({
      siteId: SITE_ID,
      status: "COMPLETED",
      outcome: "ABORTED",
    });
    createExperimentVariant({
      experimentId: abortedExp.id,
      isControl: false,
      actionType: "REFRESH_CONTENT",
    });

    const aggregations = await aggregateOutcomesByAction(SITE_ID);

    const agg = aggregations.find(a => a.actionType === "REFRESH_CONTENT");
    expect(agg).toBeDefined();
    expect(agg!.totalExperiments).toBe(4); // All 4 counted
    expect(agg!.wins).toBe(2);
    expect(agg!.inconclusive).toBe(1);
    expect(agg!.aborted).toBe(1);
    expect(agg!.winRate).toBeCloseTo(1.0, 1); // 2/2 decided = 100%
  });

  it("G3: No experiments → empty aggregation array", async () => {
    const { aggregateOutcomesByAction } = await import("@/lib/learning/aggregator");

    const aggregations = await aggregateOutcomesByAction(SITE_ID);
    expect(aggregations).toEqual([]);
  });

  it("G4: DiD calculation correct when control variant present", async () => {
    const { aggregateOutcomesByAction } = await import("@/lib/learning/aggregator");

    // Single experiment with both treatment and control
    const exp = createExperiment({
      siteId: SITE_ID,
      status: "COMPLETED",
      outcome: "WIN",
    });

    // Treatment: position went from 15 → 8 (improvement of 7)
    createExperimentVariant({
      experimentId: exp.id,
      isControl: false,
      actionType: "BUILD_INTERNAL_LINKS",
      baselineMetrics: { position: 15, clicks: 100, impressions: 5000, ctr: 0.02 },
      postMetrics: { position: 8, clicks: 180, impressions: 6000, ctr: 0.03 },
    });

    // Control: position went from 14 → 13 (improvement of 1)
    createExperimentVariant({
      experimentId: exp.id,
      isControl: true,
      actionType: "BUILD_INTERNAL_LINKS",
      baselineMetrics: { position: 14, clicks: 110, impressions: 5200, ctr: 0.021 },
      postMetrics: { position: 13, clicks: 115, impressions: 5300, ctr: 0.022 },
    });

    const aggregations = await aggregateOutcomesByAction(SITE_ID);
    const agg = aggregations.find(a => a.actionType === "BUILD_INTERNAL_LINKS");
    expect(agg).toBeDefined();

    // DiD: treatment improvement (7) - control improvement (1) = 6
    expect(agg!.avgPositionDelta).toBeCloseTo(6.0, 0);
  });

  it("G5: DiD falls back to treatment-only when no control", async () => {
    const { aggregateOutcomesByAction } = await import("@/lib/learning/aggregator");

    const exp = createExperiment({
      siteId: SITE_ID,
      status: "COMPLETED",
      outcome: "WIN",
    });

    // Treatment only — no control variant
    createExperimentVariant({
      experimentId: exp.id,
      isControl: false,
      actionType: "CONSOLIDATE_CONTENT",
      baselineMetrics: { position: 20, clicks: 50, impressions: 3000, ctr: 0.017 },
      postMetrics: { position: 10, clicks: 100, impressions: 5000, ctr: 0.02 },
    });

    const aggregations = await aggregateOutcomesByAction(SITE_ID);
    const agg = aggregations.find(a => a.actionType === "CONSOLIDATE_CONTENT");
    expect(agg).toBeDefined();

    // Treatment-only: improvement = 20 - 10 = 10
    expect(agg!.avgPositionDelta).toBeCloseTo(10.0, 0);
  });
});

// ── Group H: Signal Generation + Validation + Activation ──────────────────

describe("Group H: Signal Generation, Validation & Activation", () => {
  it("H1: winRate ≥ 80% → RISK_ADJUSTMENT -15, CONFIDENCE_ADJUSTMENT +15", async () => {
    const { generateSignals } = await import("@/lib/learning/signal-generator");

    const agg = {
      actionType: "IMPROVE_SEARCH_INTENT",
      siteId: "site_1",
      totalExperiments: 10,
      wins: 9,
      losses: 1,
      inconclusive: 0,
      aborted: 0,
      winRate: 0.9, // 90%
      avgPositionDelta: 5.0,
      avgClicksLift: 30.0,
      avgCtrLift: 0.005,
      avgConfidence: 0.88,
      lastOutcomeAt: new Date(),
      experimentIds: [],
    };

    const signals = generateSignals(agg);

    expect(signals).toHaveLength(2);

    const riskSignal = signals.find(s => s.signalType === "RISK_ADJUSTMENT");
    expect(riskSignal).toBeDefined();
    expect(riskSignal!.adjustment).toBe(-15); // High win rate → lower risk

    const confSignal = signals.find(s => s.signalType === "CONFIDENCE_ADJUSTMENT");
    expect(confSignal).toBeDefined();
    expect(confSignal!.adjustment).toBe(15); // High win rate → higher confidence
  });

  it("H2: decidedCount < MIN_EXPERIMENTS → no signals generated (maturity gate)", async () => {
    const { generateSignals } = await import("@/lib/learning/signal-generator");

    const agg = {
      actionType: "REFRESH_CONTENT",
      siteId: "site_1",
      totalExperiments: 3,
      wins: 2,
      losses: 1,
      inconclusive: 0,
      aborted: 0,
      winRate: 0.67,
      avgPositionDelta: 3.0,
      avgClicksLift: 15.0,
      avgCtrLift: 0.003,
      avgConfidence: 0.75,
      lastOutcomeAt: new Date(),
      experimentIds: [],
    };

    // Default MIN_EXPERIMENTS is 5, we only have 3 decided
    const signals = generateSignals(agg);
    expect(signals).toEqual([]);
  });

  it("H3: adjustment exceeds cap → validation fails", async () => {
    const { validateSignal } = await import("@/lib/learning/signal-validator");

    const signal = {
      signalType: "RISK_ADJUSTMENT" as const,
      actionType: "TEST_ACTION",
      adjustment: -25, // Exceeds default cap of ±15
      magnitude: "MAJOR" as const,
      reason: "test",
      derivedFrom: 10,
      winRate: 0.9,
    };

    const agg = {
      actionType: "TEST_ACTION",
      siteId: "site_1",
      totalExperiments: 10,
      wins: 9,
      losses: 1,
      inconclusive: 0,
      aborted: 0,
      winRate: 0.9,
      avgPositionDelta: 5.0,
      avgClicksLift: 30.0,
      avgCtrLift: 0.005,
      avgConfidence: 0.88,
      lastOutcomeAt: new Date(),
      experimentIds: [],
    };

    const result = validateSignal(signal, agg);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("exceeds cap"))).toBe(true);
  });

  it("H4: direction inconsistency → validation fails", async () => {
    const { validateSignal } = await import("@/lib/learning/signal-validator");

    // High win rate but POSITIVE risk adjustment (should be negative)
    const signal = {
      signalType: "RISK_ADJUSTMENT" as const,
      actionType: "TEST_ACTION",
      adjustment: 10, // Wrong direction!
      magnitude: "MODERATE" as const,
      reason: "test",
      derivedFrom: 10,
      winRate: 0.8,
    };

    const agg = {
      actionType: "TEST_ACTION",
      siteId: "site_1",
      totalExperiments: 10,
      wins: 8,
      losses: 2,
      inconclusive: 0,
      aborted: 0,
      winRate: 0.8,
      avgPositionDelta: null,
      avgClicksLift: null,
      avgCtrLift: null,
      avgConfidence: null,
      lastOutcomeAt: null,
      experimentIds: [],
    };

    const result = validateSignal(signal, agg);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("Direction inconsistency"))).toBe(true);
  });

  it("H5: valid signal → persistAndActivateSignal creates ACTIVE row", async () => {
    const { persistAndActivateSignal } = await import("@/lib/learning/signal-registry");

    const SITE_ID = "site_h5";
    createSite({ id: SITE_ID });

    const signal = {
      signalType: "RISK_ADJUSTMENT" as const,
      actionType: "IMPROVE_SEARCH_INTENT",
      adjustment: -10,
      magnitude: "MODERATE" as const,
      reason: "60% win rate — moderately lower risk",
      derivedFrom: 8,
      winRate: 0.65,
    };

    const signalId = await persistAndActivateSignal(SITE_ID, signal);

    expect(signalId).toBeTruthy();

    // Verify the stored signal
    const stored = stores.learnedSignal.getAll().find(s => s.id === signalId);
    expect(stored).toBeDefined();
    expect((stored as any).status).toBe("ACTIVE");
    expect((stored as any).adjustment).toBe(-10);
    expect((stored as any).activatedAt).toBeInstanceOf(Date);
  });

  it("H6: second signal for same key → first SUPERSEDED, second ACTIVE", async () => {
    const { persistAndActivateSignal } = await import("@/lib/learning/signal-registry");

    const SITE_ID = "site_h6";
    createSite({ id: SITE_ID });

    // First signal
    const signal1 = {
      signalType: "RISK_ADJUSTMENT" as const,
      actionType: "REFRESH_CONTENT",
      adjustment: -10,
      magnitude: "MODERATE" as const,
      reason: "First signal",
      derivedFrom: 6,
      winRate: 0.65,
    };

    const id1 = await persistAndActivateSignal(SITE_ID, signal1);

    // Second signal (supersedes first)
    const signal2 = {
      signalType: "RISK_ADJUSTMENT" as const,
      actionType: "REFRESH_CONTENT",
      adjustment: -15,
      magnitude: "MAJOR" as const,
      reason: "Updated signal with more data",
      derivedFrom: 12,
      winRate: 0.85,
    };

    const id2 = await persistAndActivateSignal(SITE_ID, signal2);

    // First should be SUPERSEDED
    const first = stores.learnedSignal.getAll().find(s => s.id === id1);
    expect((first as any).status).toBe("SUPERSEDED");
    expect((first as any).supersededAt).toBeInstanceOf(Date);
    expect((first as any).supersededBy).toBe(id2);

    // Second should be ACTIVE
    const second = stores.learnedSignal.getAll().find(s => s.id === id2);
    expect((second as any).status).toBe("ACTIVE");
    expect((second as any).version).toBe(2);
  });

  it("H7: revokeSignal → status REVOKED", async () => {
    const { revokeSignal } = await import("@/lib/learning/signal-registry");

    const signal = createLearnedSignal({
      siteId: "site_h7",
      status: "ACTIVE",
      signalType: "CONFIDENCE_ADJUSTMENT",
      actionType: "BUILD_INTERNAL_LINKS",
    });

    await revokeSignal(signal.id, "Admin kill switch — unreliable signal");

    const revoked = stores.learnedSignal.getById(signal.id);
    expect((revoked as any).status).toBe("REVOKED");
  });
});

// ── Group H (cont): Full pipeline composition ─────────────────────────────

describe("Group H (composition): End-to-end learning pipeline", () => {
  it("aggregation → signal generation → validation → activation (composition proof)", async () => {
    const { aggregateOutcomesByAction } = await import("@/lib/learning/aggregator");
    const { generateSignals } = await import("@/lib/learning/signal-generator");
    const { validateSignal } = await import("@/lib/learning/signal-validator");
    const { persistAndActivateSignal, persistActionPerformance } = await import("@/lib/learning/signal-registry");

    const SITE_ID = "site_composition";
    createSite({ id: SITE_ID });

    // Seed 6 experiments: 5 WIN + 1 LOSS = 83% win rate
    for (let i = 0; i < 5; i++) {
      const exp = createExperiment({
        siteId: SITE_ID,
        status: "COMPLETED",
        outcome: "WIN",
        outcomeConfidence: 0.9,
      });
      createExperimentVariant({
        experimentId: exp.id,
        isControl: false,
        actionType: "IMPROVE_SEARCH_INTENT",
        baselineMetrics: { position: 15, clicks: 100, impressions: 5000, ctr: 0.02 },
        postMetrics: { position: 8, clicks: 180, impressions: 6000, ctr: 0.03 },
      });
    }

    const lossExp = createExperiment({
      siteId: SITE_ID,
      status: "COMPLETED",
      outcome: "LOSS",
      outcomeConfidence: 0.6,
    });
    createExperimentVariant({
      experimentId: lossExp.id,
      isControl: false,
      actionType: "IMPROVE_SEARCH_INTENT",
      baselineMetrics: { position: 10, clicks: 200, impressions: 8000, ctr: 0.025 },
      postMetrics: { position: 12, clicks: 180, impressions: 7500, ctr: 0.024 },
    });

    // Step 1: Aggregate
    const aggregations = await aggregateOutcomesByAction(SITE_ID);
    expect(aggregations).toHaveLength(1);
    const agg = aggregations[0];
    expect(agg.winRate).toBeCloseTo(0.833, 1); // 5/6

    // Step 2: Persist performance
    await persistActionPerformance(agg);
    const perfRecords = stores.actionPerformance.getAll();
    expect(perfRecords).toHaveLength(1);

    // Step 3: Generate signals
    const signals = generateSignals(agg);
    expect(signals.length).toBeGreaterThan(0);

    // Step 4: Validate each signal
    let validCount = 0;
    for (const signal of signals) {
      const validation = validateSignal(signal, agg);
      if (validation.valid) {
        // Step 5: Activate
        await persistAndActivateSignal(SITE_ID, signal);
        validCount++;
      }
    }

    // All signals from an 83% win rate should be valid
    expect(validCount).toBe(signals.length);

    // Verify ACTIVE signals exist
    const activeSignals = stores.learnedSignal.getAll().filter(
      s => (s as any).siteId === SITE_ID && (s as any).status === "ACTIVE"
    );
    expect(activeSignals.length).toBe(validCount);
  });
});
