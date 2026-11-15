import { prisma } from "@/lib/prisma";
import {
  buildLlmsTxtMarkdown,
  canonicalizeLlmsUrl,
  extractFaqEntriesFromJsonLd,
  resolveSiteOrigin,
  stripMarkdownToPlainText,
  validateLlmsTxtCompliance,
  type LlmsTxtAeoSummary,
  type LlmsTxtBrandFact,
  type LlmsTxtBuildInput,
  type LlmsTxtCompliance,
  type LlmsTxtFaqEntry,
  type LlmsTxtPageEntry,
  type LlmsTxtQueryEntry,
} from "@/lib/seo-audit/llms-txt";
import { extractGraphNodeFromReport } from "@/lib/seo-audit/site-graph";

export interface LlmsTxtGenerationStats {
  corePages: number;
  blogPosts: number;
  brandFacts: number;
  faqs: number;
  topQueries: number;
  hasAeoSummary: boolean;
}

export interface LlmsTxtSiteGenerationResult {
  site: {
    id: string;
    domain: string;
    brandName: string | null;
    githubRepoUrl: string | null;
  };
  content: string;
  input: LlmsTxtBuildInput;
  compliance: LlmsTxtCompliance;
  stats: LlmsTxtGenerationStats;
}

interface SiteSourceRow {
  id: string;
  domain: string;
  brandName: string | null;
  targetKeyword: string | null;
  coreServices: string | null;
  techStack: string | null;
  niche: string | null;
  githubRepoUrl: string | null;
}

const SITE_SELECT = {
  id: true,
  domain: true,
  brandName: true,
  targetKeyword: true,
  coreServices: true,
  techStack: true,
  niche: true,
  githubRepoUrl: true,
} as const;

/** Normalizes a domain/URL input into a bare lowercase hostname (without `www.`). */
export function normalizeDomainLookup(rawDomain: string): string {
  const trimmed = rawDomain.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.host.toLowerCase().replace(/^www\./, "");
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/[/?#].*$/, "")
      .replace(/^www\./i, "")
      .toLowerCase();
  }
}

function buildDomainLookupCandidates(bareHost: string): string[] {
  const hosts = bareHost.startsWith("www.")
    ? [bareHost]
    : [bareHost, `www.${bareHost}`];
  const candidates = new Set<string>();
  for (const h of hosts) {
    candidates.add(h);
    candidates.add(`https://${h}`);
    candidates.add(`https://${h}/`);
    candidates.add(`http://${h}`);
    candidates.add(`http://${h}/`);
  }
  return Array.from(candidates);
}

function sameSiteHost(urlA: string, cleanDomain: string): boolean {
  try {
    const host = new URL(urlA).hostname.toLowerCase().replace(/^www\./, "");
    const target = cleanDomain.toLowerCase().replace(/^www\./, "");
    return host === target;
  } catch {
    return false;
  }
}

function resolveBlogPostUrl(
  blog: {
    slug: string;
    wordPressUrl: string | null;
    ghostUrl: string | null;
  },
  origin: string,
  cleanDomain: string,
): string {
  for (const externalUrl of [blog.wordPressUrl, blog.ghostUrl]) {
    if (externalUrl && sameSiteHost(externalUrl, cleanDomain)) {
      return externalUrl;
    }
  }
  const cleanSlug = blog.slug.replace(/^\/+/, "");
  if (!cleanSlug) return `${origin}/blog`;
  return cleanSlug.startsWith("blog/")
    ? `${origin}/${cleanSlug}`
    : `${origin}/blog/${cleanSlug}`;
}

function canonicalKey(rawUrl: string, origin: string): string | null {
  const canonical = canonicalizeLlmsUrl(rawUrl, origin);
  return canonical ? canonical.toLowerCase() : null;
}

function readOptionalSchemaText(reportLike: unknown): string | null {
  if (!reportLike || typeof reportLike !== "object") return null;
  const obj = reportLike as Record<string, unknown>;
  for (const key of ["schemaMarkup", "jsonLd", "rawSchema"]) {
    const val = obj[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val;
    }
  }
  return null;
}

