import { createHash } from "crypto";

// ── Optimization Domains ─────────────────────────────────────────────────────
//
// SEO, AEO, AIO, and GEO are different evidence/diagnostic domains feeding
// the same remediation lifecycle — not separate fix engines.

export type OptimizationDomain =
  | "TECHNICAL"
  | "CONTENT"
  | "ENTITY"
  | "SCHEMA"
  | "LINKS"
  | "AEO"
  | "AIO"
  | "GEO";

// ── Evidence Confidence Semantics ────────────────────────────────────────────

export type EvidenceConfidenceKind =
  | "DIRECTLY_OBSERVED"
  | "DERIVED"
  | "INFERRED"
  | "UNAVAILABLE";

export const CONFIDENCE_BY_KIND: Record<EvidenceConfidenceKind, number> = {
  DIRECTLY_OBSERVED: 1.0,
  DERIVED: 0.75,
  INFERRED: 0.5,
  UNAVAILABLE: 0.0,
};

// ── Canonical Observation Types ──────────────────────────────────────────────

export interface HtmlObservation {
  metaRobots: string | null;
  canonicalHref: string | null;
  canonicalIsSelf: boolean | null;
  hasQaContent: boolean;
  jsonldCount: number;
  microdataPresent: boolean;
  hasOrganization: boolean;
  hasFaq: boolean;
  hasBreadcrumb: boolean;
  schemaTypes: string[];
  schemaErrors: string[];
}

export interface HttpObservation {
  status: number;
  xRobotsTag: string | null;
  redirectCount: number;
  redirectLoop: boolean;
  protocol: "http" | "https";
  finalUrl: string;
}

export interface RobotsObservation {
  exists: boolean;
  disallowed: boolean;
  disallowsRoot: boolean;
  blocksGooglebot: boolean;
  hasSitemapDirective: boolean;
  content: string | null;
}

export interface SitemapObservation {
  exists: boolean;
  validXml: boolean;
  urlCount: number;
  containsUrl: boolean | null;
  url: string | null;
}

export interface SchemaObservation {
  jsonldCount: number;
  microdataPresent: boolean;
  hasOrganization: boolean;
  hasFaq: boolean;
  hasBreadcrumb: boolean;
  types: string[];
  errors: string[];
}

export interface GscObservation {
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number | null;
  indexingState: "INDEXED" | "NOT_INDEXED" | "UNKNOWN";
  url: string;
  querySet: string[];
  measurementWindow: { start: string; end: string };
}

// ── Canonical Observation Container ─────────────────────────────────────────

export type CanonicalObservationSource =
  | "HTML"
  | "HTTP_HEADERS"
  | "ROBOTS"
  | "SITEMAP"
  | "GSC"
  | "GA4"
  | "CRUX"
  | "LINK_GRAPH"
  | "SCHEMA"
  | "DNS"
  | "RECONCILIATION"
  | "AI_CITATION"
  | "AI_VISIBILITY"
  | "COMPETITOR";

export interface CanonicalObservation {
  source: CanonicalObservationSource;
  url: string;
  observedAt: string;
  confidenceKind: EvidenceConfidenceKind;
  confidence: number;
  data:
    | HtmlObservation
    | HttpObservation
    | RobotsObservation
    | SitemapObservation
    | SchemaObservation
    | GscObservation
    | Record<string, unknown>;
}

// ── Canonical Evidence ───────────────────────────────────────────────────────

export interface SEOEvidence {
  source: CanonicalObservationSource;
  url: string | undefined;
  observedAt: string;
  observedValue: unknown;
  expectedValue?: unknown;
  httpStatus?: number;
  confidence: number;
  confidenceKind: EvidenceConfidenceKind;
  evidenceHash: string;

