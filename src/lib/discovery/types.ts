

import type { OpportunityCategory, GrowthAction } from "@/lib/opportunity-engine/types";

// ── Discovery Sources ───────────────────────────────────────────────────────

/** Each source has its own cadence, freshness policy, and detector */
export type DiscoverySource =
  | "GSC"
  | "CRAWL"
  | "AUDIT"
  | "COMPETITOR"
  | "CONTENT"
  | "PERFORMANCE";

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
  confidence: number;           // 0.0-1.0: probability the observed condition EXISTS. This is NOT an impact score.
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
