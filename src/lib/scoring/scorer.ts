/**
 * Phase D.2 — Scorer Orchestrator
 *
 * Orchestrates the full scoring pipeline for one candidate:
 *
 *   loadCandidate → loadEvidence → hash → score → eligibility
 *     → persist OpportunityScoreRecord
 *     → if PROMOTE: verify evidence → promote
 */

import type { ScoringResult, ScoringInput, EvidenceItem } from "./types";
import { SCORING_VERSION, DEFAULT_WEIGHTS, DEFAULT_ELIGIBILITY } from "./types";
import { computeScoreComponents, calculateFinalScore } from "./score-calculator";
import { evaluateEligibility } from "./eligibility";
import { hashScoringEvidence } from "./evidence-fencing";
import { promoteCandidateToOpen } from "./promoter";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getActiveSignalsMap } from "@/lib/learning/signal-registry";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Scores a single CANDIDATE opportunity.
 *
 * Returns the scoring result including the decision (PROMOTE/DEFER/REJECT).
 * If PROMOTE, attempts atomic promotion to OPEN.
 */
export async function scoreCandidate(
  opportunityId: string
): Promise<ScoringResult & { promoted?: boolean; promotionReason?: string }> {
  // 1. Load candidate
  const input = await loadScoringInput(opportunityId);

  if (!input) {
    throw new Error(`[Scorer] Opportunity ${opportunityId} not found or not CANDIDATE`);
  }

  // 2. Hash evidence at scoring time
  const evidenceHash = hashScoringEvidence(input);

  // 2b. D.6: Load learned signals for this site
  let signals;
  try {
    signals = await getActiveSignalsMap(input.siteId);
  } catch {
    // Non-critical — score without signals if registry unavailable
    signals = undefined;
  }

  // 3. Compute score components (with optional D.6 signal adjustments)
  const components = computeScoreComponents(input, signals);

  // 4. Calculate final score
  const finalScore = calculateFinalScore(components, DEFAULT_WEIGHTS);

  // 5. Evaluate eligibility
  const eligibility = evaluateEligibility(
    components,
    finalScore,
    input,
    DEFAULT_ELIGIBILITY
  );

  // 6. Build scoring result
  const now = new Date();
  const result: ScoringResult = {
    opportunityId,
    ...components,
    finalScore,
    decision: eligibility.decision,
    decisionReasons: eligibility.reasons,
    evidenceHash,
    scoringVersion: SCORING_VERSION,
    scoredAt: now,
    weightsUsed: { ...DEFAULT_WEIGHTS },
  };

  // 7. Persist durable score record
  await persistScoreRecord(result);

  // 8. Update GrowthDecision summary metadata
  await updateScoringMetadata(opportunityId, result);

  // 9. If PROMOTE → attempt atomic promotion
  if (eligibility.decision === "PROMOTE") {
    const promotion = await promoteCandidateToOpen(opportunityId, result);

    logger.info("[Scorer] Scoring complete with promotion attempt", {
      opportunityId,
      decision: "PROMOTE",
      finalScore,
      promoted: promotion.promoted,
      promotionReason: promotion.reason,
    });

    return {
      ...result,
      promoted: promotion.promoted,
      promotionReason: promotion.reason,
    };
  }

  // 10. If REJECT → update to DISMISSED
  if (eligibility.decision === "REJECT") {
    await dismissCandidate(opportunityId);
  }

  logger.info("[Scorer] Scoring complete", {
    opportunityId,
    decision: eligibility.decision,
    finalScore,
  });

  return { ...result, promoted: false };
}

// ── Data Loading ────────────────────────────────────────────────────────────

async function loadScoringInput(
  opportunityId: string
): Promise<ScoringInput | null> {
  const opp = await (prisma as any).growthDecision.findUnique({
    where: { id: opportunityId },
    select: {
      id: true,
      siteId: true,
      url: true,
      primaryKeyword: true,
      primaryCategory: true,
      action: true,
      score: true,
      opportunityStatus: true,
      discoveryConfidence: true,
      expiresAt: true,
      lastRefreshedAt: true,
      primaryDiscoverySource: true,
      sourceFindings: {
        select: {
          finding: {
            select: {
              evidence: {
                select: {
                  sourceType: true,
                  metric: true,
                  value: true,
                  observedAt: true,
                  metadata: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!opp || opp.opportunityStatus !== "CANDIDATE") {
    return null;
  }

  // Flatten evidence from finding chain
  const evidenceItems: EvidenceItem[] = [];
  for (const opFinding of opp.sourceFindings ?? []) {
    for (const evidence of opFinding.finding?.evidence ?? []) {
      evidenceItems.push({
        sourceType: evidence.sourceType,
        metric: evidence.metric,
        value: evidence.value,
        observedAt: new Date(evidence.observedAt),
        metadata: evidence.metadata,
      });
    }
  }

  // Extract metadata from existing score JSON
  const existingScore = opp.score as Record<string, unknown> | null;
  const metadata: Record<string, unknown> = {};

  if (existingScore) {
    if (existingScore.components) {
      Object.assign(metadata, existingScore.components as Record<string, unknown>);
    }
  }

  return {
    opportunityId: opp.id,
    siteId: opp.siteId,
    url: opp.url,
    primaryKeyword: opp.primaryKeyword,
    category: opp.primaryCategory,
    action: opp.action,
    discoveryConfidence: opp.discoveryConfidence,
    expiresAt: opp.expiresAt ? new Date(opp.expiresAt) : null,
    lastRefreshedAt: opp.lastRefreshedAt ? new Date(opp.lastRefreshedAt) : null,
    primaryDiscoverySource: opp.primaryDiscoverySource,
    evidenceItems,
    existingScore,
    metadata,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

async function persistScoreRecord(result: ScoringResult): Promise<void> {
  try {
    await (prisma as any).opportunityScoreRecord.create({
      data: {
        opportunityId: result.opportunityId,
        scoringVersion: result.scoringVersion,
        impactScore: result.impactScore,
        confidenceScore: result.confidenceScore,
        evidenceScore: result.evidenceScore,
        urgencyScore: result.urgencyScore,
        effortScore: result.effortScore,
        riskScore: result.riskScore,
        finalScore: result.finalScore,
        decision: result.decision,
        decisionReasons: result.decisionReasons,
        evidenceHash: result.evidenceHash,
        weightsUsed: result.weightsUsed,
        scoredAt: result.scoredAt,
      },
    });
  } catch (err: unknown) {
    logger.error("[Scorer] Failed to persist score record", {
      opportunityId: result.opportunityId,
      error: (err as Error)?.message,
    });
  }
}

async function updateScoringMetadata(
  opportunityId: string,
  result: ScoringResult
): Promise<void> {
  try {
    await (prisma as any).growthDecision.update({
      where: { id: opportunityId },
      data: {
        lastScoredAt: result.scoredAt,
        scoringVersion: result.scoringVersion,
      },
    });
  } catch {
    // Non-critical
  }
}

async function dismissCandidate(opportunityId: string): Promise<void> {
  try {
    await (prisma as any).growthDecision.updateMany({
      where: {
        id: opportunityId,
        opportunityStatus: "CANDIDATE",
      },
      data: {
        opportunityStatus: "DISMISSED",
      },
    });
  } catch {
    // Non-critical
  }
}
