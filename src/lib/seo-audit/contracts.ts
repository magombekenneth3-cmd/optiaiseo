import { createHash } from "crypto";

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
  | "RECONCILIATION";

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
