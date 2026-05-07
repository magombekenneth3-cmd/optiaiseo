
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkPerplexityCitation } from "./perplexity-citation-check";
import { callGeminiJson } from "@/lib/gemini/client";
import { performVectorGapAnalysis } from "./vector-gap";
import { redis } from "@/lib/redis";
import { TTL } from "@/lib/constants/ttl";
import { profileCompetitorPage } from "./competitor-content-profile";

export type GapReason =
  | "missing_faq_schema"
  | "no_definition_sentence"
  | "content_too_thin"
  | "missing_structured_data"
  | "weak_authority_signals"
  | "poor_entity_coverage"
  | "no_comparison_content"
  | "missing_stats_or_data";

export interface CitationGap {
  keyword: string;
  yourPosition: number | null;
  topCompetitorCiting: {
    domain: string;
    citationPosition: number;
    citedUrl: string;
  } | null;
  affectedModels: string[];
  /** Gemini-classified reason */
  gapReason: GapReason;
  /** Plain-English explanation of why Perplexity prefers the competitor */
  explanation: string;
  /** A single, concrete, copyable fix */
  fix: string;
  /** Estimated monthly search volume for this keyword (from CompetitorKeyword) */
  searchVolume: number;
  /** high / medium / low derived from search volume + gap severity */
  impact: "high" | "medium" | "low";
  /** Source of this gap record */
  source: "live" | "cached";
  /**
   * Semantic concepts the competitor's page covers that your content is missing.
   * Derived from embedding comparison via performVectorGapAnalysis.
   * e.g. ["FAQ section", "statistics with sources", "comparison table"]
   */
  embeddingGapSignals: string[];
}

