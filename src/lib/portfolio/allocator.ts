/**
 * Phase D.7.4 — Portfolio Allocation Service
 *
 * Orchestrates portfolio allocation for a single site:
 *   1. Fetches OPEN opportunities with latest PROMOTE score records
 *   2. Loads site constraints
 *   3. Loads active D.5 experiments for conflict exclusion
 *   4. Builds AllocationCandidate[]
 *   5. Runs deterministic optimizer
 *   6. Persists PortfolioAllocation records
 *
 * INVARIANTS:
 *   - Only queries OPEN opportunities (not CANDIDATE, not PROMOTED)
 *   - Never reserves budget, creates claims, or mutates lifecycle
 *   - Persists durable allocation records for audit/provenance
 *   - One allocation per (cycleId, opportunityId) enforced by DB
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { LEARNING_VERSION } from "@/lib/learning/types";
import {
  type AllocationCandidate,
  type PortfolioConstraints,
  type PortfolioAllocationResult,
  DEFAULT_PORTFOLIO_CONSTRAINTS,
  PORTFOLIO_ALGORITHM_VERSION,
  generateCycleId,
} from "./types";
import { type ActiveExperimentConflict, optimizePortfolio } from "./optimizer";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Runs portfolio allocation for a single site.
 *
 * Returns the full allocation result, or null if no eligible candidates exist.
 */
export async function allocatePortfolioForSite(
  siteId: string,
  constraintOverrides?: Partial<PortfolioConstraints>
): Promise<PortfolioAllocationResult | null> {
  const now = new Date();

  // ── 1. Load site constraints ──────────────────────────────────────────
  const site = await (prisma as any).site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      dailyMutationLimit: true,
      maxConcurrentExecutions: true,
      automationsPaused: true,
    },
  });

  if (!site) {
    logger.warn("[PortfolioAllocator] Site not found", { siteId });
    return null;
  }

  // Respect kill switch
  if (site.automationsPaused) {
    logger.info("[PortfolioAllocator] Site automations paused — skipping", { siteId });
    return null;
  }

  const constraints: PortfolioConstraints = {
    ...DEFAULT_PORTFOLIO_CONSTRAINTS,
    maxSelections: Math.min(
      DEFAULT_PORTFOLIO_CONSTRAINTS.maxSelections,
      site.dailyMutationLimit ?? DEFAULT_PORTFOLIO_CONSTRAINTS.maxSelections
    ),
    ...constraintOverrides,
  };

  // ── 2. Load OPEN opportunities with latest PROMOTE score records ──────
  const opportunities = await (prisma as any).growthDecision.findMany({
    where: {
      siteId,
      opportunityStatus: "OPEN",
    },
    select: {
      id: true,
      siteId: true,
      url: true,
      action: true,
      primaryCategory: true,
      expiresAt: true,
      createdAt: true,
      generatedAt: true,
      scoreRecords: {
        where: { decision: "PROMOTE" },
        orderBy: { scoredAt: "desc" },
        take: 1,
        select: {
          id: true,
          scoringVersion: true,
          finalScore: true,
          impactScore: true,
          confidenceScore: true,
          effortScore: true,
          riskScore: true,
          evidenceHash: true,
          learningVersion: true,
        },
      },
    },
  });

  if (opportunities.length === 0) {
    logger.info("[PortfolioAllocator] No OPEN opportunities for site", { siteId });
    return null;
  }

  // ── 3. Load active D.5 experiments for conflict exclusion ─────────────
  const activeExperiments = await loadActiveExperiments(siteId);
  const existingExperimentSlots = activeExperiments.length;

  // ── 4. Build AllocationCandidate[] ────────────────────────────────────
  const candidates: AllocationCandidate[] = [];

  for (const opp of opportunities) {
    const scoreRecord = opp.scoreRecords?.[0];
    if (!scoreRecord) continue; // No PROMOTE score → not eligible

    candidates.push({
      opportunityId: opp.id,
      siteId: opp.siteId,
      scoreRecordId: scoreRecord.id,
      scoringVersion: scoreRecord.scoringVersion,
      finalScore: scoreRecord.finalScore,
      impactScore: scoreRecord.impactScore,
      confidenceScore: scoreRecord.confidenceScore,
      effortScore: scoreRecord.effortScore,
      riskScore: scoreRecord.riskScore,
      learningVersion: scoreRecord.learningVersion ?? null,
      actionType: opp.action,
      category: opp.primaryCategory,
      resourceType: "PAGE",       // Default — expandable per action type
      resourceId: opp.url,        // Canonical resource identity
      url: opp.url,
      evidenceHash: scoreRecord.evidenceHash,
      expiresAt: opp.expiresAt ? new Date(opp.expiresAt) : null,
      createdAt: opp.createdAt ? new Date(opp.createdAt) : new Date(opp.generatedAt),
      experimentEligibility: isExperimentEligible(opp.action),
    });
  }

  if (candidates.length === 0) {
    logger.info("[PortfolioAllocator] No candidates with PROMOTE scores", { siteId });
    return null;
  }

  // ── 5. Run optimizer ──────────────────────────────────────────────────
  const result = optimizePortfolio(
    candidates,
    constraints,
    activeExperiments,
    existingExperimentSlots,
    undefined,  // Default weights
    now,
    siteId
  );

  // ── 6. Persist PortfolioAllocation records ────────────────────────────
  await persistAllocations(result, now);

  logger.info("[PortfolioAllocator] Allocation complete", {
    siteId,
    cycleId: result.cycleId,
    selected: result.diagnostics.selectedCount,
    deferred: result.diagnostics.deferredCount,
    excluded: result.diagnostics.excludedCount,
    durationMs: result.diagnostics.durationMs,
  });

  return result;
}

