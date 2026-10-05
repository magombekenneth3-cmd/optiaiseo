// =============================================================================
// PAGE EXISTENCE RESOLVER — HARDENED IMPLEMENTATION
//
// For every TOPIC_OPPORTUNITY finding, determines whether a relevant page
// already exists on the site before recommending CREATE_NEW_CONTENT.
//
// Architectural Principles:
//   1. GSC tells you what Google associates with the query
//   2. Site discovery/crawl/blog data tells you whether the page exists
//   3. Resolver combines both before choosing create vs fix vs monitor vs review
//
// Decision hierarchy:
//   - EXACT_MATCH / GSC_MATCH / BLOG_MATCH / AUDIT_MATCH -> page exists
//   - LOW_CONFIDENCE_MATCH / AMBIGUOUS_MATCH -> NEEDS_REVIEW (never auto-create)
//   - NO_MATCH_FOUND -> MISSING -> CREATE_NEW_CONTENT
// =============================================================================

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type {
  PageExistenceVerdict,
  ExistingPageEvidence,
  PageExistenceResult,
  MatchSource,
  MatchType,
} from "./types";

export type {
  PageExistenceVerdict,
  ExistingPageEvidence,
  PageExistenceResult,
  MatchSource,
  MatchType,
};

// ── Configuration Thresholds ────────────────────────────────────────────────

const WEAK_RANKING_THRESHOLD = 30;
const HEALTHY_POSITION_THRESHOLD = 20;
const STRONG_MATCH_THRESHOLD = 0.6;
const SLUG_MATCH_THRESHOLD = 0.2;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves whether a relevant page already exists for a topic opportunity.
 * Pure evidence-based decision using DB models (GscDailyPerformance, Blog, PageAudit).
 */
export async function resolvePageExistence(
  siteId: string,
  topicKeyword: string,
  clusterQueries: string[] = [],
): Promise<PageExistenceResult> {
  const candidates: ExistingPageEvidence[] = [];

  // 1. Check GSC for pages ranking for topic or cluster queries
  const gscMatches = await findGscRankingPages(siteId, topicKeyword, clusterQueries);
  candidates.push(...gscMatches);

  // 2. Check Blog records (targetKeywords & slug/title matching)
  const blogMatches = await findMatchingBlogRecords(siteId, topicKeyword, clusterQueries);
  for (const blog of blogMatches) {
    const existingIdx = candidates.findIndex((c) => areUrlsEquivalent(c.url, blog.url));
    if (existingIdx === -1) {
      candidates.push(blog);
    } else {
      // Merge issues and refine confidence
      const existing = candidates[existingIdx];
      existing.issues = Array.from(new Set([...existing.issues, ...blog.issues]));
      existing.matchConfidence = Math.max(existing.matchConfidence, blog.matchConfidence);
    }
  }

  // 3. Check PageAudit records for crawled pages
  const auditMatches = await findMatchingPageAudits(siteId, topicKeyword);
  for (const audit of auditMatches) {
    const existingIdx = candidates.findIndex((c) => areUrlsEquivalent(c.url, audit.url));
    if (existingIdx === -1) {
      candidates.push(audit);
    } else {
      const existing = candidates[existingIdx];
      existing.issues = Array.from(new Set([...existing.issues, ...audit.issues]));
      if (audit.canonicalUrl) existing.canonicalUrl = audit.canonicalUrl;
      if (audit.isNoindex !== undefined) existing.isNoindex = audit.isNoindex;
    }
  }

  // 4. Make deterministic decision based on candidates & intent
  return makeDecision(candidates, topicKeyword);
}

/**
 * Batch version of resolvePageExistence.
 * Pre-fetches GSC performance, blog records, and page audits once for siteId,
 * then evaluates all topic queries in memory without database N+1 loops.
 */
