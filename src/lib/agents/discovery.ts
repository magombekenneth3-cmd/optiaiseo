// =============================================================================
// DISCOVERY AGENT — Site discovery (robots.txt + sitemaps + URL patterns)
//
// Pure function. No Prisma, no Inngest.
// Fetches and parses robots.txt and XML sitemaps to build a picture of the
// site's content architecture before the crawl begins.
// =============================================================================

import { isSafeUrl } from "@/lib/security/safe-url";
import { logger } from "@/lib/logger";
import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding, AgentError } from "./types";
import type { DiscoveryData } from "./snapshots";

const FETCH_TIMEOUT_MS = 10_000;

// ── Public API ──────────────────────────────────────────────────────────────

export async function analyzeDiscovery(
  siteId: string,
  domain: string,
): Promise<AgentExecution<DiscoveryData>> {
  const findings: AgentFinding[] = [];
  const errors: AgentError[] = [];

  const origin = domain.startsWith("http") ? domain : `https://${domain}`;
  const parsedOrigin = new URL(origin).origin;

  // 1. Fetch and parse robots.txt
  const robotsTxt = await fetchRobotsTxt(parsedOrigin);

  if (!robotsTxt.raw) {
    findings.push({
      type: "MISSING_ROBOTS_TXT",
      severity: "MEDIUM",
      title: "Missing robots.txt",
      description: `No robots.txt file found at ${parsedOrigin}/robots.txt. Search engines rely on this file to understand crawl directives.`,
      evidence: [
        {
          sourceType: "ROBOTS",
          metric: "exists",
          value: "false",
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "SITE", id: parsedOrigin },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "MISSING_ROBOTS_TXT",
        resourceType: "SITE",
        resourceId: parsedOrigin,
      }),
    });
  }

  // 2. Check for missing sitemap declaration in robots.txt
  if (robotsTxt.raw && robotsTxt.sitemapDeclarations.length === 0) {
    findings.push({
      type: "NO_SITEMAP_IN_ROBOTS",
      severity: "LOW",
      title: "No sitemap declared in robots.txt",
      description:
        "robots.txt exists but does not declare a Sitemap: directive. Declaring sitemaps in robots.txt helps search engines discover all XML sitemaps.",
      evidence: [
        {
          sourceType: "ROBOTS",
          metric: "sitemapDeclarations",
          value: "0",
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "SITE", id: parsedOrigin },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "NO_SITEMAP_IN_ROBOTS",
        resourceType: "SITE",
        resourceId: parsedOrigin,
      }),
    });
  }

  // 3. Discover and parse XML sitemaps
  const sitemapSources = [
    ...robotsTxt.sitemapDeclarations,
    `${parsedOrigin}/sitemap.xml`,
    `${parsedOrigin}/sitemap_index.xml`,
  ];
  const uniqueSitemapSources = [...new Set(sitemapSources)];

  const { urls: sitemapUrls, errorList: sitemapErrors } =
    await fetchSitemapUrls(uniqueSitemapSources);

  for (const err of sitemapErrors) {
    errors.push(err);
  }

  if (sitemapUrls.length === 0) {
    findings.push({
      type: "NO_SITEMAP_FOUND",
      severity: "HIGH",
      title: "No XML sitemap found",
      description:
        "No XML sitemap could be found or parsed. XML sitemaps help search engines discover and index all pages on your site.",
      evidence: [
        {
          sourceType: "SITEMAP",
          metric: "urlCount",
          value: "0",
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "SITE", id: parsedOrigin },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "NO_SITEMAP_FOUND",
        resourceType: "SITE",
        resourceId: parsedOrigin,
      }),
    });
  }

  // 4. Classify content types from URL patterns
  const contentTypes = classifyUrlPatterns(sitemapUrls, parsedOrigin);

  // 5. Detect languages from sitemap hreflang or URL patterns
  const languages = detectLanguages(sitemapUrls, parsedOrigin);

  const data: DiscoveryData = {
    sitemapUrls,
    robotsTxt,
    contentTypes,
    languages,
  };

  return {
    data,
    findings,
    errors: errors.length > 0 ? errors : undefined,
    itemsProcessed: sitemapUrls.length,
  };
}

// ── Robots.txt ──────────────────────────────────────────────────────────────

interface RobotsTxtResult {
  raw: string;
  disallowedPaths: string[];
  sitemapDeclarations: string[];
}

