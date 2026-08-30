// =============================================================================
// VERIFICATION CHECKS — Individual HTML/HTTP Verification Implementations
//
// Each VerificationCheckType has a concrete implementation that inspects
// parsed HTML to determine whether a fix was actually applied.
//
// These checks are used by the Verification Loop to close the feedback loop.
// =============================================================================

import { parse, HTMLElement } from "node-html-parser";
import {
  type VerificationCheckType,
  type VerificationDetail,
  type VerificationCriterion,
} from "./types";

// ── Parsed Page Context ─────────────────────────────────────────────────────

export interface ParsedPage {
  /** Raw HTML string */
  html: string;
  /** Parsed HTML root */
  root: HTMLElement;
  /** HTTP status code from the fetch */
  httpStatus: number;
  /** The URL that was fetched */
  fetchedUrl: string;
}

/**
 * Parses raw HTML + HTTP metadata into a PageContext for verification checks.
 */
export function parsePage(
  html: string,
  httpStatus: number,
  fetchedUrl: string
): ParsedPage {
  return {
    html,
    root: parse(html),
    httpStatus,
    fetchedUrl,
  };
}

// ── Check Runner ────────────────────────────────────────────────────────────

/**
 * Runs a single verification criterion against a parsed page.
 */
export function runCheck(
  criterion: VerificationCriterion,
  page: ParsedPage
): VerificationDetail {
  const handler = CHECK_HANDLERS[criterion.check];
  if (!handler) {
    return {
      check: criterion.check,
      passed: false,
      message: `Unknown verification check: ${criterion.check}`,
    };
  }
  return handler(criterion, page);
}

/**
 * Runs all verification criteria against a parsed page.
 * Returns the individual results and an aggregate outcome.
 */
export function runAllChecks(
  criteria: VerificationCriterion[],
  page: ParsedPage
): { details: VerificationDetail[]; allCriticalPassed: boolean } {
  const details = criteria.map((c) => runCheck(c, page));
  const allCriticalPassed = criteria.every((criterion, i) => {
    if (criterion.critical === false) return true; // advisory — doesn't count
    return details[i].passed;
  });
  return { details, allCriticalPassed };
}

// ── Check Implementations ───────────────────────────────────────────────────

type CheckHandler = (
  criterion: VerificationCriterion,
  page: ParsedPage
) => VerificationDetail;

