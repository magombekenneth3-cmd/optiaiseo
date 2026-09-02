/**
 * Phase D.1 — Audit Source Detector
 *
 * Converts recent AgentFinding records from audit runs into RawDiscoverySignal[].
 * Triggered by the `audit.completed` event.
 *
 * Read-only — no mutations, no proposals.
 */

import { createHash } from "node:crypto";
import type { RawDiscoverySignal, DiscoveryEvidence } from "../types";
import type { OpportunityCategory, GrowthAction } from "@/lib/opportunity-engine/types";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ── Finding Type → Opportunity Mapping ──────────────────────────────────────

interface FindingMapping {
  category: OpportunityCategory;
  action: GrowthAction;
  baseConfidence: number;
}

const FINDING_TYPE_MAP: Record<string, FindingMapping> = {
  QUICK_WIN:                   { category: "QUICK_WIN",       action: "OPTIMIZE_TITLE",          baseConfidence: 0.8 },
  LOW_CTR:                     { category: "QUICK_WIN",       action: "OPTIMIZE_TITLE",          baseConfidence: 0.75 },
  DECLINING_QUERY:             { category: "DECLINING",       action: "REFRESH_CONTENT",         baseConfidence: 0.8 },
  EMERGING_QUERY:              { category: "ALMOST_RANKING",  action: "IMPROVE_SEARCH_INTENT",   baseConfidence: 0.65 },
  HIGH_TRAFFIC_LOW_CONVERSION: { category: "QUICK_WIN",       action: "IMPROVE_SEARCH_INTENT",   baseConfidence: 0.85 },
  BROKEN_LINK:                 { category: "DEAD_WEIGHT",     action: "DEINDEX_OR_REDIRECT",     baseConfidence: 0.95 },
  THIN_CONTENT:                { category: "STALE",           action: "OPTIMIZE_CONTENT_DEPTH",  baseConfidence: 0.70 },
  MISSING_META_DESCRIPTION:    { category: "QUICK_WIN",       action: "OPTIMIZE_TITLE",          baseConfidence: 0.90 },
  ORPHAN_PAGE:                 { category: "ORPHANED",        action: "BUILD_INTERNAL_LINKS",    baseConfidence: 0.85 },
  CANNIBALIZATION_RISK:        { category: "CANNIBALIZATION", action: "CONSOLIDATE_CONTENT",     baseConfidence: 0.70 },
  INTENT_MISMATCH:             { category: "QUICK_WIN",       action: "IMPROVE_SEARCH_INTENT",   baseConfidence: 0.65 },
};

// ── Severity → Confidence Multiplier ────────────────────────────────────────

const SEVERITY_MULTIPLIER: Record<string, number> = {
  CRITICAL: 1.0,
  HIGH:     0.95,
  MEDIUM:   0.85,
  LOW:      0.75,
};

// ── Fingerprint ─────────────────────────────────────────────────────────────

function createFingerprint(siteId: string, category: string, resourceType: string, resourceId: string): string {
  const canonical = [siteId, category, resourceType, resourceId].join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Detects discovery signals from recent AgentFinding records.
 *
 * Reads OPEN findings from audit runs. Each finding with a known type
 * is converted into a RawDiscoverySignal.
 */
export async function detectAuditSignals(
  siteId: string,
  sourceRunId: string,
  options?: { since?: Date }
): Promise<RawDiscoverySignal[]> {
  logger.info("[AuditDetector] Starting audit detection", { siteId });

  const since = options?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default: 30 days

  // Query recent audit findings for this site
  const findings = await (prisma as any).agentFinding.findMany({
    where: {
      agentRun: { siteId },
      status: "OPEN",
      createdAt: { gte: since },
    },
    include: {
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
    orderBy: { createdAt: "desc" },
    take: 200, // Cap to prevent runaway queries
  });

  const signals: RawDiscoverySignal[] = [];

  for (const finding of findings) {
    const mapping = FINDING_TYPE_MAP[finding.type];
    if (!mapping) continue; // Unknown finding type — skip

    const resourceType = finding.resourceType ?? "PAGE";
    const resourceId = finding.resourceId ?? "";

    if (!resourceId) continue; // No resource — skip

    // Compute confidence: base * severity * finding.confidence
    const severityMult = SEVERITY_MULTIPLIER[finding.severity] ?? 0.75;
    const confidence = Math.min(
      mapping.baseConfidence * severityMult * (finding.confidence ?? 0.5),
      1.0
    );

    // Convert finding evidence to discovery evidence
    const evidence: DiscoveryEvidence[] = (finding.evidence ?? []).map((e: any) => ({
      sourceType: e.sourceType ?? "AUDIT",
      metric: e.metric,
      value: e.value,
      observedAt: new Date(e.observedAt),
      metadata: e.metadata,
    }));

    // Always include the finding description as evidence
    evidence.push({
      sourceType: "AUDIT",
      metric: "findingDescription",
      value: finding.description,
      observedAt: new Date(finding.createdAt),
    });

    signals.push({
      siteId,
      source: "AUDIT",
      sourceRunId,
      fingerprint: createFingerprint(siteId, mapping.category, resourceType, resourceId),
      category: mapping.category,
      suggestedAction: mapping.action,
      resourceType: resourceType as "PAGE" | "QUERY" | "SITE" | "KEYWORD",
      resourceId,
      url: resourceType === "PAGE" ? resourceId : undefined,
      keyword: resourceType === "QUERY" || resourceType === "KEYWORD" ? resourceId : undefined,
      confidence,
      evidence,
      metadata: {
        findingId: finding.id,
        findingType: finding.type,
        severity: finding.severity,
        title: finding.title,
      },
    });
  }

  logger.info("[AuditDetector] Detection complete", {
    siteId,
    findingsProcessed: findings.length,
    signalsProduced: signals.length,
  });

  return signals;
}