export async function resolvePageExistenceBatch(
  siteId: string,
  topics: { keyword: string; clusterQueries: string[] }[],
): Promise<Map<string, PageExistenceResult>> {
  const resultMap = new Map<string, PageExistenceResult>();
  if (topics.length === 0) return resultMap;

  try {
    const allQueryTerms = Array.from(
      new Set(topics.flatMap((t) => [t.keyword, ...t.clusterQueries.slice(0, 9)])),
    );

    const topicTokens = Array.from(
      new Set(
        allQueryTerms.flatMap((term) =>
          term
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 2),
        ),
      ),
    ).slice(0, 20);

    const blogConditions = [
      { targetKeywords: { hasSome: allQueryTerms } },
      ...topicTokens.map((t) => ({ slug: { contains: t } })),
      ...topicTokens.map((t) => ({ title: { contains: t } })),
    ];

    const auditConditions = topicTokens.map((t) => ({ pageUrl: { contains: t } }));

    // Single-pass targeted DB fetches
    const [gscRows, blogs, pageAudits] = await Promise.all([
      prisma.gscDailyPerformance.findMany({
        where: {
          siteId,
          keyword: { in: allQueryTerms },
        },
        orderBy: { fetchedAt: "desc" },
      }),
      prisma.blog.findMany({
        where: {
          siteId,
          deletedAt: null,
          status: { notIn: ["DELETED", "REJECTED"] },
          ...(blogConditions.length > 0 ? { OR: blogConditions } : {}),
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
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      prisma.pageAudit.findMany({
        where: {
          siteId,
          ...(auditConditions.length > 0 ? { OR: auditConditions } : {}),
        },
        select: {
          pageUrl: true,
          overallScore: true,
          issueList: true,
        },
        orderBy: { runTimestamp: "desc" },
        take: 300,
      }),
    ]);

    // Build O(1) Hash & Token Indexes once
    const gscByKeyword = new Map<string, typeof gscRows>();
    for (const row of gscRows) {
      const k = row.keyword.toLowerCase().trim();
      const existing = gscByKeyword.get(k) || [];
      existing.push(row);
      gscByKeyword.set(k, existing);
    }

    const blogByTargetKeyword = new Map<string, typeof blogs>();
    const blogTokenIndex: Array<{ blog: (typeof blogs)[0]; combinedTokens: Set<string> }> = [];

    for (const blog of blogs) {
      for (const kw of blog.targetKeywords) {
        const k = kw.toLowerCase().trim();
        const existing = blogByTargetKeyword.get(k) || [];
        existing.push(blog);
        blogByTargetKeyword.set(k, existing);
      }
      const slugTokens = tokenize(blog.slug.replace(/-/g, " "));
      const titleTokens = tokenize(blog.title);
      blogTokenIndex.push({
        blog,
        combinedTokens: new Set([...slugTokens, ...titleTokens]),
      });
    }

    const auditTokenIndex: Array<{ audit: (typeof pageAudits)[0]; pathTokens: Set<string> }> = pageAudits.map(
      (audit) => ({
        audit,
        pathTokens: new Set(tokenize(extractPath(audit.pageUrl))),
      }),
    );

    // Evaluate each topic in O(1) via pre-built indexes
    for (const topic of topics) {
      const queryTerms = Array.from(new Set([topic.keyword, ...topic.clusterQueries.slice(0, 9)]));
      const candidates: ExistingPageEvidence[] = [];

      // 1. Fast GSC matching via index
      const gscTopicRows = queryTerms.flatMap((term) => gscByKeyword.get(term.toLowerCase().trim()) || []);
      if (gscTopicRows.length > 0) {
        const urlMap = new Map<
          string,
          { originalUrl: string; clicks: number; impressions: number; positionSum: number; count: number; keywords: Set<string> }
        >();
        for (const row of gscTopicRows) {
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
              originalUrl: row.url,
              clicks: row.clicks,
              impressions: row.impressions,
              positionSum: row.position * row.impressions,
              count: 1,
              keywords: new Set([row.keyword]),
            });
          }
        }

        for (const [, data] of urlMap) {
          const avgPosition = data.impressions > 0 ? data.positionSum / data.impressions : 100;
          const keywordOverlap = data.keywords.size / queryTerms.length;
          const confidence = Math.min(1, 0.7 + keywordOverlap * 0.3);
          candidates.push({
            url: data.originalUrl,
            matchSource: "GSC_RANKING_URL",
            matchConfidence: confidence,
            matchType: confidence >= STRONG_MATCH_THRESHOLD ? "GSC_MATCH" : "LOW_CONFIDENCE_MATCH",
            currentPosition: Math.round(avgPosition * 10) / 10,
            currentImpressions: data.impressions,
            currentClicks: data.clicks,
            issues: detectGscIssues(avgPosition, data.clicks, data.impressions),
          });
        }
      }

      // 2. Fast Blog matching via targetKeyword map + token index
      const targetKeywordBlogs = queryTerms.flatMap(
        (term) => blogByTargetKeyword.get(term.toLowerCase().trim()) || [],
      );
      const matchedBlogIds = new Set<string>();

      for (const blog of targetKeywordBlogs) {
        if (matchedBlogIds.has(blog.id)) continue;
        matchedBlogIds.add(blog.id);

        const url = blog.sourceUrl || `/blog/${blog.slug}`;
        const matchingKeywords = blog.targetKeywords.filter((kw) => queryTerms.includes(kw));
        const overlapRatio = matchingKeywords.length / Math.max(1, blog.targetKeywords.length);
        const confidence = Math.min(1, 0.6 + overlapRatio * 0.4);

        const issues: string[] = [];
        if (blog.needsRefresh) issues.push("NEEDS_REFRESH");
        if (blog.status === "DRAFT") issues.push("STILL_IN_DRAFT");
        if (blog.validationScore !== null && blog.validationScore < 60) issues.push("LOW_VALIDATION_SCORE");
        if (blog.publishedAt && daysSince(blog.publishedAt) > 180) issues.push("STALE_CONTENT");

        candidates.push({
          url,
          matchSource: "BLOG_RECORD",
          matchConfidence: confidence,
          matchType: confidence >= STRONG_MATCH_THRESHOLD ? "BLOG_MATCH" : "LOW_CONFIDENCE_MATCH",
          issues,
        });
      }

      // Fallback token index matching for blogs not already matched by exact targetKeyword
      const topicTokens = tokenize(topic.keyword);
      if (topicTokens.length > 0) {
        for (const item of blogTokenIndex) {
          if (matchedBlogIds.has(item.blog.id)) continue;

          const overlap = topicTokens.filter((t) => item.combinedTokens.has(t)).length;
          const tokenRatio = overlap / topicTokens.length;

          if (tokenRatio >= SLUG_MATCH_THRESHOLD) {
            const blog = item.blog;
            matchedBlogIds.add(blog.id);
            const url = blog.sourceUrl || `/blog/${blog.slug}`;
            const exactMatch = tokenRatio === 1.0;
            const confidence = exactMatch ? 0.95 : Math.min(1, 0.4 + tokenRatio * 0.5);

            const issues: string[] = [];
            if (blog.needsRefresh) issues.push("NEEDS_REFRESH");
            if (blog.status === "DRAFT") issues.push("STILL_IN_DRAFT");
            if (blog.validationScore !== null && blog.validationScore < 60) issues.push("LOW_VALIDATION_SCORE");
            if (blog.publishedAt && daysSince(blog.publishedAt) > 180) issues.push("STALE_CONTENT");

            candidates.push({
              url,
              matchSource: "BLOG_RECORD",
              matchConfidence: confidence,
              matchType: exactMatch ? "EXACT_MATCH" : confidence >= STRONG_MATCH_THRESHOLD ? "BLOG_MATCH" : "LOW_CONFIDENCE_MATCH",
              issues,
            });
          }
        }

        // 3. Fast PageAudit matching via token index
        for (const item of auditTokenIndex) {
          const overlap = topicTokens.filter((t) => item.pathTokens.has(t)).length;
          const overlapRatio = overlap / topicTokens.length;

          if (overlapRatio >= SLUG_MATCH_THRESHOLD) {
            const audit = item.audit;
            const issues: string[] = [];
            if (audit.overallScore < 50) issues.push("LOW_AUDIT_SCORE");

            const issueList = audit.issueList as unknown[];
            if (Array.isArray(issueList)) {
              for (const issueItem of issueList) {
                const str = typeof issueItem === "string" ? issueItem : JSON.stringify(issueItem);
                if (str.includes("noindex")) issues.push("NOINDEX_DETECTED");
                if (str.includes("canonical")) issues.push("CANONICAL_CONFLICT");
                if (str.includes("thin")) issues.push("THIN_CONTENT");
                if (str.includes("orphan") || str.includes("internal_link")) issues.push("ORPHAN_PAGE");
              }
            }

            const confidence = Math.min(1, 0.35 + overlapRatio * 0.55);
            const existingIdx = candidates.findIndex((c) => areUrlsEquivalent(c.url, audit.pageUrl));
            if (existingIdx === -1) {
              candidates.push({
                url: audit.pageUrl,
                matchSource: "PAGE_AUDIT",
                matchConfidence: confidence,
                matchType: confidence >= STRONG_MATCH_THRESHOLD ? "AUDIT_MATCH" : "LOW_CONFIDENCE_MATCH",
                issues,
              });
            } else {
              const existing = candidates[existingIdx];
              existing.issues = Array.from(new Set([...existing.issues, ...issues]));
            }
          }
        }
      }

      resultMap.set(topic.keyword.toLowerCase().trim(), makeDecision(candidates, topic.keyword));
    }
  } catch (err) {
    logger.warn("[PageExistenceResolver] Batch lookup failed", {
      siteId,
      error: (err as Error)?.message,
    });
  }

  return resultMap;
}