const CHECK_HANDLERS: Record<VerificationCheckType, CheckHandler> = {
  // ── Meta Description ────────────────────────────────────────────────────

  HAS_META_DESCRIPTION: (_criterion, page) => {
    const meta = page.root.querySelector("meta[name='description']");
    const content = meta?.getAttribute("content")?.trim();
    return {
      check: "HAS_META_DESCRIPTION",
      passed: !!content && content.length > 0,
      actualValue: content ?? null,
      message: content
        ? `Meta description found (${content.length} chars)`
        : "No meta description found",
    } as VerificationDetail;
  },

  META_DESCRIPTION_MATCHES: (criterion, page) => {
    const meta = page.root.querySelector("meta[name='description']");
    const content = meta?.getAttribute("content")?.trim() ?? "";
    const expected = criterion.expectedValue?.trim() ?? "";
    const matches = content === expected;
    return {
      check: "META_DESCRIPTION_MATCHES",
      passed: matches,
      actualValue: content,
      expectedValue: expected,
      message: matches
        ? "Meta description matches expected value"
        : `Meta description mismatch: got "${content.slice(0, 80)}..."`,
    };
  },

  META_DESCRIPTION_LENGTH_VALID: (_criterion, page) => {
    const meta = page.root.querySelector("meta[name='description']");
    const content = meta?.getAttribute("content")?.trim() ?? "";
    const len = content.length;
    const valid = len >= 50 && len <= 160;
    return {
      check: "META_DESCRIPTION_LENGTH_VALID",
      passed: valid,
      actualValue: String(len),
      message: valid
        ? `Meta description length OK (${len} chars)`
        : `Meta description length out of range: ${len} chars (expected 50–160)`,
    };
  },

  // ── Title ───────────────────────────────────────────────────────────────

  HAS_TITLE: (_criterion, page) => {
    const title = page.root.querySelector("title");
    const text = title?.text?.trim();
    return {
      check: "HAS_TITLE",
      passed: !!text && text.length > 0,
      actualValue: text ?? null,
      message: text
        ? `Title found: "${text.slice(0, 80)}"`
        : "No <title> tag found",
    } as VerificationDetail;
  },

  TITLE_MATCHES: (criterion, page) => {
    const title = page.root.querySelector("title");
    const text = title?.text?.trim() ?? "";
    const expected = criterion.expectedValue?.trim() ?? "";
    const matches = text === expected;
    return {
      check: "TITLE_MATCHES",
      passed: matches,
      actualValue: text,
      expectedValue: expected,
      message: matches
        ? "Title matches expected value"
        : `Title mismatch: got "${text.slice(0, 80)}"`,
    };
  },

  // ── Canonical ───────────────────────────────────────────────────────────

  HAS_CANONICAL: (_criterion, page) => {
    const canonical = page.root.querySelector("link[rel='canonical']");
    const href = canonical?.getAttribute("href")?.trim();
    return {
      check: "HAS_CANONICAL",
      passed: !!href && href.length > 0,
      actualValue: href ?? null,
      message: href
        ? `Canonical tag found: ${href}`
        : "No canonical tag found",
    } as VerificationDetail;
  },

  CANONICAL_MATCHES: (criterion, page) => {
    const canonical = page.root.querySelector("link[rel='canonical']");
    const href = canonical?.getAttribute("href")?.trim() ?? "";
    const expected = criterion.expectedValue?.trim() ?? "";
    const matches = href === expected;
    return {
      check: "CANONICAL_MATCHES",
      passed: matches,
      actualValue: href,
      expectedValue: expected,
      message: matches
        ? "Canonical matches expected value"
        : `Canonical mismatch: got "${href}"`,
    };
  },

  CANONICAL_UNCHANGED: (criterion, page) => {
    // Pass if canonical exists and matches the expectedValue (the original)
    // or if no expectedValue was provided (we just check it exists)
    const canonical = page.root.querySelector("link[rel='canonical']");
    const href = canonical?.getAttribute("href")?.trim() ?? "";
    if (!criterion.expectedValue) {
      return {
        check: "CANONICAL_UNCHANGED",
        passed: true,
        actualValue: href,
        message: "No baseline canonical to compare against — check skipped",
      };
    }
    const matches = href === criterion.expectedValue.trim();
    return {
      check: "CANONICAL_UNCHANGED",
      passed: matches,
      actualValue: href,
      expectedValue: criterion.expectedValue,
      message: matches
        ? "Canonical unchanged after modification"
        : `Canonical was unexpectedly changed from "${criterion.expectedValue}" to "${href}"`,
    };
  },

  // ── Headings ────────────────────────────────────────────────────────────

  HAS_H1: (_criterion, page) => {
    const h1s = page.root.querySelectorAll("h1");
    return {
      check: "HAS_H1",
      passed: h1s.length > 0,
      actualValue: h1s.length > 0 ? h1s[0].text.trim().slice(0, 80) : null,
      message:
        h1s.length > 0
          ? `H1 found: "${h1s[0].text.trim().slice(0, 80)}"`
          : "No <h1> tag found",
    } as VerificationDetail;
  },

  SINGLE_H1: (_criterion, page) => {
    const h1s = page.root.querySelectorAll("h1");
    return {
      check: "SINGLE_H1",
      passed: h1s.length === 1,
      actualValue: String(h1s.length),
      message:
        h1s.length === 1
          ? "Exactly one H1 found"
          : `Found ${h1s.length} H1 tags (expected 1)`,
    };
  },

  HEADING_HIERARCHY_VALID: (_criterion, page) => {
    const headings = page.root.querySelectorAll("h1, h2, h3, h4, h5, h6");
    let currentLevel = 0;
    let gaps = 0;

    for (const h of headings) {
      const level = parseInt(h.tagName.substring(1), 10);
      if (currentLevel > 0 && level > currentLevel + 1) {
        gaps++;
      }
      currentLevel = level;
    }

    return {
      check: "HEADING_HIERARCHY_VALID",
      passed: gaps === 0,
      actualValue: `${gaps} gaps`,
      message:
        gaps === 0
          ? "Heading hierarchy is valid (no skipped levels)"
          : `${gaps} heading level gap(s) detected`,
    };
  },

  // ── Schema Markup ───────────────────────────────────────────────────────

  SCHEMA_MARKUP_PRESENT: (_criterion, page) => {
    const scripts = page.root.querySelectorAll(
      "script[type='application/ld+json']"
    );
    return {
      check: "SCHEMA_MARKUP_PRESENT",
      passed: scripts.length > 0,
      actualValue: String(scripts.length),
      message:
        scripts.length > 0
          ? `${scripts.length} JSON-LD script(s) found`
          : "No JSON-LD schema markup found",
    };
  },

  SCHEMA_MARKUP_VALID: (_criterion, page) => {
    const scripts = page.root.querySelectorAll(
      "script[type='application/ld+json']"
    );
    let validCount = 0;
    let errorCount = 0;

    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.text);
        if (parsed["@context"] && parsed["@type"]) {
          validCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    return {
      check: "SCHEMA_MARKUP_VALID",
      passed: errorCount === 0 && validCount > 0,
      actualValue: `${validCount} valid, ${errorCount} invalid`,
      message:
        errorCount === 0
          ? `All ${validCount} schema script(s) are valid JSON-LD`
          : `${errorCount} schema script(s) have JSON-LD errors`,
    };
  },

  // ── Internal Links ──────────────────────────────────────────────────────

  INTERNAL_LINK_EXISTS: (criterion, page) => {
    const targetUrl = criterion.targetUrl ?? criterion.expectedValue ?? "";
    const links = page.root.querySelectorAll("a");
    const found = links.some((a) => {
      const href = a.getAttribute("href") ?? "";
      return href === targetUrl || href.endsWith(targetUrl);
    });
    return {
      check: "INTERNAL_LINK_EXISTS",
      passed: found,
      expectedValue: targetUrl,
      message: found
        ? `Internal link to "${targetUrl}" found`
        : `No internal link to "${targetUrl}" found`,
    };
  },

  // ── HTTP Status ─────────────────────────────────────────────────────────

  HTTP_STATUS_200: (_criterion, page) => {
    return {
      check: "HTTP_STATUS_200",
      passed: page.httpStatus === 200,
      actualValue: String(page.httpStatus),
      message:
        page.httpStatus === 200
          ? "HTTP 200 OK"
          : `HTTP ${page.httpStatus} (expected 200)`,
    };
  },

  // ── Robots Meta ─────────────────────────────────────────────────────────

  ROBOTS_META_UNCHANGED: (criterion, page) => {
    const robotsMeta = page.root.querySelector("meta[name='robots']");
    const content = robotsMeta?.getAttribute("content")?.trim() ?? "";
    if (!criterion.expectedValue) {
      // No baseline — check that no noindex was introduced
      const hasNoindex = content.toLowerCase().includes("noindex");
      return {
        check: "ROBOTS_META_UNCHANGED",
        passed: !hasNoindex,
        actualValue: content || "(none)",
        message: hasNoindex
          ? "WARNING: noindex was introduced"
          : "No destructive robots meta change detected",
      };
    }
    const matches = content === criterion.expectedValue.trim();
    return {
      check: "ROBOTS_META_UNCHANGED",
      passed: matches,
      actualValue: content || "(none)",
      expectedValue: criterion.expectedValue,
      message: matches
        ? "Robots meta unchanged"
        : `Robots meta changed from "${criterion.expectedValue}" to "${content}"`,
    };
  },

  // ── Indexability ────────────────────────────────────────────────────────

  PAGE_INDEXABLE: (_criterion, page) => {
    const robotsMeta = page.root.querySelector("meta[name='robots']");
    const content = robotsMeta?.getAttribute("content")?.toLowerCase() ?? "";
    const hasNoindex = content.includes("noindex");
    return {
      check: "PAGE_INDEXABLE",
      passed: !hasNoindex && page.httpStatus === 200,
      actualValue: hasNoindex ? "noindex" : "indexable",
      message:
        !hasNoindex && page.httpStatus === 200
          ? "Page is indexable (HTTP 200, no noindex)"
          : hasNoindex
            ? "Page has noindex directive"
            : `Page returned HTTP ${page.httpStatus}`,
    };
  },

  // ── Content ─────────────────────────────────────────────────────────────

  CONTENT_CONTAINS_KEYWORD: (criterion, page) => {
    const keyword = criterion.expectedValue?.toLowerCase() ?? "";
    if (!keyword) {
      return {
        check: "CONTENT_CONTAINS_KEYWORD",
        passed: true,
        message: "No keyword specified — check skipped",
      };
    }
    const bodyText = page.root.querySelector("body")?.text?.toLowerCase() ?? "";
    const found = bodyText.includes(keyword);
    return {
      check: "CONTENT_CONTAINS_KEYWORD",
      passed: found,
      expectedValue: keyword,
      message: found
        ? `Keyword "${keyword}" found in page content`
        : `Keyword "${keyword}" not found in page content`,
    };
  },
};
