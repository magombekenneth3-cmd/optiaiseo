/**
 * Phase D.5.1 — Immutable Experiment Config Builder
 *
 * Builds and seals experiment configuration at creation time.
 * The config hash ensures immutability — any post-creation modification
 * is detectable by re-hashing and comparing.
 *
 * INVARIANT: Once an experiment is created, its config fields
 * (hypothesis, successMetric, thresholds, limits) MUST NOT change.
 */

import { createHash } from "crypto";
import type { ActionPlan } from "@/lib/planning/types";
import {
  type ExperimentConfig,
  type SuccessMetric,
  DEFAULT_SUCCESS_THRESHOLDS,
  DEFAULT_SAFETY_LIMITS,
  SUCCESS_METRICS,
} from "./types";

// ── Config Version ──────────────────────────────────────────────────────────

export const EXPERIMENT_CONFIG_VERSION = "d5-v1";

// ── Build Config ────────────────────────────────────────────────────────────

export interface BuildConfigInput {
  opportunityId: string;
  siteId: string;
  hypothesis: string;
  successMetric?: SuccessMetric;
  successThreshold?: number;
  maxDurationDays?: number;
  maxMutationCount?: number;
  maxBudgetUnits?: number;
}

/**
 * Builds an immutable experiment configuration from a planning output.
 *
 * Applies default safety limits if not explicitly provided.
 * Validates the success metric is recognized.
 *
 * @returns A sealed ExperimentConfig ready for hashing
 */
export function buildExperimentConfig(input: BuildConfigInput): ExperimentConfig {
  const metric = input.successMetric ?? "clicks_lift";

  if (!SUCCESS_METRICS.includes(metric)) {
    throw new Error(
      `Invalid success metric: "${metric}". Must be one of: ${SUCCESS_METRICS.join(", ")}`
    );
  }

  const threshold = input.successThreshold ?? DEFAULT_SUCCESS_THRESHOLDS[metric];

  const config: ExperimentConfig = {
    opportunityId: input.opportunityId,
    siteId: input.siteId,
    hypothesis: input.hypothesis,
    successMetric: metric,
    successThreshold: threshold,
    maxDurationDays: Math.min(
      input.maxDurationDays ?? DEFAULT_SAFETY_LIMITS.maxDurationDays,
      DEFAULT_SAFETY_LIMITS.maxDurationDays
    ),
    maxMutationCount: Math.min(
      input.maxMutationCount ?? DEFAULT_SAFETY_LIMITS.maxMutationCount,
      DEFAULT_SAFETY_LIMITS.maxMutationCount
    ),
    maxBudgetUnits: Math.min(
      input.maxBudgetUnits ?? DEFAULT_SAFETY_LIMITS.maxBudgetUnits,
      DEFAULT_SAFETY_LIMITS.maxBudgetUnits
    ),
    configVersion: EXPERIMENT_CONFIG_VERSION,
  };

  return config;
}

/**
 * Derives a config from an ActionPlan with a default hypothesis.
 */
export function buildConfigFromPlan(
  plan: ActionPlan,
  overrides?: Partial<BuildConfigInput>
): ExperimentConfig {
  const hypothesis =
    overrides?.hypothesis ??
    `Applying ${plan.actionType} to ${plan.targetUrl} will improve search performance. ` +
    `Expected: ${plan.expectedOutcome}`;

  return buildExperimentConfig({
    opportunityId: plan.opportunityId,
    siteId: plan.siteId,
    hypothesis,
    ...overrides,
  });
}

// ── Config Hash ─────────────────────────────────────────────────────────────

/**
 * Produces a deterministic SHA-256 hash of the experiment config.
 *
 * The hash is computed from a canonical JSON representation:
 * - Keys sorted alphabetically
 * - No whitespace
 * - Deterministic number formatting
 *
 * This hash is stored on the Experiment row and checked before
 * any config read to ensure immutability.
 */
export function hashExperimentConfig(config: ExperimentConfig): string {
  const canonical = canonicalizeConfig(config);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verifies that a stored config hash matches the current config values.
 * Returns false if any config field has been tampered with.
 */
export function verifyConfigIntegrity(
  config: ExperimentConfig,
  storedHash: string
): boolean {
  return hashExperimentConfig(config) === storedHash;
}

// ── Internals ───────────────────────────────────────────────────────────────

function canonicalizeConfig(config: ExperimentConfig): string {
  // Sort keys alphabetically for deterministic serialization
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(config).sort()) {
    sorted[key] = config[key as keyof ExperimentConfig];
  }
  return JSON.stringify(sorted);
}
