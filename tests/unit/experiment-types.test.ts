/**
 * D.5.1 — Experiment Types Tests
 *
 * Tests state machine transitions, config immutability, and hash determinism.
 */

import { describe, it, expect } from "vitest";
import {
  VALID_EXPERIMENT_TRANSITIONS,
  TERMINAL_EXPERIMENT_STATUSES,
  DEFAULT_SAFETY_LIMITS,
  DEFAULT_SUCCESS_THRESHOLDS,
  SUCCESS_METRICS,
  ExperimentTransitionError,
  ExperimentConflictError,
  ExperimentLimitError,
  ExperimentConfigMutationError,
} from "@/lib/experiments/types";
import {
  buildExperimentConfig,
  hashExperimentConfig,
  verifyConfigIntegrity,
  EXPERIMENT_CONFIG_VERSION,
} from "@/lib/experiments/config";

// ── State Machine ───────────────────────────────────────────────────────────

describe("Experiment State Machine", () => {
  it("DRAFT can transition to RUNNING or ABORTED", () => {
    expect(VALID_EXPERIMENT_TRANSITIONS.DRAFT).toEqual(["RUNNING", "ABORTED"]);
  });

  it("RUNNING can transition to PAUSED, COMPLETED, or ABORTED", () => {
    expect(VALID_EXPERIMENT_TRANSITIONS.RUNNING).toEqual(["PAUSED", "COMPLETED", "ABORTED"]);
  });

  it("PAUSED can transition to RUNNING or ABORTED", () => {
    expect(VALID_EXPERIMENT_TRANSITIONS.PAUSED).toEqual(["RUNNING", "ABORTED"]);
  });

  it("COMPLETED is terminal — no transitions allowed", () => {
    expect(VALID_EXPERIMENT_TRANSITIONS.COMPLETED).toEqual([]);
  });

  it("ABORTED is terminal — no transitions allowed", () => {
    expect(VALID_EXPERIMENT_TRANSITIONS.ABORTED).toEqual([]);
  });

  it("terminal statuses include COMPLETED and ABORTED", () => {
    expect(TERMINAL_EXPERIMENT_STATUSES).toContain("COMPLETED");
    expect(TERMINAL_EXPERIMENT_STATUSES).toContain("ABORTED");
    expect(TERMINAL_EXPERIMENT_STATUSES).not.toContain("RUNNING");
    expect(TERMINAL_EXPERIMENT_STATUSES).not.toContain("DRAFT");
  });
});

// ── Config Immutability ─────────────────────────────────────────────────────

describe("Experiment Config", () => {
  const baseInput = {
    opportunityId: "opp-123",
    siteId: "site-456",
    hypothesis: "Updating meta description will improve CTR",
  };

  it("builds config with defaults", () => {
    const config = buildExperimentConfig(baseInput);

    expect(config.opportunityId).toBe("opp-123");
    expect(config.siteId).toBe("site-456");
    expect(config.successMetric).toBe("clicks_lift");
    expect(config.successThreshold).toBe(DEFAULT_SUCCESS_THRESHOLDS.clicks_lift);
    expect(config.maxDurationDays).toBe(28);
    expect(config.maxMutationCount).toBe(1);
    expect(config.maxBudgetUnits).toBe(1);
    expect(config.configVersion).toBe(EXPERIMENT_CONFIG_VERSION);
  });

  it("respects custom metric and threshold", () => {
    const config = buildExperimentConfig({
      ...baseInput,
      successMetric: "position_delta",
      successThreshold: 5.0,
    });

    expect(config.successMetric).toBe("position_delta");
    expect(config.successThreshold).toBe(5.0);
  });

  it("caps duration at safety limit", () => {
    const config = buildExperimentConfig({
      ...baseInput,
      maxDurationDays: 365, // way over limit
    });

    expect(config.maxDurationDays).toBe(DEFAULT_SAFETY_LIMITS.maxDurationDays);
  });

  it("rejects invalid success metric", () => {
    expect(() =>
      buildExperimentConfig({
        ...baseInput,
        successMetric: "invalid_metric" as any,
      })
    ).toThrow("Invalid success metric");
  });
});

// ── Config Hash Determinism ─────────────────────────────────────────────────

describe("Config Hash", () => {
  const config = buildExperimentConfig({
    opportunityId: "opp-123",
    siteId: "site-456",
    hypothesis: "Test hypothesis",
  });

  it("produces deterministic hash", () => {
    const hash1 = hashExperimentConfig(config);
    const hash2 = hashExperimentConfig(config);
    expect(hash1).toBe(hash2);
  });

  it("produces 64-char hex string (SHA-256)", () => {
    const hash = hashExperimentConfig(config);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different configs produce different hashes", () => {
    const config2 = buildExperimentConfig({
      opportunityId: "opp-999",
      siteId: "site-456",
      hypothesis: "Different hypothesis",
    });

    expect(hashExperimentConfig(config)).not.toBe(hashExperimentConfig(config2));
  });

  it("verifyConfigIntegrity returns true for matching hash", () => {
    const hash = hashExperimentConfig(config);
    expect(verifyConfigIntegrity(config, hash)).toBe(true);
  });

  it("verifyConfigIntegrity returns false for tampered config", () => {
    const hash = hashExperimentConfig(config);
    const tampered = { ...config, hypothesis: "Tampered hypothesis" };
    expect(verifyConfigIntegrity(tampered, hash)).toBe(false);
  });
});

// ── Error Types ─────────────────────────────────────────────────────────────

describe("Experiment Errors", () => {
  it("ExperimentTransitionError includes from/to in message", () => {
    const err = new ExperimentTransitionError("exp-1", "COMPLETED", "RUNNING");
    expect(err.message).toContain("COMPLETED");
    expect(err.message).toContain("RUNNING");
    expect(err.name).toBe("ExperimentTransitionError");
  });

  it("ExperimentConflictError includes URL and existing experiment", () => {
    const err = new ExperimentConflictError("site-1", "/page", "exp-old");
    expect(err.message).toContain("/page");
    expect(err.message).toContain("exp-old");
    expect(err.siteId).toBe("site-1");
  });

  it("ExperimentLimitError includes limit and current count", () => {
    const err = new ExperimentLimitError("site-1", 5, 5);
    expect(err.message).toContain("5/5");
  });

  it("ExperimentConfigMutationError prevents modification", () => {
    const err = new ExperimentConfigMutationError("exp-1");
    expect(err.message).toContain("immutable");
  });
});

// ── Safety Limits ───────────────────────────────────────────────────────────

describe("Safety Limits", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_SAFETY_LIMITS.maxDurationDays).toBe(28);
    expect(DEFAULT_SAFETY_LIMITS.maxMutationCount).toBe(1);
    expect(DEFAULT_SAFETY_LIMITS.maxBudgetUnits).toBe(1);
    expect(DEFAULT_SAFETY_LIMITS.maxConcurrentPerSite).toBe(5);
    expect(DEFAULT_SAFETY_LIMITS.maxOverlappingPerUrl).toBe(1);
    expect(DEFAULT_SAFETY_LIMITS.autoAbortPositionDrop).toBe(-10);
    expect(DEFAULT_SAFETY_LIMITS.minDataDays).toBe(14);
  });

  it("success metrics cover all expected types", () => {
    expect(SUCCESS_METRICS).toContain("position_delta");
    expect(SUCCESS_METRICS).toContain("clicks_lift");
    expect(SUCCESS_METRICS).toContain("ctr_lift");
    expect(SUCCESS_METRICS).toContain("impressions_lift");
    expect(SUCCESS_METRICS).toHaveLength(4);
  });
});
