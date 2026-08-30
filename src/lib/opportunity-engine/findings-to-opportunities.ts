// =============================================================================
// FINDINGS TO OPPORTUNITIES ENGINE (v2)
//
// Converts AgentFinding records from the Agent OS into actionable GrowthDecision
// opportunities and links them via OpportunityFinding join table.
//
// v2 changes:
//   - Stable fingerprint for opportunity deduplication
//   - Bounded 0–1 component scoring with explainable weights
//   - previousFinal preservation on score updates
// =============================================================================

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AgentFinding } from "@/lib/agents/types";

// ── Opportunity Scoring Types ───────────────────────────────────────────────

export interface OpportunityScoreComponents {
  /** 0–1: severity + mapping weight of the finding */
  impact: number;
  /** 0–1: finding.confidence */
  confidence: number;
  /** 0–1: normalized traffic potential from evidence */
  trafficValue: number;
  /** 0–1: inverse of estimated implementation effort */
  effort: number;
  /** 0–1: category-based SEO strategic importance (not true business value — placeholder for Phase B revenue/conversion integration) */
  strategicValue: number;
}

export interface OpportunityScore {
  /** 0–100 weighted aggregate */
  final: number;
  /** Individual normalized components */
  components: OpportunityScoreComponents;
  /** Weights used for the aggregate */
  weights: Record<keyof OpportunityScoreComponents, number>;
  /** Previous final score (null on first creation) */
  previousFinal: number | null;
  /** ISO timestamp of when this score was computed */
  scoredAt: string;
}

// ── Score Weights ───────────────────────────────────────────────────────────

const SCORE_WEIGHTS: Record<keyof OpportunityScoreComponents, number> = {
  impact: 0.30,
  confidence: 0.20,
  trafficValue: 0.20,
  effort: 0.15,
  strategicValue: 0.15,
};

// ── Opportunity Mapping ─────────────────────────────────────────────────────

interface OpportunityMapping {
  category: string;
  action: string;
  /** 0–1: base impact weight for this finding type */
  impactWeight: number;
  /** 0–1: base effort (higher = easier to fix) */
  effortScore: number;
  /** 0–1: strategic SEO importance */
  strategicValueScore: number;
}

const FINDING_TYPE_MAPPINGS: Record<string, OpportunityMapping> = {
  QUICK_WIN:                   { category: "QUICK_WIN", action: "OPTIMIZE_TITLE", impactWeight: 0.9, effortScore: 0.9, strategicValueScore: 0.85 },
  LOW_CTR:                     { category: "QUICK_WIN", action: "OPTIMIZE_TITLE", impactWeight: 0.8, effortScore: 0.85, strategicValueScore: 0.8 },
  DECLINING_QUERY:             { category: "DECLINING", action: "REFRESH_CONTENT", impactWeight: 0.85, effortScore: 0.5, strategicValueScore: 0.8 },
  EMERGING_QUERY:              { category: "ALMOST_RANKING", action: "IMPROVE_SEARCH_INTENT", impactWeight: 0.75, effortScore: 0.6, strategicValueScore: 0.7 },
  HIGH_TRAFFIC_LOW_CONVERSION: { category: "QUICK_WIN", action: "IMPROVE_SEARCH_INTENT", impactWeight: 0.9, effortScore: 0.5, strategicValueScore: 0.95 },
  BROKEN_LINK:                 { category: "DEAD_WEIGHT", action: "DEINDEX_OR_REDIRECT", impactWeight: 0.6, effortScore: 0.95, strategicValueScore: 0.5 },
  THIN_CONTENT:                { category: "STALE", action: "OPTIMIZE_CONTENT_DEPTH", impactWeight: 0.7, effortScore: 0.4, strategicValueScore: 0.65 },
  MISSING_META_DESCRIPTION:    { category: "QUICK_WIN", action: "OPTIMIZE_TITLE", impactWeight: 0.5, effortScore: 0.95, strategicValueScore: 0.5 },
  ORPHAN_PAGE:                 { category: "ORPHANED", action: "BUILD_INTERNAL_LINKS", impactWeight: 0.8, effortScore: 0.7, strategicValueScore: 0.7 },
  CANNIBALIZATION_RISK:        { category: "CANNIBALIZATION", action: "CONSOLIDATE_CONTENT", impactWeight: 0.85, effortScore: 0.35, strategicValueScore: 0.8 },
  INTENT_MISMATCH:             { category: "QUICK_WIN", action: "IMPROVE_SEARCH_INTENT", impactWeight: 0.8, effortScore: 0.5, strategicValueScore: 0.75 },
  TOPIC_OPPORTUNITY:           { category: "ALMOST_RANKING", action: "CREATE_NEW_CONTENT", impactWeight: 0.7, effortScore: 0.3, strategicValueScore: 0.7 },
  MISSING_TITLE:               { category: "QUICK_WIN", action: "OPTIMIZE_TITLE", impactWeight: 0.7, effortScore: 0.95, strategicValueScore: 0.6 },
  MISSING_H1:                  { category: "QUICK_WIN", action: "OPTIMIZE_TITLE", impactWeight: 0.5, effortScore: 0.95, strategicValueScore: 0.5 },
  NOINDEX_PAGE:                { category: "DEAD_WEIGHT", action: "DEINDEX_OR_REDIRECT", impactWeight: 0.6, effortScore: 0.9, strategicValueScore: 0.5 },
  INDEXATION_CONFLICT:         { category: "DEAD_WEIGHT", action: "DEINDEX_OR_REDIRECT", impactWeight: 0.75, effortScore: 0.8, strategicValueScore: 0.6 },
};

