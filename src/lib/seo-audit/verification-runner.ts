/**
 * src/lib/seo-audit/verification-runner.ts
 *
 * T+0 Technical Verification Runner.
 *
 * After a fix is deployed, this module re-crawls the target URL and evaluates
 * the VerificationCriterion[] contract from the DiagnosticFinding.
 *
 * Returns a structured result that maps each criterion to PASS/FAIL
 * and computes an overall VerificationOutcome.
 *
 * No Prisma calls — this is a pure verification evaluator.
 * Persistence is handled by the caller (Inngest job or API route).
 */

import { logger } from "@/lib/logger";
import type { VerificationCriterion } from "./diagnostic-types";
import type { VerificationOutcome, VerificationWindow } from "../mutations/types";

// ── Result Types ────────────────────────────────────────────────────────────

export interface CriterionResult {
  criterion: VerificationCriterion;
  passed: boolean;
  actual: unknown;
  error?: string;
}

export interface VerificationResult {
  url: string;
  window: VerificationWindow;
  outcome: VerificationOutcome;
  criteria: CriterionResult[];
  passedCount: number;
  totalCount: number;
  verifiedAt: string;
  durationMs: number;
}

// ── HTML/HTTP Fetcher Interface ─────────────────────────────────────────────

export interface VerificationFetcher {
  /** Fetch HTML content of a URL */
  fetchHtml(url: string): Promise<string | null>;
  /** Fetch HTTP headers of a URL */
  fetchHeaders(url: string): Promise<Record<string, string>>;
  /** Get HTTP status code of a URL */
  getStatus(url: string): Promise<number>;
}

/**
 * Default fetcher using the audit system's existing fetchHtml.
 */
export function createDefaultFetcher(): VerificationFetcher {
  return {
    async fetchHtml(url: string): Promise<string | null> {
      try {
        const { fetchHtml } = await import("./utils/fetch-html");
        return await fetchHtml(url);
      } catch {
        return null;
      }
    },

    async fetchHeaders(url: string): Promise<Record<string, string>> {
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        return headers;
      } catch {
        return {};
      }
    },

    async getStatus(url: string): Promise<number> {
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        return res.status;
      } catch {
        return 0;
      }
    },
  };
}

// ── Criterion Evaluators ────────────────────────────────────────────────────

async function evaluateHtmlSelector(
  criterion: Extract<VerificationCriterion, { type: "HTML_SELECTOR" }>,
  html: string,
): Promise<CriterionResult> {
  try {
    const { parse } = await import("node-html-parser");
    const root = parse(html);
    const element = root.querySelector(criterion.selector);

    if (!element) {
      return {
        criterion,
        passed: criterion.expected === null || criterion.expected === false,
        actual: null,
        error: `No element matching selector: ${criterion.selector}`,
      };
    }

    const actual = element.getAttribute("content") ??
      element.getAttribute("href") ??
      element.textContent?.trim();

    let passed = false;
    const expected = criterion.expected;

    if (typeof expected === "string") {
      passed = actual === expected;
    } else if (expected && typeof expected === "object") {
      const exp = expected as Record<string, unknown>;
      if ("exists" in exp) {
        passed = exp.exists ? !!element : !element;
      }
      if ("not_contains" in exp && typeof exp.not_contains === "string") {
        passed = typeof actual === "string" && !actual.toLowerCase().includes(exp.not_contains.toLowerCase());
      }
      if ("contains" in exp && typeof exp.contains === "string") {
        passed = typeof actual === "string" && actual.toLowerCase().includes(exp.contains.toLowerCase());
      }
    } else {
      passed = !!element;
    }

    return { criterion, passed, actual };
  } catch (err) {
    return {
      criterion,
      passed: false,
      actual: null,
      error: (err as Error)?.message ?? "HTML parse error",
    };
  }
}

async function evaluateHttpStatus(
  criterion: Extract<VerificationCriterion, { type: "HTTP_STATUS" }>,
  fetcher: VerificationFetcher,
  baseUrl: string,
): Promise<CriterionResult> {
  const targetUrl = criterion.url
    ? new URL(criterion.url, baseUrl).toString()
    : baseUrl;

  const status = await fetcher.getStatus(targetUrl);
  const expectedStatuses = Array.isArray(criterion.expected)
    ? criterion.expected
    : [criterion.expected];

  return {
    criterion,
    passed: expectedStatuses.includes(status),
    actual: status,
  };
}

async function evaluateXmlValid(
  criterion: Extract<VerificationCriterion, { type: "XML_VALID" }>,
  fetcher: VerificationFetcher,
  baseUrl: string,
): Promise<CriterionResult> {
  const targetUrl = criterion.url
    ? new URL(criterion.url, baseUrl).toString()
    : baseUrl;

  const content = await fetcher.fetchHtml(targetUrl);
  if (!content) {
    return { criterion, passed: false, actual: null, error: "Could not fetch XML" };
  }

  // Basic XML validity check: starts with <? or <, has matching tags
  const looksLikeXml = content.trimStart().startsWith("<?xml") || content.trimStart().startsWith("<urlset");
  const hasClosingTag = content.includes("</urlset>") || content.includes("</sitemapindex>");

  return {
    criterion,
    passed: criterion.expected ? (looksLikeXml && hasClosingTag) : true,
    actual: { looksLikeXml, hasClosingTag, length: content.length },
  };
}

