import { createHash } from "crypto";

export type EvidenceSource =
  | "HTML"
  | "HTTP_HEADERS"
  | "ROBOTS"
  | "SITEMAP"
  | "GSC"
  | "GA4"
  | "CRUX"
  | "LINK_GRAPH"
  | "SCHEMA"
  | "DNS";

export interface SEOEvidence {
  source: EvidenceSource;
  url?: string;
  observedAt: string;
  observedValue?: unknown;
  expectedValue?: unknown;
  httpStatus?: number;
  confidence: number;
  evidenceHash: string;
}

export function computeEvidenceHash(
  evidence: Omit<SEOEvidence, "evidenceHash">
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        source: evidence.source,
        url: evidence.url,
        observedValue: evidence.observedValue,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

export function createEvidence(
  evidence: Omit<SEOEvidence, "evidenceHash">
): SEOEvidence {
  const confidence = Math.max(0, Math.min(1, evidence.confidence));
  return {
    ...evidence,
    confidence,
    evidenceHash: computeEvidenceHash({ ...evidence, confidence }),
  };
}

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
};

export type RemediationType =
  | "DETERMINISTIC"
  | "AI_PATCH"
  | "MANUAL"
  | "EXPERIMENT";

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

export interface DiagnosticFinding {
  id: string;
  fingerprint: string;
  issueType: string;
  status: DiagnosticStatus;
  severity: FindingSeverity;
  scope: FindingScope;
  rootCause: string;
  evidence: SEOEvidence[];
  confidence: number;
  expectedOutcome: string;
  remediationType: RemediationType;
  verificationCriteria: VerificationCriterion[];
  dependencies?: string[];
}

export function computeFindingFingerprint(
  siteId: string,
  issueType: string,
  normalizedUrl: string,
  rootCause: string
): string {
  return createHash("sha256")
    .update(
      [siteId, issueType, normalizedUrl, rootCause.trim().toLowerCase()].join(
        "|"
      )
    )
    .digest("hex")
    .slice(0, 20);
}

export function aggregateEvidenceConfidence(evidence: SEOEvidence[]): number {
  if (evidence.length === 0) return 0;
  const independentSources = new Set(evidence.map((item) => item.source)).size;
  const average =
    evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length;
  const corroboration = Math.min(1, independentSources / 3);
  return Math.round((average * 0.7 + corroboration * 0.3) * 100) / 100;
}
