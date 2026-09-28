/**
 * src/lib/seo-audit/root-cause-engine.ts
 *
 * Deterministic root-cause analysis engine.
 *
 * For every finding, this engine performs:
 *   Symptom → Evidence → Possible causes → Eliminate impossible → Root cause → Remediation
 *
 * The DIAGNOSTIC_RULES graph defines:
 *   - Issue types with their trigger signals
 *   - Possible root causes with evidence-based conditions
 *   - The remediation type each root cause maps to
 *   - Verification criteria to prove the fix worked
 *   - Dependencies: which issues must be resolved first
 *
 * This is the "brain" that replaces checklist-driven diagnosis.
 * Pure functions — no DB calls, no AI calls, no side effects.
 */

import type {
  SEOEvidence,
  DiagnosticFinding,
  DiagnosticStatus,
  FindingSeverity,
  RemediationType,
  VerificationCriterion,
  FindingScope,
} from "./diagnostic-types";
import {
  computeFindingFingerprint,
  aggregateEvidenceConfidence,
} from "./diagnostic-types";

// ── Rule Types ──────────────────────────────────────────────────────────────

export type ConditionOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "exists"
  | "not_exists"
  | "regex";

export interface EvidenceCondition {
  /** Which evidence source to evaluate */
  source: string;
  /** Field path within observedValue (dot-separated) */
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

export interface RootCause {
  id: string;
  label: string;
  /** Evidence conditions — ALL must match */
  conditions: EvidenceCondition[];
  /** What type of fix this root cause requires */
  remediationType: RemediationType;
  /** How to prove the fix worked */
  verification: VerificationCriterion[];
  /** Severity of this particular root cause */
  severity: FindingSeverity;
}

export interface DiagnosticRule {
  /** Machine-readable issue type, e.g. "INDEXING_BLOCKED" */
  issueType: string;
  /** Human-readable label */
  label: string;
  /** Evidence signals that indicate this issue may be present */
  signals: string[];
  /** Possible root causes — evaluated in order, first match wins */
  causes: RootCause[];
  /** Issue types that must be resolved before this one */
  dependsOn: string[];
  /** What the user should expect after fixing this */
  expectedOutcome: string;
}

// ── Diagnostic Rules ────────────────────────────────────────────────────────

export const DIAGNOSTIC_RULES: Record<string, DiagnosticRule> = {

  INDEXING_BLOCKED: {
    issueType: "indexing_blocked",
    label: "Indexing Blocked",
    signals: ["meta_noindex", "x_robots_noindex", "robots_disallow", "http_4xx", "http_5xx"],
    dependsOn: [],
    expectedOutcome: "Page becomes crawlable and eligible for indexing by search engines.",
    causes: [
      {
        id: "meta_noindex",
        label: "Meta robots noindex directive blocks indexing",
        severity: "critical",
        conditions: [
          { source: "HTML", field: "meta_robots", operator: "contains", value: "noindex" },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "HTML_SELECTOR", selector: 'meta[name="robots"]', expected: { not_contains: "noindex" } },
        ],
      },
      {
        id: "x_robots_noindex",
        label: "X-Robots-Tag HTTP header contains noindex",
        severity: "critical",
        conditions: [
          { source: "HTTP_HEADERS", field: "x-robots-tag", operator: "contains", value: "noindex" },
        ],
        remediationType: "MANUAL", // server config, can't fix via code patch
        verification: [
          { type: "HEADER_VALUE", headerName: "x-robots-tag", expected: { not_contains: "noindex" } },
        ],
      },
      {
        id: "robots_txt_block",
        label: "robots.txt disallows crawling this path",
        severity: "critical",
        conditions: [
          { source: "ROBOTS", field: "disallowed", operator: "eq", value: true },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "ROBOTS_ALLOWED", userAgent: "Googlebot", url: "__CURRENT_URL__", expected: true },
        ],
      },
      {
        id: "server_error",
        label: "Server returns 5xx error — page is unreachable",
        severity: "critical",
        conditions: [
          { source: "HTTP_HEADERS", field: "status", operator: "gte", value: 500 },
        ],
        remediationType: "MANUAL",
        verification: [
          { type: "HTTP_STATUS", expected: 200 },
        ],
      },
      {
        id: "client_error",
        label: "Page returns 4xx error — URL may be broken or removed",
        severity: "high",
        conditions: [
          { source: "HTTP_HEADERS", field: "status", operator: "gte", value: 400 },
          { source: "HTTP_HEADERS", field: "status", operator: "lt", value: 500 },
        ],
        remediationType: "MANUAL",
        verification: [
          { type: "HTTP_STATUS", expected: [200, 301] },
        ],
      },
    ],
  },

  CANONICAL_CONFLICT: {
    issueType: "canonical_conflict",
    label: "Canonical Tag Conflict",
    signals: ["canonical_mismatch", "canonical_missing", "canonical_to_param_url", "canonical_self_referencing_error"],
    dependsOn: ["INDEXING_BLOCKED"],
    expectedOutcome: "Canonical tag points to the preferred URL, consolidating ranking signals.",
    causes: [
      {
        id: "canonical_to_parameter",
        label: "Canonical points to parameterized URL instead of clean path",
        severity: "high",
        conditions: [
          { source: "HTML", field: "canonical_href", operator: "contains", value: "?" },
          { source: "HTML", field: "canonical_is_self", operator: "eq", value: false },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "HTML_SELECTOR", selector: 'link[rel="canonical"]', expected: "__PREFERRED_URL__" },
        ],
      },
      {
        id: "canonical_points_elsewhere",
        label: "Canonical points to a different page entirely",
        severity: "high",
        conditions: [
          { source: "HTML", field: "canonical_href", operator: "exists", value: true },
          { source: "HTML", field: "canonical_is_self", operator: "eq", value: false },
        ],
        remediationType: "MANUAL", // may be intentional consolidation
        verification: [
          { type: "HTML_SELECTOR", selector: 'link[rel="canonical"]', expected: "__PREFERRED_URL__" },
        ],
      },
      {
        id: "canonical_missing",
        label: "No canonical tag present — search engines guess the preferred URL",
        severity: "high",
        conditions: [
          { source: "HTML", field: "canonical_href", operator: "not_exists", value: null },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "HTML_SELECTOR", selector: 'link[rel="canonical"]', expected: "__CURRENT_URL__" },
        ],
      },
    ],
  },

  REDIRECT_CHAIN: {
    issueType: "redirect_chain",
    label: "Redirect Chain Detected",
    signals: ["redirect_chain_long", "redirect_loop"],
    dependsOn: ["INDEXING_BLOCKED"],
    expectedOutcome: "URL resolves in ≤1 redirect hop.",
    causes: [
      {
        id: "long_redirect_chain",
        label: "Redirect chain exceeds 2 hops — slows crawling and wastes link equity",
        severity: "medium",
        conditions: [
          { source: "HTTP_HEADERS", field: "redirect_count", operator: "gt", value: 2 },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "HTTP_STATUS", expected: 200 },
        ],
      },
      {
        id: "redirect_loop",
        label: "Redirect loop detected — page is unreachable",
        severity: "critical",
        conditions: [
          { source: "HTTP_HEADERS", field: "redirect_loop", operator: "eq", value: true },
        ],
        remediationType: "MANUAL",
        verification: [
          { type: "HTTP_STATUS", expected: 200 },
        ],
      },
    ],
  },

  SITEMAP_INCOMPLETE: {
    issueType: "sitemap_incomplete",
    label: "Sitemap Missing or Incomplete",
    signals: ["sitemap_missing", "sitemap_invalid_xml", "url_not_in_sitemap"],
    dependsOn: [],
    expectedOutcome: "Valid XML sitemap at /sitemap.xml listing all indexable pages.",
    causes: [
      {
        id: "no_sitemap",
        label: "No sitemap.xml found at /sitemap.xml",
        severity: "high",
        conditions: [
          { source: "SITEMAP", field: "exists", operator: "eq", value: false },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "HTTP_STATUS", url: "/sitemap.xml", expected: 200 },
          { type: "XML_VALID", url: "/sitemap.xml", expected: true },
        ],
      },
      {
        id: "sitemap_invalid",
        label: "Sitemap exists but contains invalid XML",
        severity: "medium",
        conditions: [
          { source: "SITEMAP", field: "exists", operator: "eq", value: true },
          { source: "SITEMAP", field: "valid_xml", operator: "eq", value: false },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "XML_VALID", url: "/sitemap.xml", expected: true },
        ],
      },
    ],
  },

  SCHEMA_MISSING: {
    issueType: "schema_missing",
    label: "Structured Data Missing",
    signals: ["no_jsonld", "no_organization", "no_faq", "no_breadcrumb"],
    dependsOn: [],
    expectedOutcome: "Page has appropriate JSON-LD structured data for its type.",
    causes: [
      {
        id: "no_structured_data",
        label: "Page has no JSON-LD or Microdata at all",
        severity: "medium",
        conditions: [
          { source: "SCHEMA", field: "jsonld_count", operator: "eq", value: 0 },
          { source: "SCHEMA", field: "microdata_present", operator: "eq", value: false },
        ],
        remediationType: "AI_PATCH",
        verification: [
          { type: "SCHEMA_PRESENT", expected: true },
        ],
      },
      {
        id: "missing_organization",
        label: "No Organization schema — AI engines can't verify brand identity",
        severity: "high",
        conditions: [
          { source: "SCHEMA", field: "has_organization", operator: "eq", value: false },
        ],
        remediationType: "AI_PATCH",
        verification: [
          { type: "SCHEMA_PRESENT", expected: true },
        ],
      },
      {
        id: "missing_faq",
        label: "No FAQPage schema — missed rich result and AI citation opportunity",
        severity: "medium",
        conditions: [
          { source: "SCHEMA", field: "has_faq", operator: "eq", value: false },
          { source: "HTML", field: "has_qa_content", operator: "eq", value: true },
        ],
        remediationType: "AI_PATCH",
        verification: [
          { type: "SCHEMA_PRESENT", expected: true },
        ],
      },
    ],
  },

  ROBOTS_TXT_MISCONFIGURED: {
    issueType: "robots_txt_misconfigured",
    label: "robots.txt Misconfigured",
    signals: ["robots_blocks_root", "robots_blocks_googlebot", "robots_no_sitemap_directive"],
    dependsOn: [],
    expectedOutcome: "robots.txt allows Googlebot access and references the sitemap.",
    causes: [
      {
        id: "blocks_googlebot",
        label: "robots.txt blocks Googlebot from crawling the site",
        severity: "critical",
        conditions: [
          { source: "ROBOTS", field: "blocks_googlebot", operator: "eq", value: true },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "ROBOTS_ALLOWED", userAgent: "Googlebot", expected: true },
        ],
      },
      {
        id: "blocks_root",
        label: "robots.txt Disallow: / blocks all crawlers",
        severity: "critical",
        conditions: [
          { source: "ROBOTS", field: "disallows_root", operator: "eq", value: true },
        ],
        remediationType: "DETERMINISTIC",
        verification: [
          { type: "ROBOTS_ALLOWED", userAgent: "*", expected: true },
        ],
      },
    ],
  },

  SSL_MISSING: {
    issueType: "ssl_missing",
    label: "HTTPS / SSL Certificate Missing",
    signals: ["http_only", "mixed_content"],
    dependsOn: [],
    expectedOutcome: "Site is served over HTTPS with no mixed content.",
    causes: [
      {
        id: "no_https",
        label: "Site served over HTTP — Google treats HTTPS as a ranking signal",
        severity: "critical",
        conditions: [
          { source: "HTTP_HEADERS", field: "protocol", operator: "eq", value: "http" },
        ],
        remediationType: "MANUAL",
        verification: [
          { type: "HTTP_STATUS", url: "__CURRENT_URL__", expected: 200 },
        ],
      },
    ],
  },
};