async function generateFromSiteRow(
  site: SiteSourceRow,
  opts?: { full?: boolean },
): Promise<LlmsTxtSiteGenerationResult> {
  const full = Boolean(opts?.full);
  const { origin, cleanDomain } = resolveSiteOrigin(site.domain);

  const gscStartDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [latestAudit, blogs, brandFactRows, gscRows, latestAeoReport] =
    await Promise.all([
      prisma.audit.findFirst({
        where: { siteId: site.id, deletedAt: null },
        orderBy: { runTimestamp: "desc" },
        select: { id: true, issueList: true },
      }),
      prisma.blog.findMany({
        where: { siteId: site.id, status: "PUBLISHED", deletedAt: null },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: full ? 40 : 20,
        select: {
          title: true,
          slug: true,
          content: true,
          metaDescription: true,
          targetKeywords: true,
          schemaMarkup: true,
          wordPressUrl: true,
          ghostUrl: true,
        },
      }),
      prisma.brandFact.findMany({
        where: { siteId: site.id },
        orderBy: [{ verified: "desc" }, { updatedAt: "desc" }],
        take: full ? 40 : 20,
        select: {
          factType: true,
          value: true,
          sourceUrl: true,
          verified: true,
        },
      }),
      prisma.gscDailyPerformance.findMany({
        where: {
          siteId: site.id,
          date: { gte: gscStartDate },
        },
        orderBy: [{ clicks: "desc" }, { impressions: "desc" }],
        take: 400,
        select: {
          keyword: true,
          url: true,
          clicks: true,
          impressions: true,
        },
      }),
      prisma.aeoReport.findFirst({
        where: { siteId: site.id, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: {
          score: true,
          grade: true,
          citationLikelihood: true,
          generativeShareOfVoice: true,
        },
      }),
    ]);

  let pageAuditRows = latestAudit
    ? await prisma.pageAudit.findMany({
        where: { siteId: site.id, auditId: latestAudit.id },
        orderBy: [{ overallScore: "desc" }, { runTimestamp: "desc" }],
        take: full ? 60 : 30,
        select: {
          pageUrl: true,
          issueList: true,
        },
      })
    : [];

  if (pageAuditRows.length === 0) {
    pageAuditRows = await prisma.pageAudit.findMany({
      where: { siteId: site.id },
      orderBy: { runTimestamp: "desc" },
      take: full ? 60 : 30,
      select: {
        pageUrl: true,
        issueList: true,
      },
    });
  }

  // Extract graph metadata and track excluded (noindex) URLs across audited pages.
  const noindexKeys = new Set<string>();
  const corePages: LlmsTxtPageEntry[] = [];
  const faqCandidates: LlmsTxtFaqEntry[] = [];
  const seenFaqQuestions = new Set<string>();

  const pushFaqsFromRaw = (rawSchema: string | null | undefined) => {
    for (const faq of extractFaqEntriesFromJsonLd(rawSchema, 25)) {
      const qKey = faq.question.toLowerCase();
      if (!seenFaqQuestions.has(qKey)) {
        seenFaqQuestions.add(qKey);
        faqCandidates.push(faq);
      }
    }
  };

  const rootNode = extractGraphNodeFromReport(origin, latestAudit?.issueList);
  pushFaqsFromRaw(readOptionalSchemaText(latestAudit?.issueList));

  if (rootNode && !rootNode.isNoindex) {
    corePages.push({
      url: rootNode.url,
      title: rootNode.title,
      summary: rootNode.metaDescription,
      h1: rootNode.h1,
      section: "core",
    });
  } else if (rootNode?.isNoindex) {
    const key = canonicalKey(rootNode.url, origin);
    if (key) noindexKeys.add(key);
  }

  for (const row of pageAuditRows) {
    pushFaqsFromRaw(readOptionalSchemaText(row.issueList));
    const node = extractGraphNodeFromReport(row.pageUrl, row.issueList);
    if (!node) {
      corePages.push({
        url: row.pageUrl,
        section: "core",
      });
      continue;
    }

    if (node.isNoindex) {
      const key = canonicalKey(node.url, origin);
      if (key) noindexKeys.add(key);
      continue;
    }

    corePages.push({
      url: node.url,
      title: node.title,
      summary: node.metaDescription,
      h1: node.h1,
      section: "core",
    });
  }

  // Build published blog entries before core entries when merging into buildLlmsTxtMarkdown
  // so blog posts preserve `section: "blog"` even if the same URL also appeared in PageAudit.
  const blogPages: LlmsTxtPageEntry[] = [];
  for (const blog of blogs) {
    const url = resolveBlogPostUrl(blog, origin, cleanDomain);
    const key = canonicalKey(url, origin);
    if (key && noindexKeys.has(key)) continue;

    pushFaqsFromRaw(blog.schemaMarkup);

    const abstract = blog.content
      ? stripMarkdownToPlainText(blog.content, full ? 450 : 200)
      : undefined;
    const summary =
      blog.metaDescription?.trim() ||
      (abstract ? stripMarkdownToPlainText(abstract, full ? 260 : 160) : null) ||
      (blog.targetKeywords ? `Covers ${blog.targetKeywords}` : null);

    blogPages.push({
      url,
      title: blog.title,
      summary,
      abstract,
      section: "blog",
    });
  }

  const blogKeySet = new Set(
    blogPages
      .map((b) => canonicalKey(b.url, origin))
      .filter((k): k is string => Boolean(k)),
  );
  const distinctCorePages = corePages.filter((p) => {
    const key = canonicalKey(p.url, origin);
    return key ? !blogKeySet.has(key) && !noindexKeys.has(key) : true;
  });

  // Deduplicate brand facts cleanly while preserving verified-first ordering.
  const brandFacts: LlmsTxtBrandFact[] = [];
  const seenFacts = new Set<string>();
  for (const fact of brandFactRows) {
    const dedupeKey = `${fact.factType.trim().toLowerCase()}::${fact.value.trim().toLowerCase()}`;
    if (!fact.factType.trim() || !fact.value.trim() || seenFacts.has(dedupeKey)) {
      continue;
    }
    seenFacts.add(dedupeKey);
    brandFacts.push({
      factType: fact.factType,
      value: fact.value,
      sourceUrl: fact.sourceUrl,
      verified: fact.verified,
    });
  }

  // Aggregate GSC rows into top queries by clicks/impressions.
  const queryMap = new Map<
    string,
    { keyword: string; url: string | null; clicks: number; impressions: number; topImpressions: number }
  >();
  for (const row of gscRows) {
    const trimmedKw = row.keyword?.trim();
    if (!trimmedKw) continue;
    const key = trimmedKw.toLowerCase();
    const existing = queryMap.get(key);
    const clicks = row.clicks ?? 0;
    const impressions = row.impressions ?? 0;
    if (!existing) {
      queryMap.set(key, {
        keyword: trimmedKw,
        url: row.url ?? null,
        clicks,
        impressions,
        topImpressions: impressions,
      });
    } else {
      existing.clicks += clicks;
      existing.impressions += impressions;
      if (impressions > existing.topImpressions && row.url) {
        existing.topImpressions = impressions;
        existing.url = row.url;
      }
    }
  }

  const topQueries: LlmsTxtQueryEntry[] = Array.from(queryMap.values())
    .sort((a, b) => b.clicks * 10 + b.impressions - (a.clicks * 10 + a.impressions))
    .slice(0, full ? 20 : 8)
    .map((q) => ({
      keyword: q.keyword,
      url: q.url,
      clicks: q.clicks,
      impressions: q.impressions,
    }));

  const aeoSummary: LlmsTxtAeoSummary | null = latestAeoReport
    ? {
        score: latestAeoReport.score,
        grade: latestAeoReport.grade,
        citationLikelihood: latestAeoReport.citationLikelihood,
        generativeShareOfVoice: latestAeoReport.generativeShareOfVoice,
      }
    : null;

  const descriptionParts = [
    site.coreServices?.trim(),
    rootNode?.metaDescription?.trim(),
    site.niche?.trim() ? `Industry focus: ${site.niche.trim()}` : "",
    site.targetKeyword?.trim() ? `Primary focus: ${site.targetKeyword.trim()}` : "",
  ].filter((part): part is string => Boolean(part && part.length > 0));

  const combinedDescription =
    descriptionParts.length > 0 ? Array.from(new Set(descriptionParts)).join(" — ") : null;

  const input: LlmsTxtBuildInput = {
    domain: site.domain,
    origin,
    brandName: site.brandName,
    description: combinedDescription,
    techStack: site.techStack,
    coreServices: site.coreServices,
    pages: [...blogPages, ...distinctCorePages],
    brandFacts,
    topQueries,
    faqs: faqCandidates,
    aeoSummary,
    full,
  };

  const content = buildLlmsTxtMarkdown(input);
  const compliance = validateLlmsTxtCompliance(content);

  return {
    site: {
      id: site.id,
      domain: site.domain,
      brandName: site.brandName,
      githubRepoUrl: site.githubRepoUrl,
    },
    content,
    input,
    compliance,
    stats: {
      corePages: countDistinctUrls(distinctCorePages, origin),
      blogPosts: countDistinctUrls(blogPages, origin),
      brandFacts: brandFacts.length,
      faqs: faqCandidates.length,
      topQueries: topQueries.length,
      hasAeoSummary: aeoSummary !== null,
    },
  };
}

function countDistinctUrls(entries: LlmsTxtPageEntry[], origin: string): number {
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = canonicalKey(entry.url, origin);
    if (key) keys.add(key);
  }
  return keys.size;
}

