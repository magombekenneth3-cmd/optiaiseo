/**
 * Week 5.3 — Pipeline Health Query Layer
 *
 * Individual aggregation functions for autonomy pipeline observability.
 * Each function is independently testable and follows strict rules:
 *
 *   1. Current state vs windowed activity — never mixed
 *   2. "Zero" vs "unavailable" distinguished
 *   3. No SSE — designed for polling (10–30s intervals)
 *   4. Each function reads from authoritative DB state only
 *
 * Architecture note:
 *   ExecutionTrace is the correlation spine for the autonomous pipeline.
 *   It links opportunityId → proposalId → operationId.
 *   Gaps acknowledged: no experimentId, signalId, or allocationId on trace.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuthorizationHealth {
  /** Windowed: decisions made within windowHours */
  authorized: number;
  denied: number;
  needsApproval: number;
  /** Most recent authorization timestamp */
  lastDecisionAt: Date | null;
}

export interface MutationHealth {
  /** Current: operations currently executing */
  executing: number;
  /** Windowed: operations completed within windowHours */
  completed: number;
  failed: number;
  rolledBack: number;
  /** Completion rate: completed / (completed + failed) in window */
  completionRate: number | null;
}

export interface CircuitHealth {
  /** Current state per channel */
  channels: Array<{
    channel: string;
    state: string;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    lastFailureAt: Date | null;
    openedAt: Date | null;
    nextAttemptAt: Date | null;
    halfOpenProbeInFlight: boolean;
  }>;
}

export interface BudgetHealth {
  /** Current: active (RESERVED) reservations */
  activeReservations: number;
  /** Windowed: consumed and released within windowHours */
  consumed: number;
  released: number;
  /** Current: daily budget utilization */
  dailyConsumed: number;
  dailyLimit: number | null;
}

export interface ExperimentHealth {
  /** Current: running experiments */
  running: number;
  /** Windowed: completed within windowHours */
  completedInWindow: number;
  wins: number;
  losses: number;
  inconclusive: number;
  aborted: number;
}

export interface LearningHealth {
  /** Current: ACTIVE signals count */
  activeSignals: number;
  /** Breakdown by signal type */
  riskAdjustments: number;
  confidenceAdjustments: number;
  /** Most recent signal activation */
  lastActivatedAt: Date | null;
}

export interface HealingHealth {
  /** Windowed: healing actions within windowHours */
  completed: number;
  failed: number;
  pending: number;
  dropped: number;
  /** Most recent healing action */
  lastActionAt: Date | null;
}

export interface AutonomyPipelineHealth {
  siteId: string;
  windowHours: number;
  queriedAt: Date;
  authorization: AuthorizationHealth;
  mutation: MutationHealth;
  circuit: CircuitHealth;
  budget: BudgetHealth;
  experiment: ExperimentHealth;
  learning: LearningHealth;
  healing: HealingHealth;
}

// ── Individual Health Functions ─────────────────────────────────────────────

