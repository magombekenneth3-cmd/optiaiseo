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
  if (itemId === "ai-bot-robots" || itemId === "llms-txt" || itemId.startsWith("aeo-")) {
    return "AI_VISIBILITY";
  }
  if (
    itemId.startsWith("cwv-") ||
    itemId.startsWith("core-web-vitals-") ||
    itemId.startsWith("crux-")
  ) {
    return "CRUX";
  }
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
  if (
    itemId.includes("gsc") ||
    itemId.includes("search-console") ||
    itemId === "keyword-cannibalization"
  ) {
    return "GSC";
  }
  if (
    itemId.includes("link-graph") ||
    itemId.includes("internal-link") ||
    itemId === "broken-internal-links"
  ) {
    return "LINK_GRAPH";
  }
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

function maxNumericField(...values: unknown[]): number | undefined {
  let max: number | undefined;
  for (const val of values) {
    if (typeof val === "number" && Number.isFinite(val)) {
      max = max === undefined ? val : Math.max(max, val);
    }
  }
  return max;
}

const SKIPPED_STATUSES = new Set(["Skipped", "NotApplicable"]);
const PROBLEM_STATUSES = new Set(["Fail", "Warning"]);

/** Normalizes audit item fields into stable predicates consumed by `DIAGNOSTIC_RULES`. */
function normalizeChecklistDetails(
  item: ChecklistItem,
  d: Record<string, unknown>,
  url: string,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const actionable = !SKIPPED_STATUSES.has(item.status);

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
  } else if (item.id === "redirect-chain") {
    if (typeof d.hops === "number") normalized.redirect_count = d.hops;
    if (typeof d.hasLoop === "boolean") normalized.redirect_loop = d.hasLoop;
  } else if (item.id === "ssl-certificate" || item.id === "https-security") {
    normalized.protocol = item.status === "Fail" || url.startsWith("http://") ? "http" : "https";
  } else if (
    item.id === "robots-txt" ||
    item.id === "robots-directive-check" ||
    item.id === "technical.robots-sitemap" ||
    item.id === "robots-sitemap"
  ) {
    const blocksGooglebot = Boolean(d.googlebotBlocked);
    const disallowsRoot = Boolean(d.disallowsRoot);
    const urlBlocked = Boolean(d.urlBlocked);
    normalized.blocks_googlebot = blocksGooglebot;
    normalized.disallows_root = disallowsRoot;
    normalized.disallowed = blocksGooglebot || disallowsRoot || urlBlocked;
    const robotsMissing =
      d.exists === false ||
      Boolean(typeof item.finding === "string" && /\bmissing\b|not found/i.test(item.finding));
    if (item.id === "robots-txt" || typeof d.exists === "boolean" || robotsMissing) {
      normalized.exists =
        item.status === "Pass"
          ? true
          : typeof d.exists === "boolean"
            ? d.exists
            : !robotsMissing;
    }
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
    if (item.id === "schema-missing-faq") {
      normalized.has_qa_content = true;
    }
  } else if (item.id === "mobile-ux" || item.id === "viewport") {
    normalized.viewport_missing = item.status === "Fail";
  } else if (item.id === "charset") {
    normalized.charset_missing = PROBLEM_STATUSES.has(item.status);
  } else if (item.id === "html-lang" || item.id === "a11y-lang") {
    normalized.html_lang_missing = item.status === "Fail";
  } else if (item.id === "og-title" || item.id === "og-description" || item.id === "og-image") {
    normalized.og_tags_missing = PROBLEM_STATUSES.has(item.status);
    if (normalized.og_tags_missing) normalized.missing_og_tag = item.id;
  } else if (item.id === "title-tag" && actionable) {
    normalized.title_missing = item.status === "Fail";
    if (typeof d.length === "number") normalized.title_length = d.length;
    if (typeof d.value === "string") normalized.title_value = d.value;
  } else if (item.id === "meta-description" && actionable) {
    normalized.meta_desc_missing = item.status === "Fail";
    if (typeof d.length === "number") normalized.meta_desc_length = d.length;
    if (typeof d.value === "string") normalized.meta_desc_value = d.value;
  } else if (item.id === "h1-tag" && actionable) {
    const h1Count = typeof d.count === "number"
      ? d.count
      : item.status === "Fail"
        ? 0
        : item.status === "Warning"
          ? 2
          : 1;
    normalized.h1_count = h1Count;
    normalized.h1_missing = item.status === "Fail" || h1Count === 0;
    normalized.h1_multiple = (item.status === "Warning" && h1Count !== 0) || h1Count > 1;
  } else if (item.id === "broken-internal-links" && actionable && item.status !== "Info") {
    normalized.broken_count = typeof d.brokenCount === "number"
      ? d.brokenCount
      : item.status === "Fail"
        ? 3
        : item.status === "Warning"
          ? 1
          : 0;
  } else if (item.id === "lcp-hero-image" && actionable) {
    normalized.lcp_hero_lazy_loaded = d.loading === "lazy" || item.status === "Fail";
    if (typeof d.fetchpriority === "string") normalized.lcp_hero_fetchpriority = d.fetchpriority;
  } else if (item.id === "render-blocking-scripts" && actionable) {
    normalized.blocking_script_count = typeof d.blockingScriptCount === "number"
      ? d.blockingScriptCount
      : PROBLEM_STATUSES.has(item.status)
        ? 1
        : 0;
  } else if (item.id === "cwv-mobile-lcp" || item.id === "core-web-vitals-lcp") {
    const lcpMs = maxNumericField(d.cruxMobileLcpP75Ms, d.fieldLcpP75Ms, d.labLcpMs)
      ?? (item.status === "Fail" ? 4500 : undefined);
    if (lcpMs !== undefined) normalized.lcp_ms = lcpMs;
    if (actionable && item.status !== "Info") {
      normalized.lcp_poor = item.status === "Fail" || (lcpMs !== undefined && lcpMs > 4000);
    }
  } else if (item.id === "cwv-mobile-cls" || item.id === "core-web-vitals-cls") {
    const clsVal = maxNumericField(d.cruxMobileClsP75, d.labCls)
      ?? (item.status === "Fail" ? 0.3 : undefined);
    if (clsVal !== undefined) normalized.cls_score = clsVal;
    if (actionable && item.status !== "Info") {
      normalized.cls_poor = item.status === "Fail" || (clsVal !== undefined && clsVal > 0.25);
    }
  } else if (item.id === "cwv-mobile-inp" || item.id === "core-web-vitals-inp") {
    const inpMs = maxNumericField(d.cruxMobileInpP75Ms, d.labInpMs)
      ?? (item.status === "Fail" ? 550 : undefined);
    if (inpMs !== undefined) normalized.inp_ms = inpMs;
    if (actionable && item.status !== "Info") {
      normalized.inp_poor = item.status === "Fail" || (inpMs !== undefined && inpMs > 500);
    }
  } else if (item.id === "llms-txt" && actionable) {
    const rawQuality = typeof d.quality === "string"
      ? d.quality
      : item.status === "Pass"
        ? "good"
        : item.status === "Warning"
          ? "partial"
          : item.status === "Fail"
            ? "missing"
            : "unknown";
    normalized.llms_txt_quality = rawQuality === "empty" ? "missing" : rawQuality;
    normalized.llms_txt_exists = typeof d.exists === "boolean" ? d.exists : normalized.llms_txt_quality !== "missing";
    if (typeof d.pageEntries === "number") normalized.llms_txt_entries = d.pageEntries;
  } else if (item.id === "ai-bot-robots" && actionable) {
    const blockedList = typeof d.blockedBots === "string"
      ? d.blockedBots.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(d.blockedBots)
        ? d.blockedBots.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : [];
    const blockedCount = typeof d.blockedCount === "number"
      ? d.blockedCount
      : blockedList.length > 0
        ? blockedList.length
        : item.status === "Fail"
          ? 1
          : 0;
    normalized.ai_bots_blocked_count = blockedCount;
    if (blockedList.length > 0) normalized.ai_bots_blocked = blockedList;
  } else if (item.id === "keyword-cannibalization" && actionable && item.status !== "Info") {
    normalized.cannibalization_risk_score = typeof d.riskScore === "number"
      ? d.riskScore
      : item.status === "Fail"
        ? 75
        : item.status === "Warning"
          ? 45
          : 0;
  }

  return normalized;
}