/**
 * Generates an `/llms.txt` or `/llms-full.txt` document for a site ID using real verified
 * crawl, content, brand-fact, Search Console, and AEO report records.
 */
export async function generateLlmsTxtForSite(
  siteId: string,
  opts?: { full?: boolean; userId?: string },
): Promise<LlmsTxtSiteGenerationResult | null> {
  const site = await prisma.site.findFirst({
    where: opts?.userId ? { id: siteId, userId: opts.userId } : { id: siteId },
    select: SITE_SELECT,
  });
  if (!site) return null;
  return generateFromSiteRow(site, opts);
}

/**
 * Resolves a domain parameter safely (without broad substring matching) and builds
 * `/llms.txt` or `/llms-full.txt` for the public API route.
 */
export async function generateLlmsTxtByDomain(
  domain: string,
  opts?: { full?: boolean },
): Promise<LlmsTxtSiteGenerationResult | null> {
  const bareHost = normalizeDomainLookup(domain);
  if (!bareHost) return null;

  const candidates = buildDomainLookupCandidates(bareHost);
  const site = await prisma.site.findFirst({
    where: {
      OR: candidates.map((candidate) => ({
        domain: { equals: candidate, mode: "insensitive" as const },
      })),
    },
    orderBy: { createdAt: "desc" },
    select: SITE_SELECT,
  });

  if (!site) return null;
  return generateFromSiteRow(site, opts);
}

