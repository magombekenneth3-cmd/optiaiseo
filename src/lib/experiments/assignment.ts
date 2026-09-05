/**
 * Phase D.5.3 — Experiment Assignment
 *
 * Deterministic assignment engine that creates experiments with variants.
 *
 * INVARIANTS:
 * - One experiment per (siteId, opportunityId) — enforced by @@unique
 * - No overlapping RUNNING experiments on the same URL
 * - Maximum concurrent experiments per site enforced
 * - Creating the same experiment twice returns the existing record (idempotent)
 * - Assignment hashes are deterministic and stable
 */

import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { ActionPlan } from "@/lib/planning/types";
import {
  type ExperimentConfig,
  type ExperimentVariantInput,
  DEFAULT_SAFETY_LIMITS,
  ExperimentConflictError,
  ExperimentLimitError,
} from "./types";
import { buildExperimentConfig, hashExperimentConfig, type BuildConfigInput } from "./config";
import { generateVariants, computeAssignmentHash, validateVariants } from "./variant-generator";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AssignExperimentInput {
  siteId: string;
  opportunityId: string;
  plan: ActionPlan;
  primaryKeyword: string;
  configOverrides?: Partial<BuildConfigInput>;
}

export interface AssignExperimentResult {
  experimentId: string;
  isNew: boolean;
  variantCount: number;
}

// ── Core: Assign Experiment ─────────────────────────────────────────────────

/**
 * Creates a new experiment with control + treatment variants.
 *
 * Pre-flight checks:
 * 1. Idempotency: if experiment already exists for (siteId, opportunityId), return it
 * 2. Concurrent limit: check RUNNING experiment count for site
 * 3. URL conflict: check for RUNNING experiments targeting the same URL
 *
 * @throws ExperimentLimitError if concurrent limit exceeded
 * @throws ExperimentConflictError if URL already has a running experiment
 */
export async function assignExperiment(
  input: AssignExperimentInput
): Promise<AssignExperimentResult> {
  const { siteId, opportunityId, plan, primaryKeyword, configOverrides } = input;

  // ── 1. Idempotency check ──────────────────────────────────────────────
  const existing = await prisma.experiment.findUnique({
    where: {
      siteId_opportunityId: { siteId, opportunityId },
    },
    select: {
      id: true,
      variants: { select: { id: true } },
    },
  });

  if (existing) {
    logger.info("[ExperimentAssignment] Idempotent hit — experiment already exists", {
      experimentId: existing.id,
      siteId,
      opportunityId,
    });
    return {
      experimentId: existing.id,
      isNew: false,
      variantCount: existing.variants.length,
    };
  }

  // ── 2. Concurrent experiment limit ────────────────────────────────────
  const runningCount = await prisma.experiment.count({
    where: {
      siteId,
      status: "RUNNING",
    },
  });

  if (runningCount >= DEFAULT_SAFETY_LIMITS.maxConcurrentPerSite) {
    throw new ExperimentLimitError(
      siteId,
      DEFAULT_SAFETY_LIMITS.maxConcurrentPerSite,
      runningCount
    );
  }

  // ── 3. URL conflict check ─────────────────────────────────────────────
  const urlConflict = await prisma.experimentVariant.findFirst({
    where: {
      targetUrl: plan.targetUrl,
      experiment: {
        siteId,
        status: "RUNNING",
      },
    },
    select: {
      experimentId: true,
    },
  });

  if (urlConflict) {
    throw new ExperimentConflictError(
      siteId,
      plan.targetUrl,
      urlConflict.experimentId
    );
  }

  // ── 4. Build config ───────────────────────────────────────────────────
  const config = buildExperimentConfig({
    opportunityId,
    siteId,
    hypothesis:
      configOverrides?.hypothesis ??
      `Applying ${plan.actionType} to ${plan.targetUrl} will improve search performance. ` +
      `Expected: ${plan.expectedOutcome}`,
    ...configOverrides,
  });

  const configHash = hashExperimentConfig(config);

  // ── 5. Generate variants ──────────────────────────────────────────────
  // Use a placeholder experimentId for hash computation; will be replaced
  // with the actual ID after creation. Since the hash includes experimentId,
  // we need a two-step process.
  const variantInputs = generateVariants("pending", plan, primaryKeyword);
  const validation = validateVariants(variantInputs);

  if (!validation.valid) {
    throw new Error(`[ExperimentAssignment] Invalid variants: ${validation.reason}`);
  }

  // ── 6. Create experiment + variants in a transaction ──────────────────
  const experiment = await prisma.$transaction(async (tx) => {
    // Create experiment
    const exp = await tx.experiment.create({
      data: {
        siteId,
        opportunityId,
        hypothesis: config.hypothesis,
        successMetric: config.successMetric,
        successThreshold: config.successThreshold,
        status: "DRAFT",
        configVersion: config.configVersion,
        configHash,
        maxDurationDays: config.maxDurationDays,
        maxMutationCount: config.maxMutationCount,
        maxBudgetUnits: config.maxBudgetUnits,
      },
    });

    // Create variants with correct experimentId in hash
    for (const v of variantInputs) {
      const assignmentHash = computeAssignmentHash(exp.id, v.variantKey, v.targetUrl);

      await tx.experimentVariant.create({
        data: {
          experimentId: exp.id,
          variantKey: v.variantKey,
          isControl: v.isControl,
          targetUrl: v.targetUrl,
          targetKeyword: v.targetKeyword,
          actionType: v.actionType,
          actionParameters: (v.actionParameters ?? Prisma.DbNull) as any,
          assignmentHash,
        },
      });
    }

    return exp;
  });

  logger.info("[ExperimentAssignment] Experiment created", {
    experimentId: experiment.id,
    siteId,
    opportunityId,
    targetUrl: plan.targetUrl,
    variantCount: variantInputs.length,
    configHash,
  });

  return {
    experimentId: experiment.id,
    isNew: true,
    variantCount: variantInputs.length,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetches the treatment variant for an experiment.
 * Returns null if the experiment has no treatment variant.
 */
export async function getTreatmentVariant(experimentId: string) {
  return prisma.experimentVariant.findFirst({
    where: {
      experimentId,
      isControl: false,
    },
  });
}

/**
 * Fetches the control variant for an experiment.
 */
export async function getControlVariant(experimentId: string) {
  return prisma.experimentVariant.findFirst({
    where: {
      experimentId,
      isControl: true,
    },
  });
}

/**
 * Checks if a URL has any running experiments on the given site.
 */
export async function hasRunningExperimentForUrl(
  siteId: string,
  targetUrl: string
): Promise<boolean> {
  const count = await prisma.experimentVariant.count({
    where: {
      targetUrl,
      experiment: {
        siteId,
        status: "RUNNING",
      },
    },
  });
  return count > 0;
}
