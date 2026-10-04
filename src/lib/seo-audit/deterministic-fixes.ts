/**
 * src/lib/seo-audit/deterministic-fixes.ts
 *
 * Level 1 fix library — generates exact patches for common SEO issues
 * without any AI/LLM call.
 *
 * Design constraints:
 *   1. Every fix is a pure function (input → patch). No side effects.
 *   2. Every fix includes its own VerificationCriteria.
 *   3. Fixes are the _smallest_ possible change that resolves the issue.
 *   4. If a fix can't be generated deterministically, it returns null
 *      and the remediation planner escalates to AI_PATCH or MANUAL.
 */

import type { VerificationCriterion, RemediationType, FixRisk } from "./diagnostic-types";
import type { AstOperation, AstLanguage } from "@/lib/ast/types";

// ── Fix Result Types ────────────────────────────────────────────────────────

export type PatchAction = "insert" | "replace" | "remove" | "create_file";

export interface FixResult {
  /** The patch content (HTML, XML, text). Null for removals. */
  patch: string | null;
  /** CSS selector targeting where to apply the patch (for HTML fixes) */
  targetSelector?: string;
  /** Where to insert relative to the target */
  insertPosition?: "beforeBegin" | "afterBegin" | "beforeEnd" | "afterEnd";
  /** What action to take */
  action: PatchAction;
  /** File path for create_file actions (e.g. "public/sitemap.xml") */
  filePath?: string;
  /** Structured AST operations corresponding to this deterministic fix */
  astOperations?: AstOperation[];
  /** Target AST language */
  astLanguage?: AstLanguage;
  /**
   * Risk level — controls execution policy, not just display.
   *   SAFE / LOW   → may auto-generate and auto-PR
   *   MEDIUM       → requires explicit approval before PR
   *   HIGH         → requires explicit approval + human review
   *   CRITICAL     → manual workflow only, never auto-applied
   */
  risk: FixRisk;
  /** Verification criteria to confirm the fix worked */
  verification: VerificationCriterion[];
  /** Human-readable description of what this fix does */
  description: string;
  /** Estimated impact on SEO (for dashboard display) */
  impactLabel: string;
}

export interface FixContext {
  /** The URL being fixed */
  url: string;
  /** The preferred/canonical URL */
  preferredUrl?: string;
  /** The site's domain */
  domain: string;
  /** Title of the page (if available) */
  title?: string;
  /** Meta description (if available) */
  metaDescription?: string;
  /** List of discovered URLs (for sitemap generation) */
  discoveredUrls?: string[];
  /** Existing meta robots content */
  robotsContent?: string;
  /** Page's detected page type */
  pageType?: string;
  /** Additional context from the diagnostic finding */
  findingDetails?: Record<string, unknown>;
}

// ── Fix Generator Type ──────────────────────────────────────────────────────

type FixGenerator = (ctx: FixContext) => FixResult | null;

// ── Deterministic Fix Library ───────────────────────────────────────────────

/**
 * Add a self-referencing canonical tag.
 */
const fixCanonicalMissing: FixGenerator = (ctx) => ({
  patch: `<link rel="canonical" href="${ctx.preferredUrl ?? ctx.url}" />`,
  targetSelector: "head",
  insertPosition: "beforeEnd",
  action: "insert",
  astLanguage: "html",
  astOperations: [
    {
      kind: "insertHtmlElement",
      parentSelector: "head",
      position: "append",
      htmlSnippet: `<link rel="canonical" href="${ctx.preferredUrl ?? ctx.url}" />`,
    },
  ],
  risk: "MEDIUM",
  verification: [
    { type: "HTML_SELECTOR", selector: 'link[rel="canonical"]', expected: ctx.preferredUrl ?? ctx.url },
  ],
  description: `Add self-referencing canonical tag pointing to ${ctx.preferredUrl ?? ctx.url}`,
  impactLabel: "Prevents duplicate content issues and consolidates ranking signals",
});

/**
 * Fix a canonical tag that points to a parameterized URL.
 */
const fixCanonicalParameterized: FixGenerator = (ctx) => {
  if (!ctx.preferredUrl) return null;
  return {
    patch: `<link rel="canonical" href="${ctx.preferredUrl}" />`,
    targetSelector: 'link[rel="canonical"]',
    action: "replace",
    astLanguage: "html",
    astOperations: [
      {
        kind: "setHtmlAttribute",
        selector: 'link[rel="canonical"]',
        attributeName: "href",
        value: ctx.preferredUrl,
      },
    ],
    risk: "MEDIUM",
    verification: [
      { type: "HTML_SELECTOR", selector: 'link[rel="canonical"]', expected: ctx.preferredUrl },
    ],
    description: `Update canonical from parameterized URL to clean path: ${ctx.preferredUrl}`,
    impactLabel: "Consolidates ranking signals to the preferred URL",
  };
};

