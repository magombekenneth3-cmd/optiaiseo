// =============================================================================
// PAGE EXISTENCE RESOLVER
//
// For every TOPIC_OPPORTUNITY finding, determines whether a relevant page
// already exists on the site before recommending CREATE_NEW_CONTENT.
//
// Decision hierarchy (highest confidence first):
//   1. GSC ranking URL — Google already associates a page with the query
//   2. Blog/Content record — an existing content record targets these keywords
//   3. PageAudit URL match — a crawled page with matching URL slug/path
//   4. GscDailyPerformance URL — any page ranking for similar queries
//
// Output: PageExistenceResult with verdict + evidence trail
// =============================================================================

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ── Result Types ────────────────────────────────────────────────────────────

export type PageExistenceVerdict =
  | "EXISTING_HEALTHY"     // Page exists & ranks acceptably — monitor only
  | "EXISTING_NEEDS_FIX"   // Page exists but underperforms — optimize it
  | "EXISTING_CANNIBALIZED" // Multiple pages compete for same intent
  | "MISSING";             // No relevant page found — create new content

export interface ExistingPageEvidence {
  /** The URL of the existing page */
  url: string;
  /** How the match was found */
  matchSource:
    | "GSC_RANKING_URL"
    | "BLOG_RECORD"
    | "PAGE_AUDIT"
    | "GSC_BROAD_MATCH";
  /** Confidence of the match (0–1) */
  matchConfidence: number;
  /** Current GSC position for the topic query (if available) */
  currentPosition?: number;
  /** Current impressions (if available) */
  currentImpressions?: number;
  /** Current clicks (if available) */
  currentClicks?: number;
  /** Issues detected on the existing page */
  issues: string[];
}

export interface PageExistenceResult {
  verdict: PageExistenceVerdict;
  /** The best-matching existing page (null if MISSING) */
  existingPage: ExistingPageEvidence | null;
  /** All candidate pages found (for cannibalization detection) */
  allCandidates: ExistingPageEvidence[];
  /** Recommended action override based on the verdict */
  recommendedAction: string;
  /** Recommended category override */
  recommendedCategory: string;
  /** Human-readable explanation of the decision */
  reasoning: string;
}

// ── Configuration ───────────────────────────────────────────────────────────

/** Position threshold: above this, the page is "not really ranking" for the topic */
const WEAK_RANKING_THRESHOLD = 30;

/** Position threshold: below this (inclusive), the page is healthy */
const HEALTHY_POSITION_THRESHOLD = 20;

/** Minimum token overlap ratio for slug/title matching */
const SLUG_MATCH_THRESHOLD = 0.4;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves whether a relevant page already exists for a topic opportunity.
 *
 * Uses existing Prisma models (GscDailyPerformance, Blog, PageAudit) —
 * no new tables, no LLM calls. Pure evidence-based decision.
 */
export async function resolvePageExistence(
  siteId: string,
  topicKeyword: string,
  clusterQueries: string[],
): Promise<PageExistenceResult> {
  const candidates: ExistingPageEvidence[] = [];

  // ── Step 1: Check GSC for pages already ranking for this exact query ────
  const gscMatches = await findGscRankingPages(siteId, topicKeyword, clusterQueries);
  candidates.push(...gscMatches);

  // ── Step 2: Check Blog records with matching target keywords ────────────
  const blogMatches = await findMatchingBlogRecords(siteId, topicKeyword, clusterQueries);
  for (const blog of blogMatches) {
    // Avoid duplicates — only add if URL not already found
    if (!candidates.some((c) => normalizeUrl(c.url) === normalizeUrl(blog.url))) {
      candidates.push(blog);
    }
  }

  // ── Step 3: Check PageAudit for crawled pages with matching slugs ───────
  const auditMatches = await findMatchingPageAudits(siteId, topicKeyword);
  for (const audit of auditMatches) {
    if (!candidates.some((c) => normalizeUrl(c.url) === normalizeUrl(audit.url))) {
      candidates.push(audit);
    }
  }

  // ── Step 4: Make the decision ──────────────────────────────────────────
  return makeDecision(candidates, topicKeyword);
}

