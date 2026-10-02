import type {
  CanonicalObservationSource,
  CanonicalObservation,
  HtmlObservation,
  HttpObservation,
  RobotsObservation,
  SitemapObservation,
  SchemaObservation,
  GscObservation,
  SEOEvidence,
  EvidenceConfidenceKind,
} from "./contracts";
import {
  createEvidence,
  CONFIDENCE_BY_KIND,
} from "./contracts";

// ── Adapter: HTML ────────────────────────────────────────────────────────────

export function htmlObservationToEvidence(
  obs: HtmlObservation,
  url: string,
): SEOEvidence {
  const isReal =
    obs.metaRobots !== undefined ||
    obs.canonicalHref !== undefined ||
    obs.jsonldCount > 0;
  const kind: EvidenceConfidenceKind = isReal
    ? "DIRECTLY_OBSERVED"
    : "UNAVAILABLE";
  return createEvidence({
    source: "HTML",
    url,
    observedAt: new Date().toISOString(),
    observedValue: {
      metaRobots: obs.metaRobots,
      canonicalHref: obs.canonicalHref,
      canonicalIsSelf: obs.canonicalIsSelf,
      hasQaContent: obs.hasQaContent,
      jsonldCount: obs.jsonldCount,
      microdataPresent: obs.microdataPresent,
      hasOrganization: obs.hasOrganization,
      hasFaq: obs.hasFaq,
      hasBreadcrumb: obs.hasBreadcrumb,
      schemaTypes: obs.schemaTypes,
      schemaErrors: obs.schemaErrors,
    } satisfies HtmlObservation,
    confidence: CONFIDENCE_BY_KIND[kind],
    confidenceKind: kind,
  });
}

// ── Adapter: HTTP ────────────────────────────────────────────────────────────

export function httpObservationToEvidence(
  obs: HttpObservation,
  url: string,
): SEOEvidence {
  const kind: EvidenceConfidenceKind =
    obs.status > 0 ? "DIRECTLY_OBSERVED" : "UNAVAILABLE";
  return createEvidence({
    source: "HTTP_HEADERS",
    url,
    observedAt: new Date().toISOString(),
    httpStatus: obs.status,
    observedValue: {
      status: obs.status,
      xRobotsTag: obs.xRobotsTag,
      redirectCount: obs.redirectCount,
      redirectLoop: obs.redirectLoop,
      protocol: obs.protocol,
      finalUrl: obs.finalUrl,
    } satisfies HttpObservation,
    confidence: CONFIDENCE_BY_KIND[kind],
    confidenceKind: kind,
  });
}

// ── Adapter: Robots ──────────────────────────────────────────────────────────

export function robotsObservationToEvidence(
  obs: RobotsObservation,
  url: string,
): SEOEvidence {
  const kind: EvidenceConfidenceKind = obs.exists
    ? "DIRECTLY_OBSERVED"
    : "DIRECTLY_OBSERVED";
  return createEvidence({
    source: "ROBOTS",
    url,
    observedAt: new Date().toISOString(),
    observedValue: {
      exists: obs.exists,
      disallowed: obs.disallowed,
      disallowsRoot: obs.disallowsRoot,
      blocksGooglebot: obs.blocksGooglebot,
      hasSitemapDirective: obs.hasSitemapDirective,
      content: obs.content,
    } satisfies RobotsObservation,
    confidence: CONFIDENCE_BY_KIND[kind],
    confidenceKind: kind,
  });
}

// ── Adapter: Sitemap ─────────────────────────────────────────────────────────

export function sitemapObservationToEvidence(
  obs: SitemapObservation,
  url: string,
): SEOEvidence {
  const kind: EvidenceConfidenceKind = "DIRECTLY_OBSERVED";
  return createEvidence({
    source: "SITEMAP",
    url,
    observedAt: new Date().toISOString(),
    observedValue: {
      exists: obs.exists,
      validXml: obs.validXml,
      urlCount: obs.urlCount,
      containsUrl: obs.containsUrl,
      url: obs.url,
    } satisfies SitemapObservation,
    confidence: CONFIDENCE_BY_KIND[kind],
    confidenceKind: kind,
  });
}

// ── Adapter: Schema ──────────────────────────────────────────────────────────