  // ── AI Evidence Provenance (optional — populated for AI_CITATION / AI_VISIBILITY) ──
  /** AI provider that generated the response (e.g. "gemini", "chatgpt", "perplexity") */
  aiProvider?: string;
  /** Model identifier (e.g. "gemini-2.5-flash", "gpt-4o") */
  aiModel?: string;
  /** Model version or checkpoint */
  aiModelVersion?: string;
  /** Prompt template version used for the query */
  aiPromptVersion?: string;
  /** The query sent to the AI */
  aiQuery?: string;
  /** Unique sample identifier for deduplication */
  aiSampleId?: string;
  /** Whether the response used live web grounding */
  aiGroundingUsed?: boolean;
  /** URLs the AI cited as grounding sources */
  aiGroundingSources?: string[];
}

export function computeEvidenceHash(
  evidence: Pick<SEOEvidence, "source" | "url" | "observedValue">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        source: evidence.source,
        url: evidence.url,
        observedValue: evidence.observedValue,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export function createEvidence(
  evidence: Omit<SEOEvidence, "evidenceHash">,
): SEOEvidence {
  const confidence = Math.max(0, Math.min(1, evidence.confidence));
  return {
    ...evidence,
    confidence,
    evidenceHash: computeEvidenceHash({
      source: evidence.source,
      url: evidence.url,
      observedValue: evidence.observedValue,
    }),
  };
}

export function createUnavailableEvidence(
  source: CanonicalObservationSource,
  url: string,
  reason: string,
): SEOEvidence {
  return createEvidence({
    source,
    url,
    observedAt: new Date().toISOString(),
    observedValue: { unavailable: true, reason },
    confidence: CONFIDENCE_BY_KIND.UNAVAILABLE,
    confidenceKind: "UNAVAILABLE",
  });
}

// ── Finding Status ───────────────────────────────────────────────────────────

export type DiagnosticStatus =
  | "PASS"
  | "FAIL"
  | "WARNING"
  | "UNKNOWN"
  | "NOT_APPLICABLE"
  | "BLOCKED";

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type FindingScope = {
  type: "SITE" | "PAGE" | "URL_PATTERN";
  urls: string[];
  pattern?: string;
  affectedCount?: number;
};

export type RemediationType =
  | "DETERMINISTIC"
  | "AI_PATCH"
  | "MANUAL"
  | "EXPERIMENT";

// ── Fix Risk ─────────────────────────────────────────────────────────────────
//
// Controls execution policy, not just display.
//   SAFE / LOW   → may auto-generate and auto-PR
//   MEDIUM       → requires explicit approval before PR
//   HIGH         → requires explicit approval, human review
//   CRITICAL     → manual workflow only, never auto-applied

export type FixRisk =
  | "SAFE"
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

/** Whether a given risk level requires human approval before execution */
export function fixRiskRequiresApproval(risk: FixRisk): boolean {
  return risk === "MEDIUM" || risk === "HIGH" || risk === "CRITICAL";
}

/** Whether a given risk level forbids automated execution entirely */
export function fixRiskIsManualOnly(risk: FixRisk): boolean {
  return risk === "CRITICAL";
}

// ── Evidence Requirements ────────────────────────────────────────────────────
//
// Per-remediation evidence gates. Remediation eligibility depends on the
// evidence requirements of that specific remediation — not simply the
// highest-confidence evidence in the finding.
//
// Example: removing noindex requires DIRECTLY_OBSERVED evidence from both
// HTML and HTTP_HEADERS. A meta description fix only needs HTML.

export interface EvidenceRequirement {
  /** Which evidence source must be present */
  source: CanonicalObservationSource;
  /** Minimum confidence kind required */
  minimumConfidence: EvidenceConfidenceKind;
}

/** Check whether collected evidence satisfies a set of requirements */
export function evidenceSatisfiesRequirements(
  evidence: SEOEvidence[],
  requirements: EvidenceRequirement[],
): { satisfied: boolean; missing: EvidenceRequirement[] } {
  const missing: EvidenceRequirement[] = [];
  for (const req of requirements) {
    const matching = evidence.filter(e => e.source === req.source);
    if (matching.length === 0) {
      missing.push(req);
      continue;
    }
    const meetsConfidence = matching.some(
      e => CONFIDENCE_BY_KIND[e.confidenceKind] >= CONFIDENCE_BY_KIND[req.minimumConfidence],
    );
    if (!meetsConfidence) {
      missing.push(req);
    }
  }
  return { satisfied: missing.length === 0, missing };
}

// ── Evidence Quality Gates ───────────────────────────────────────────────────
//
// What remediation actions are allowed given the best available evidence?
//
//   DIRECTLY_OBSERVED → all types allowed (we saw it in the page/headers)
//   DERIVED           → AI patches OK, but not deterministic rewrites
//   INFERRED          → only experiments and manual review
//   UNAVAILABLE       → NEVER auto-fix — evidence doesn't exist
//
// Enforcement: remediation-planner.ts checks these gates before scheduling.

/** Ordinal ranking for evidence confidence comparison */
export const CONFIDENCE_RANK: Record<EvidenceConfidenceKind, number> = {
  DIRECTLY_OBSERVED: 4,
  DERIVED:           3,
  INFERRED:          2,
  UNAVAILABLE:       1,
};

/** Maps evidence confidence to the set of remediation types it permits */
export const EVIDENCE_QUALITY_GATES: Record<EvidenceConfidenceKind, readonly RemediationType[]> = {
  DIRECTLY_OBSERVED: ["DETERMINISTIC", "AI_PATCH", "MANUAL", "EXPERIMENT"] as const,
  DERIVED:           ["AI_PATCH", "MANUAL", "EXPERIMENT"] as const,
  INFERRED:          ["EXPERIMENT", "MANUAL"] as const,
  UNAVAILABLE:       [] as const,   // NEVER auto-fix on UNAVAILABLE evidence
};

/**
 * Find the best (highest-rank) evidence confidence across a set of evidence.
 * Returns UNAVAILABLE if no evidence is provided.
 */
export function bestEvidenceConfidence(
  evidence: SEOEvidence[],
): EvidenceConfidenceKind {
  if (evidence.length === 0) return "UNAVAILABLE";
  return evidence.reduce<EvidenceConfidenceKind>(
    (best, e) =>
      CONFIDENCE_RANK[e.confidenceKind] > CONFIDENCE_RANK[best]
        ? e.confidenceKind
        : best,
    "UNAVAILABLE",
  );
}

/**
 * Check whether a remediation type is allowed given the best evidence.
 * If not allowed, returns the highest-privilege allowed type (or null if none).
 */
export function gateRemediationType(
  intended: RemediationType,
  evidence: SEOEvidence[],
): { allowed: boolean; effectiveType: RemediationType | null; reason?: string } {
  const bestConfidence = bestEvidenceConfidence(evidence);
  const allowed = EVIDENCE_QUALITY_GATES[bestConfidence];

  if (allowed.includes(intended)) {
    return { allowed: true, effectiveType: intended };
  }

  const fallback = allowed.length > 0 ? allowed[0] : null;
  return {
    allowed: false,
    effectiveType: fallback,
    reason: `Evidence confidence is ${bestConfidence} — ${intended} requires higher confidence. Downgraded to ${fallback ?? "NONE (manual review only)"}.`,
  };
}

// ── AI Patch Result ──────────────────────────────────────────────────────────
//
// Constrained output contract for AI-generated patches.
// The AEO fix engine (and any future AI patch generators) must return this
// instead of raw full-file strings. This enables:
//   1. Diff-based review (not full-file replacement)
//   2. Blast-radius analysis via the mutation risk engine
//   3. Routing through the remediation planner

export interface AiPatchResult {
  /** Fingerprint of the diagnostic finding this patch addresses */
  findingFingerprint: string;
  /** Git commit SHA the patch was generated against (if available) */
  baseCommitSha?: string;
  /** Target file path (relative to project root) */
  filePath: string;
  /** Unified diff or minimal insertion — NOT an entire file */
  patch: string;
  /** Human-readable explanation of what this patch does and why */
  rationale: string;
  /** Risk classification for this specific patch */
  risk: FixRisk;
  /** How to verify the patch was applied correctly */
  verification: VerificationCriterion[];
  /** AI model and version that generated this patch */
  aiModel?: string;
  /** Domain this patch addresses */
  domain: OptimizationDomain;
}

// ── Verification Contract ────────────────────────────────────────────────────

export type VerificationCriterion =
  | {
      type: "HTML_SELECTOR";
      selector: string;
      expected: unknown;
      url?: string;
    }
  | {
      type: "HTTP_STATUS";
      expected: number | number[];
      url?: string;
    }
  | {
      type: "XML_VALID";
      expected: boolean;
      url?: string;
    }
  | {
      type: "URL_PRESENT";
      url: string;
      expected: boolean;
    }
  | {
      type: "ROBOTS_ALLOWED";
      userAgent?: string;
      expected: boolean;
      url?: string;
    }
  | {
      type: "HEADER_VALUE";
      headerName: string;
      expected: unknown;
      url?: string;
    }
  | {
      type: "SCHEMA_PRESENT";
      expected: boolean;
      url?: string;
    }
  | {
      type: "GSC_INDEXED";
      url: string;
      expected: boolean;
    };

// ── T+7 Verification Outcome ─────────────────────────────────────────────────

export type SearchVerificationOutcome =
  | "SEARCH_VERIFIED"
  | "NO_MEASURABLE_CHANGE"
  | "INEFFECTIVE"
  | "REGRESSED"
  | "UNKNOWN"
  | "INSUFFICIENT_DATA";

export interface T7VerificationRecord {
  findingId: string;
  findingFingerprint: string;
  url: string;
  querySet: string[];
  indexingState: "INDEXED" | "NOT_INDEXED" | "UNKNOWN";
  baselineImpressions: number;
  postChangeImpressions: number;
  baselineClicks: number;
  postChangeClicks: number;
  baselineCtr: number;
  postChangeCtr: number;
  baselinePosition: number | null;
  postChangePosition: number | null;
  measurementWindow: { start: string; end: string };
  outcome: SearchVerificationOutcome;
  measuredAt: string;
}

// ── Outcome Attribution (T+28) ───────────────────────────────────────────────

export type OutcomeAttribution =
  | "OUTCOME_MEASURED"
  | "NO_MEASURABLE_CHANGE"
  | "REGRESSED"
  | "INSUFFICIENT_DATA";

export interface T28OutcomeRecord {
  findingId: string;
  findingFingerprint: string;
  actionId: string | null;
  deployedAt: string | null;
  t0Outcome: string | null;
  t7Outcome: SearchVerificationOutcome | null;
  t28Outcome: OutcomeAttribution;
  trafficBefore: number | null;
  trafficAfter: number | null;
  rankBefore: number | null;
  rankAfter: number | null;
  impactScore: number | null;
  measuredAt: string;
}

// ── Canonical SeoFinding ─────────────────────────────────────────────────────

export interface SeoFinding {
  /** Optimization domain this finding belongs to */
  domain: OptimizationDomain;
  fingerprint: string;
  issueType: string;
  rootCauseId: string;
  rootCause: string;
  status: DiagnosticStatus;
  severity: FindingSeverity;
  scope: FindingScope;
  evidence: SEOEvidence[];
  confidence: number;
  expectedOutcome: string;
  remediationType: RemediationType;
  verificationCriteria: VerificationCriterion[];
  dependencyFingerprints: string[];
  priority?: ExplainablePriority;
}

export interface PersistedSeoFinding extends SeoFinding {
  dbId: string;
  siteId: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

// ── Priority ─────────────────────────────────────────────────────────────────

export interface PriorityComponents {
  businessImpact: number;
  searchImpact: number;
  affectedScope: number;
  confidence: number;
  fixability: number;
  evidenceStrength: number;
  recency: number;
}

export interface ExplainablePriority {
  policyVersion: string;
  score: number;
  components: PriorityComponents;
}

// ── Remediation Action ────────────────────────────────────────────────────────

export interface RemediationAction {
  findingFingerprint: string;
  findingDbId: string | null;
  issueType: string;
  rootCause: string;
  remediationType: RemediationType;
  priority: ExplainablePriority;
  executionOrder: number;
  blockedByFingerprints: string[];
  verificationCriteria: VerificationCriterion[];
  expectedOutcome: string;
  status: RemediationActionStatus;
  deterministicFix?: unknown;
  aiPatchHint?: string;
  manualActionDescription?: string;
}

export type RemediationActionStatus =
  | "PLANNED"
  | "FIX_GENERATED"
  | "AWAITING_REVIEW"
  | "APPLIED"
  | "VERIFIED"
  | "FAILED"
  | "SKIPPED";

// ── Fingerprint Computation ──────────────────────────────────────────────────

export function computeFindingFingerprint(
  siteId: string,
  issueType: string,
  normalizedUrl: string,
  rootCauseId: string,
): string {
  return createHash("sha256")
    .update(
      [siteId, issueType, normalizedUrl, rootCauseId.trim().toLowerCase()].join("|"),
    )
    .digest("hex")
    .slice(0, 20);
}

export function aggregateEvidenceConfidence(evidence: SEOEvidence[]): number {
  if (evidence.length === 0) return 0;
  const deterministic = evidence.filter(
    (e) => e.confidenceKind === "DIRECTLY_OBSERVED",
  );
  if (deterministic.length > 0) {
    const avg =
      deterministic.reduce((s, e) => s + e.confidence, 0) /
      deterministic.length;
    const sources = new Set(deterministic.map((e) => e.source)).size;
    const corroboration = Math.min(1, sources / 3);
    return Math.round((avg * 0.7 + corroboration * 0.3) * 100) / 100;
  }
  const sources = new Set(evidence.map((e) => e.source)).size;
  const avg =
    evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length;
  const corroboration = Math.min(1, sources / 3);
  return Math.round((avg * 0.7 + corroboration * 0.3) * 100) / 100;
}

// ── Phase 5: AEO/AIO Intelligence Integration ────────────────────────────────

// ── AEO Remediation Mode ─────────────────────────────────────────────────────
//
// Classifies AEO/AIO remediation actions into two mutually exclusive modes:
//
//   TECHNICAL_FIX     → concrete technical condition, deterministic or safe fix
//                       eligible for mutation pipeline
//
//   CONTENT_EXPERIMENT → opportunity with unproven causality
//                        becomes recommendation/experiment with measurable outcomes
//                        MUST NOT be represented as a guaranteed fix
//
// Mapping rules:
//   missing/malformed schema              → TECHNICAL_FIX
//   incorrect canonical                   → TECHNICAL_FIX
//   inaccessible answer content           → TECHNICAL_FIX
//   invalid Speakable (where applicable)  → TECHNICAL_FIX
//   improve answer structure              → CONTENT_EXPERIMENT
//   content/citation/topical gap          → CONTENT_EXPERIMENT
//   authority/freshness gap               → CONTENT_EXPERIMENT
//   competitor citation gap               → CONTENT_EXPERIMENT

export type AeoRemediationMode =
  | "TECHNICAL_FIX"
  | "CONTENT_EXPERIMENT";

// ── CitationOpportunity ──────────────────────────────────────────────────────
//
// Canonical AIO/AEO opportunity type.
//
// Escalation lifecycle:
//   OBSERVATION   → single AI response observation
//   OPPORTUNITY   → repeated observations across queries or samples
//   RECOMMENDATION→ persistent gap with enough evidence to recommend action
//   FIX_CANDIDATE → verified technical cause → eligible for mutation pipeline
//
// Safety invariant:
//   status === "OBSERVATION" → NEVER triggers a mutation
//   A CitationOpportunity alone is NOT sufficient evidence for a repository change.
//   It must become a DiagnosticFinding via the canonical applicability gate first.

export type CitationOpportunityType =
  | "NO_MENTION"
  | "NO_CITATION"
  | "WRONG_ENTITY"
  | "COMPETITOR_CITED"
  | "WEAK_SOURCE"
  | "CONTENT_GAP"
  | "EVIDENCE_GAP"
  | "FRESHNESS_GAP"
  | "AUTHORITY_GAP"
  | "STRUCTURE_GAP"
  | "INTENT_GAP";

export type CitationOpportunityStatus =
  | "OBSERVATION"
  | "OPPORTUNITY"
  | "RECOMMENDATION"
  | "FIX_CANDIDATE";

export interface CitationOpportunityEvidence {
  /** AI provider (e.g. "gemini", "chatgpt", "perplexity") */
  provider: string;
  /** Model identifier — preserved for variance analysis */
  model?: string;
  /** Model version or checkpoint */
  modelVersion?: string;
  /** Prompt template version — needed to detect prompt-driven regressions */
  promptVersion?: string;
  /** Unique sample ID for deduplication across runs */
  sampleId?: string;
  /** Whether the response used live grounding/retrieval */
  groundingUsed?: boolean;
  /** URLs cited as grounding sources in this response */
  groundingSources?: string[];
}

export interface CitationOpportunity {
  /** Stable unique identifier (deterministic from domain + type + query) */
  id: string;
  /** Site database ID when persisted; undefined for transient opportunities */
  siteId?: string;
  /** URL this opportunity applies to; null = site-wide */
  url: string | null;

  /** AEO = Answer Engine Optimisation; AIO = AI-driven Organic */
  domain: "AEO" | "AIO";

  /** Type of gap or citation opportunity */
  type: CitationOpportunityType;

  /** The query or question that produced this observation */
  query: string;

  /** ISO 8601 timestamp of the observation */
  observedAt: string;

  /** Evidence provenance — who produced this observation */
  evidence: CitationOpportunityEvidence;

  /**
   * Confidence in this observation (0–1).
   * Single AI responses should use low values (≤ 0.5).
   * Repeated cross-provider observations may use higher values.
   */
  confidence: number;

  /**
   * Number of times this pattern has been independently observed.
   * Used by AI_ESCALATION_POLICY to determine escalation tier.
   * Must be >= 1 (the initial observation).
   */
  repeatedObservationCount: number;

  /**
   * Whether this is a technical gap (fixable via mutation) or a
   * content/authority gap (requires experiment with measurable outcome).
   */
  remediationMode: AeoRemediationMode;

  /**
   * Current escalation status.
   * Starts as OBSERVATION. Can only move forward, never backward.
   * FIX_CANDIDATE requires verified technical cause via canonical evidence.
   */
  status: CitationOpportunityStatus;
}

// ── AI Escalation Policy ─────────────────────────────────────────────────────
//
// Prevents single AI responses from becoming automatic fixes.
//
// Safety invariants:
//   1. A single AI observation NEVER authorises a repository mutation.
//   2. Different signal types require different evidence thresholds.
//   3. Technical issues with direct schema/HTML evidence have lower thresholds
//      than competitor citation gaps or authority gaps.
//   4. GSoV movement alone cannot escalate to FIX_CANDIDATE.
//
// Escalation sequence (forward-only):
//   single observation          → OBSERVATION (SIGNAL)
//   repeated observations       → OPPORTUNITY
//   persistent gap + threshold  → RECOMMENDATION
//   verified technical cause    → FIX_CANDIDATE

export interface EscalationThreshold {
  /** Minimum number of independent observations before this status is reached */
  minObservations: number;
  /** Minimum confidence score (0–1) required */
  minConfidence: number;
  /** Whether direct technical evidence (not just AI responses) is required */
  requiresTechnicalEvidence: boolean;
  /** Human-readable rationale for this threshold */
  rationale: string;
}

export interface SignalTypePolicy {
  /** Which remediationMode this policy applies to */
  remediationMode: AeoRemediationMode;
  /** Evidence requirements for each escalation tier */
  thresholds: Record<CitationOpportunityStatus, EscalationThreshold>;
}

/**
 * AI_ESCALATION_POLICY
 *
 * Per-signal-type evidence requirements for escalation.
 *
 * Key principles:
 *   - "OBSERVATION" requires only 1 sample (the initial observation itself)
 *   - "FIX_CANDIDATE" for CONTENT_EXPERIMENT requires ≥ 5 observations because
 *     content causality is difficult to establish
 *   - "FIX_CANDIDATE" for TECHNICAL_FIX requires ≥ 2 observations but also
 *     requires technical evidence (HTML/schema) to be present
 *   - GSoV movement alone never satisfies any FIX_CANDIDATE threshold
 */
export const AI_ESCALATION_POLICY: Record<CitationOpportunityType, SignalTypePolicy> = {
  // Technical gaps: lower observation threshold, but MUST have technical evidence
  NO_MENTION: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.3,  requiresTechnicalEvidence: false, rationale: "Single observation — creates alert only" },
      OPPORTUNITY:   { minObservations: 2, minConfidence: 0.4,  requiresTechnicalEvidence: false, rationale: "Repeated non-mention across queries" },
      RECOMMENDATION:{ minObservations: 3, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Persistent gap warrants content experiment" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.65, requiresTechnicalEvidence: true,  rationale: "Requires verified structural or entity cause" },
    },
  },
  NO_CITATION: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.3,  requiresTechnicalEvidence: false, rationale: "Single response — may be model variance" },
      OPPORTUNITY:   { minObservations: 2, minConfidence: 0.45, requiresTechnicalEvidence: false, rationale: "Repeated pattern across models or sessions" },
      RECOMMENDATION:{ minObservations: 3, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Persistent non-citation warrants experiment" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.65, requiresTechnicalEvidence: true,  rationale: "Requires verified technical or entity cause" },
    },
  },
  WRONG_ENTITY: {
    remediationMode: "TECHNICAL_FIX",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Entity mismatch — alert immediately" },
      OPPORTUNITY:   { minObservations: 2, minConfidence: 0.6,  requiresTechnicalEvidence: false, rationale: "Repeated entity confusion" },
      RECOMMENDATION:{ minObservations: 2, minConfidence: 0.65, requiresTechnicalEvidence: true,  rationale: "Requires schema/entity technical evidence" },
      FIX_CANDIDATE: { minObservations: 2, minConfidence: 0.7,  requiresTechnicalEvidence: true,  rationale: "Technical entity fix: schema + sameAs required" },
    },
  },
  COMPETITOR_CITED: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.4,  requiresTechnicalEvidence: false, rationale: "Competitor appearance — informational signal" },
      OPPORTUNITY:   { minObservations: 3, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Competitor consistently preferred" },
      RECOMMENDATION:{ minObservations: 5, minConfidence: 0.55, requiresTechnicalEvidence: false, rationale: "Stable pattern across queries/models" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.65, requiresTechnicalEvidence: true,  rationale: "Competitor gap requires structural analysis" },
    },
  },
  WEAK_SOURCE: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.4,  requiresTechnicalEvidence: false, rationale: "Source quality observation" },
      OPPORTUNITY:   { minObservations: 2, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Repeated weak source pattern" },
      RECOMMENDATION:{ minObservations: 3, minConfidence: 0.55, requiresTechnicalEvidence: false, rationale: "Content/authority improvement warranted" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.65, requiresTechnicalEvidence: true,  rationale: "Requires verified source quality evidence" },
    },
  },
  CONTENT_GAP: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.3,  requiresTechnicalEvidence: false, rationale: "Initial content gap signal" },
      OPPORTUNITY:   { minObservations: 2, minConfidence: 0.4,  requiresTechnicalEvidence: false, rationale: "Repeated gap across queries" },
      RECOMMENDATION:{ minObservations: 3, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Content experiment recommended" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.6,  requiresTechnicalEvidence: false, rationale: "Stable content gap — content action" },
    },
  },
  EVIDENCE_GAP: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.35, requiresTechnicalEvidence: false, rationale: "Evidence/citation gap observation" },
      OPPORTUNITY:   { minObservations: 2, minConfidence: 0.45, requiresTechnicalEvidence: false, rationale: "Repeated evidence weakness" },
      RECOMMENDATION:{ minObservations: 3, minConfidence: 0.5,  requiresTechnicalEvidence: true,  rationale: "Requires external citation analysis" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.6,  requiresTechnicalEvidence: true,  rationale: "External evidence building action" },
    },
  },
  FRESHNESS_GAP: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.35, requiresTechnicalEvidence: false, rationale: "Freshness signal — may be retrieval variance" },
      OPPORTUNITY:   { minObservations: 2, minConfidence: 0.45, requiresTechnicalEvidence: false, rationale: "Consistent freshness deficit" },
      RECOMMENDATION:{ minObservations: 3, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Content refresh experiment warranted" },
      FIX_CANDIDATE: { minObservations: 3, minConfidence: 0.55, requiresTechnicalEvidence: false, rationale: "Time-sensitive content update recommended" },
    },
  },
  AUTHORITY_GAP: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.3,  requiresTechnicalEvidence: false, rationale: "Authority gap — requires external evidence" },
      OPPORTUNITY:   { minObservations: 3, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Repeated authority deficit" },
      RECOMMENDATION:{ minObservations: 5, minConfidence: 0.55, requiresTechnicalEvidence: true,  rationale: "Requires external citation/link evidence" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.65, requiresTechnicalEvidence: true,  rationale: "Authority gaps require external validation" },
    },
  },
  STRUCTURE_GAP: {
    remediationMode: "TECHNICAL_FIX",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Structural issue — schema or heading gap" },
      OPPORTUNITY:   { minObservations: 1, minConfidence: 0.6,  requiresTechnicalEvidence: true,  rationale: "Technical observation confirms structural issue" },
      RECOMMENDATION:{ minObservations: 1, minConfidence: 0.7,  requiresTechnicalEvidence: true,  rationale: "Direct technical evidence of structure gap" },
      FIX_CANDIDATE: { minObservations: 1, minConfidence: 0.75, requiresTechnicalEvidence: true,  rationale: "HTML/schema confirms structural fix is appropriate" },
    },
  },
  INTENT_GAP: {
    remediationMode: "CONTENT_EXPERIMENT",
    thresholds: {
      OBSERVATION:   { minObservations: 1, minConfidence: 0.3,  requiresTechnicalEvidence: false, rationale: "Intent mismatch observation" },
      OPPORTUNITY:   { minObservations: 3, minConfidence: 0.45, requiresTechnicalEvidence: false, rationale: "Repeated intent failures" },
      RECOMMENDATION:{ minObservations: 4, minConfidence: 0.5,  requiresTechnicalEvidence: false, rationale: "Content experiment for query intent alignment" },
      FIX_CANDIDATE: { minObservations: 5, minConfidence: 0.6,  requiresTechnicalEvidence: false, rationale: "Stable intent gap — content action warranted" },
    },
  },
};

