/**
 * Phase D.2 — Evidence Fencing
 *
 * Prevents stale scoring from promoting an opportunity whose evidence
 * has changed between scoring time and promotion time.
 *
 * Flow:
 *   1. Read candidate + evidence
 *   2. hashScoringEvidence(evidence) → evidenceHash
 *   3. Calculate score using that evidence
 *   4. Before promotion: re-read evidence → re-hash
 *   5. Same hash? → proceed with promotion
 *   6. Different hash? → discard score, RESCORE_REQUIRED
 */

import { createHash } from "node:crypto";
import type { EvidenceItem, ScoringInput } from "./types";
import { canonicalizeJson } from "@/lib/opportunity-engine/evidence-snapshot";
import { prisma } from "@/lib/prisma";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Creates a deterministic hash of the evidence used for scoring.
 *
 * Includes:
 *   - All evidence items (sourceType, metric, value, observedAt)
 *   - discoveryConfidence
 *   - lastRefreshedAt
 *   - expiresAt
 *
 * This hash is stored in OpportunityScoreRecord.evidenceHash.
 */
export function hashScoringEvidence(input: ScoringInput): string {
  const payload = {
    opportunityId: input.opportunityId,
    discoveryConfidence: input.discoveryConfidence,
    lastRefreshedAt: input.lastRefreshedAt?.toISOString() ?? null,
    expiresAt: input.expiresAt?.toISOString() ?? null,
    evidence: input.evidenceItems.map((e) => ({
      sourceType: e.sourceType,
      metric: e.metric ?? null,
      value: e.value ?? null,
      observedAt: e.observedAt.toISOString(),
    })),
  };

  const canonical = canonicalizeJson(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verifies that evidence hasn't changed between scoring and promotion.
 *
 * Re-reads the opportunity and its evidence from the database,
 * re-computes the hash, and compares with the expected hash.
 */
export async function verifyEvidenceBeforePromotion(
  opportunityId: string,
  expectedHash: string
): Promise<{ verified: boolean; currentHash: string }> {
  // Re-read the opportunity with fresh data
  const opportunity = await (prisma as any).growthDecision.findUnique({
    where: { id: opportunityId },
    select: {
      id: true,
      discoveryConfidence: true,
      lastRefreshedAt: true,
      expiresAt: true,
      opportunityStatus: true,
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
                },
              },
            },
          },
        },
      },
    },
  });

  if (!opportunity) {
    return { verified: false, currentHash: "" };
  }

  // Rebuild evidence items from the finding chain
  const evidenceItems: EvidenceItem[] = [];
  for (const opFinding of opportunity.sourceFindings ?? []) {
    for (const evidence of opFinding.finding?.evidence ?? []) {
      evidenceItems.push({
        sourceType: evidence.sourceType,
        metric: evidence.metric,
        value: evidence.value,
        observedAt: new Date(evidence.observedAt),
      });
    }
  }

  // Compute current hash
  const currentInput: ScoringInput = {
    opportunityId,
    siteId: "",
    url: "",
    primaryKeyword: "",
    category: "",
    action: "",
    discoveryConfidence: opportunity.discoveryConfidence,
    expiresAt: opportunity.expiresAt ? new Date(opportunity.expiresAt) : null,
    lastRefreshedAt: opportunity.lastRefreshedAt ? new Date(opportunity.lastRefreshedAt) : null,
    primaryDiscoverySource: null,
    evidenceItems,
    existingScore: null,
    metadata: {},
  };

  const currentHash = hashScoringEvidence(currentInput);

  return {
    verified: currentHash === expectedHash,
    currentHash,
  };
}