/**
 * Remove a noindex directive from meta robots.
 */
const fixMetaNoindex: FixGenerator = (ctx) => {
  const current = ctx.robotsContent ?? "";
  // Remove "noindex" from the content, keeping other directives
  const cleaned = current
    .split(",")
    .map(d => d.trim())
    .filter(d => d.toLowerCase() !== "noindex")
    .join(", ");

  if (cleaned === "") {
    // If noindex was the only directive, remove the entire tag
    return {
      patch: null,
      targetSelector: 'meta[name="robots"]',
      action: "remove",
      astLanguage: "html",
      astOperations: [
        {
          kind: "removeHtmlAttribute",
          selector: 'meta[name="robots"]',
          attributeName: "content",
        },
      ],
      risk: "HIGH",
      verification: [
        { type: "HTML_SELECTOR", selector: 'meta[name="robots"]', expected: { not_contains: "noindex" } },
      ],
      description: "Remove meta robots noindex directive to allow indexing",
      impactLabel: "Critical — page will become indexable by search engines",
    };
  }

  return {
    patch: `<meta name="robots" content="${cleaned}" />`,
    targetSelector: 'meta[name="robots"]',
    action: "replace",
    astLanguage: "html",
    astOperations: [
      {
        kind: "setHtmlAttribute",
        selector: 'meta[name="robots"]',
        attributeName: "content",
        value: cleaned,
      },
    ],
    risk: "HIGH",
    verification: [
      { type: "HTML_SELECTOR", selector: 'meta[name="robots"]', expected: { not_contains: "noindex" } },
    ],
    description: `Update meta robots from "${current}" to "${cleaned}"`,
    impactLabel: "Critical — page will become indexable by search engines",
  };
};

/**
 * Add a viewport meta tag for mobile responsiveness.
 */
const fixViewportMissing: FixGenerator = () => ({
  patch: '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  targetSelector: "head",
  insertPosition: "afterBegin",
  action: "insert",
  astLanguage: "html",
  astOperations: [
    {
      kind: "insertHtmlElement",
      parentSelector: "head",
      position: "prepend",
      htmlSnippet: '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    },
  ],
  risk: "SAFE",
  verification: [
    { type: "HTML_SELECTOR", selector: 'meta[name="viewport"]', expected: { exists: true } },
  ],
  description: "Add viewport meta tag for mobile-first indexing",
  impactLabel: "Essential for mobile-first indexing and Core Web Vitals",
});

/**
 * Add charset meta tag.
 */
const fixCharsetMissing: FixGenerator = () => ({
  patch: '<meta charset="UTF-8" />',
  targetSelector: "head",
  insertPosition: "afterBegin",
  action: "insert",
  astLanguage: "html",
  astOperations: [
    {
      kind: "insertHtmlElement",
      parentSelector: "head",
      position: "prepend",
      htmlSnippet: '<meta charset="UTF-8" />',
    },
  ],
  risk: "SAFE",
  verification: [
    { type: "HTML_SELECTOR", selector: 'meta[charset]', expected: { exists: true } },
  ],
  description: "Add UTF-8 charset declaration as first element in <head>",
  impactLabel: "Prevents character encoding issues that can corrupt content",
});

/**
 * Add html lang attribute.
 */
const fixHtmlLangMissing: FixGenerator = () => ({
  patch: 'lang="en"',
  targetSelector: "html",
  action: "insert",
  insertPosition: "afterBegin",
  astLanguage: "html",
  astOperations: [
    {
      kind: "setHtmlAttribute",
      selector: "html",
      attributeName: "lang",
      value: "en",
    },
  ],
  risk: "SAFE",
  verification: [
    { type: "HTML_SELECTOR", selector: "html[lang]", expected: { exists: true } },
  ],
  description: 'Add lang="en" attribute to <html> tag',
  impactLabel: "Improves accessibility and internationalization signals",
});

/**
 * Add OpenGraph tags.
 */
const fixOgTagsMissing: FixGenerator = (ctx) => {
  const tags: string[] = [];
  if (ctx.title) {
    tags.push(`<meta property="og:title" content="${escapeAttr(ctx.title)}" />`);
  }
  if (ctx.metaDescription) {
    tags.push(`<meta property="og:description" content="${escapeAttr(ctx.metaDescription)}" />`);
  }
  tags.push(`<meta property="og:url" content="${ctx.preferredUrl ?? ctx.url}" />`);
  tags.push(`<meta property="og:type" content="website" />`);

  if (tags.length === 0) return null;

  return {
    patch: tags.join("\n    "),
    targetSelector: "head",
    insertPosition: "beforeEnd",
    action: "insert",
    astLanguage: "html",
    astOperations: tags.map((t) => ({
      kind: "insertHtmlElement",
      parentSelector: "head",
      position: "append",
      htmlSnippet: t,
    })),
    risk: "LOW",
    verification: [
      { type: "HTML_SELECTOR", selector: 'meta[property="og:title"]', expected: { exists: true } },
    ],
    description: "Add OpenGraph meta tags for social media sharing",
    impactLabel: "Improves social media click-through rate",
  };
};

/**
 * Generate a sitemap.xml from discovered URLs.
 */
const fixSitemapMissing: FixGenerator = (ctx) => {
  if (!ctx.discoveredUrls || ctx.discoveredUrls.length === 0) return null;

  const today = new Date().toISOString().split("T")[0];
  const entries = ctx.discoveredUrls
    .slice(0, 500)
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeXml(url)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`,
    )
    .join("\n");

  return {
    patch: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`,
    filePath: "public/sitemap.xml",
    action: "create_file",
    astLanguage: "xml",
    astOperations: [
      {
        kind: "setXmlNode",
        targetTag: "urlset",
        value: entries,
      },
    ],
    risk: "LOW",
    verification: [
      { type: "HTTP_STATUS", url: "/sitemap.xml", expected: 200 },
      { type: "XML_VALID", url: "/sitemap.xml", expected: true },
    ],
    description: `Generate sitemap.xml with ${ctx.discoveredUrls.length} URLs`,
    impactLabel: "Ensures all pages are discoverable by search engines",
  };
};