/**
 * Evaluate the escalation status a CitationOpportunity should occupy
 * given its current observation count, confidence, and available evidence.
 *
 * Returns the highest status the opportunity is eligible for.
 * A status is only returned if ALL thresholds for that status are met.
 *
 * Safety guarantee:
 *   - If technical evidence is required but absent, FIX_CANDIDATE is blocked.
 *   - Single observations (count === 1) can never exceed OBSERVATION.
 *     (The minObservations check enforces this.)
 */
export function evaluateEscalationStatus(
  opportunity: Pick<
    CitationOpportunity,
    "type" | "repeatedObservationCount" | "confidence" | "remediationMode"
  >,
  hasTechnicalEvidence: boolean,
): CitationOpportunityStatus {
  const policy = AI_ESCALATION_POLICY[opportunity.type];
  const tiers: CitationOpportunityStatus[] = [
    "FIX_CANDIDATE",
    "RECOMMENDATION",
    "OPPORTUNITY",
    "OBSERVATION",
  ];

  for (const tier of tiers) {
    const threshold = policy.thresholds[tier];
    const meetsObservations =
      opportunity.repeatedObservationCount >= threshold.minObservations;
    const meetsConfidence = opportunity.confidence >= threshold.minConfidence;
    const meetsTechnical =
      !threshold.requiresTechnicalEvidence || hasTechnicalEvidence;

    if (meetsObservations && meetsConfidence && meetsTechnical) {
      return tier;
    }
  }

  return "OBSERVATION";
}

