import type {
  SEOEvidence,
  CanonicalObservationSource,
  EvidenceConfidenceKind,
} from "./contracts";
import { createEvidence, CONFIDENCE_BY_KIND } from "./contracts";
import type { ChecklistItem, AuditCategoryResult } from "./types";
import { diagnose, type DiagnosticFinding } from "./root-cause-engine";

export class EvidenceCollector {
  private readonly siteId: string;
  private readonly url: string;
  private readonly evidence: SEOEvidence[] = [];

  constructor(siteId: string, url: string) {
    this.siteId = siteId;
    this.url = url;
  }

  collect(
    source: CanonicalObservationSource,
    observedValue: unknown,
    opts: {
      expectedValue?: unknown;
      httpStatus?: number;
      confidence?: number;
      confidenceKind?: EvidenceConfidenceKind;
      url?: string;
    } = {},
  ): SEOEvidence {
    const kind = opts.confidenceKind ?? "DIRECTLY_OBSERVED";
    const evidence = createEvidence({
      source,
      url: opts.url ?? this.url,
      observedAt: new Date().toISOString(),
      observedValue,
      expectedValue: opts.expectedValue,
      httpStatus: opts.httpStatus,
      confidence: opts.confidence ?? CONFIDENCE_BY_KIND[kind],
      confidenceKind: kind,
    });
    this.evidence.push(evidence);
    return evidence;
  }

  getEvidence(): SEOEvidence[] {
    return [...this.evidence];
  }

  diagnose(): DiagnosticFinding[] {
    return diagnose({
      siteId: this.siteId,
      url: this.url,
      evidence: this.evidence,
    });
  }
}

function inferEvidenceSource(itemId: string): CanonicalObservationSource {
  if (itemId === "robots-meta") return "HTML";
  if (
    itemId === "indexability" ||
    itemId === "x-robots-tag" ||
    itemId.includes("ssl") ||
    itemId.includes("https") ||
    itemId.includes("redirect")
  ) {
    return "HTTP_HEADERS";
  }
  if (itemId.includes("robots")) return "ROBOTS";
  if (itemId.includes("sitemap")) return "SITEMAP";
  if (itemId.includes("schema") || itemId.includes("jsonld") || itemId.includes("structured")) return "SCHEMA";
  if (itemId.includes("http") && !itemId.includes("https")) return "HTTP_HEADERS";
  if (itemId.includes("gsc") || itemId.includes("search-console")) return "GSC";
  if (itemId.includes("link-graph") || itemId.includes("internal-link")) return "LINK_GRAPH";
  return "HTML";
}

function statusToConfidenceKind(status: string): { confidence: number; kind: EvidenceConfidenceKind } {
  switch (status) {
    case "Pass":
      return { confidence: CONFIDENCE_BY_KIND.DIRECTLY_OBSERVED, kind: "DIRECTLY_OBSERVED" };
    case "Fail":
      return { confidence: CONFIDENCE_BY_KIND.DIRECTLY_OBSERVED, kind: "DIRECTLY_OBSERVED" };
    case "Warning":
      return { confidence: CONFIDENCE_BY_KIND.DERIVED, kind: "DERIVED" };
    case "Error":
      return { confidence: CONFIDENCE_BY_KIND.DERIVED, kind: "DERIVED" };
    case "Info":
      return { confidence: CONFIDENCE_BY_KIND.INFERRED, kind: "INFERRED" };
    case "Skipped":
    case "NotApplicable":
      return { confidence: CONFIDENCE_BY_KIND.UNAVAILABLE, kind: "UNAVAILABLE" };
    default:
      return { confidence: CONFIDENCE_BY_KIND.INFERRED, kind: "INFERRED" };
  }
}

