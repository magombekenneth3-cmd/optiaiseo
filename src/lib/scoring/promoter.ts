import type { ScoringResult, PromotionResult } from "./types";
import { verifyEvidenceBeforePromotion } from "./evidence-fencing";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ── Public API ──────────────────────────────────────────────────────────────

export async function promoteCandidateToOpen(
  opportunityId: string,
  scoreResult: ScoringResult,
  now: Date = new Date()
): Promise<PromotionResult> {
  // 1. Verify decision is PROMOTE
  if (scoreResult.decision !== "PROMOTE") {
    return {
      promoted: false,
      reason: `Score decision is ${scoreResult.decision}, not PROMOTE`,
    };
  }

  // 2. Re-verify evidence hasn't changed since scoring
  const evidenceCheck = await verifyEvidenceBeforePromotion(
    opportunityId,
    scoreResult.evidenceHash
  );

  if (!evidenceCheck.verified) {
    logger.warn("[Promoter] Evidence changed since scoring — promotion aborted", {
      opportunityId,
      expectedHash: scoreResult.evidenceHash,
      currentHash: evidenceCheck.currentHash,
    });

    return {
      promoted: false,
      reason: "Evidence changed since scoring — RESCORE_REQUIRED",
    };
  }

  // 3. Atomic promotion: WHERE { id, opportunityStatus: "CANDIDATE" }
  try {
    // Check that candidate is not expired
    const candidate = await (prisma as any).growthDecision.findUnique({
      where: { id: opportunityId },
      select: {
        opportunityStatus: true,
        expiresAt: true,
      },
    });

    if (!candidate) {
      return { promoted: false, reason: "Opportunity not found" };
    }

    if (candidate.opportunityStatus !== "CANDIDATE") {
      return {
        promoted: false,
        reason: `Status is ${candidate.opportunityStatus}, not CANDIDATE (concurrent scorer?)`,
      };
    }

    if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() <= now.getTime()) {
      return {
        promoted: false,
        reason: `Candidate expired at ${candidate.expiresAt}`,
      };
    }

    // 4. Atomic update — only succeeds if still CANDIDATE
    const result = await (prisma as any).growthDecision.updateMany({
      where: {
        id: opportunityId,
        opportunityStatus: "CANDIDATE",
      },
      data: {
        opportunityStatus: "OPEN",
        lastScoredAt: now,
        scoringVersion: scoreResult.scoringVersion,
        score: {
          final: scoreResult.finalScore,
          impact: scoreResult.impactScore,
          confidence: scoreResult.confidenceScore,
          trafficPotential: scoreResult.impactScore,
          businessValue: 0,
          effort: scoreResult.effortScore,
          components: {
            rankingOpportunity: scoreResult.impactScore,
            trafficOpportunity: scoreResult.impactScore,
            intentAlignment: scoreResult.confidenceScore,
            businessAlignment: 0,
            freshness: scoreResult.evidenceScore,
            internalLinkOpportunity: 0,
          },
        },
      },
    });

    if (result.count === 0) {
      return {
        promoted: false,
        reason: "Concurrent promotion — 0 rows updated (status changed)",
      };
    }

    // 5. Mark evidence as verified on the score record
    await markEvidenceVerified(scoreResult.opportunityId, now);

    // 6. Emit domain event for D.3 planning pipeline
    try {
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "opportunity.opened",
        data: {
          opportunityId,
          siteId: candidate.siteId, // from DB, not scoreResult
          finalScore: scoreResult.finalScore,
          scoringVersion: scoreResult.scoringVersion,
        },
      });
    } catch (eventErr: unknown) {
      // Non-critical: D.3 reconciliation will catch stranded OPEN records
      logger.warn("[Promoter] Failed to emit opportunity.opened event", {
        opportunityId,
        error: (eventErr as Error)?.message,
      });
    }

    logger.info("[Promoter] CANDIDATE → OPEN", {
      opportunityId,
      finalScore: scoreResult.finalScore,
      scoringVersion: scoreResult.scoringVersion,
    });

    return { promoted: true };

  } catch (err: unknown) {
    logger.error("[Promoter] Promotion failed", {
      opportunityId,
      error: (err as Error)?.message,
    });

    return {
      promoted: false,
      reason: (err as Error)?.message ?? "Unknown error",
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Marks the most recent score record as evidence-verified.
 */
async function markEvidenceVerified(
  opportunityId: string,
  verifiedAt: Date
): Promise<void> {
  try {
    const latest = await (prisma as any).opportunityScoreRecord.findFirst({
      where: { opportunityId },
      orderBy: { scoredAt: "desc" },
      select: { id: true },
    });

    if (latest) {
      await (prisma as any).opportunityScoreRecord.update({
        where: { id: latest.id },
        data: { evidenceVerifiedAt: verifiedAt },
      });
    }
  } catch {
    // Non-critical — evidence verification is best-effort audit trail
  }
}