/**
 * Generate a robots.txt with sitemap directive.
 */
const fixRobotsTxtMissing: FixGenerator = (ctx) => ({
  patch: [
    "# DRAFT — review before deploying. Sensitive paths (admin, API, auth)",
    "# may need Disallow rules. See https://developers.google.com/search/docs/crawling-indexing/robots/intro",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: https://${ctx.domain}/sitemap.xml`,
    "",
  ].join("\n"),
  filePath: "public/robots.txt",
  action: "create_file",
  astLanguage: "robots",
  astOperations: [
    {
      kind: "setRobotsDirective",
      userAgent: "*",
      directive: "Allow",
      path: "/",
    },
  ],
  risk: "HIGH",
  verification: [
    { type: "HTTP_STATUS", url: "/robots.txt", expected: 200 },
    { type: "ROBOTS_ALLOWED", userAgent: "*", expected: true },
  ],
  description: "DRAFT robots.txt — requires review before deployment. Sensitive paths may need Disallow rules.",
  impactLabel: "Guides search engine crawlers and references sitemap",
});

// ── Utilities ───────────────────────────────────────────────────────────────

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ── Registry ────────────────────────────────────────────────────────────────

/**
 * Registry of deterministic fixes keyed by root-cause ID.
 *
 * The root-cause ID comes from the DIAGNOSTIC_RULES in root-cause-engine.ts.
 * This ensures we can only apply deterministic fixes when the root cause has
 * been identified — not just when a symptom is detected.
 */
export const DETERMINISTIC_FIXES: Record<string, FixGenerator> = {
  // Canonical
  canonical_missing:         fixCanonicalMissing,
  canonical_to_parameter:    fixCanonicalParameterized,

  // Indexing
  meta_noindex:              fixMetaNoindex,

  // Head meta
  viewport_missing:          fixViewportMissing,
  charset_missing:           fixCharsetMissing,
  html_lang_missing:         fixHtmlLangMissing,

  // Social
  og_tags_missing:           fixOgTagsMissing,

  // Sitemap & Robots
  no_sitemap:                fixSitemapMissing,
  robots_txt_missing:        fixRobotsTxtMissing,
};

/**
 * Attempt to generate a deterministic fix for a given root-cause ID.
 *
 * Returns null if:
 *   - No fix generator exists for this root cause
 *   - The generator can't produce a fix with the given context
 *   - The root cause requires AI or manual intervention
 */
export function tryDeterministicFix(
  rootCauseId: string,
  ctx: FixContext,
): FixResult | null {
  const generator = DETERMINISTIC_FIXES[rootCauseId];
  if (!generator) return null;

  try {
    return generator(ctx);
  } catch {
    // Fix generation failed — escalate to next level
    return null;
  }
}

/**
 * Check if a root cause has a deterministic fix available.
 */
export function hasDeterministicFix(rootCauseId: string): boolean {
  return rootCauseId in DETERMINISTIC_FIXES;
}