async function evaluateHeaderValue(
  criterion: Extract<VerificationCriterion, { type: "HEADER_VALUE" }>,
  fetcher: VerificationFetcher,
  baseUrl: string,
): Promise<CriterionResult> {
  const targetUrl = criterion.url
    ? new URL(criterion.url, baseUrl).toString()
    : baseUrl;

  const headers = await fetcher.fetchHeaders(targetUrl);
  const actual = headers[criterion.headerName.toLowerCase()] ?? null;

  let passed = false;
  const expected = criterion.expected;

  if (typeof expected === "string") {
    passed = actual === expected;
  } else if (expected && typeof expected === "object") {
    const exp = expected as Record<string, unknown>;
    if ("not_contains" in exp && typeof exp.not_contains === "string") {
      passed = actual === null || !actual.toLowerCase().includes(exp.not_contains.toLowerCase());
    }
  }

  return { criterion, passed, actual };
}

async function evaluateRobotsAllowed(
  criterion: Extract<VerificationCriterion, { type: "ROBOTS_ALLOWED" }>,
  fetcher: VerificationFetcher,
  baseUrl: string,
): Promise<CriterionResult> {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();
  const content = await fetcher.fetchHtml(robotsUrl);

  if (!content) {
    // No robots.txt = everything is allowed
    return { criterion, passed: criterion.expected === true, actual: "no robots.txt" };
  }

  const targetPath = criterion.url
    ? new URL(criterion.url, baseUrl).pathname
    : "/";

  // Simple robots.txt check — look for Disallow directives
  const lines = content.split("\n");
  const userAgent = criterion.userAgent?.toLowerCase() ?? "*";
  let inMatchingBlock = false;
  let isAllowed = true;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.startsWith("user-agent:")) {
      const ua = trimmed.replace("user-agent:", "").trim();
      inMatchingBlock = ua === userAgent || ua === "*";
    } else if (inMatchingBlock && trimmed.startsWith("disallow:")) {
      const disallowed = trimmed.replace("disallow:", "").trim();
      if (disallowed && targetPath.startsWith(disallowed)) {
        isAllowed = false;
      }
    }
  }

  return {
    criterion,
    passed: isAllowed === criterion.expected,
    actual: isAllowed,
  };
}

async function evaluateSchemaPresent(
  criterion: Extract<VerificationCriterion, { type: "SCHEMA_PRESENT" }>,
  html: string,
): Promise<CriterionResult> {
  try {
    const { parse } = await import("node-html-parser");
    const root = parse(html);
    const scripts = root.querySelectorAll('script[type="application/ld+json"]');
    const hasSchema = scripts.length > 0;

    return {
      criterion,
      passed: hasSchema === criterion.expected,
      actual: { schemaCount: scripts.length },
    };
  } catch (err) {
    return {
      criterion,
      passed: false,
      actual: null,
      error: (err as Error)?.message ?? "Schema check error",
    };
  }
}

// ── Main Runner ─────────────────────────────────────────────────────────────

/**
 * Run T+0 technical verification against a set of criteria.
 *
 * Re-crawls the URL and evaluates each VerificationCriterion.
 * Returns a structured result with per-criterion pass/fail and an overall outcome.
 */
export async function runTechnicalVerification(
  url: string,
  criteria: VerificationCriterion[],
  fetcher?: VerificationFetcher,
): Promise<VerificationResult> {
  const t0 = performance.now();
  const f = fetcher ?? createDefaultFetcher();

  // Fetch HTML once for all HTML-based checks
  let html = "";
  const needsHtml = criteria.some(
    c => c.type === "HTML_SELECTOR" || c.type === "SCHEMA_PRESENT",
  );

  if (needsHtml) {
    html = (await f.fetchHtml(url)) ?? "";
  }

  // Evaluate each criterion
  const results: CriterionResult[] = [];

  for (const criterion of criteria) {
    try {
      let result: CriterionResult;

      switch (criterion.type) {
        case "HTML_SELECTOR":
          result = await evaluateHtmlSelector(criterion, html);
          break;
        case "HTTP_STATUS":
          result = await evaluateHttpStatus(criterion, f, url);
          break;
        case "XML_VALID":
          result = await evaluateXmlValid(criterion, f, url);
          break;
        case "HEADER_VALUE":
          result = await evaluateHeaderValue(criterion, f, url);
          break;
        case "ROBOTS_ALLOWED":
          result = await evaluateRobotsAllowed(criterion, f, url);
          break;
        case "SCHEMA_PRESENT":
          result = await evaluateSchemaPresent(criterion, html);
          break;
        case "URL_PRESENT":
          // Check if a URL returns 200
          result = {
            criterion,
            passed: (await f.getStatus(criterion.url)) === 200 === criterion.expected,
            actual: await f.getStatus(criterion.url),
          };
          break;
        case "GSC_INDEXED":
          // GSC indexing check requires API access — deferred to T+7
          result = {
            criterion,
            passed: false,
            actual: null,
            error: "GSC indexing check deferred to T+7 verification window",
          };
          break;
        default:
          result = {
            criterion,
            passed: false,
            actual: null,
            error: `Unknown criterion type: ${(criterion as { type: string }).type}`,
          };
      }

      results.push(result);
    } catch (err) {
      results.push({
        criterion,
        passed: false,
        actual: null,
        error: (err as Error)?.message ?? "Evaluation error",
      });
    }
  }

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const durationMs = Math.round(performance.now() - t0);

  // Determine outcome
  let outcome: VerificationOutcome;
  if (totalCount === 0) {
    outcome = "UNKNOWN";
  } else if (passedCount === totalCount) {
    outcome = "TECHNICALLY_VERIFIED";
  } else if (passedCount > 0) {
    outcome = "PARTIALLY_VERIFIED";
  } else {
    outcome = "PENDING"; // All criteria failed — fix may not have deployed yet
  }

  return {
    url,
    window: "T0_TECHNICAL",
    outcome,
    criteria: results,
    passedCount,
    totalCount,
    verifiedAt: new Date().toISOString(),
    durationMs,
  };
}
