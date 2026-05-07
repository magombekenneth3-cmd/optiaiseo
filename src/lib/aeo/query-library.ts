import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { callGeminiJson } from "@/lib/gemini";
import { checkPerplexityCitation } from "./perplexity-citation-check";
import { checkChatGptMention } from "./openai-check";
import { checkClaudeMention } from "./claude-check";

export type QueryIntent =
  | "informational"
  | "commercial"
  | "comparison"
  | "problem"
  | "navigational";

export interface GeneratedQuery {
  query:  string;
  intent: QueryIntent;
  reason: string;
}

export interface QueryCheckResult {
  model:            string;
  mentioned:        boolean;
  mentionPosition:  number;
  isAuthoritative:  boolean;
  citationUrl:      string | null;
  competitorsCited: string[];
  responseSnippet:  string;
  checkedAt:        Date;
}

export interface QueryWeeklySummary {
  query:              string;
  intent:             QueryIntent;
  overallMentionRate: number;
  modelResults:       QueryCheckResult[];
  weekOverWeek:       number | null;
  topCompetitor:      string | null;
}

export async function generateQueryLibrary(
  domain:       string,
  coreServices: string | null | undefined,
  pageContent:  string | null,
  existingQueryCount = 0
): Promise<GeneratedQuery[]> {
  const targetCount = existingQueryCount > 20 ? 20 : 40;

  const cleanContent = pageContent
    ? pageContent
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000)
    : "";

  const prompt = `You are a senior AEO (Answer Engine Optimization) researcher building a query library for a website.

Your task: Generate exactly ${targetCount} queries that real users would type into ChatGPT, Perplexity, or Google AI to find this website.

SITE: ${domain}
CORE SERVICES: ${coreServices ?? "infer from content"}

INTENT DISTRIBUTION (spread evenly):
- INFORMATIONAL (8 queries): "How does X work?", "What is Y?", "Why should I care about Z?"
- COMMERCIAL (8 queries): "Best tool for X in 2026", "Is [brand] worth it?", pricing comparisons
- COMPARISON (8 queries): "[brand] vs [competitor]", "alternatives to [brand]", "which is better for X?"
- PROBLEM (8 queries): "Why is my X not working?", "How to fix Y?", "Common Z mistakes"
- NAVIGATIONAL (8 queries): "How to use [brand] for X", "Does [brand] do Y?", "[brand] X feature"

RULES:
- Every query must be phrased as a user would ACTUALLY type it — natural language, not SEO keywords
- Queries must be specific to this site's actual services — no generic "best software" questions
- Include the brand name in some navigational and comparison queries
- Include competitor names where natural (Semrush, Ahrefs, etc. if this is an SEO tool)
- Each query should be something Perplexity or ChatGPT would actually return a citation for

SITE CONTENT (use to make queries specific):
${cleanContent || "(No content available — generate based on domain and services)"}

Respond ONLY with a JSON array — no markdown, no explanation:
[
  {
    "query": "string (the exact query text)",
    "intent": "informational|commercial|comparison|problem|navigational",
    "reason": "1 sentence: why this query matters for AI citation"
  }
]`;

  try {
    const results = await callGeminiJson<GeneratedQuery[]>(prompt, {
      temperature:     0.3,
      maxOutputTokens: 5500,
    });

    if (!Array.isArray(results) || results.length === 0) {
      logger.warn("[QueryLibrary] Gemini returned no queries", { domain });
      return getFallbackQueries(domain, coreServices);
    }

    return results
      .filter(
        (q): q is GeneratedQuery =>
          typeof q.query === "string" &&
          q.query.length > 10 &&
          ["informational", "commercial", "comparison", "problem", "navigational"].includes(q.intent)
      )
      .slice(0, targetCount);
  } catch (err: unknown) {
    logger.error("[QueryLibrary] Generation failed", {
      domain,
      error: (err as Error)?.message,
    });
    return getFallbackQueries(domain, coreServices);
  }
}

function getFallbackQueries(
  domain:       string,
  coreServices: string | null | undefined
): GeneratedQuery[] {
  const svc   = coreServices?.split(",")[0]?.trim() ?? "digital marketing";
  const brand = domain.split(".")[0];

  return [
    { query: `What is the best tool for ${svc}?`,              intent: "commercial",    reason: "Commercial intent query for category" },
    { query: `How does ${brand} help with ${svc}?`,            intent: "informational", reason: "Direct brand question" },
    { query: `${brand} vs alternatives for ${svc}`,            intent: "comparison",    reason: "Comparison intent" },
    { query: `How to get started with ${svc} using ${brand}`,  intent: "navigational",  reason: "Onboarding navigational query" },
    { query: `Why is my ${svc} not getting results?`,          intent: "problem",       reason: "Problem-aware query" },
    { query: `Is ${brand} worth it for ${svc}?`,               intent: "commercial",    reason: "Evaluation commercial query" },
    { query: `Best ${svc} tools in 2026`,                      intent: "commercial",    reason: "Broader category query" },
    { query: `How to improve ${svc} with AI`,                  intent: "informational", reason: "AI-forward query" },
  ];
}

