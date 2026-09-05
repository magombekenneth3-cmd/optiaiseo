/**
 * D.5.6 — Experiment Safety Tests
 *
 * Tests safety limit validation at the type/contract level.
 * DB-dependent safety enforcement is tested in integration tests.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_SAFETY_LIMITS,
  VALID_EXPERIMENT_TRANSITIONS,
  ExperimentTransitionError,
  type ExperimentStatus,
} from "@/lib/experiments/types";

// ── Safety Limits ───────────────────────────────────────────────────────────

describe("Safety Limits", () => {
  it("max duration is 28 days", () => {
    expect(DEFAULT_SAFETY_LIMITS.maxDurationDays).toBe(28);
  });

  it("max mutations per experiment is 1", () => {
    expect(DEFAULT_SAFETY_LIMITS.maxMutationCount).toBe(1);
  });

  it("max budget units per experiment is 1", () => {
    expect(DEFAULT_SAFETY_LIMITS.maxBudgetUnits).toBe(1);
  });

  it("max concurrent experiments per site is 5", () => {
    expect(DEFAULT_SAFETY_LIMITS.maxConcurrentPerSite).toBe(5);
  });

  it("max overlapping experiments per URL is 1", () => {
    expect(DEFAULT_SAFETY_LIMITS.maxOverlappingPerUrl).toBe(1);
  });

  it("auto-abort threshold is -10 positions", () => {
    expect(DEFAULT_SAFETY_LIMITS.autoAbortPositionDrop).toBe(-10);
  });

  it("stale evidence grace period is 7 days", () => {
    expect(DEFAULT_SAFETY_LIMITS.staleEvidenceGraceDays).toBe(7);
  });

  it("minimum data days for significance is 14", () => {
    expect(DEFAULT_SAFETY_LIMITS.minDataDays).toBe(14);
  });
});

// ── Transition Guard ────────────────────────────────────────────────────────

describe("Experiment Transition Guard", () => {
  function assertValid(from: ExperimentStatus, to: ExperimentStatus): boolean {
    const allowed = VALID_EXPERIMENT_TRANSITIONS[from];
    return allowed?.includes(to) ?? false;
  }

  // Valid transitions
  it("allows DRAFT → RUNNING", () => expect(assertValid("DRAFT", "RUNNING")).toBe(true));
  it("allows DRAFT → ABORTED", () => expect(assertValid("DRAFT", "ABORTED")).toBe(true));
  it("allows RUNNING → PAUSED", () => expect(assertValid("RUNNING", "PAUSED")).toBe(true));
  it("allows RUNNING → COMPLETED", () => expect(assertValid("RUNNING", "COMPLETED")).toBe(true));
  it("allows RUNNING → ABORTED", () => expect(assertValid("RUNNING", "ABORTED")).toBe(true));
  it("allows PAUSED → RUNNING", () => expect(assertValid("PAUSED", "RUNNING")).toBe(true));
  it("allows PAUSED → ABORTED", () => expect(assertValid("PAUSED", "ABORTED")).toBe(true));

  // Invalid transitions
  it("blocks COMPLETED → RUNNING", () => expect(assertValid("COMPLETED", "RUNNING")).toBe(false));
  it("blocks COMPLETED → ABORTED", () => expect(assertValid("COMPLETED", "ABORTED")).toBe(false));
  it("blocks ABORTED → RUNNING", () => expect(assertValid("ABORTED", "RUNNING")).toBe(false));
  it("blocks ABORTED → COMPLETED", () => expect(assertValid("ABORTED", "COMPLETED")).toBe(false));
  it("blocks DRAFT → COMPLETED", () => expect(assertValid("DRAFT", "COMPLETED")).toBe(false));
  it("blocks DRAFT → PAUSED", () => expect(assertValid("DRAFT", "PAUSED")).toBe(false));

  // Error typing
  it("ExperimentTransitionError has correct name", () => {
    const err = new ExperimentTransitionError("exp-1", "COMPLETED", "RUNNING");
    expect(err.name).toBe("ExperimentTransitionError");
    expect(err).toBeInstanceOf(Error);
  });
});