// ── D.5 Conflict Loading ────────────────────────────────────────────────────

async function loadActiveExperiments(siteId: string): Promise<ActiveExperimentConflict[]> {
  try {
    const experiments = await (prisma as any).experiment.findMany({
      where: {
        siteId,
        status: { in: ["DRAFT", "RUNNING"] },
      },
      select: {
        id: true,
        targetUrl: true,
        variants: {
          where: { isControl: false },
          select: {
            actionType: true,
          },
          take: 1,
        },
      },
    });

    return experiments
      .filter((e: any) => e.targetUrl)
      .map((e: any) => ({
        resourceType: "PAGE",
        resourceId: e.targetUrl,
        url: e.targetUrl,
        experimentId: e.id,
      }));
  } catch {
    return [];
  }
}

// ── Experiment Eligibility ──────────────────────────────────────────────────

/** Actions that can be tested with D.5 experiments */
const EXPERIMENT_ELIGIBLE_ACTIONS = new Set([
  "OPTIMIZE_TITLE",
  "UPDATE_TITLE_TAG",
  "UPDATE_META_DESCRIPTION",
  "REFRESH_CONTENT",
  "IMPROVE_SEARCH_INTENT",
  "OPTIMIZE_CONTENT_DEPTH",
  "BUILD_INTERNAL_LINKS",
  "ADD_INTERNAL_LINKS",
]);

function isExperimentEligible(action: string): boolean {
  return EXPERIMENT_ELIGIBLE_ACTIONS.has(action);
}

// ── Persistence ─────────────────────────────────────────────────────────────

async function persistAllocations(
  result: PortfolioAllocationResult,
  now: Date
): Promise<void> {
  // Allocation expires at end of day (23:59:59 UTC)
  const expiresAt = new Date(now);
  expiresAt.setUTCHours(23, 59, 59, 999);

  const allDecisions = [
    ...result.selected,
    ...result.deferred,
    ...result.excluded,
  ];

  // Batch persist — skip duplicates (idempotent)
  for (const d of allDecisions) {
    try {
      await (prisma as any).portfolioAllocation.upsert({
        where: {
          cycleId_opportunityId: {
            cycleId: result.cycleId,
            opportunityId: d.opportunityId,
          },
        },
        create: {
          siteId: result.siteId,
          opportunityId: d.opportunityId,
          cycleId: result.cycleId,
          optimizerVersion: result.optimizerVersion,
          decision: d.decision,
          rank: d.rank,
          utilityScore: d.utilityScore,
          reasonCodes: d.reasonCodes,
          scoreRecordId: d.scoreRecordId,
          evidenceHash: d.evidenceHash,
          learningVersion: d.candidateSnapshot.learningVersion,
          constraintSnapshot: result.constraintSnapshot,
          candidateSnapshot: d.candidateSnapshot,
          experimentPreference: d.experimentPreference,
          allocatedAt: result.allocatedAt,
          expiresAt,
        },
        update: {
          decision: d.decision,
          rank: d.rank,
          utilityScore: d.utilityScore,
          reasonCodes: d.reasonCodes,
          scoreRecordId: d.scoreRecordId,
          evidenceHash: d.evidenceHash,
          learningVersion: d.candidateSnapshot.learningVersion,
          constraintSnapshot: result.constraintSnapshot,
          candidateSnapshot: d.candidateSnapshot,
          experimentPreference: d.experimentPreference,
          allocatedAt: result.allocatedAt,
          expiresAt,
        },
      });
    } catch (err: unknown) {
      logger.error("[PortfolioAllocator] Failed to persist allocation", {
        cycleId: result.cycleId,
        opportunityId: d.opportunityId,
        error: (err as Error)?.message,
      });
    }
  }
}