export async function checkQueryAcrossModels(
  query:        string,
  domain:       string,
  coreServices: string | null | undefined
): Promise<QueryCheckResult[]> {
  const results: QueryCheckResult[] = [];

  const [perplexityResult, chatgptResult, claudeResult] = await Promise.allSettled([
    checkPerplexityCitation(query, domain),
    checkChatGptMention(domain, coreServices),
    checkClaudeMention(domain, coreServices),
  ]);

  const now = new Date();

  if (perplexityResult.status === "fulfilled") {
    const p = perplexityResult.value;
    results.push({
      model:            "perplexity",
      mentioned:        p.cited || p.textMentionScore > 30,
      mentionPosition:  p.textMentionScore,
      isAuthoritative:  p.cited && (p.citationPosition ?? 99) <= 3,
      citationUrl:      p.citationUrl,
      competitorsCited: p.competitorsCited,
      responseSnippet:  p.responseText.slice(0, 200),
      checkedAt:        now,
    });
  }

  if (chatgptResult.status === "fulfilled") {
    const c = chatgptResult.value;
    const quality = c.quality;
    results.push({
      model:            "chatgpt",
      mentioned:        c.mentioned,
      mentionPosition:  quality?.positionScore ?? 0,
      isAuthoritative:  quality?.isAuthoritative ?? false,
      citationUrl:      null,
      competitorsCited: [],
      responseSnippet:  c.snippet?.slice(0, 200) ?? "",
      checkedAt:        now,
    });
  }

  if (claudeResult.status === "fulfilled") {
    const c = claudeResult.value;
    const quality = c.quality;
    results.push({
      model:            "claude",
      mentioned:        c.mentioned,
      mentionPosition:  quality?.positionScore ?? 0,
      isAuthoritative:  quality?.isAuthoritative ?? false,
      citationUrl:      null,
      competitorsCited: [],
      responseSnippet:  c.snippet?.slice(0, 200) ?? "",
      checkedAt:        now,
    });
  }

  return results;
}

export async function upsertTrackedQueries(
  siteId:  string,
  queries: GeneratedQuery[]
): Promise<number> {
  let created = 0;

  for (const q of queries) {
    try {
      const existing = await prisma.trackedQuery.findFirst({
        where:  { siteId, queryText: q.query },
        select: { id: true },
      });

      if (!existing) {
        await prisma.trackedQuery.create({
          data: {
            siteId,
            queryText: q.query,
            intent:    q.intent,
            reason:    q.reason,
            source:    "auto",
            isActive:  true,
          },
        });
        created++;
      }
    } catch {
      // Skip duplicates silently
    }
  }

  return created;
}

export async function saveQueryResults(
  trackedQueryId: string,
  results:        QueryCheckResult[]
): Promise<void> {
  for (const result of results) {
    await prisma.queryResult.create({
      data: {
        trackedQueryId,
        model:            result.model,
        mentioned:        result.mentioned,
        mentionPosition:  result.mentionPosition,
        isAuthoritative:  result.isAuthoritative,
        citationUrl:      result.citationUrl,
        competitorsCited: result.competitorsCited,
        responseSnippet:  result.responseSnippet,
      },
    });
  }
}

export async function getQueryLibrarySummary(
  siteId:    string,
  weeksBack = 4
): Promise<{
  queries:             QueryWeeklySummary[];
  overallCitationRate: number;
  trendVsLastWeek:     number | null;
  topCompetitor:       string | null;
}> {
  const since = new Date();
  since.setDate(since.getDate() - weeksBack * 7);

  const queries = await prisma.trackedQuery.findMany({
    where:   { siteId, isActive: true },
    include: {
      results: {
        where:   { checkedAt: { gte: since } },
        orderBy: { checkedAt: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const summaries: QueryWeeklySummary[] = queries.map((q) => {
    const thisWeekResults = q.results.filter(
      (r) => new Date(r.checkedAt) >= oneWeekAgo
    );
    const lastWeekResults = q.results.filter(
      (r) =>
        new Date(r.checkedAt) >= twoWeeksAgo &&
        new Date(r.checkedAt) < oneWeekAgo
    );

    const mentionRate =
      thisWeekResults.length > 0
        ? Math.round(
            (thisWeekResults.filter((r) => r.mentioned).length /
              thisWeekResults.length) *
              100
          )
        : 0;

    const lastWeekRate =
      lastWeekResults.length > 0
        ? Math.round(
            (lastWeekResults.filter((r) => r.mentioned).length /
              lastWeekResults.length) *
              100
          )
        : null;

    const compCounts: Record<string, number> = {};
    for (const r of thisWeekResults) {
      for (const comp of r.competitorsCited) {
        compCounts[comp] = (compCounts[comp] ?? 0) + 1;
      }
    }
    const topComp =
      Object.entries(compCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

    return {
      query:              q.queryText,
      intent:             q.intent as QueryIntent,
      overallMentionRate: mentionRate,
      modelResults:       thisWeekResults.map((r) => ({
        model:            r.model,
        mentioned:        r.mentioned,
        mentionPosition:  r.mentionPosition,
        isAuthoritative:  r.isAuthoritative,
        citationUrl:      r.citationUrl,
        competitorsCited: r.competitorsCited,
        responseSnippet:  r.responseSnippet,
        checkedAt:        r.checkedAt,
      })),
      weekOverWeek:  lastWeekRate !== null ? mentionRate - lastWeekRate : null,
      topCompetitor: topComp,
    };
  });

  const allRates = summaries.map((s) => s.overallMentionRate);
  const overallCitationRate =
    allRates.length > 0
      ? Math.round(allRates.reduce((a, b) => a + b, 0) / allRates.length)
      : 0;

  const weeklyChanges = summaries
    .map((s) => s.weekOverWeek)
    .filter((c): c is number => c !== null);
  const trendVsLastWeek =
    weeklyChanges.length > 0
      ? Math.round(weeklyChanges.reduce((a, b) => a + b, 0) / weeklyChanges.length)
      : null;

  const globalCompCounts: Record<string, number> = {};
  for (const s of summaries) {
    if (s.topCompetitor) {
      globalCompCounts[s.topCompetitor] =
        (globalCompCounts[s.topCompetitor] ?? 0) + 1;
    }
  }
  const topCompetitor =
    Object.entries(globalCompCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ??
    null;

  return { queries: summaries, overallCitationRate, trendVsLastWeek, topCompetitor };
}


