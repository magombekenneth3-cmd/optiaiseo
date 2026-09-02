/**
 * Phase D.1 — Discovery Types
 *
 * Core type definitions for the autonomous opportunity discovery system.
 *
 * CONFIDENCE SEMANTICS:
 *   confidence: number  // 0.0–1.0
 *   Meaning: probability that the underlying observed SEO condition EXISTS.
 *
 *   Examples:
 *     0.95 — GSC shows position 12.3 with 500 impressions (high data quality)
 *     0.70 — Audit detects thin content based on word count heuristic
 *     0.40 — Content staleness based on updatedAt alone (no GSC confirmation)
 *
 *   This is NOT:
 *     - probability this action will increase traffic (D.2 impact scoring)
 *     - priority or urgency (D.2 ranking)
 *     - expected ROI (D.7 portfolio optimization)
 */

import type { OpportunityCategory, GrowthAction } from "@/lib/opportunity-engine/types";

// ── Discovery Sources ───────────────────────────────────────────────────────

/** Each source has its own cadence, freshness policy, and detector */
export type DiscoverySource =
  | "GSC"           // Google Search Console metrics
  | "CRAWL"         // Technical crawl findings
  | "AUDIT"         // Agent audit findings
  | "COMPETITOR"    // Competitor intelligence
  | "CONTENT"       // Content quality/staleness analysis
  | "PERFORMANCE";  // GA4/Core Web Vitals

export const DISCOVERY_SOURCES: readonly DiscoverySource[] = [
  "GSC", "CRAWL", "AUDIT", "COMPETITOR", "CONTENT", "PERFORMANCE",
] as const;

// ── Freshness Policy ────────────────────────────────────────────────────────

export interface FreshnessPolicy {
  /** How long evidence remains valid after observation (days) */
  ttlDays: number;
  /** Reject evidence older than this (days) */
  maxEvidenceAgeDays: number;
  /** How often to re-run detection for this source (days) */
  refreshIntervalDays: number;
}

// ── Raw Discovery Signal ────────────────────────────────────────────────────

/** Resource type that a signal refers to */
export type DiscoveryResourceType = "PAGE" | "QUERY" | "SITE" | "KEYWORD";

/**
 * Evidence item attached to a discovery signal.
 * Maps to FindingEvidence for persistence.
 */
export interface DiscoveryEvidence {
  sourceType: string;           // "GSC" | "CRAWL" | "COMPUTED" | "CONTENT" | ...
  metric?: string;              // "position" | "httpStatus" | "ctr" | "wordCount" | ...
  value?: string;               // String representation of the metric value
  observedAt: Date;             // When this specific observation was made
  metadata?: Record<string, unknown>;
}

/**
 * Raw discovery signal — produced by source-specific detectors.
 * Before validation, deduplication, or conflict resolution.
 *
 * `suggestedAction` is explicitly "suggested" — not authoritative.
 * The final action is determined by conflict resolution (conflict-resolution.ts)
 * when multiple sources produce signals with the same fingerprint.
 */
export interface RawDiscoverySignal {
  siteId: string;
  source: DiscoverySource;
  sourceRunId: string;          // AgentRun ID that produced this signal
  fingerprint: string;          // sha256(siteId:category:resourceType:resourceId)
  category: OpportunityCategory;
  suggestedAction: GrowthAction; // Suggested — conflict resolution decides final action
  resourceType: DiscoveryResourceType;
  resourceId: string;           // URL, query text, keyword, etc.
  url?: string;
  keyword?: string;
  confidence: number;           // 0.0–1.0: probability the observed condition exists
  evidence: DiscoveryEvidence[];
  metadata?: Record<string, unknown>;
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ── Conflict Resolution ─────────────────────────────────────────────────────

export interface ResolvedSignal {
  fingerprint: string;
  siteId: string;
  category: OpportunityCategory;
  action: GrowthAction;
  resourceType: DiscoveryResourceType;
  resourceId: string;
  url?: string;
  keyword?: string;
  confidence: number;             // max across contributing sources
  mergedEvidence: DiscoveryEvidence[];
  contributingSources: DiscoverySource[];
  sourceRunIds: string[];
  metadata?: Record<string, unknown>;
}

// ── Discovery Run ───────────────────────────────────────────────────────────

export interface DiscoveryRunResult {
  siteId: string;
  source: DiscoverySource;
  agentRunId: string;
  signalsDetected: number;
  signalsValid: number;
  candidatesCreated: number;
  candidatesRefreshed: number;
  candidatesSkipped: number;
  durationMs: number;
}

// Re-export opportunity types for convenience
export type { OpportunityCategory, GrowthAction } from "@/lib/opportunity-engine/types";