const DEFAULT_MAPPING: OpportunityMapping = {
  category: "QUICK_WIN",
  action: "REFRESH_CONTENT",
  impactWeight: 0.5,
  effortScore: 0.5,
  strategicValueScore: 0.5,
};

// ── Severity to Impact Multiplier ───────────────────────────────────────────

const SEVERITY_MULTIPLIER: Record<string, number> = {
  CRITICAL: 1.0,
  HIGH: 0.85,
  MEDIUM: 0.65,
  LOW: 0.45,
  INFO: 0.25,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a stable fingerprint for an opportunity.
 * Same concept as finding fingerprint — deterministic hash for deduplication.
 */
export function createOpportunityFingerprint(input: {
  siteId: string;
  category: string;
  resourceType?: string;
  resourceId?: string;
  action: string;
}): string {
  const canonical = [
    input.siteId,
    input.category,
    input.resourceType ?? "",
    input.resourceId ?? "",
    input.action,
  ].join(":");

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Compute a bounded, explainable opportunity score.
 * All components are 0–1. Final score is 0–100.
 */
function computeScore(
  finding: AgentFinding,
  mapping: OpportunityMapping,
): OpportunityScoreComponents {
  const severityMultiplier = SEVERITY_MULTIPLIER[finding.severity] ?? 0.5;

  return {
    impact: Math.min(1, mapping.impactWeight * severityMultiplier * 1.2),
    confidence: finding.confidence ?? 0.5,
    trafficValue: estimateTrafficValue(finding),
    effort: mapping.effortScore,
    strategicValue: mapping.strategicValueScore,
  };
}

/**
 * Estimate traffic value from finding evidence (0–1 normalized).
 * Uses impressions/clicks evidence if available, otherwise defaults to 0.5.
 */
function estimateTrafficValue(finding: AgentFinding): number {
  for (const ev of finding.evidence) {
    if (ev.metric === "impressions" && ev.value) {
      const impressions = parseInt(ev.value, 10);
      if (!isNaN(impressions)) {
        // Log-normalize: 0 impressions → 0, 100 → 0.5, 10000 → 0.9, 100000 → 1.0
        return Math.min(1, Math.log10(Math.max(1, impressions)) / 5);
      }
    }
    if (ev.metric === "sessions" && ev.value) {
      const sessions = parseInt(ev.value, 10);
      if (!isNaN(sessions)) {
        return Math.min(1, Math.log10(Math.max(1, sessions)) / 4);
      }
    }
  }
  return 0.5; // Default for findings without traffic evidence
}

/**
 * Compute weighted aggregate score (0–100) from components.
 */
function aggregateScore(components: OpportunityScoreComponents): number {
  let total = 0;
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS) as [keyof OpportunityScoreComponents, number][]) {
    total += (components[key] ?? 0) * weight;
  }
  return Math.round(total * 100);
}

/**
 * Transforms findings into persisted GrowthDecision records linked via OpportunityFinding.
 */
