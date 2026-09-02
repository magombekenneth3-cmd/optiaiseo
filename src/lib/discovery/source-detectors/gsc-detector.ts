/**
 * Phase D.1 — GSC Source Detector
 *
 * Wraps the existing opportunity-engine/detector.ts and evidence.ts
 * to produce RawDiscoverySignal[] from Google Search Console data.
 *
 * This detector is triggered by the `gsc.sync.completed` event.
 * It is read-only — no mutations, no proposals.
 */

import { createHash } from "node:crypto";
import type { RawDiscoverySignal, DiscoveryEvidence } from "../types";
import type { RawOpportunitySignal, GrowthAction } from "@/lib/opportunity-engine/types";
import { fetchGscEvidence } from "@/lib/opportunity-engine/evidence";
import { detectRawOpportunities } from "@/lib/opportunity-engine/detector";
import { logger } from "@/lib/logger";

// ── Category → Action Mapping ───────────────────────────────────────────────

const CATEGORY_ACTION_MAP: Record<string, GrowthAction> = {
  DECLINING:       "REFRESH_CONTENT",
  QUICK_WIN:       "OPTIMIZE_TITLE",
  ALMOST_RANKING:  "IMPROVE_SEARCH_INTENT",
  STALE:           "REFRESH_CONTENT",
  CANNIBALIZATION: "CONSOLIDATE_CONTENT",
  ORPHANED:        "BUILD_INTERNAL_LINKS",
  DEAD_WEIGHT:     "DEINDEX_OR_REDIRECT",
};

// ── Confidence Assignment ───────────────────────────────────────────────────

/**
 * Assigns confidence based on GSC data quality signals.
 * Confidence = probability the observed SEO condition EXISTS.
 */
function computeGscConfidence(signal: RawOpportunitySignal): number {
  let confidence = 0.5; // Base: we have some signal

  // High impressions = high data reliability
  if (signal.impressions >= 500) confidence += 0.25;
  else if (signal.impressions >= 100) confidence += 0.15;
  else if (signal.impressions >= 30) confidence += 0.05;

  // Position data from GSC is very reliable
  if (signal.position > 0) confidence += 0.1;

  // Previous position available → trend is confirmed
  if (signal.previousPosition !== undefined) confidence += 0.1;

  return Math.min(confidence, 1.0);
}

// ── Fingerprint ─────────────────────────────────────────────────────────────

function createFingerprint(siteId: string, category: string, resourceType: string, resourceId: string): string {
  const canonical = [siteId, category, resourceType, resourceId].join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Runs GSC-based opportunity detection for a site.
 * Returns raw discovery signals — NOT validated or deduplicated yet.
 */
export async function detectGscSignals(
  siteId: string,
  sourceRunId: string,
  options?: { since?: Date }
): Promise<RawDiscoverySignal[]> {
  logger.info("[GscDetector] Starting GSC detection", { siteId });

  // 1. Fetch evidence from GSC (existing infrastructure)
  const gscMetrics = await fetchGscEvidence(siteId);

  if (gscMetrics.length === 0) {
    logger.info("[GscDetector] No GSC metrics available", { siteId });
    return [];
  }

  // 2. Detect raw opportunities (existing infrastructure)
  const rawSignals = await detectRawOpportunities(siteId, gscMetrics, {
    modifiedSince: options?.since,
  });

  // 3. Convert to discovery signals
  const now = new Date();
  const discoverySignals: RawDiscoverySignal[] = rawSignals.map((raw) => ({
    siteId,
    source: "GSC" as const,
    sourceRunId,
    fingerprint: createFingerprint(siteId, raw.category, "PAGE", raw.url),
    category: raw.category,
    suggestedAction: CATEGORY_ACTION_MAP[raw.category] ?? "MONITOR",
    resourceType: "PAGE" as const,
    resourceId: raw.url,
    url: raw.url,
    keyword: raw.keyword,
    confidence: computeGscConfidence(raw),
    evidence: buildGscEvidence(raw, now),
    metadata: {
      impressions: raw.impressions,
      clicks: raw.clicks,
      position: raw.position,
      previousPosition: raw.previousPosition,
      inboundInternalLinksCount: raw.inboundInternalLinksCount,
    },
  }));

  logger.info("[GscDetector] Detection complete", {
    siteId,
    gscMetrics: gscMetrics.length,
    rawSignals: rawSignals.length,
    discoverySignals: discoverySignals.length,
  });

  return discoverySignals;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildGscEvidence(raw: RawOpportunitySignal, observedAt: Date): DiscoveryEvidence[] {
  const evidence: DiscoveryEvidence[] = [];

  if (raw.position > 0) {
    evidence.push({
      sourceType: "GSC",
      metric: "position",
      value: String(raw.position),
      observedAt,
    });
  }

  if (raw.impressions > 0) {
    evidence.push({
      sourceType: "GSC",
      metric: "impressions",
      value: String(raw.impressions),
      observedAt,
    });
  }

  if (raw.clicks > 0) {
    evidence.push({
      sourceType: "GSC",
      metric: "clicks",
      value: String(raw.clicks),
      observedAt,
    });
  }

  if (raw.previousPosition !== undefined) {
    evidence.push({
      sourceType: "GSC",
      metric: "previousPosition",
      value: String(raw.previousPosition),
      observedAt,
    });
  }

  // Always include the evidence text from the detector
  evidence.push({
    sourceType: "COMPUTED",
    metric: "evidenceText",
    value: raw.evidenceText,
    observedAt,
  });

  return evidence;
}