export function checklistItemToEvidence(
  item: ChecklistItem,
  url: string,
): SEOEvidence {
  const { confidence, kind } = statusToConfidenceKind(item.status);
  const d = (item.details ?? {}) as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  if (item.id === "robots-meta") {
    normalized.meta_robots = typeof d.robotsContent === "string"
      ? d.robotsContent
      : item.status === "Fail"
        ? "noindex"
        : "";
  } else if (item.id === "indexability") {
    if (typeof d.httpStatus === "number") normalized.status = d.httpStatus;
    if (typeof d.xRobotsTag === "string" && d.xRobotsTag !== "none") {
      normalized["x-robots-tag"] = d.xRobotsTag;
    }
    if (typeof d.redirects === "number") normalized.redirect_count = d.redirects;
    if (typeof d.error === "string" && d.error.toLowerCase().includes("redirect")) {
      normalized.redirect_loop = true;
    }
  } else if (item.id === "ssl-certificate") {
    normalized.protocol = item.status === "Fail" || url.startsWith("http://") ? "http" : "https";
  } else if (item.id === "robots-txt") {
    const blocksGooglebot = Boolean(d.googlebotBlocked);
    const disallowsRoot = Boolean(d.disallowsRoot);
    normalized.blocks_googlebot = blocksGooglebot;
    normalized.disallows_root = disallowsRoot;
    normalized.disallowed = blocksGooglebot || disallowsRoot;
  } else if (item.id === "xml-sitemap") {
    normalized.exists = typeof d.exists === "boolean" ? d.exists : item.status !== "Fail";
    normalized.valid_xml = typeof d.validXml === "boolean" ? d.validXml : item.status === "Pass";
  } else if (item.id === "canonical-tag") {
    const canonicalUrl = typeof d.canonicalUrl === "string" && d.canonicalUrl ? d.canonicalUrl : null;
    normalized.canonical_href = canonicalUrl;
    normalized.canonical_is_self = typeof d.canonicalIsSelf === "boolean"
      ? d.canonicalIsSelf
      : canonicalUrl
        ? item.status === "Pass"
        : null;
  } else if (item.id === "technical.schema-quick-check" || item.id === "schema-presence") {
    normalized.jsonld_count = typeof d.jsonLdBlocks === "number"
      ? d.jsonLdBlocks
      : typeof d.blocks === "number"
        ? d.blocks
        : item.status === "Fail"
          ? 0
          : 1;
    normalized.microdata_present = typeof d.microdata === "boolean" ? d.microdata : false;
  } else if (item.id === "schema-missing-org" || item.id === "schema-organization") {
    normalized.has_organization = item.status === "Pass";
  } else if (item.id === "schema-missing-faq" || item.id === "schema-faq") {
    normalized.has_faq = item.status === "Pass";
  }

  return createEvidence({
    source: inferEvidenceSource(item.id),
    url,
    observedAt: new Date().toISOString(),
    observedValue: {
      checkId: item.id,
      checkStatus: item.status,
      status: typeof normalized.status === "number" ? normalized.status : item.status,
      finding: item.finding,
      ...d,
      ...normalized,
    },
    expectedValue: item.status === "Pass" ? undefined : {
      description: item.recommendation?.text,
    },
    confidence,
    confidenceKind: kind,
  });
}

export function categoryResultToEvidence(
  result: AuditCategoryResult,
  url: string,
): SEOEvidence[] {
  return result.items.map(item => checklistItemToEvidence(item, url));
}

export interface EvidenceAwareResult extends AuditCategoryResult {
  diagnosticFindings?: DiagnosticFinding[];
  collectedEvidence?: SEOEvidence[];
}

export function isEvidenceAwareResult(
  result: AuditCategoryResult,
): result is EvidenceAwareResult {
  return (
    "diagnosticFindings" in result &&
    Array.isArray((result as EvidenceAwareResult).diagnosticFindings)
  );
}

export function extractDiagnosticFindings(
  siteId: string,
  url: string,
  categoryResults: AuditCategoryResult[],
): {
  findings: DiagnosticFinding[];
  evidence: SEOEvidence[];
} {
  const allFindings: DiagnosticFinding[] = [];
  const allEvidence: SEOEvidence[] = [];

  for (const result of categoryResults) {
    if (isEvidenceAwareResult(result)) {
      if (result.diagnosticFindings) {
        allFindings.push(...result.diagnosticFindings);
      }
      if (result.collectedEvidence) {
        allEvidence.push(...result.collectedEvidence);
      }
    } else {
      const evidence = categoryResultToEvidence(result, url);
      allEvidence.push(...evidence);
    }
  }

  if (allEvidence.length > 0 && allFindings.length === 0) {
    const passiveFindings = diagnose({ siteId, url, evidence: allEvidence });
    allFindings.push(...passiveFindings);
  }

  const seen = new Set<string>();
  const deduped = allFindings.filter(f => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });

  return { findings: deduped, evidence: allEvidence };
}