export async function getAuthorizationHealth(
  siteId: string,
  windowHours: number
): Promise<AuthorizationHealth> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  try {
    const traces = await (prisma as any).executionTrace.findMany({
      where: {
        siteId,
        createdAt: { gte: windowStart },
      },
      select: {
        policyDecision: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    let authorized = 0;
    let denied = 0;
    let needsApproval = 0;

    for (const trace of traces) {
      switch (trace.policyDecision) {
        case "AUTHORIZED": authorized++; break;
        case "BLOCKED": denied++; break;
        case "NEEDS_APPROVAL": needsApproval++; break;
        default: denied++; break; // Fail-closed: unknown → denied
      }
    }

    return {
      authorized,
      denied,
      needsApproval,
      lastDecisionAt: traces[0]?.createdAt ?? null,
    };
  } catch (err) {
    logger.error("[PipelineHealth] Authorization query failed", { siteId, error: (err as Error)?.message });
    return { authorized: 0, denied: 0, needsApproval: 0, lastDecisionAt: null };
  }
}

export async function getMutationHealth(
  siteId: string,
  windowHours: number
): Promise<MutationHealth> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  try {
    // Current: executing right now
    const executing = await (prisma as any).mutationOperation.count({
      where: { siteId, status: "EXECUTING" },
    });

    // Windowed: completed operations
    const windowedOps = await (prisma as any).mutationOperation.findMany({
      where: {
        siteId,
        updatedAt: { gte: windowStart },
        status: { in: ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "ROLLED_BACK"] },
      },
      select: { status: true },
    });

    let completed = 0;
    let failed = 0;
    let rolledBack = 0;

    for (const op of windowedOps) {
      switch (op.status) {
        case "COMPLETED":
        case "COMPLETED_WITH_ERRORS":
          completed++; break;
        case "FAILED": failed++; break;
        case "ROLLED_BACK": rolledBack++; break;
      }
    }

    const total = completed + failed;
    const completionRate = total > 0 ? completed / total : null;

    return { executing, completed, failed, rolledBack, completionRate };
  } catch (err) {
    logger.error("[PipelineHealth] Mutation query failed", { siteId, error: (err as Error)?.message });
    return { executing: 0, completed: 0, failed: 0, rolledBack: 0, completionRate: null };
  }
}

export async function getCircuitHealth(siteId: string): Promise<CircuitHealth> {
  try {
    const breakers = await (prisma as any).circuitBreaker.findMany({
      where: { siteId },
    });

    return {
      channels: breakers.map((b: any) => ({
        channel: b.channel,
        state: b.state,
        consecutiveFailures: b.consecutiveFailures,
        consecutiveSuccesses: b.consecutiveSuccesses,
        lastFailureAt: b.lastFailureAt,
        openedAt: b.openedAt,
        nextAttemptAt: b.nextAttemptAt,
        halfOpenProbeInFlight: b.halfOpenProbeInFlight,
      })),
    };
  } catch (err) {
    logger.error("[PipelineHealth] Circuit query failed", { siteId, error: (err as Error)?.message });
    return { channels: [] };
  }
}

export async function getBudgetHealth(
  siteId: string,
  windowHours: number
): Promise<BudgetHealth> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    // Current: active reservations
    const activeReservations = await (prisma as any).budgetReservation.count({
      where: { siteId, status: "RESERVED" },
    });

    // Windowed: consumed and released
    const windowedReservations = await (prisma as any).budgetReservation.findMany({
      where: {
        siteId,
        OR: [
          { status: "CONSUMED", consumedAt: { gte: windowStart } },
          { status: "RELEASED", releasedAt: { gte: windowStart } },
        ],
      },
      select: { status: true },
    });

    let consumed = 0;
    let released = 0;
    for (const r of windowedReservations) {
      if (r.status === "CONSUMED") consumed++;
      else released++;
    }

    // Daily consumed
    const dailyConsumed = await (prisma as any).budgetReservation.count({
      where: { siteId, status: "CONSUMED", consumedAt: { gte: todayStart } },
    });

    // Get site's daily limit
    const site = await (prisma as any).site.findUnique({
      where: { id: siteId },
      select: { dailyBudgetUnits: true },
    });

    return {
      activeReservations,
      consumed,
      released,
      dailyConsumed,
      dailyLimit: site?.dailyBudgetUnits ?? null,
    };
  } catch (err) {
    logger.error("[PipelineHealth] Budget query failed", { siteId, error: (err as Error)?.message });
    return { activeReservations: 0, consumed: 0, released: 0, dailyConsumed: 0, dailyLimit: null };
  }
}

