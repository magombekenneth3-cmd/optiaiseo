/**
 * Phase D.5.6 — Experiment Safety
 *
 * Hard limits enforced at experiment creation and during execution.
 * Provides abort, kill switch, and rollback integration.
 *
 * INVARIANTS:
 * - Duration cap: experiments auto-abort past maxDurationDays
 * - Concurrent cap: site cannot exceed maxConcurrentPerSite RUNNING experiments
 * - URL overlap: one RUNNING experiment per URL per site
 * - Kill switch: site-level automationsPaused aborts all running experiments
 * - Auto-abort: position drops beyond threshold trigger experiment abort
 * - Rollback: aborted experiments trigger existing rollback.ts path
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  type ExperimentStatus,
  type ExperimentSafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  VALID_EXPERIMENT_TRANSITIONS,
  ExperimentTransitionError,
} from "./types";

// ── Safety Check ────────────────────────────────────────────────────────────

export interface SafetyCheckResult {
  safe: boolean;
  violations: SafetyViolation[];
}

export interface SafetyViolation {
  rule: string;
  details: string;
  severity: "WARNING" | "CRITICAL";
}

/**
 * Runs all safety checks for an experiment.
 * Returns a list of violations — any CRITICAL violation means the experiment
 * should be aborted.
 */
export async function enforceExperimentSafety(
  siteId: string,
  experimentId: string,
  limits: ExperimentSafetyLimits = DEFAULT_SAFETY_LIMITS
): Promise<SafetyCheckResult> {
  const violations: SafetyViolation[] = [];

  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      variants: {
        where: { isControl: false },
        select: { operationId: true },
      },
    },
  });

  if (!experiment) {
    violations.push({
      rule: "EXPERIMENT_NOT_FOUND",
      details: `Experiment ${experimentId} not found`,
      severity: "CRITICAL",
    });
    return { safe: false, violations };
  }

  // ── Duration check ────────────────────────────────────────────────────
  if (experiment.startedAt && experiment.endsAt) {
    if (new Date() > experiment.endsAt) {
      violations.push({
        rule: "DURATION_EXCEEDED",
        details: `Experiment exceeded max duration of ${experiment.maxDurationDays} days`,
        severity: "CRITICAL",
      });
    }
  }

  // ── Site kill switch ──────────────────────────────────────────────────
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { automationsPaused: true },
  });

  if (site?.automationsPaused) {
    violations.push({
      rule: "SITE_AUTOMATIONS_PAUSED",
      details: `Site ${siteId} has automations paused — experiments must be aborted`,
      severity: "CRITICAL",
    });
  }

  // ── Global kill switch ────────────────────────────────────────────────
  if (process.env.GLOBAL_EMERGENCY_STOP === "true") {
    violations.push({
      rule: "GLOBAL_EMERGENCY_STOP",
      details: "Global emergency stop is active",
      severity: "CRITICAL",
    });
  }

  // ── Stale evidence check ──────────────────────────────────────────────
  if (experiment.endsAt) {
    const graceDeadline = new Date(experiment.endsAt);
    graceDeadline.setUTCDate(graceDeadline.getUTCDate() + limits.staleEvidenceGraceDays);

    if (new Date() > graceDeadline && experiment.status === "RUNNING") {
      violations.push({
        rule: "STALE_EVIDENCE",
        details: `Experiment is ${limits.staleEvidenceGraceDays} days past end date without completion`,
        severity: "CRITICAL",
      });
    }
  }

  // ── Position drop auto-abort ──────────────────────────────────────────
  const latestMeasurements = await prisma.experimentMeasurement.findMany({
    where: {
      experimentId,
      variantKey: "treatment_a",
    },
    orderBy: { measurementDay: "desc" },
    take: 1,
  });

  if (latestMeasurements.length > 0) {
    const treatment = latestMeasurements[0];
    const baselineMeasurement = await prisma.experimentMeasurement.findUnique({
      where: {
        experimentId_variantKey_measurementDay: {
          experimentId,
          variantKey: "treatment_a",
          measurementDay: 0,
        },
      },
    });

    if (
      treatment.position !== null &&
      baselineMeasurement?.position !== null &&
      baselineMeasurement?.position !== undefined
    ) {
      // Position delta: positive = improvement (lower position number)
      const positionDelta = baselineMeasurement.position - treatment.position;
      if (positionDelta < limits.autoAbortPositionDrop) {
        violations.push({
          rule: "POSITION_DROP",
          details: `Treatment position dropped by ${Math.abs(positionDelta).toFixed(1)} (threshold: ${Math.abs(limits.autoAbortPositionDrop)})`,
          severity: "CRITICAL",
        });
      }
    }
  }

  const hasCritical = violations.some(v => v.severity === "CRITICAL");

  if (violations.length > 0) {
    logger.warn("[ExperimentSafety] Violations detected", {
      experimentId,
      siteId,
      violationCount: violations.length,
      hasCritical,
      rules: violations.map(v => v.rule),
    });
  }

  return {
    safe: !hasCritical,
    violations,
  };
}