async function fetchRobotsTxt(origin: string): Promise<RobotsTxtResult> {
  const empty: RobotsTxtResult = {
    raw: "",
    disallowedPaths: [],
    sitemapDeclarations: [],
  };

  try {
    const guard = isSafeUrl(`${origin}/robots.txt`);
    if (!guard.ok) return empty;

    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return empty;
    const raw = await res.text();

    const disallowedPaths: string[] = [];
    const sitemapDeclarations: string[] = [];
    let appliesToUs = false;

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();

      if (lower.startsWith("user-agent:")) {
        const agent = lower.replace("user-agent:", "").trim();
        appliesToUs = agent === "*" || agent.includes("seotool-bot");
      }

      if (appliesToUs && lower.startsWith("disallow:")) {
        const path = trimmed.replace(/^disallow:\s*/i, "").trim();
        if (path) disallowedPaths.push(path);
      }

      if (lower.startsWith("sitemap:")) {
        const url = trimmed.replace(/^sitemap:\s*/i, "").trim();
        if (url) sitemapDeclarations.push(url);
      }
    }

    return { raw, disallowedPaths, sitemapDeclarations };
  } catch {
    return empty;
  }
}

// ── Sitemap Parsing ─────────────────────────────────────────────────────────

async function fetchSitemapUrls(
  sources: string[],
): Promise<{ urls: string[]; errorList: AgentError[] }> {
  const allUrls = new Set<string>();
  const errorList: AgentError[] = [];
  const visited = new Set<string>();

  async function processSitemap(url: string, depth = 0): Promise<void> {
    if (depth > 3 || visited.has(url)) return;
    visited.add(url);

    const guard = isSafeUrl(url);
    if (!guard.ok) return;

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) return;

      const xml = await res.text();

      // Check if this is a sitemap index
      const sitemapIndexMatches = [
        ...xml.matchAll(/<sitemap>\s*<loc>\s*([^<]+)\s*<\/loc>/gi),
      ];

      if (sitemapIndexMatches.length > 0) {
        // Recursively process child sitemaps
        for (const match of sitemapIndexMatches.slice(0, 50)) {
          await processSitemap(match[1].trim(), depth + 1);
        }
        return;
      }

      // Regular sitemap: extract URLs
      const urlMatches = [...xml.matchAll(/<url>\s*<loc>\s*([^<]+)\s*<\/loc>/gi)];
      for (const match of urlMatches) {
        allUrls.add(match[1].trim());
      }
    } catch (err: unknown) {
      logger.warn("[DiscoveryAgent] Failed to fetch sitemap", {
        url,
        error: (err as Error)?.message,
      });
      errorList.push({
        code: "SITEMAP_FETCH_FAILED",
        message: `Failed to fetch sitemap: ${url} — ${(err as Error)?.message ?? "unknown"}`,
        recoverable: true,
      });
    }
  }

  for (const source of sources) {
    await processSitemap(source);
  }

  return { urls: [...allUrls], errorList };
}

// ── URL Classification ──────────────────────────────────────────────────────

function classifyUrlPatterns(
  urls: string[],
  origin: string,
): Record<string, number> {
  const patterns: Record<string, number> = {};

  for (const url of urls) {
    let path: string;
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      continue;
    }

    const type = classifyPath(path);
    patterns[type] = (patterns[type] ?? 0) + 1;
  }

  return patterns;
}

function classifyPath(path: string): string {
  if (/^\/(blog|articles?|posts?|news)\//i.test(path)) return "blog";
  if (/^\/(products?|shop|store|catalog)\//i.test(path)) return "product";
  if (/^\/(category|categories|collections?)\//i.test(path)) return "category";
  if (/^\/(docs?|documentation|help|support|kb|knowledge-base)\//i.test(path))
    return "documentation";
  if (/^\/(about|team|careers|contact|pricing|faq)\/?$/i.test(path))
    return "marketing";
  if (/^\/(tags?|topics?|labels?)\//i.test(path)) return "taxonomy";
  if (/^\/(authors?|profiles?|users?)\//i.test(path)) return "author";
  return "other";
}

// ── Language Detection ──────────────────────────────────────────────────────

function detectLanguages(urls: string[], origin: string): string[] {
  const languages = new Set<string>();

  for (const url of urls) {
    try {
      const path = new URL(url).pathname;
      // Match patterns like /en/, /fr/, /de/, /en-us/, /pt-br/
      const langMatch = path.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i);
      if (langMatch) {
        languages.add(langMatch[1].toLowerCase());
      }
    } catch {
      continue;
    }
  }

  // If no language prefixes found, assume English
  if (languages.size === 0) {
    languages.add("en");
  }

  return [...languages];
}