export interface CitationGapReport {
  siteId: string;
  domain: string;
  gapCount: number;
  gaps: CitationGap[];
  summary: {
    highImpactGaps: number;
    topGapReason: GapReason | null;
    topCompetitorWinning: string | null;
  };
  generatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GAP_REASON_LABELS: Record<GapReason, string> = {
  missing_faq_schema: "Missing FAQ Schema",
  no_definition_sentence: "No Definition Sentence",
  content_too_thin: "Content Too Thin",
  missing_structured_data: "Missing Structured Data",
  weak_authority_signals: "Weak Authority Signals",
  poor_entity_coverage: "Poor Entity Coverage",
  no_comparison_content: "No Comparison Content",
  missing_stats_or_data: "Missing Stats / Data",
};

export { GAP_REASON_LABELS };

// ─── Keyword-only gap reason classifier (Redis-cached 24 h) ──────────────────

function gapReasonCacheKey(siteId: string, keyword: string): string {
  return `gap-reason:${siteId}:${keyword.toLowerCase().replace(/\s+/g, "-")}`;
}

interface ClassifiedGap {
  gapReason: GapReason;
  explanation: string;
  fix: string;
}

/**
 * Classify a citation gap using only the keyword text — no live page fetches.
 * Falls back to "content_too_thin" if Gemini is unavailable.
 * Result is cached in Redis for 24 h.
 */
async function classifyGapReason(
  siteId: string,
  keyword: string,
  competitorDomain: string
): Promise<ClassifiedGap> {
  const cacheKey = gapReasonCacheKey(siteId, keyword);

  // ── Redis read ──────────────────────────────────────────────────────────────
  try {
    const cached = await redis.get<ClassifiedGap>(cacheKey);
    if (cached) return cached;
  } catch {
    // Redis unavailable — continue to Gemini
  }

  // ── Fallback (used if Gemini key missing or call fails) ───────────────────
  const fallback: ClassifiedGap = {
    gapReason: "content_too_thin",
    explanation: `${competitorDomain} is cited for "${keyword}" while your site is not. Run a full citation gap analysis for a detailed diagnosis.`,
    fix: "Add a dedicated page targeting this exact query phrase with a clear direct answer in the first paragraph, plus FAQPage schema.",
  };

  if (!process.env.GEMINI_API_KEY) return fallback;

  const prompt = `You are an AEO (Answer Engine Optimization) expert.
A competitor domain ("${competitorDomain}") is being cited by AI engines for the keyword "${keyword}", but the user's site is NOT being cited.

Without seeing either page, infer the MOST LIKELY reason from the keyword text alone.
Choose EXACTLY ONE reason from this list:
- missing_faq_schema
- no_definition_sentence
- content_too_thin
- missing_structured_data
- weak_authority_signals
- poor_entity_coverage
- no_comparison_content
- missing_stats_or_data

Respond ONLY in this JSON format (no markdown, no preamble):
{
  "gapReason": "<one of the 8 reasons above>",
  "explanation": "<1-2 sentences: why AI engines likely prefer the competitor for this keyword>",
  "fix": "<one concrete actionable fix — be specific about content format, schema type, or word count>"
}`;

  try {
    const parsed = await callGeminiJson<ClassifiedGap>(prompt, {
      model: "gemini-2.0-flash",
      temperature: 0.2,
      maxOutputTokens: 300,
    });

    const result: ClassifiedGap = {
      gapReason: parsed.gapReason ?? "content_too_thin",
      explanation: parsed.explanation ?? fallback.explanation,
      fix: parsed.fix ?? fallback.fix,
    };

    // ── Redis write ───────────────────────────────────────────────────────────
    try {
      await redis.set(cacheKey, result, { ex: TTL.MENTION_S }); // 24 h
    } catch {
      // Non-fatal — just skip caching
    }

    return result;
  } catch (err) {
    logger.warn("[CitationGap] Keyword-only Gemini classification failed", {
      keyword,
      error: (err as Error)?.message,
    });
    return fallback;
  }
}

// ─── Fast cached path (dashboard widget) ─────────────────────────────────────

/**
 * Returns citation gaps derived purely from AiShareOfVoice records.
 * Gap reasons are classified via a lightweight keyword-only Gemini call,
 * cached in Redis for 24 h — safe to call on every dashboard load.
 */
export async function getCachedCitationGaps(siteId: string): Promise<CitationGap[]> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { domain: true },
  });
  if (!site) return [];

  const sovRecords = await prisma.aiShareOfVoice.findMany({
    where: {
      siteId,
      brandMentioned: false,
    },
    orderBy: { recordedAt: "desc" },
    take: 30,
    distinct: ["keyword"],
    select: {
      keyword: true,
      modelName: true,
      competitorsMentioned: true,
      // Gap 1 — read persisted classification to skip Gemini re-calls
      gapReason: true,
      gapExplanation: true,
      gapFix: true,
      embeddingGapSignals: true,
    },
  });

  const gaps: CitationGap[] = [];

  // Split records: those with a persisted gapReason skip Gemini entirely.
  // Only un-classified records hit classifyGapReason() (Redis-cached 24 h).
  const needsClassification = sovRecords.filter(r => !r.gapReason);
  const alreadyClassified   = sovRecords.filter(r => !!r.gapReason);

  const classifications = await Promise.allSettled(
    needsClassification.map((record) => {
      const competitorsMentioned: string[] = Array.isArray(record.competitorsMentioned)
        ? record.competitorsMentioned
        : [];
      const topCompetitor = competitorsMentioned[0] ?? "a competitor";
      return classifyGapReason(siteId, record.keyword, topCompetitor);
    })
  );

  // Merge both sets back in original order
  let classIdx = 0;
  for (const record of sovRecords) {
    const competitorsMentioned: string[] = Array.isArray(record.competitorsMentioned)
      ? record.competitorsMentioned
      : [];

    if (competitorsMentioned.length === 0) {
      if (!record.gapReason) classIdx++;
      continue;
    }

    let classified: ClassifiedGap;

    if (record.gapReason) {
      // ✅ Use persisted classification — zero API cost
      classified = {
        gapReason: record.gapReason as GapReason,
        explanation: record.gapExplanation ?? `${competitorsMentioned[0]} is cited for "${record.keyword}" while your site is not.`,
        fix: record.gapFix ?? "Add a dedicated page targeting this query with a direct answer and FAQPage schema.",
      };
    } else {
      // Keyword not yet classified — use Gemini result (Redis-cached)
      const result = classifications[classIdx++];
      classified = result.status === "fulfilled"
        ? result.value
        : {
            gapReason: "content_too_thin" as GapReason,
            explanation: `${competitorsMentioned[0]} is cited for "${record.keyword}" while your site is not.`,
            fix: "Add a dedicated page targeting this query with a direct answer and FAQPage schema.",
          };
    }

    gaps.push({
      keyword: record.keyword,
      yourPosition: null,
      topCompetitorCiting: competitorsMentioned[0]
        ? {
            domain: competitorsMentioned[0],
            citationPosition: 1,
            citedUrl: `https://${competitorsMentioned[0]}`,
          }
        : null,
      affectedModels: [record.modelName ?? "perplexity"],
      gapReason: classified.gapReason,
      explanation: classified.explanation,
      fix: classified.fix,
      searchVolume: 0,
      impact: "medium",
      source: "cached",
      embeddingGapSignals: record.embeddingGapSignals.length > 0
        ? record.embeddingGapSignals
        : [], // no live embedding available in cached path
    });
  }

  // Suppress unused-variable warning — alreadyClassified drives the split above
  void alreadyClassified;

  return gaps;
}

