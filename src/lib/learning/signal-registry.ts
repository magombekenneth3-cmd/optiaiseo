/**
 * Phase D.6.4 — Signal Registry
 *
 * Manages the lifecycle of learned signals in PostgreSQL.
 * Provides read access for D.2/D.3 consumers.
 *
 * Signal lifecycle: PROPOSED → ACTIVE → SUPERSEDED | REVOKED
 *
 * INVARIANTS:
 * - Only one ACTIVE signal per (siteId, signalType, actionType) — enforced by @@unique
 * - Activation supersedes any existing ACTIVE signal for the same key
 * - Revocation is a manual override (admin kill switch)
 * - This module writes ONLY to ActionPerformance and LearnedSignal tables
 * - It NEVER modifies scoring weights, planning parameters, or D.2/D.3 constants
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { ActionOutcomeAggregation } from "./types";
import { LEARNING_VERSION } from "./types";
import type { GeneratedSignal } from "./signal-generator";

// ── Types ───────────────────────────────────────────────────────────────────

export interface LearnedSignalRecord {
  id: string;
  siteId: string;
  signalType: string;
  actionType: string;
  adjustment: number;
  magnitude: string;
  derivedFrom: number;
  winRate: number;
  reason: string;
  status: string;
  version: number;
  activatedAt: Date | null;
  createdAt: Date;
}

/** Map key format: "SIGNAL_TYPE:ACTION_TYPE" → signal record */
export type LearnedSignalMap = Map<string, LearnedSignalRecord>;

// ── Public API: Write ───────────────────────────────────────────────────────

/**
 * Persists a validated signal as PROPOSED, then immediately activates it.
 *
 * If an ACTIVE signal already exists for the same (site, signalType, actionType),
 * it is transitioned to SUPERSEDED atomically.
 */
export async function persistAndActivateSignal(
  siteId: string,
  signal: GeneratedSignal
): Promise<string> {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // 1. Supersede any existing ACTIVE signal for this key
    const existing = await (tx as any).learnedSignal.findFirst({
      where: {
        siteId,
        signalType: signal.signalType,
        actionType: signal.actionType,
        status: "ACTIVE",
      },
      select: { id: true, version: true },
    });

    let newVersion = 1;

    if (existing) {
      newVersion = (existing.version ?? 1) + 1;

      await (tx as any).learnedSignal.update({
        where: { id: existing.id },
        data: {
          status: "SUPERSEDED",
          supersededAt: now,
        },
      });

      logger.info("[SignalRegistry] Superseded previous signal", {
        siteId,
        signalType: signal.signalType,
        actionType: signal.actionType,
        supersededId: existing.id,
      });
    }

    // 2. Create new ACTIVE signal
    const created = await (tx as any).learnedSignal.create({
      data: {
        siteId,
        signalType: signal.signalType,
        actionType: signal.actionType,
        adjustment: signal.adjustment,
        magnitude: signal.magnitude,
        derivedFrom: signal.derivedFrom,
        winRate: signal.winRate,
        reason: signal.reason,
        status: "ACTIVE",
        version: newVersion,
        activatedAt: now,
      },
    });

    // 3. Update supersededBy on old signal (if exists)
    if (existing) {
      await (tx as any).learnedSignal.update({
        where: { id: existing.id },
        data: { supersededBy: created.id },
      });
    }

    return created;
  });

  logger.info("[SignalRegistry] Signal activated", {
    signalId: result.id,
    siteId,
    signalType: signal.signalType,
    actionType: signal.actionType,
    adjustment: signal.adjustment,
    version: result.version,
  });

  return result.id;
}

/**
 * Persists an ActionPerformance snapshot (upsert by site + action type).
 */
export async function persistActionPerformance(
  aggregation: ActionOutcomeAggregation
): Promise<void> {
  await (prisma as any).actionPerformance.upsert({
    where: {
      siteId_actionType: {
        siteId: aggregation.siteId,
        actionType: aggregation.actionType,
      },
    },
    create: {
      siteId: aggregation.siteId,
      actionType: aggregation.actionType,
      totalExperiments: aggregation.totalExperiments,
      wins: aggregation.wins,
      losses: aggregation.losses,
      inconclusive: aggregation.inconclusive,
      aborted: aggregation.aborted,
      winRate: aggregation.winRate ?? 0,
      avgPositionDelta: aggregation.avgPositionDelta,
      avgClicksLift: aggregation.avgClicksLift,
      avgCtrLift: aggregation.avgCtrLift,
      avgConfidence: aggregation.avgConfidence,
      computedVersion: LEARNING_VERSION,
      experimentCount: aggregation.totalExperiments,
    },
    update: {
      totalExperiments: aggregation.totalExperiments,
      wins: aggregation.wins,
      losses: aggregation.losses,
      inconclusive: aggregation.inconclusive,
      aborted: aggregation.aborted,
      winRate: aggregation.winRate ?? 0,
      avgPositionDelta: aggregation.avgPositionDelta,
      avgClicksLift: aggregation.avgClicksLift,
      avgCtrLift: aggregation.avgCtrLift,
      avgConfidence: aggregation.avgConfidence,
      computedAt: new Date(),
      computedVersion: LEARNING_VERSION,
      experimentCount: aggregation.totalExperiments,
    },
  });
}

// ── Public API: Read (for D.2/D.3) ─────────────────────────────────────────

/**
 * Gets all ACTIVE signals for a site as a lookup map.
 * Key format: "SIGNAL_TYPE:ACTION_TYPE"
 *
 * This is the primary read interface for D.2 score calculator and D.3 planner.
 */
export async function getActiveSignalsMap(siteId: string): Promise<LearnedSignalMap> {
  const signals = await (prisma as any).learnedSignal.findMany({
    where: {
      siteId,
      status: "ACTIVE",
    },
  });

  const map: LearnedSignalMap = new Map();
  for (const s of signals) {
    const key = `${s.signalType}:${s.actionType}`;
    map.set(key, {
      id: s.id,
      siteId: s.siteId,
      signalType: s.signalType,
      actionType: s.actionType,
      adjustment: s.adjustment,
      magnitude: s.magnitude,
      derivedFrom: s.derivedFrom,
      winRate: s.winRate,
      reason: s.reason,
      status: s.status,
      version: s.version,
      activatedAt: s.activatedAt,
      createdAt: s.createdAt,
    });
  }

  return map;
}

/**
 * Gets a specific ACTIVE signal for a given action and signal type.
 * Returns null if no active signal exists.
 */
export async function getSignalForAction(
  siteId: string,
  actionType: string,
  signalType: string
): Promise<LearnedSignalRecord | null> {
  const signal = await (prisma as any).learnedSignal.findFirst({
    where: {
      siteId,
      actionType,
      signalType,
      status: "ACTIVE",
    },
  });

  return signal ?? null;
}

/**
 * Revokes a signal (manual admin kill switch).
 * Revoked signals cannot be re-activated.
 */
export async function revokeSignal(
  signalId: string,
  reason: string
): Promise<void> {
  await (prisma as any).learnedSignal.update({
    where: { id: signalId },
    data: {
      status: "REVOKED",
      reason: reason,
    },
  });

  logger.info("[SignalRegistry] Signal revoked", { signalId, reason });
}
