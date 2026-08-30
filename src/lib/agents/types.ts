// =============================================================================
// AGENT CONTRACT — Shared Types for the Agentic SEO Operating System
//
// Every agent speaks this language.
//
// Key distinction:
//   AgentExecution<T>  — what an agent function returns (pure domain output)
//   AgentResult<T>     — what the runner wraps it into (includes lifecycle metadata)
//
// The runner determines the final status. Agents never call Prisma or Inngest.
// =============================================================================

// ── Classification ──────────────────────────────────────────────────────────

export type AgentTier = "DATA" | "ANALYSIS" | "AI_REASONING";

export type AgentStatus = "COMPLETED" | "PARTIAL" | "FAILED";

// ── Severity & Resource Typing ──────────────────────────────────────────────

export type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type FindingResourceType = "SITE" | "PAGE" | "QUERY" | "KEYWORD";

// ── Error Contract ──────────────────────────────────────────────────────────

export interface AgentError {
  code: string;
  message: string;
  recoverable: boolean;
}

// ── Evidence ────────────────────────────────────────────────────────────────

export type EvidenceSourceType =
  | "GSC"
  | "GA4"
  | "CRAWL"
  | "SITEMAP"
  | "ROBOTS"
  | "COMPUTED";

export interface Evidence {
  sourceType: EvidenceSourceType;

  /** Composite key for provenance, e.g. crawlRunId, query/page/date */
  sourceId?: string;

  /** Metric name, e.g. "position", "httpStatus", "ctr" */
  metric?: string;

  /** String representation of the value */
  value?: string;

  /** Structured data for complex evidence (maps to JSON column) */
  metadata?: Record<string, unknown>;

  /** ISO timestamp of when this observation was made */
  observedAt?: Date | string;
}

// ── Finding ─────────────────────────────────────────────────────────────────

export interface AgentFinding {
  /** Finding type identifier, e.g. "MISSING_META_DESCRIPTION" */
  type: string;

  severity: FindingSeverity;

  title: string;
  description: string;

  evidence: Evidence[];

  recommendation?: string;

  /** Confidence score: 0.0–1.0 */
  confidence: number;

  affectedResource?: {
    type: FindingResourceType;
    id: string;
  };

  /**
   * Stable identity for the underlying issue.
   * sha256(siteId:type:resourceType:resourceId)
   *
   * The same underlying problem produces the same fingerprint across runs,
   * enabling lifecycle tracking (OPEN → RESOLVED → REOPENED).
   */
  fingerprint?: string;
}

// ── Agent Execution (what agents return) ────────────────────────────────────

/**
 * Pure domain output from an agent function.
 *
 * The agent produces data, findings, and optionally reports errors.
 * The runner determines the final AgentStatus from the error array.
 */
export interface AgentExecution<T> {
  data: T;
  findings: AgentFinding[];

  /** Recoverable or non-recoverable errors encountered during execution */
  errors?: AgentError[];

  /** Number of items the agent processed (pages crawled, queries analyzed, etc.) */
  itemsProcessed?: number;

  /** LLM token usage (only for AI_REASONING agents) */
  tokensUsed?: number;

  /** Estimated cost in USD (only for AI_REASONING agents) */
  estimatedCostUsd?: number;
}

// ── Agent Result (what the runner wraps it into) ────────────────────────────

/**
 * Full lifecycle result including runner-computed metadata.
 *
 * Status derivation:
 *   - errors.length === 0                     → COMPLETED
 *   - errors.some(e => e.recoverable)         → PARTIAL
 *   - thrown exception / all errors non-recoverable → FAILED
 */
export interface AgentResult<T> {
  agent: string;
  runId: string;

  status: AgentStatus;

  data: T;
  findings: AgentFinding[];

  metrics: {
    durationMs: number;
    itemsProcessed: number;
    tokensUsed?: number;
    estimatedCostUsd?: number;
  };

  errors: AgentError[];
}