// ── Condition Evaluation ────────────────────────────────────────────────────

/** Extract a nested field from an evidence observedValue */
function getField(evidence: SEOEvidence, field: string): unknown {
  const value = evidence.observedValue;
  if (value == null) return undefined;
  if (typeof value !== "object") return field === "value" ? value : undefined;
  const parts = field.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Evaluate a single condition against a set of evidence items */
export function evaluateCondition(
  condition: EvidenceCondition,
  evidence: SEOEvidence[],
): boolean {
  const matching = evidence.filter(e => e.source === condition.source);
  if (matching.length === 0) return false;

  return matching.some(e => {
    const fieldValue = getField(e, condition.field);

    switch (condition.operator) {
      case "eq":
        return fieldValue === condition.value;
      case "neq":
        return fieldValue !== condition.value;
      case "contains":
        return typeof fieldValue === "string" &&
          typeof condition.value === "string" &&
          fieldValue.toLowerCase().includes(condition.value.toLowerCase());
      case "not_contains":
        return typeof fieldValue === "string" &&
          typeof condition.value === "string" &&
          !fieldValue.toLowerCase().includes(condition.value.toLowerCase());
      case "gt":
        return typeof fieldValue === "number" && fieldValue > (condition.value as number);
      case "lt":
        return typeof fieldValue === "number" && fieldValue < (condition.value as number);
      case "gte":
        return typeof fieldValue === "number" && fieldValue >= (condition.value as number);
      case "lte":
        return typeof fieldValue === "number" && fieldValue <= (condition.value as number);
      case "exists":
        return fieldValue !== undefined && fieldValue !== null;
      case "not_exists":
        return fieldValue === undefined || fieldValue === null;
      case "regex":
        return typeof fieldValue === "string" && new RegExp(condition.value as string, "i").test(fieldValue);
      default:
        return false;
    }
  });
}

// ── Diagnosis ───────────────────────────────────────────────────────────────

export interface DiagnosisInput {
  siteId: string;
  url: string;
  evidence: SEOEvidence[];
}

/**
 * Run the root-cause engine against collected evidence.
 *
 * For each applicable diagnostic rule:
 *   1. Check if any trigger signal is present in the evidence
 *   2. Evaluate each possible root cause's conditions in order
 *   3. First matching root cause becomes the diagnosis
 *   4. Produce a DiagnosticFinding with fingerprint, evidence, and verification contract
 *
 * Returns only findings with FAIL or WARNING status.
 * Rules whose evidence is insufficient return UNKNOWN and are excluded.
 */
export function diagnose(input: DiagnosisInput): DiagnosticFinding[] {
  const { siteId, url, evidence } = input;
  const findings: DiagnosticFinding[] = [];
  const now = new Date().toISOString();

  for (const [ruleKey, rule] of Object.entries(DIAGNOSTIC_RULES)) {
    // Try each root cause in priority order — first match wins
    let matched = false;

    for (const cause of rule.causes) {
      const allConditionsMet = cause.conditions.every(cond =>
        evaluateCondition(cond, evidence)
      );

      if (allConditionsMet) {
        // Gather relevant evidence for this finding
        const relevantEvidence = evidence.filter(e =>
          cause.conditions.some(c => c.source === e.source)
        );

        const fingerprint = computeFindingFingerprint(
          siteId,
          rule.issueType,
          url,
          cause.id,
        );

        findings.push({
          id: `${ruleKey}:${cause.id}:${now}`,
          fingerprint,
          issueType: rule.issueType,
          status: "FAIL",
          severity: cause.severity,
          scope: { type: "PAGE", urls: [url] },
          rootCause: cause.label,
          evidence: relevantEvidence,
          confidence: aggregateEvidenceConfidence(relevantEvidence),
          expectedOutcome: rule.expectedOutcome,
          remediationType: cause.remediationType,
          verificationCriteria: cause.verification,
          dependencies: rule.dependsOn.length > 0
            ? rule.dependsOn.map(dep => {
                const depRule = DIAGNOSTIC_RULES[dep];
                return depRule
                  ? computeFindingFingerprint(siteId, depRule.issueType, url, "any")
                  : dep;
              })
            : undefined,
        });

        matched = true;
        break; // first matching root cause wins
      }
    }

    // If no root cause matched but we have some evidence for this rule's signals,
    // the issue might exist but we can't determine the cause → UNKNOWN
    if (!matched) {
      const hasRelevantEvidence = evidence.some(e =>
        rule.causes.some(c => c.conditions.some(cond => cond.source === e.source))
      );
      // Intentionally don't emit UNKNOWN findings — they add noise.
      // The absence of a finding means "not diagnosed, not necessarily absent."
      void hasRelevantEvidence;
    }
  }

  return findings;
}

// ── Dependency Ordering ─────────────────────────────────────────────────────

/**
 * Topological sort of issue types — blockers come first.
 *
 * If issue A depends on issue B, B appears before A in the result.
 * This ensures the fixing engine resolves root blockers first.
 */
export function topologicalSort(issueTypes: string[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(type: string) {
    if (visited.has(type)) return;
    visited.add(type);
    const rule = DIAGNOSTIC_RULES[type];
    if (rule?.dependsOn) {
      for (const dep of rule.dependsOn) {
        visit(dep);
      }
    }
    result.push(type);
  }

  for (const type of issueTypes) visit(type);
  return result;
}

/**
 * Sort findings by their dependency graph, then by severity, then by priority score.
 * This gives the remediation planner the correct execution order.
 */
export function sortFindingsForRemediation(findings: DiagnosticFinding[]): DiagnosticFinding[] {
  // 1. Build dependency order
  const issueTypes = [...new Set(findings.map(f => {
    // Find the DIAGNOSTIC_RULES key for this finding's issueType
    const ruleEntry = Object.entries(DIAGNOSTIC_RULES).find(([, r]) => r.issueType === f.issueType);
    return ruleEntry?.[0] ?? f.issueType;
  }))];
  const order = topologicalSort(issueTypes);

  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  return [...findings].sort((a, b) => {
    // Dependencies first
    const aRuleKey = Object.entries(DIAGNOSTIC_RULES).find(([, r]) => r.issueType === a.issueType)?.[0] ?? a.issueType;
    const bRuleKey = Object.entries(DIAGNOSTIC_RULES).find(([, r]) => r.issueType === b.issueType)?.[0] ?? b.issueType;
    const aOrder = order.indexOf(aRuleKey);
    const bOrder = order.indexOf(bRuleKey);
    if (aOrder !== bOrder) return aOrder - bOrder;

    // Then severity
    const aSev = SEVERITY_ORDER[a.severity] ?? 3;
    const bSev = SEVERITY_ORDER[b.severity] ?? 3;
    if (aSev !== bSev) return aSev - bSev;

    // Then confidence (higher first)
    return b.confidence - a.confidence;
  });
}
