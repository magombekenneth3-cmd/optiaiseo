/**
 * src/lib/seo-audit/evidence-collector.ts
 *
 * Bridges legacy audit modules (ChecklistItem[]) and the new diagnostic engine
 * (SEOEvidence[] → DiagnosticFinding[]).
 *
 * Two modes of operation:
 *   1. Passive: convert existing ChecklistItems into SEOEvidence after the fact.
 *   2. Active: modules call collectEvidence() during their run() to capture
 *              structured evidence alongside the legacy ChecklistItem.
 *
 * The engine uses this to populate DiagnosticFindingRecords without
 * rewriting all 16 audit modules at once.
 */

import type {
  SEOEvidence,
  EvidenceSource,
  DiagnosticFinding,
} from "./diagnostic-types";
import { createEvidence, computeFindingFingerprint, aggregateEvidenceConfidence } from "./diagnostic-types";
import type { ChecklistItem, AuditCategoryResult, AuditModuleContext } from "./types";
import { toDiagnosticStatus } from "./types";
import { diagnose } from "./root-cause-engine";

// ── Evidence Builder ────────────────────────────────────────────────────────

export class EvidenceCollector {
  private readonly siteId: string;
  private readonly url: string;
  private readonly evidence: SEOEvidence[] = [];

  constructor(siteId: string, url: string) {
    this.siteId = siteId;
    this.url = url;
  }

  /**
   * Capture a piece of evidence during module execution.
   * Returns the evidence object (for chaining or inspection).
   */
  collect(
    source: EvidenceSource,
    observedValue: unknown,
    opts: {
      expectedValue?: unknown;
      httpStatus?: number;
      confidence?: number;
      url?: string;
    } = {},
  ): SEOEvidence {
    const evidence = createEvidence({
      source,
      url: opts.url ?? this.url,
      observedAt: new Date().toISOString(),
      observedValue,
      expectedValue: opts.expectedValue,
      httpStatus: opts.httpStatus,
      confidence: opts.confidence ?? 0.9,
    });
    this.evidence.push(evidence);
    return evidence;
  }

  /** All evidence collected so far */
  getEvidence(): SEOEvidence[] {
    return [...this.evidence];
  }

  /** Run the root-cause engine against collected evidence */
  diagnose(): DiagnosticFinding[] {
    return diagnose({
      siteId: this.siteId,
      url: this.url,
      evidence: this.evidence,
    });
  }
}

// ── Passive Evidence Extraction ─────────────────────────────────────────────

/**
 * Map a legacy ChecklistItem's `id` to the most appropriate EvidenceSource.
 */
function inferEvidenceSource(itemId: string): EvidenceSource {
  // HTTP / indexability items
  if (itemId.includes("ssl") || itemId.includes("http")) return "HTTP_HEADERS";
  if (itemId.includes("robots")) return "ROBOTS";
  if (itemId.includes("sitemap")) return "SITEMAP";
  if (itemId.includes("schema") || itemId.includes("jsonld") || itemId.includes("structured")) return "SCHEMA";
  if (itemId.includes("dns") || itemId.includes("redirect")) return "HTTP_HEADERS";
  if (itemId.includes("gsc") || itemId.includes("search-console")) return "GSC";
  if (itemId.includes("link-graph") || itemId.includes("internal-link")) return "LINK_GRAPH";
  // Everything else is derived from HTML analysis
  return "HTML";
}

/**
 * Confidence mapping for legacy items.
 * 
 * Pass/Fail have high confidence (the module found a definitive answer).
 * Warning/Info have lower confidence (may need manual review).
 * Error/Skipped mean the check couldn't run properly.
 */
function statusToConfidence(item: ChecklistItem): number {
  switch (item.status) {
    case "Pass":    return 1.0;
    case "Fail":    return 0.95;
    case "Warning": return 0.75;
    case "Error":   return 0.5;
    case "Info":    return 0.6;
    case "Skipped": return 0.0;
    default:        return 0.5;
  }
}

/**
 * Convert a legacy ChecklistItem into SEOEvidence.
 *
 * This is the "passive" mode — it doesn't add new evidence, it just
 * re-interprets existing checklist results as structured evidence objects.
 */
export function checklistItemToEvidence(
  item: ChecklistItem,
  url: string,
): SEOEvidence {
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
    expectedValue: item.status === "Pass" ? undefined : {
      description: item.recommendation?.text,
    },
    confidence: statusToConfidence(item),
  });
}

/**
 * Convert an entire AuditCategoryResult into SEOEvidence[].
 * Used for passive extraction when a module doesn't implement active collection.
 */
export function categoryResultToEvidence(
  result: AuditCategoryResult,
  url: string,
): SEOEvidence[] {
  return result.items.map(item => checklistItemToEvidence(item, url));
}

// ── Extended Result Type ────────────────────────────────────────────────────

/**
 * Modules that implement active evidence collection return this instead of
 * plain AuditCategoryResult. The engine checks for the presence of
 * `diagnosticFindings` and persists them if present.
 *
 * Backward-compatible: modules that don't implement this still return
 * AuditCategoryResult, and the engine falls back to passive extraction.
 */
export interface EvidenceAwareResult extends AuditCategoryResult {
  /** Findings produced by the root-cause engine during this module's run */
  diagnosticFindings?: DiagnosticFinding[];
  /** Raw evidence collected during the module's run */
  collectedEvidence?: SEOEvidence[];
}

/**
 * Type guard to check if a result has diagnostic findings.
 */
export function isEvidenceAwareResult(
  result: AuditCategoryResult,
): result is EvidenceAwareResult {
  return (
    "diagnosticFindings" in result &&
    Array.isArray((result as EvidenceAwareResult).diagnosticFindings)
  );
}

// ── Engine Integration ──────────────────────────────────────────────────────

/**
 * Process all category results from an audit run and extract diagnostic findings.
 *
 * For modules that implement active evidence collection (EvidenceAwareResult),
 * the findings are already computed — just pass them through.
 *
 * For legacy modules, perform passive extraction:
 *   1. Convert ChecklistItems to SEOEvidence
 *   2. Run the root-cause engine
 *   3. Return the findings
 */
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
      // Active mode — use the module's own findings
      if (result.diagnosticFindings) {
        allFindings.push(...result.diagnosticFindings);
      }
      if (result.collectedEvidence) {
        allEvidence.push(...result.collectedEvidence);
      }
    } else {
      // Passive mode — convert checklist items to evidence
      const evidence = categoryResultToEvidence(result, url);
      allEvidence.push(...evidence);
    }
  }

  // If we have passive evidence but no active findings, run the diagnostic engine
  if (allEvidence.length > 0 && allFindings.length === 0) {
    const passiveFindings = diagnose({ siteId, url, evidence: allEvidence });
    allFindings.push(...passiveFindings);
  }

  // Deduplicate findings by fingerprint
  const seen = new Set<string>();
  const deduped = allFindings.filter(f => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });

  return { findings: deduped, evidence: allEvidence };
}