// ── Evidence Gathering Functions ────────────────────────────────────────────

/**
 * Query GscDailyPerformance for pages Google associates with this topic/queries.
 */
async function findGscRankingPages(
  siteId: string,
  topicKeyword: string,
  clusterQueries: string[],
): Promise<ExistingPageEvidence[]> {
  const queryTerms = Array.from(new Set([topicKeyword, ...clusterQueries.slice(0, 9)]));

  try {
    const gscRows = await prisma.gscDailyPerformance.findMany({
      where: {
        siteId,
        keyword: { in: queryTerms },
      },
      orderBy: { fetchedAt: "desc" },
      take: 100,
    });

    if (gscRows.length === 0) return [];

    const urlMap = new Map<
      string,
      { originalUrl: string; clicks: number; impressions: number; positionSum: number; count: number; keywords: Set<string> }
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
          originalUrl: row.url,
          clicks: row.clicks,
          impressions: row.impressions,
          positionSum: row.position * row.impressions,
          count: 1,
          keywords: new Set([row.keyword]),
        });
      }
    }

    const results: ExistingPageEvidence[] = [];

    for (const [, data] of urlMap) {
      const avgPosition = data.impressions > 0 ? data.positionSum / data.impressions : 100;
      const keywordOverlap = data.keywords.size / queryTerms.length;
      const confidence = Math.min(1, 0.7 + keywordOverlap * 0.3);

      results.push({
        url: data.originalUrl,
        matchSource: "GSC_RANKING_URL",
        matchConfidence: confidence,
        matchType: confidence >= STRONG_MATCH_THRESHOLD ? "GSC_MATCH" : "LOW_CONFIDENCE_MATCH",
        currentPosition: Math.round(avgPosition * 10) / 10,
        currentImpressions: data.impressions,
        currentClicks: data.clicks,
        issues: detectGscIssues(avgPosition, data.clicks, data.impressions),
      });
    }

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
 * Check Blog records for targetKeywords & title/slug matches.
 */