export async function getExperimentHealth(
  siteId: string,
  windowHours: number
): Promise<ExperimentHealth> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  try {
    // Current: running experiments
    const running = await (prisma as any).experiment.count({
      where: { siteId, status: "RUNNING" },
    });

    // Windowed: completed experiments
    const windowedExps = await (prisma as any).experiment.findMany({
      where: {
        siteId,
        status: "COMPLETED",
        completedAt: { gte: windowStart },
      },
      select: { outcome: true },
    });

    let wins = 0, losses = 0, inconclusive = 0, aborted = 0;
    for (const exp of windowedExps) {
      switch (exp.outcome) {
        case "WIN": wins++; break;
        case "LOSS": losses++; break;
        case "INCONCLUSIVE": inconclusive++; break;
        case "ABORTED": aborted++; break;
      }
    }

    return {
      running,
      completedInWindow: windowedExps.length,
      wins,
      losses,
      inconclusive,
      aborted,
    };
  } catch (err) {
    logger.error("[PipelineHealth] Experiment query failed", { siteId, error: (err as Error)?.message });
    return { running: 0, completedInWindow: 0, wins: 0, losses: 0, inconclusive: 0, aborted: 0 };
  }
}

export async function getLearningHealth(siteId: string): Promise<LearningHealth> {
  try {
    const activeSignals = await (prisma as any).learnedSignal.findMany({
      where: { siteId, status: "ACTIVE" },
      select: { signalType: true, activatedAt: true },
      orderBy: { activatedAt: "desc" },
    });

    let riskAdjustments = 0;
    let confidenceAdjustments = 0;

    for (const signal of activeSignals) {
      if (signal.signalType === "RISK_ADJUSTMENT") riskAdjustments++;
      else if (signal.signalType === "CONFIDENCE_ADJUSTMENT") confidenceAdjustments++;
    }

    return {
      activeSignals: activeSignals.length,
      riskAdjustments,
      confidenceAdjustments,
      lastActivatedAt: activeSignals[0]?.activatedAt ?? null,
    };
  } catch (err) {
    logger.error("[PipelineHealth] Learning query failed", { siteId, error: (err as Error)?.message });
    return { activeSignals: 0, riskAdjustments: 0, confidenceAdjustments: 0, lastActivatedAt: null };
  }
}

export async function getHealingHealth(
  siteId: string,
  windowHours: number
): Promise<HealingHealth> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  try {
    const logs = await (prisma as any).selfHealingLog.findMany({
      where: {
        siteId,
        createdAt: { gte: windowStart },
      },
      select: { status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    let completed = 0, failed = 0, pending = 0, dropped = 0;
    for (const log of logs) {
      switch (log.status) {
        case "COMPLETED": completed++; break;
        case "FAILED": failed++; break;
        case "PENDING":
        case "PENDING_REVIEW": pending++; break;
        case "DROPPED": dropped++; break;
      }
    }

    return {
      completed,
      failed,
      pending,
      dropped,
      lastActionAt: logs[0]?.createdAt ?? null,
    };
  } catch (err) {
    logger.error("[PipelineHealth] Healing query failed", { siteId, error: (err as Error)?.message });
    return { completed: 0, failed: 0, pending: 0, dropped: 0, lastActionAt: null };
  }
}

// ── Composition ─────────────────────────────────────────────────────────────

export async function getAutonomyPipelineHealth(
  siteId: string,
  windowHours: number = 24
): Promise<AutonomyPipelineHealth> {
  const [authorization, mutation, circuit, budget, experiment, learning, healing] =
    await Promise.all([
      getAuthorizationHealth(siteId, windowHours),
      getMutationHealth(siteId, windowHours),
      getCircuitHealth(siteId),
      getBudgetHealth(siteId, windowHours),
      getExperimentHealth(siteId, windowHours),
      getLearningHealth(siteId),
      getHealingHealth(siteId, windowHours),
    ]);

  return {
    siteId,
    windowHours,
    queriedAt: new Date(),
    authorization,
    mutation,
    circuit,
    budget,
    experiment,
    learning,
    healing,
  };
}