export function schemaObservationToEvidence(
  obs: SchemaObservation,
  url: string,
): SEOEvidence {
  const kind: EvidenceConfidenceKind = "DIRECTLY_OBSERVED";
  return createEvidence({
    source: "SCHEMA",
    url,
    observedAt: new Date().toISOString(),
    observedValue: {
      jsonldCount: obs.jsonldCount,
      microdataPresent: obs.microdataPresent,
      hasOrganization: obs.hasOrganization,
      hasFaq: obs.hasFaq,
      hasBreadcrumb: obs.hasBreadcrumb,
      types: obs.types,
      errors: obs.errors,
    } satisfies SchemaObservation,
    confidence: CONFIDENCE_BY_KIND[kind],
    confidenceKind: kind,
  });
}

// ── Adapter: GSC ─────────────────────────────────────────────────────────────

export function gscObservationToEvidence(
  obs: GscObservation,
  siteId: string,
): SEOEvidence {
  const hasData = obs.impressions > 0 || obs.clicks > 0;
  const kind: EvidenceConfidenceKind = hasData
    ? "DIRECTLY_OBSERVED"
    : "UNAVAILABLE";
  return createEvidence({
    source: "GSC",
    url: obs.url,
    observedAt: new Date().toISOString(),
    observedValue: {
      impressions: obs.impressions,
      clicks: obs.clicks,
      ctr: obs.ctr,
      avgPosition: obs.avgPosition,
      indexingState: obs.indexingState,
      url: obs.url,
      querySet: obs.querySet,
      measurementWindow: obs.measurementWindow,
    } satisfies GscObservation,
    confidence: CONFIDENCE_BY_KIND[kind],
    confidenceKind: kind,
  });
}

// ── Legacy ChecklistItem Adapter ─────────────────────────────────────────────

type LegacyAuditStatus =
  | "Pass"
  | "Fail"
  | "Warning"
  | "Error"
  | "Skipped"
  | "Info"
  | "NotApplicable";

interface LegacyChecklistItem {
  id: string;
  label: string;
  status: LegacyAuditStatus;
  finding: string;
  recommendation?: { text: string; priority: string };
  roiImpact?: number;
  aiVisibilityImpact?: number;
  details?: Record<string, string | number | boolean>;
}

function legacyStatusToConfidence(status: LegacyAuditStatus): {
  confidence: number;
  kind: EvidenceConfidenceKind;
} {
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

function inferEvidenceSource(itemId: string): CanonicalObservationSource {
  if (itemId.includes("ssl") || itemId.includes("https") || itemId.includes("redirect")) return "HTTP_HEADERS";
  if (itemId.includes("robots")) return "ROBOTS";
  if (itemId.includes("sitemap")) return "SITEMAP";
  if (itemId.includes("schema") || itemId.includes("jsonld") || itemId.includes("structured")) return "SCHEMA";
  if (itemId.includes("http") && !itemId.includes("https")) return "HTTP_HEADERS";
  if (itemId.includes("gsc") || itemId.includes("search-console")) return "GSC";
  if (itemId.includes("link-graph") || itemId.includes("internal-link")) return "LINK_GRAPH";
  return "HTML";
}

export function checklistItemToCanonicalEvidence(
  item: LegacyChecklistItem,
  url: string,
): SEOEvidence {
  const { confidence, kind } = legacyStatusToConfidence(item.status);
  return createEvidence({
    source: inferEvidenceSource(item.id),
    url,
    observedAt: new Date().toISOString(),
    observedValue: {
      checkId: item.id,
      status: item.status,
      finding: item.finding,
      ...(item.details ?? {}),
    },
    expectedValue:
      item.status === "Pass"
        ? undefined
        : { description: item.recommendation?.text },
    confidence,
    confidenceKind: kind,
  });
}

// ── Canonical Observation Builder ────────────────────────────────────────────

export function buildCanonicalObservation(
  source: CanonicalObservationSource,
  url: string,
  data:
    | HtmlObservation
    | HttpObservation
    | RobotsObservation
    | SitemapObservation
    | SchemaObservation
    | GscObservation
    | Record<string, unknown>,
  kind: EvidenceConfidenceKind,
): CanonicalObservation {
  return {
    source,
    url,
    observedAt: new Date().toISOString(),
    confidenceKind: kind,
    confidence: CONFIDENCE_BY_KIND[kind],
    data,
  };
}