export function checklistItemToEvidence(
  item: ChecklistItem,
  url: string,
): SEOEvidence {
  const { confidence, kind } = statusToConfidenceKind(item.status);
  const d = (item.details ?? {}) as Record<string, unknown>;
  const normalized = normalizeChecklistDetails(item, d, url);

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
  const items = result.items.map(item => checklistItemToEvidence(item, url));

  for (const item of result.items) {
    const d = (item.details ?? {}) as Record<string, unknown>;
    if (
      (item.id === "robots-directive-check" || item.id === "technical.robots-sitemap" || item.id === "robots-sitemap") &&
      d.validXml === false
    ) {
      items.push(
        createEvidence({
          source: "SITEMAP",
          url,
          observedAt: new Date().toISOString(),
          observedValue: {
            checkId: `${item.id}:sitemap`,
            checkStatus: item.status,
            exists: true,
            valid_xml: false,
          },
          confidence: CONFIDENCE_BY_KIND.DIRECTLY_OBSERVED,
          confidenceKind: "DIRECTLY_OBSERVED",
        }),
      );
    }
    if (item.id === "schema-missing-faq" && item.status !== "Pass") {
      items.push(
        createEvidence({
          source: "HTML",
          url,
          observedAt: new Date().toISOString(),
          observedValue: {
            checkId: "schema-missing-faq:qa-content",
            checkStatus: item.status,
            has_qa_content: true,
          },
          confidence: CONFIDENCE_BY_KIND.DERIVED,
          confidenceKind: "DERIVED",
        }),
      );
    }
  }

  return items;
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