// ── Evidence Gathering Functions ────────────────────────────────────────────

/**
 * Step 1: Query GscDailyPerformance for pages Google associates with this topic.
 * This is the strongest signal — Google is literally showing this page for the query.
 */
async function findGscRankingPages(
  siteId: string,
  topicKeyword: string,
  clusterQueries: string[],
): Promise<ExistingPageEvidence[]> {
  // Look for GSC rows where the keyword matches any cluster query
  // Use the top 10 cluster queries to keep the DB query bounded
  const queryTerms = [topicKeyword, ...clusterQueries.slice(0, 9)];

  try {
    const gscRows = await prisma.gscDailyPerformance.findMany({
      where: {
        siteId,
        keyword: { in: queryTerms },
      },
      orderBy: { fetchedAt: "desc" },
      // Get the most recent data — cap at a reasonable number
      take: 100,
    });

    if (gscRows.length === 0) return [];

    // Aggregate by URL to find the best-performing page per URL
    const urlMap = new Map<
      string,
      { clicks: number; impressions: number; positionSum: number; count: number; keywords: Set<string> }
    >();

    for (const row of gscRows) {
      const norm = normalizeUrl(row.url);
      const existing = urlMap.get(norm);
      if (existing) {
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
        existing.positionSum += row.position * row.impressions;
        existing.count++;
        existing.keywords.add(row.keyword);
      } else {
        urlMap.set(norm, {
          clicks: row.clicks,
          impressions: row.impressions,
          positionSum: row.position * row.impressions,
          count: 1,
          keywords: new Set([row.keyword]),
        });
      }
    }

    const results: ExistingPageEvidence[] = [];

    for (const [url, data] of urlMap) {
      const avgPosition = data.impressions > 0 ? data.positionSum / data.impressions : 100;
      const keywordOverlap = data.keywords.size / queryTerms.length;

      results.push({
        url,
        matchSource: "GSC_RANKING_URL",
        matchConfidence: Math.min(1, 0.7 + keywordOverlap * 0.3),
        currentPosition: Math.round(avgPosition * 10) / 10,
        currentImpressions: data.impressions,
        currentClicks: data.clicks,
        issues: detectGscIssues(avgPosition, data.clicks, data.impressions),
      });
    }

    // Sort by impression volume descending (most significant page first)
    results.sort((a, b) => (b.currentImpressions ?? 0) - (a.currentImpressions ?? 0));

    return results;
  } catch (err) {
    logger.warn("[PageExistenceResolver] GSC lookup failed", {
      siteId,
      error: (err as Error)?.message,
    });
    return [];
  }
}

/**
 * Step 2: Check Blog records for keyword matches.
 * Blogs have `targetKeywords` arrays — we check for overlap with the topic.
 */
async function findMatchingBlogRecords(
  siteId: string,
  topicKeyword: string,
  clusterQueries: string[],
): Promise<ExistingPageEvidence[]> {
  try {
    // Search for blogs whose targetKeywords overlap with the topic
    // Prisma's array `hasSome` checks for intersection
    const blogs = await prisma.blog.findMany({
      where: {
        siteId,
        deletedAt: null,
        status: { notIn: ["DELETED", "REJECTED"] },
        targetKeywords: {
          hasSome: [topicKeyword, ...clusterQueries.slice(0, 9)],
        },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        sourceUrl: true,
        targetKeywords: true,
        publishedAt: true,
        updatedAt: true,
        needsRefresh: true,
        validationScore: true,
      },
      take: 10,
    });

    if (blogs.length === 0) {
      // Fallback: check if any blog slug/title contains topic tokens
      return findBlogsBySlugMatch(siteId, topicKeyword);
    }

    return blogs.map((blog) => {
      const url = blog.sourceUrl || `/blog/${blog.slug}`;
      const issues: string[] = [];

      if (blog.needsRefresh) issues.push("NEEDS_REFRESH");
      if (blog.status === "DRAFT") issues.push("STILL_IN_DRAFT");
      if (blog.validationScore !== null && blog.validationScore < 60) {
        issues.push("LOW_VALIDATION_SCORE");
      }
      if (blog.publishedAt && daysSince(blog.publishedAt) > 180) {
        issues.push("STALE_CONTENT");
      }

      // Compute keyword overlap confidence
      const matchingKeywords = blog.targetKeywords.filter(
        (kw) => kw === topicKeyword || clusterQueries.includes(kw),
      );
      const overlapRatio = matchingKeywords.length / Math.max(1, blog.targetKeywords.length);

      return {
        url,
        matchSource: "BLOG_RECORD" as const,
        matchConfidence: Math.min(1, 0.6 + overlapRatio * 0.4),
        issues,
      };
    });
  } catch (err) {
    logger.warn("[PageExistenceResolver] Blog lookup failed", {
      siteId,
      error: (err as Error)?.message,
    });
    return [];
  }
}