async function findMatchingBlogRecords(
  siteId: string,
  topicKeyword: string,
  clusterQueries: string[],
): Promise<ExistingPageEvidence[]> {
  try {
    const queryTerms = Array.from(new Set([topicKeyword, ...clusterQueries.slice(0, 9)]));
    const blogs = await prisma.blog.findMany({
      where: {
        siteId,
        deletedAt: null,
        status: { notIn: ["DELETED", "REJECTED"] },
        targetKeywords: {
          hasSome: queryTerms,
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

    const blogResults: ExistingPageEvidence[] = blogs.map((blog) => {
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

      const matchingKeywords = blog.targetKeywords.filter((kw) => queryTerms.includes(kw));
      const overlapRatio = matchingKeywords.length / Math.max(1, blog.targetKeywords.length);
      const confidence = Math.min(1, 0.6 + overlapRatio * 0.4);

      return {
        url,
        matchSource: "BLOG_RECORD" as const,
        matchConfidence: confidence,
        matchType: confidence >= STRONG_MATCH_THRESHOLD ? "BLOG_MATCH" : "LOW_CONFIDENCE_MATCH",
        issues,
      };
    });

    // Fallback: slug token matching
    const slugMatches = await findBlogsBySlugMatch(siteId, topicKeyword);
    for (const sm of slugMatches) {
      if (!blogResults.some((b) => areUrlsEquivalent(b.url, sm.url))) {
        blogResults.push(sm);
      }
    }

    return blogResults;
  } catch (err) {
    logger.warn("[PageExistenceResolver] Blog lookup failed", {
      siteId,
      error: (err as Error)?.message,
    });
    return [];
  }
}

/**
 * Fallback blog search: tokenize topic and match against blog slugs & titles.
 */
async function findBlogsBySlugMatch(
  siteId: string,
  topicKeyword: string,
): Promise<ExistingPageEvidence[]> {
  const topicTokens = tokenize(topicKeyword);
  if (topicTokens.length === 0) return [];

  try {
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
      take: 200,
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

        const exactMatch = overlapRatio === 1.0;
        const confidence = exactMatch ? 0.95 : Math.min(1, 0.4 + overlapRatio * 0.5);

        results.push({
          url: blog.sourceUrl || `/blog/${blog.slug}`,
          matchSource: "BLOG_RECORD",
          matchConfidence: confidence,
          matchType: exactMatch
            ? "EXACT_MATCH"
            : confidence >= STRONG_MATCH_THRESHOLD
              ? "BLOG_MATCH"
              : "LOW_CONFIDENCE_MATCH",
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
 * Check PageAudit records for crawled pages matching the topic.
 */
async function findMatchingPageAudits(
  siteId: string,
  topicKeyword: string,
): Promise<ExistingPageEvidence[]> {
  const topicTokens = tokenize(topicKeyword);
  if (topicTokens.length === 0) return [];

  try {
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
      const pathTokens = new Set(tokenize(extractPath(audit.pageUrl)));
      const overlap = topicTokens.filter((t) => pathTokens.has(t)).length;
      const overlapRatio = overlap / topicTokens.length;

      if (overlapRatio >= SLUG_MATCH_THRESHOLD) {
        const issues: string[] = [];
        if (audit.overallScore < 50) issues.push("LOW_AUDIT_SCORE");

        const issueList = audit.issueList as unknown[];
        if (Array.isArray(issueList)) {
          for (const item of issueList) {
            const str = typeof item === "string" ? item : JSON.stringify(item);
            if (str.includes("noindex")) issues.push("NOINDEX_DETECTED");
            if (str.includes("canonical")) issues.push("CANONICAL_CONFLICT");
            if (str.includes("thin")) issues.push("THIN_CONTENT");
            if (str.includes("orphan") || str.includes("internal_link")) issues.push("ORPHAN_PAGE");
          }
        }

        const confidence = Math.min(1, 0.35 + overlapRatio * 0.55);

        results.push({
          url: audit.pageUrl,
          matchSource: "PAGE_AUDIT",
          matchConfidence: confidence,
          matchType: confidence >= STRONG_MATCH_THRESHOLD ? "AUDIT_MATCH" : "LOW_CONFIDENCE_MATCH",
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
  // 1. No candidates found -> MISSING -> CREATE_NEW_CONTENT
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

  // Sort candidates by match confidence and source weight
  const sorted = [...candidates].sort((a, b) => {
    const sourceWeight = (s: ExistingPageEvidence) =>
      s.matchSource === "GSC_RANKING_URL"
        ? 1.0
        : s.matchSource === "BLOG_RECORD"
          ? 0.85
          : s.matchSource === "PAGE_AUDIT"
            ? 0.65
            : 0.4;

    const aScore = a.matchConfidence * sourceWeight(a);
    const bScore = b.matchConfidence * sourceWeight(b);
    return bScore - aScore;
  });

  const bestMatch = sorted[0];

  // 2. Check for Ambiguous / Low-Confidence Match
  // Ambiguous: multiple candidates with nearly identical confidence scores, or bestMatch < 0.6
  const isLowConfidence = bestMatch.matchConfidence < STRONG_MATCH_THRESHOLD;
  const isAmbiguous =
    sorted.length >= 2 &&
    sorted[0].matchConfidence - sorted[1].matchConfidence < 0.1 &&
    sorted[0].matchSource !== "GSC_RANKING_URL";

  if (isLowConfidence || isAmbiguous) {
    bestMatch.matchType = isAmbiguous ? "AMBIGUOUS_MATCH" : "LOW_CONFIDENCE_MATCH";
    return {
      verdict: "NEEDS_REVIEW",
      existingPage: bestMatch,
      allCandidates: sorted,
      recommendedAction: "NEEDS_REVIEW",
      recommendedCategory: "QUICK_WIN",
      reasoning: isAmbiguous
        ? `Ambiguous page matches found for topic "${topicKeyword}" (${sorted[0].url} vs ${sorted[1].url}). Manual review required.`
        : `Uncertain page match for "${topicKeyword}" (${bestMatch.url}, confidence: ${bestMatch.matchConfidence.toFixed(2)}). Review before creating new content.`,
    };
  }

  // 3. Cannibalization check (Phase 5: Check intent similarity!)
  const gscCandidates = sorted.filter(
    (c) => c.matchSource === "GSC_RANKING_URL" && c.currentImpressions !== undefined && c.currentImpressions > 0,
  );

  if (gscCandidates.length >= 2) {
    // Compare intent between top 2 GSC URLs
    const url1 = gscCandidates[0].url;
    const url2 = gscCandidates[1].url;
    const shareSameIntent = checkIntentSimilarity(url1, url2, topicKeyword);

    if (shareSameIntent) {
      return {
        verdict: "EXISTING_CANNIBALIZED",
        existingPage: bestMatch,
        allCandidates: sorted,
        recommendedAction: "CONSOLIDATE_CONTENT",
        recommendedCategory: "CANNIBALIZATION",
        reasoning: `Multiple pages (${url1}, ${url2}) compete for topic "${topicKeyword}" with identical intent. Consolidation recommended.`,
      };
    }
    // Different intent -> separate valid pages, fall through to single-page diagnosis
  }

  // 4. Single-page Diagnosis (Phase 6: Specific actions for diagnosed issues)
  const position = bestMatch.currentPosition;
  const hasIssues = bestMatch.issues.length > 0;

  // Healthy Page Check: position <= 20 and no major issues
  if (
    position !== undefined &&
    position <= HEALTHY_POSITION_THRESHOLD &&
    !hasIssues &&
    bestMatch.matchConfidence >= 0.7
  ) {
    return {
      verdict: "EXISTING_HEALTHY",
      existingPage: bestMatch,
      allCandidates: sorted,
      recommendedAction: "MONITOR",
      recommendedCategory: "QUICK_WIN",
      reasoning: `Page "${bestMatch.url}" already ranks at position ${position} for "${topicKeyword}". Monitoring.`,
    };
  }

  // Page Exists but Needs Fix
  const action = determineDiagnosisAction(bestMatch);
  const category = determineCategoryForFix(bestMatch);

  const issueDesc = bestMatch.issues.length > 0 ? ` Issues: ${bestMatch.issues.join(", ")}.` : "";
  const posDesc = position !== undefined ? ` Position: ${position}.` : "";

  return {
    verdict: "EXISTING_NEEDS_FIX",
    existingPage: bestMatch,
    allCandidates: sorted,
    recommendedAction: action,
    recommendedCategory: category,
    reasoning: `Existing page "${bestMatch.url}" found for "${topicKeyword}".${posDesc}${issueDesc} Optimizing existing page.`,
  };
}

// ── Diagnosis & Intent Helpers ──────────────────────────────────────────────

/**
 * Phase 6: Diagnose exact problem and select appropriate action.
 */
function determineDiagnosisAction(page: ExistingPageEvidence): string {
  // Explicit issue-based overrides first
  if (page.issues.includes("NOINDEX_DETECTED")) return "MODIFY_ROBOTS_META";
  if (page.issues.includes("CANONICAL_CONFLICT")) return "CHANGE_CANONICAL";
  if (page.issues.includes("ORPHAN_PAGE")) return "ADD_INTERNAL_LINKS";
  if (page.issues.includes("LOW_CTR")) return "OPTIMIZE_TITLE";
  if (page.issues.includes("THIN_CONTENT") || page.issues.includes("LOW_AUDIT_SCORE")) {
    return "OPTIMIZE_CONTENT_DEPTH";
  }

  // Position-based diagnosis
  if (page.currentPosition !== undefined) {
    if (page.currentPosition > WEAK_RANKING_THRESHOLD) {
      return "OPTIMIZE_CONTENT_DEPTH"; // Major ranking deficit
    }
    if (page.currentPosition > HEALTHY_POSITION_THRESHOLD) {
      return "REFRESH_CONTENT"; // Striking distance
    }
  }

  if (page.issues.includes("STALE_CONTENT") || page.issues.includes("NEEDS_REFRESH")) {
    return "REFRESH_CONTENT";
  }

  return "IMPROVE_SEARCH_INTENT";
}

function determineCategoryForFix(page: ExistingPageEvidence): string {
  if (page.issues.includes("STALE_CONTENT") || page.issues.includes("NEEDS_REFRESH")) {
    return "STALE";
  }
  if (page.currentPosition !== undefined && page.currentPosition <= 15) {
    return "QUICK_WIN";
  }
  if (page.currentPosition !== undefined && page.currentPosition <= 30) {
    return "ALMOST_RANKING";
  }
  return "STALE";
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
  if (impressions > 100 && clicks / impressions < 0.015 && avgPosition <= 20) {
    issues.push("LOW_CTR");
  }
  return issues;
}

/**
 * Phase 5: Check intent similarity between two URLs competing for same query.
 */
function checkIntentSimilarity(url1: string, url2: string, topicKeyword: string): boolean {
  const p1 = extractPath(url1);
  const p2 = extractPath(url2);
  const t1 = tokenize(p1);
  const t2 = tokenize(p2);

  if (t1.length === 0 || t2.length === 0) return true; // Default to same intent if unparseable

  const set2 = new Set(t2);
  const overlap = t1.filter((token) => set2.has(token)).length;
  const similarity = overlap / Math.min(t1.length, t2.length);

  // High path token similarity = same intent (cannibalization)
  // Low path token similarity = different intent (e.g. /tools/seo vs /blog/seo-guide)
  return similarity >= 0.5;
}

// ── URL Normalization & Helper Utilities ────────────────────────────────────

/**
 * Phase 4: Full URL normalization.
 * Handles trailing slashes, scheme, www, query params (?utm_...), fragments (#...).
 */
export function normalizeUrl(url: string): string {
  if (!url) return "";
  try {
    const raw = url.trim();
    const hasScheme = raw.startsWith("http://") || raw.startsWith("https://");
    const parsed = new URL(hasScheme ? raw : `https://dummy.domain${raw.startsWith("/") ? raw : `/${raw}`}`);

    let pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    if (!pathname) pathname = "/";

    if (hasScheme) {
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      return `${hostname}${pathname}`;
    }
    return pathname;
  } catch {
    return url.toLowerCase().trim().replace(/\/+$/, "").replace(/\?.*$/, "");
  }
}

/**
 * Checks if two URLs are equivalent after normalization.
 */
export function areUrlsEquivalent(url1: string, url2: string): boolean {
  const n1 = normalizeUrl(url1);
  const n2 = normalizeUrl(url2);
  if (n1 === n2) return true;

  // Path suffix check (e.g. /seo-audit vs example.com/seo-audit)
  const p1 = n1.replace(/^[a-z0-9.-]+/, "");
  const p2 = n2.replace(/^[a-z0-9.-]+/, "");
  return p1.length > 1 && p1 === p2;
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
    const norm = normalizeUrl(url);
    return norm.replace(/[/\-_]/g, " ");
  } catch {
    return url.replace(/[/\-_]/g, " ");
  }
}

/** Days since a date */
function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}