// ─── Full live analysis ───────────────────────────────────────────────────────

/**
 * Full citation gap analysis — makes live Perplexity + Gemini API calls.
 * Only call this from Inngest or the POST /api/aeo/citation-gap route.
 *
 * @param siteId      - The site to analyse
 * @param maxKeywords - Cap on how many keywords to check (default 20)
 */
export async function runCitationGapAnalysis(
  siteId: string,
  maxKeywords = 20
): Promise<CitationGapReport> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      domain: true,
      coreServices: true,
      competitors: {
        select: { id: true, domain: true },
        take: 5,
      },
    },
  });

  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const domain = site.domain;

  // ── Step 1: gather candidate keywords from competitor DB ──────────────────
  const competitorIds = site.competitors.map((c) => c.id);

  const competitorKeywords = await prisma.competitorKeyword.findMany({
    where: { competitorId: { in: competitorIds } },
    orderBy: { searchVolume: "desc" },
    take: maxKeywords * 2, // fetch extra to account for deduplication
    select: {
      keyword: true,
      searchVolume: true,
      competitor: { select: { domain: true } },
    },
  });

  // Deduplicate keywords — keep the one with the highest volume
  const seen = new Map<string, (typeof competitorKeywords)[0]>();
  for (const ck of competitorKeywords) {
    const existing = seen.get(ck.keyword);
    if (!existing || (ck.searchVolume ?? 0) > (existing.searchVolume ?? 0)) {
      seen.set(ck.keyword, ck);
    }
  }
  const uniqueKeywords = [...seen.values()].slice(0, maxKeywords);

  if (uniqueKeywords.length === 0) {
    logger.warn("[CitationGap] No competitor keywords found", { siteId });
    return buildEmptyReport(siteId, domain);
  }

  // ── Step 2: live Perplexity checks + Gemini diagnosis ────────────────────
  const gaps: CitationGap[] = [];

  // Process in batches of 5 to avoid burst rate limits
  const BATCH = 5;
  for (let i = 0; i < uniqueKeywords.length; i += BATCH) {
    const batch = uniqueKeywords.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(
      batch.map((ck) =>
        analyseKeyword(siteId, domain, ck.keyword, ck.searchVolume ?? 0, site.competitors)
      )
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        gaps.push(result.value);
      } else if (result.status === "rejected") {
        logger.warn("[CitationGap] Keyword analysis failed", {
          error: (result.reason as Error)?.message,
        });
      }
    }
  }

  // Persist gaps to AiShareOfVoice for the fast cached path
  await persistGaps(siteId, gaps);

  const highImpactGaps = gaps.filter((g) => g.impact === "high").length;
  const reasonCounts = new Map<GapReason, number>();
  for (const g of gaps) {
    reasonCounts.set(g.gapReason, (reasonCounts.get(g.gapReason) ?? 0) + 1);
  }
  const topGapReason = reasonCounts.size > 0
    ? ([...reasonCounts.entries()].sort(([, a], [, b]) => b - a)[0][0] as GapReason)
    : null;

  const competitorCounts = new Map<string, number>();
  for (const g of gaps) {
    if (g.topCompetitorCiting) {
      const d = g.topCompetitorCiting.domain;
      competitorCounts.set(d, (competitorCounts.get(d) ?? 0) + 1);
    }
  }
  const topCompetitorWinning = competitorCounts.size > 0
    ? [...competitorCounts.entries()].sort(([, a], [, b]) => b - a)[0][0]
    : null;

  return {
    siteId,
    domain,
    gapCount: gaps.length,
    gaps: gaps.sort((a, b) => {
      const imp = { high: 3, medium: 2, low: 1 };
      return imp[b.impact] - imp[a.impact];
    }),
    summary: {
      highImpactGaps,
      topGapReason,
      topCompetitorWinning,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function analyseKeyword(
  siteId: string,
  domain: string,
  keyword: string,
  searchVolume: number,
  competitors: Array<{ domain: string }>
): Promise<CitationGap | null> {
  // Run brand check + competitor checks in parallel
  const [brandCheck, ...competitorChecks] = await Promise.all([
    checkPerplexityCitation(keyword, domain),
    ...competitors.slice(0, 3).map((c) => checkPerplexityCitation(keyword, c.domain)),
  ]);

  // Find the highest-ranked competitor that IS cited
  const citedCompetitor = competitors
    .map((c, i) => ({ ...c, result: competitorChecks[i] }))
    .filter((c) => c.result?.cited)
    .sort((a, b) => (a.result.citationPosition ?? 99) - (b.result.citationPosition ?? 99))[0];

  // Only a gap if a competitor is cited AND we are not
  if (!citedCompetitor || brandCheck.cited) {
    return null;
  }

  const citedUrl = citedCompetitor.result.citationUrl ?? `https://${citedCompetitor.domain}`;

  // Profile the competitor's winning page (non-blocking — doesn't affect gap result)
  profileCompetitorPage(citedCompetitor.domain, citedUrl, keyword)
    .then(profile => {
      if (profile) {
        redis.set(
          `comp-profile:${siteId}:${keyword.toLowerCase().replace(/\s+/g, "-")}`,
          profile,
          { ex: TTL.MULTI_MODEL_S }, // 7 days
        ).catch(() => { /* non-fatal */ });
      }
    })
    .catch(() => { /* non-fatal */ });

  // Run Gemini text diagnosis and embedding vector analysis in parallel
  const [geminiDiagnosis, vectorGapResult] = await Promise.allSettled([
    diagnoseWithGemini(keyword, domain, citedCompetitor.domain, citedUrl),
    // Fetch the competitor's cited page and compare embeddings to our domain's content
    (async () => {
      try {
        const competitorPageText = await fetchPageText(citedUrl);
        if (!competitorPageText) return null;
        return await performVectorGapAnalysis(competitorPageText, keyword);
      } catch {
        return null;
      }
    })(),
  ]);

  const { gapReason, explanation, fix } =
    geminiDiagnosis.status === "fulfilled"
      ? geminiDiagnosis.value
      : { gapReason: "content_too_thin" as GapReason, explanation: "", fix: "" };

  // Extract semantic concepts the competitor covers that we're missing.
  // Gap 1: if no SERP source is configured, performVectorGapAnalysis() returns
  // setupWarning instead of missingConcepts — surface it so the UI can render
  // an actionable "configure DATAFORSEO / SERPER / PERPLEXITY_API_KEY" message.
  const embeddingGapSignals: string[] = (() => {
    if (vectorGapResult.status !== "fulfilled" || !vectorGapResult.value) return [];
    const result = vectorGapResult.value;
    if (result.setupWarning) return [`⚠️ ${result.setupWarning}`];
    return result.missingConcepts;
  })();

  const volume = searchVolume;
  const impact: CitationGap["impact"] =
    volume >= 1000 ? "high" : volume >= 200 ? "medium" : "low";

  return {
    keyword,
    yourPosition: null,
    topCompetitorCiting: {
      domain: citedCompetitor.domain,
      citationPosition: citedCompetitor.result.citationPosition ?? 1,
      citedUrl,
    },
    affectedModels: ["perplexity"],
    gapReason,
    explanation,
    fix,
    searchVolume: volume,
    impact,
    source: "live",
    embeddingGapSignals,
  };
}

/** Fetches plain text from a URL, strips tags, returns first 4000 chars */
async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return "";
  }
}