/**
 * Fallback blog search: tokenize the topic and match against slugs.
 */
async function findBlogsBySlugMatch(
  siteId: string,
  topicKeyword: string,
): Promise<ExistingPageEvidence[]> {
  const topicTokens = tokenize(topicKeyword);
  if (topicTokens.length === 0) return [];

  try {
    // Fetch recent blogs for this site and check slug overlap
    const blogs = await prisma.blog.findMany({
      where: {
        siteId,
        deletedAt: null,
        status: { notIn: ["DELETED", "REJECTED"] },
      },
      select: {
        slug: true,
        title: true,
        sourceUrl: true,
        status: true,
        needsRefresh: true,
        publishedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200, // Reasonable cap
    });

    const results: ExistingPageEvidence[] = [];

    for (const blog of blogs) {
      const slugTokens = tokenize(blog.slug.replace(/-/g, " "));
      const titleTokens = tokenize(blog.title);
      const combinedTokens = new Set([...slugTokens, ...titleTokens]);

      const overlap = topicTokens.filter((t) => combinedTokens.has(t)).length;
      const overlapRatio = overlap / topicTokens.length;

      if (overlapRatio >= SLUG_MATCH_THRESHOLD) {
        const issues: string[] = [];
        if (blog.needsRefresh) issues.push("NEEDS_REFRESH");
        if (blog.status === "DRAFT") issues.push("STILL_IN_DRAFT");
        if (blog.publishedAt && daysSince(blog.publishedAt) > 180) {
          issues.push("STALE_CONTENT");
        }

        results.push({
          url: blog.sourceUrl || `/blog/${blog.slug}`,
          matchSource: "BLOG_RECORD",
          matchConfidence: Math.min(1, 0.4 + overlapRatio * 0.4),
          issues,
        });
      }
    }

    return results;
  } catch (err) {
    logger.warn("[PageExistenceResolver] Blog slug match failed", {
      siteId,
      error: (err as Error)?.message,
    });
    return [];
  }
}

/**
 * Step 3: Check PageAudit records for crawled pages with matching URL paths.
 */
async function findMatchingPageAudits(
  siteId: string,
  topicKeyword: string,
): Promise<ExistingPageEvidence[]> {
  const topicTokens = tokenize(topicKeyword);
  if (topicTokens.length === 0) return [];

  try {
    // Fetch recent page audits for this site
    const pageAudits = await prisma.pageAudit.findMany({
      where: { siteId },
      select: {
        pageUrl: true,
        overallScore: true,
        issueList: true,
      },
      orderBy: { runTimestamp: "desc" },
      take: 300,
    });

    const results: ExistingPageEvidence[] = [];

    for (const audit of pageAudits) {
      // Extract path from URL and tokenize it
      const pathTokens = new Set(tokenize(extractPath(audit.pageUrl)));
      const overlap = topicTokens.filter((t) => pathTokens.has(t)).length;
      const overlapRatio = overlap / topicTokens.length;

      if (overlapRatio >= SLUG_MATCH_THRESHOLD) {
        const issues: string[] = [];
        if (audit.overallScore < 50) issues.push("LOW_AUDIT_SCORE");

        // Check for specific SEO issues in the audit
        const issueList = audit.issueList as unknown[];
        if (Array.isArray(issueList) && issueList.length > 5) {
          issues.push("MANY_AUDIT_ISSUES");
        }

        results.push({
          url: audit.pageUrl,
          matchSource: "PAGE_AUDIT",
          matchConfidence: Math.min(1, 0.3 + overlapRatio * 0.5),
          issues,
        });
      }
    }

    return results;
  } catch (err) {
    logger.warn("[PageExistenceResolver] PageAudit lookup failed", {
      siteId,
      error: (err as Error)?.message,
    });
    return [];
  }
}

// ── Decision Logic ──────────────────────────────────────────────────────────

function makeDecision(
  candidates: ExistingPageEvidence[],
  topicKeyword: string,
): PageExistenceResult {
  if (candidates.length === 0) {
    return {
      verdict: "MISSING",
      existingPage: null,
      allCandidates: [],
      recommendedAction: "CREATE_NEW_CONTENT",
      recommendedCategory: "ALMOST_RANKING",
      reasoning: `No existing page found for topic "${topicKeyword}". Recommending new content creation.`,
    };
  }

  // Sort by match confidence * (inverse position if available)
  const sorted = [...candidates].sort((a, b) => {
    // Prioritize GSC matches (strongest signal)
    const sourceWeight = (s: ExistingPageEvidence) =>
      s.matchSource === "GSC_RANKING_URL"
        ? 1.0
        : s.matchSource === "BLOG_RECORD"
          ? 0.8
          : s.matchSource === "PAGE_AUDIT"
            ? 0.6
            : 0.4;

    const aScore = a.matchConfidence * sourceWeight(a);
    const bScore = b.matchConfidence * sourceWeight(b);
    return bScore - aScore;
  });

  const bestMatch = sorted[0];

  // ── Cannibalization check ─────────────────────────────────────────────
  // Multiple GSC URLs ranking for the same topic = cannibalization
  const gscCandidates = candidates.filter(
    (c) => c.matchSource === "GSC_RANKING_URL" && c.currentImpressions && c.currentImpressions > 0,
  );

  if (gscCandidates.length >= 2) {
    return {
      verdict: "EXISTING_CANNIBALIZED",
      existingPage: bestMatch,
      allCandidates: sorted,
      recommendedAction: "CONSOLIDATE_CONTENT",
      recommendedCategory: "CANNIBALIZATION",
      reasoning: `${gscCandidates.length} pages compete for topic "${topicKeyword}": ${gscCandidates
        .slice(0, 3)
        .map((c) => c.url)
        .join(", ")}. Consolidation recommended.`,
    };
  }

  // ── Healthy vs needs-fix decision ─────────────────────────────────────
  const position = bestMatch.currentPosition;
  const hasIssues = bestMatch.issues.length > 0;

  // If page exists in GSC and ranks well with no issues — it's healthy
  if (
    bestMatch.matchSource === "GSC_RANKING_URL" &&
    position !== undefined &&
    position <= HEALTHY_POSITION_THRESHOLD &&
    !hasIssues
  ) {
    return {
      verdict: "EXISTING_HEALTHY",
      existingPage: bestMatch,
      allCandidates: sorted,
      recommendedAction: "MONITOR",
      recommendedCategory: "QUICK_WIN",
      reasoning: `Page "${bestMatch.url}" already ranks at position ${position} for "${topicKeyword}". No action needed — monitoring.`,
    };
  }

  // Page exists but has problems
  if (bestMatch.matchConfidence >= 0.5) {
    const action = determineFixAction(bestMatch);
    const category = determineCategoryForFix(bestMatch);

    const issueDescriptions = bestMatch.issues.length > 0
      ? ` Issues: ${bestMatch.issues.join(", ")}.`
      : "";

    const positionDesc = position !== undefined
      ? ` Currently at position ${position}.`
      : "";

    return {
      verdict: "EXISTING_NEEDS_FIX",
      existingPage: bestMatch,
      allCandidates: sorted,
      recommendedAction: action,
      recommendedCategory: category,
      reasoning: `Existing page "${bestMatch.url}" found for "${topicKeyword}" via ${bestMatch.matchSource}.${positionDesc}${issueDescriptions} Optimizing existing page instead of creating new content.`,
    };
  }

  // Low-confidence match — treat as missing
  return {
    verdict: "MISSING",
    existingPage: null,
    allCandidates: sorted,
    recommendedAction: "CREATE_NEW_CONTENT",
    recommendedCategory: "ALMOST_RANKING",
    reasoning: `Low-confidence match for "${topicKeyword}" (best: ${bestMatch.matchConfidence.toFixed(2)} via ${bestMatch.matchSource}). Treating as new content opportunity.`,
  };
}

// ── Helper Functions ────────────────────────────────────────────────────────

function determineFixAction(page: ExistingPageEvidence): string {
  // Priority: position-based first, then issue-based
  if (page.currentPosition !== undefined) {
    if (page.currentPosition > WEAK_RANKING_THRESHOLD) {
      return "OPTIMIZE_CONTENT_DEPTH"; // Ranking too low — major content overhaul
    }
    if (page.currentPosition > HEALTHY_POSITION_THRESHOLD) {
      return "REFRESH_CONTENT"; // Close to good — refresh
    }
  }

  if (page.issues.includes("STALE_CONTENT")) return "REFRESH_CONTENT";
  if (page.issues.includes("NEEDS_REFRESH")) return "REFRESH_CONTENT";
  if (page.issues.includes("LOW_AUDIT_SCORE")) return "OPTIMIZE_CONTENT_DEPTH";
  if (page.issues.includes("LOW_VALIDATION_SCORE")) return "OPTIMIZE_CONTENT_DEPTH";
  if (page.issues.includes("STILL_IN_DRAFT")) return "REFRESH_CONTENT";

  return "IMPROVE_SEARCH_INTENT"; // Default fix
}

function determineCategoryForFix(page: ExistingPageEvidence): string {
  if (page.issues.includes("STALE_CONTENT") || page.issues.includes("NEEDS_REFRESH")) {
    return "STALE";
  }
  if (page.currentPosition !== undefined && page.currentPosition <= 15) {
    return "QUICK_WIN";
  }
  if (page.currentPosition !== undefined && page.currentPosition <= 20) {
    return "ALMOST_RANKING";
  }
  return "STALE"; // Default for existing pages that need work
}

function detectGscIssues(
  avgPosition: number,
  clicks: number,
  impressions: number,
): string[] {
  const issues: string[] = [];

  if (avgPosition > WEAK_RANKING_THRESHOLD) {
    issues.push("WEAK_RANKING");
  }

  if (impressions > 0 && clicks / impressions < 0.01 && avgPosition <= 10) {
    issues.push("LOW_CTR");
  }

  return issues;
}

/**
 * Normalize URL for comparison: lowercase, strip trailing slash,
 * strip protocol, strip www, strip query params and fragments.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

/** Tokenize text into lowercase words, stripping stop words */
function tokenize(text: string): string[] {
  const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "shall", "how", "what",
    "which", "who", "when", "where", "why", "not", "no", "nor", "so",
    "yet", "both", "each", "few", "more", "most", "other", "some", "such",
    "than", "too", "very", "just", "about", "your", "our", "my", "his",
    "her", "its", "they", "them", "their", "this", "that", "these", "those",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Extract URL path and tokenize it (split on /, -, _) */
function extractPath(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.pathname.replace(/[/\-_]/g, " ");
  } catch {
    return url.replace(/[/\-_]/g, " ");
  }
}

/** Days since a date */
function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}