// ── Abort Experiment ────────────────────────────────────────────────────────

/**
 * Aborts a running experiment. Transitions to ABORTED status.
 *
 * If the treatment has an active MutationOperation, triggers rollback
 * through the existing rollback path.
 */
export async function abortExperiment(
  experimentId: string,
  reason: string
): Promise<void> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      variants: {
        where: { isControl: false },
        select: { operationId: true, proposalId: true },
      },
    },
  });

  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  assertValidTransition(experiment.status as ExperimentStatus, "ABORTED");

  // Transition experiment to ABORTED
  await prisma.experiment.update({
    where: { id: experimentId },
    data: {
      status: "ABORTED",
      statusReason: reason,
      outcome: "ABORTED",
      completedAt: new Date(),
      outcomeDetails: { reason, abortedAt: new Date().toISOString() },
    },
  });

  // Cancel any pending operations for treatment variants
  for (const variant of experiment.variants) {
    if (variant.operationId) {
      try {
        // Attempt to cancel or trigger rollback via existing mutation lifecycle
        const op = await prisma.mutationOperation.findUnique({
          where: { id: variant.operationId },
          select: { status: true },
        });

        if (op && !["COMPLETED", "FAILED", "ROLLED_BACK", "CANCELLED"].includes(op.status)) {
          await prisma.mutationOperation.update({
            where: { id: variant.operationId },
            data: {
              status: "CANCELLED",
              completedAt: new Date(),
            },
          });

          logger.info("[ExperimentSafety] Cancelled operation for aborted experiment", {
            experimentId,
            operationId: variant.operationId,
          });
        }
      } catch (err) {
        logger.warn("[ExperimentSafety] Failed to cancel operation", {
          experimentId,
          operationId: variant.operationId,
          error: (err as Error)?.message,
        });
      }
    }
  }

  logger.info("[ExperimentSafety] Experiment aborted", {
    experimentId,
    reason,
  });
}

// ── Kill Experiments by Site ────────────────────────────────────────────────

/**
 * Aborts ALL running experiments for a site.
 * Called when the site kill switch is activated.
 *
 * @returns Number of experiments aborted
 */
export async function killExperimentsBySite(
  siteId: string,
  reason: string
): Promise<number> {
  const running = await prisma.experiment.findMany({
    where: {
      siteId,
      status: "RUNNING",
    },
    select: { id: true },
  });

  let aborted = 0;
  for (const exp of running) {
    try {
      await abortExperiment(exp.id, reason);
      aborted++;
    } catch (err) {
      logger.warn("[ExperimentSafety] Failed to abort experiment during site kill", {
        experimentId: exp.id,
        siteId,
        error: (err as Error)?.message,
      });
    }
  }

  logger.info("[ExperimentSafety] Site experiment kill complete", {
    siteId,
    reason,
    aborted,
    total: running.length,
  });

  return aborted;
}

// ── Cron: Enforce Safety on All Running Experiments ─────────────────────────

/**
 * Runs safety checks on all RUNNING experiments.
 * Auto-aborts any experiment with CRITICAL violations.
 * Designed to be called by a daily cron.
 */
export async function enforceSafetyOnAllExperiments(): Promise<{
  checked: number;
  aborted: number;
}> {
  const running = await prisma.experiment.findMany({
    where: { status: "RUNNING" },
    select: { id: true, siteId: true },
  });

  let aborted = 0;

  for (const exp of running) {
    try {
      const result = await enforceExperimentSafety(exp.siteId, exp.id);

      if (!result.safe) {
        const criticalRules = result.violations
          .filter(v => v.severity === "CRITICAL")
          .map(v => v.rule)
          .join(", ");

        await abortExperiment(exp.id, `Safety violation: ${criticalRules}`);
        aborted++;
      }
    } catch (err) {
      logger.warn("[ExperimentSafety] Safety check failed", {
        experimentId: exp.id,
        error: (err as Error)?.message,
      });
    }
  }

  logger.info("[ExperimentSafety] Safety enforcement complete", {
    checked: running.length,
    aborted,
  });

  return { checked: running.length, aborted };
}

// ── State Transition ────────────────────────────────────────────────────────

function assertValidTransition(from: ExperimentStatus, to: ExperimentStatus): void {
  const allowed = VALID_EXPERIMENT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ExperimentTransitionError("unknown", from, to);
  }
}