export async function generateOpportunitiesFromFindings(
  siteId: string,
  findings: AgentFinding[],
): Promise<number> {
  if (findings.length === 0) return 0;

  logger.info("[OpportunityEngine] Generating opportunities from findings", {
    siteId,
    findingCount: findings.length,
  });

  // Query DB finding IDs by fingerprint for this site to link them via OpportunityFinding
  const fingerprints = findings.map((f) => f.fingerprint).filter(Boolean) as string[];
  const dbFindings = await prisma.agentFinding.findMany({
    where: {
      fingerprint: { in: fingerprints },
      agentRun: { siteId },
      status: { in: ["OPEN", "REOPENED"] },
    },
    select: { id: true, fingerprint: true, resourceId: true, type: true },
  });

  const findingDbIdMap = new Map<string, string>();
  for (const dbf of dbFindings) {
    findingDbIdMap.set(dbf.fingerprint, dbf.id);
  }

  let createdCount = 0;

  for (const finding of findings) {
    const mapping = FINDING_TYPE_MAPPINGS[finding.type] || DEFAULT_MAPPING;
    const resourceType = finding.affectedResource?.type ?? "SITE";
    const resourceId = finding.affectedResource?.id ?? "site-level";
    const url = resourceId.startsWith("http") ? resourceId : `https://${resourceId}`;
    const primaryKeyword = finding.title.slice(0, 100);

    // Compute stable fingerprint for this opportunity
    const opFingerprint = createOpportunityFingerprint({
      siteId,
      category: mapping.category,
      resourceType,
      resourceId,
      action: mapping.action,
    });

    // Compute bounded, explainable score
    const components = computeScore(finding, mapping);
    const finalScore = aggregateScore(components);

    // Check for existing opportunity to preserve previousFinal
    const existing = await prisma.growthDecision.findFirst({
      where: { siteId, fingerprint: opFingerprint },
      select: { id: true, score: true },
    });

    const previousFinal = existing
      ? ((existing.score as Record<string, unknown>)?.final as number ?? null)
      : null;

    const scorePayload: OpportunityScore = {
      final: finalScore,
      components,
      weights: SCORE_WEIGHTS,
      previousFinal,
      scoredAt: new Date().toISOString(),
    };

    const decisionData = {
      siteId,
      url,
      primaryKeyword,
      primaryCategory: mapping.category,
      opportunityCategories: [mapping.category],
      action: mapping.action,
      fingerprint: opFingerprint,
      score: scorePayload as object,
      whyNow: {
        signals: [
          {
            signal: "AGENT_FINDING",
            severity: finding.severity,
            evidence: finding.description.slice(0, 500),
          },
        ],
        urgency: finding.severity === "CRITICAL" ? "CRITICAL" : finding.severity === "HIGH" ? "HIGH" : "MEDIUM",
      },
      impact: {
        trafficPotential: {
          low: Math.round(finalScore * 0.5),
          expected: Math.round(finalScore * 2),
          high: Math.round(finalScore * 5),
          confidence: finding.confidence,
        },
      },
      executionPlan: [
        { step: 1, action: finding.title, expectedOutcome: "Improve search performance" },
      ],
      status: "ACTIVE",
    };

    try {
      // Prefer fingerprint-based upsert, fall back to composite unique
      const decision = existing
        ? await prisma.growthDecision.update({
            where: { id: existing.id },
            data: {
              score: scorePayload as object,
              whyNow: decisionData.whyNow,
              updatedAt: new Date(),
            },
          })
        : await prisma.growthDecision.upsert({
            where: {
              siteId_url_primaryKeyword_action: {
                siteId,
                url,
                primaryKeyword,
                action: mapping.action,
              },
            },
            update: {
              score: scorePayload as object,
              whyNow: decisionData.whyNow,
              fingerprint: opFingerprint,
              updatedAt: new Date(),
            },
            create: decisionData,
          });

      // Link with AgentFinding if we have the DB finding ID
      const dbFindingId = finding.fingerprint ? findingDbIdMap.get(finding.fingerprint) : null;
      if (dbFindingId) {
        await prisma.opportunityFinding.upsert({
          where: {
            decisionId_findingId: {
              decisionId: decision.id,
              findingId: dbFindingId,
            },
          },
          update: {},
          create: {
            decisionId: decision.id,
            findingId: dbFindingId,
          },
        });
      }

      createdCount++;
    } catch (err: unknown) {
      logger.warn("[OpportunityEngine] Failed to save decision for finding", {
        findingType: finding.type,
        error: (err as Error)?.message,
      });
    }
  }

  logger.info("[OpportunityEngine] Generated opportunities from findings", {
    siteId,
    createdCount,
  });

  return createdCount;
}