async function diagnoseWithGemini(
  keyword: string,
  ourDomain: string,
  competitorDomain: string,
  competitorUrl: string
): Promise<{ gapReason: GapReason; explanation: string; fix: string }> {
  // Fetch competitor page HTML (best effort — skip on error)
  let competitorContent = "";
  try {
    const res = await fetch(competitorUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    competitorContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
  } catch {
    competitorContent = "(Could not fetch competitor page)";
  }

  const prompt = `You are an AI citation gap expert. A user's site (${ourDomain}) is NOT being cited by Perplexity for the keyword "${keyword}", but their competitor (${competitorDomain}) IS being cited.

Here is a snippet of the competitor's cited page:
---
${competitorContent}
---

Diagnose why Perplexity prefers the competitor. Choose EXACTLY ONE reason from this list:
- missing_faq_schema
- no_definition_sentence
- content_too_thin
- missing_structured_data
- weak_authority_signals
- poor_entity_coverage
- no_comparison_content
- missing_stats_or_data

Respond in this EXACT JSON format:
{
  "gapReason": "<one of the 8 reasons above>",
  "explanation": "<2-3 sentence plain English explanation of why Perplexity cites the competitor>",
  "fix": "<one concrete, immediately actionable fix — be specific, include word counts, schema types, or exact text patterns>"
}`;

  try {
    const parsed = await callGeminiJson<{
      gapReason: GapReason;
      explanation: string;
      fix: string;
    }>(prompt, { model: "gemini-2.0-flash", temperature: 0.3 });

    return {
      gapReason: parsed.gapReason ?? "content_too_thin",
      explanation: parsed.explanation ?? "",
      fix: parsed.fix ?? "",
    };
  } catch (err) {
    logger.warn("[CitationGap] Gemini diagnosis failed", {
      error: (err as Error)?.message,
    });
    return {
      gapReason: "content_too_thin",
      explanation: `${competitorDomain} is cited for "${keyword}" while ${ourDomain} is not. Run a full content audit to diagnose.`,
      fix: "Add a concise definition paragraph for this topic, then add FAQ schema targeting the specific question your audience is asking.",
    };
  }
}

async function persistGaps(siteId: string, gaps: CitationGap[]): Promise<void> {
  if (gaps.length === 0) return;
  try {
    // AiShareOfVoice has no unique constraint on (siteId, keyword).
    // Use createMany + skipDuplicates to safely append without upserts.
    // Gap 1 fix: persist gapReason + explanation + fix + embeddingGapSignals so
    // the cached dashboard path can read them back without re-calling Gemini.
    await prisma.aiShareOfVoice.createMany({
      data: gaps.map((gap) => ({
        siteId,
        keyword: gap.keyword,
        modelName: gap.affectedModels[0] ?? "perplexity",
        brandMentioned: gap.yourPosition !== null,
        competitorsMentioned: gap.topCompetitorCiting
          ? [gap.topCompetitorCiting.domain]
          : [],
        recordedAt: new Date(),
        // Persisted classification fields (Gap 1)
        gapReason:          gap.gapReason,
        gapExplanation:     gap.explanation,
        gapFix:             gap.fix,
        embeddingGapSignals: gap.embeddingGapSignals,
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    logger.warn("[CitationGap] Failed to persist gaps", {
      error: (err as Error)?.message,
    });
  }
}

function buildEmptyReport(siteId: string, domain: string): CitationGapReport {
  return {
    siteId,
    domain,
    gapCount: 0,
    gaps: [],
    summary: {
      highImpactGaps: 0,
      topGapReason: null,
      topCompetitorWinning: null,
    },
    generatedAt: new Date().toISOString(),
  };
}
