"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getSerpContextForKeyword, scrapePageData } from "@/lib/blog/serp";
import { getBacklinkSummary, getCompetitorBacklinkGap } from "@/lib/backlinks";
import { getCompetitorAuthorityComparison } from "@/lib/seo/competitor-authority";
import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "@/lib/constants/ai-models";

export interface SerpFix {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  category: "content" | "structure" | "intent" | "links" | "authority" | "schema";
  linkToTab: "heading-gaps" | "link-authority" | null;
}

export interface HeadingGap {
  topic: string;
  freqInTop10: number;
  coveredOnYourPage: boolean;
}

export interface SerpResult {
  position: number;
  domain: string;
  title: string;
  snippet: string;
  url: string;
  wordCount: number;
  h2Count: number;
  contentType: string;
}

export interface SerpAnalysisResult {
  fixes: SerpFix[];
  headingGaps: HeadingGap[];
  serpResults: SerpResult[];
  wordCountAvgTop10: number;
  wordCountYourPage: number;
  yourPageH2s: string[];
  drGap: number | null;
  rdGapRoot: number | null;
  rdGapPage: number | null;
  clientDR: number;
  clientRDs: number;
  pageRDs: number;
  toxicCount: number;
  topAnchors: { anchor: string; count: number }[];
  newLastWeek: number;
  lostLastWeek: number;
  dofollowRatio: number;
  opportunityDoms: { domain: string; dr: number }[];
  intentMismatch: boolean;
  intentNote: string | null;
  contentTypeTop10: string;
  disclaimerNeeded: boolean;
  cachedAt: string;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export async function analyseKeywordVsSerp(
  siteId: string,
  keyword: string,
  landingPageUrl: string,
): Promise<{ data: SerpAnalysisResult | null; error: string | null }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { data: null, error: "Unauthorised" };

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { domain: true, competitors: { select: { domain: true }, take: 10 } },
  });
  if (!site) return { data: null, error: "Site not found" };

  const cached = await prisma.keywordSerpAnalysis.findUnique({
    where: { siteId_keyword: { siteId, keyword } },
  });
  if (cached && cached.expiresAt > new Date()) {
    const d = cached;
    return {
      data: {
        fixes:            d.fixes            as unknown as SerpFix[],
        headingGaps:      d.headingGaps      as unknown as HeadingGap[],
        serpResults:      d.serpResults      as unknown as SerpResult[],
        wordCountAvgTop10: d.wordCountAvg,
        wordCountYourPage: d.wordCountPage,
        yourPageH2s:      [],
        drGap:            d.drGap,
        rdGapRoot:        d.rdGapRoot,
        rdGapPage:        d.rdGapPage,
        clientDR:         0,
        clientRDs:        0,
        pageRDs:          0,
        toxicCount:       0,
        topAnchors:       [],
        newLastWeek:      0,
        lostLastWeek:     0,
        dofollowRatio:    0,
        opportunityDoms:  d.opportunityDoms  as unknown as { domain: string; dr: number }[],
        intentMismatch:   d.intentMismatch,
        intentNote:       d.intentNote ?? null,
        contentTypeTop10: d.contentType ?? "",
        disclaimerNeeded: d.disclaimerNeeded,
        cachedAt:         d.createdAt.toISOString(),
      },
      error: null,
    };
  }

  try {
    const serpContext = await getSerpContextForKeyword(keyword);
    if (!serpContext) return { data: null, error: "SERP fetch failed — check SERPER_API_KEY" };

    const top10 = serpContext.results.slice(0, 10);
    const serpResults: SerpResult[] = top10.map((r, i) => ({
      position:    i + 1,
      domain:      extractDomain(r.link),
      title:       r.title,
      snippet:     r.snippet?.slice(0, 180) ?? "",
      url:         r.link,
      wordCount:   r.wordCount ?? 0,
      h2Count:     (r.scrapedHeadings ?? []).length,
      contentType: "",
    }));

    const wordCounts = serpResults.map(r => r.wordCount).filter(w => w > 0);
    const wordCountAvg = wordCounts.length ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0;

    const userPage = await scrapePageData(landingPageUrl);
    const userWordCount = userPage.text ? userPage.text.split(/\s+/).length : 0;
    const userH2s = userPage.headings ?? [];

    const [authorityComp, backlinkSummary] = await Promise.all([
      getCompetitorAuthorityComparison(siteId).catch(() => null),
      getBacklinkSummary(site.domain, siteId).catch(() => null),
    ]);

    const clientDR  = authorityComp?.yourDr ?? 0;
    const clientRDs = backlinkSummary?.referringDomains ?? 0;
    const toxicCount = backlinkSummary?.toxicCount ?? 0;
    const topAnchors = backlinkSummary?.topAnchors ?? [];
    const newLastWeek = backlinkSummary?.newLastWeek ?? 0;
    const lostLastWeek = backlinkSummary?.lostLastWeek ?? 0;

    const topCompetitorDomain = serpResults[0]?.domain ?? "";
    const isTrackedCompetitor = site.competitors.some(c => c.domain === topCompetitorDomain);

    let gapReport = null;
    if (isTrackedCompetitor && topCompetitorDomain) {
      gapReport = await getCompetitorBacklinkGap(site.domain, topCompetitorDomain).catch(() => null);
    }

    const drGap = authorityComp?.competitors[0]?.drGap ?? null;
    const rdGapRoot = gapReport ? gapReport.gap.referringDomains : null;
    const opportunityDoms = gapReport?.gap.opportunityDomains ?? [];

    const pageBacklinks = await prisma.backlinkDetail.count({
      where: { siteId, targetUrl: { contains: landingPageUrl } },
    }).catch(() => 0);
    const rdGapPage = pageBacklinks;

    const top3Competitors = serpResults.slice(0, 3);
    const top3AvgDR = authorityComp
      ? (authorityComp.competitors.slice(0, 3).reduce((s, c) => s + (c.dr ?? 0), 0) / Math.max(1, Math.min(3, authorityComp.competitors.length)))
      : 0;

    const disclaimerNeeded = (rdGapRoot !== null && rdGapRoot > 100) || (drGap !== null && drGap > 30);

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 90_000 } });

    const prompt = `You are an SEO analyst. Given the combined SERP, content, and backlink data below, return a JSON object with this exact shape — no markdown, no prose:

{
  "fixes": [{"title":string,"description":string,"priority":"high"|"medium"|"low","category":"content"|"structure"|"intent"|"links"|"authority"|"schema","linkToTab":"heading-gaps"|"link-authority"|null}],
  "headingGaps": [{"topic":string,"freqInTop10":number,"coveredOnYourPage":boolean}],
  "intentMismatch": boolean,
  "intentNote": string|null,
  "contentTypeTop10": string
}

Rules:
- fixes: max 7, ordered high→medium→low; every description MUST reference actual numbers from the data
- If rdGapRoot > 100 or drGap > 30, include a HIGH authority fix referencing the actual gap numbers
- headingGaps: semantic clusters only; include topics in ≥3/10 top results; coveredOnYourPage = true only if user H2s clearly cover the topic
- linkToTab: "link-authority" for authority/backlink fixes, "heading-gaps" for heading gap fixes, null otherwise

SERP DATA:
Top 10 results: ${JSON.stringify(top3Competitors.map(r => ({ pos: r.position, domain: r.domain, title: r.title, wordCount: r.wordCount, h2Count: r.h2Count })))}
All H2s from top results: ${JSON.stringify(serpContext.results.slice(0,5).flatMap(r => r.scrapedHeadings ?? []).slice(0,30))}
People Also Ask: ${JSON.stringify(serpContext.peopleAlsoAsk.slice(0,5).map(p => p.question))}

USER PAGE:
URL: ${landingPageUrl}
H2s: ${JSON.stringify(userH2s)}
Word count: ${userWordCount}
Meta: ${userPage.text?.slice(0, 200) ?? ""}

BACKLINK DATA:
Client DR: ${clientDR} · Client RDs (root): ${clientRDs} · Page RDs: ${rdGapPage} · Toxic: ${toxicCount}
Top anchors: ${JSON.stringify(topAnchors.slice(0, 5))}
DR gap vs top competitor: ${drGap ?? "unknown"}
RD gap (root domain): ${rdGapRoot ?? "not tracked"}
Opportunity domains (top 5): ${JSON.stringify(opportunityDoms.slice(0, 5))}
Top-3 avg DR: ${Math.round(top3AvgDR)}
Avg top-10 word count: ${wordCountAvg} · Your page word count: ${userWordCount}`;

    const response = await ai.models.generateContent({
      model: AI_MODELS.GEMINI_PRO,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 3000 },
    });

    let aiResult: {
      fixes: SerpFix[];
      headingGaps: HeadingGap[];
      intentMismatch: boolean;
      intentNote: string | null;
      contentTypeTop10: string;
    };

    try {
      aiResult = JSON.parse(response.text ?? "{}");
    } catch {
      aiResult = { fixes: [], headingGaps: [], intentMismatch: false, intentNote: null, contentTypeTop10: "" };
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.keywordSerpAnalysis.upsert({
      where: { siteId_keyword: { siteId, keyword } },
      create: {
        siteId,
        keyword,
        landingUrl:      landingPageUrl,
        serpResults:     serpResults     as unknown as Prisma.InputJsonValue,
        fixes:           aiResult.fixes  as unknown as Prisma.InputJsonValue,
        headingGaps:     aiResult.headingGaps as unknown as Prisma.InputJsonValue,
        wordCountAvg,
        wordCountPage:   userWordCount,
        drGap:           drGap ?? undefined,
        rdGapRoot:       rdGapRoot ?? undefined,
        rdGapPage,
        opportunityDoms: opportunityDoms as unknown as Prisma.InputJsonValue,
        intentMismatch:  aiResult.intentMismatch,
        intentNote:      aiResult.intentNote,
        contentType:     aiResult.contentTypeTop10,
        disclaimerNeeded,
        expiresAt,
      },
      update: {
        landingUrl:      landingPageUrl,
        serpResults:     serpResults     as unknown as Prisma.InputJsonValue,
        fixes:           aiResult.fixes  as unknown as Prisma.InputJsonValue,
        headingGaps:     aiResult.headingGaps as unknown as Prisma.InputJsonValue,
        wordCountAvg,
        wordCountPage:   userWordCount,
        drGap:           drGap ?? undefined,
        rdGapRoot:       rdGapRoot ?? undefined,
        rdGapPage,
        opportunityDoms: opportunityDoms as unknown as Prisma.InputJsonValue,
        intentMismatch:  aiResult.intentMismatch,
        intentNote:      aiResult.intentNote,
        contentType:     aiResult.contentTypeTop10,
        disclaimerNeeded,
        expiresAt,
      },
    });

    const result: SerpAnalysisResult = {
      fixes:            aiResult.fixes,
      headingGaps:      aiResult.headingGaps,
      serpResults,
      wordCountAvgTop10: wordCountAvg,
      wordCountYourPage: userWordCount,
      yourPageH2s:      userH2s,
      drGap,
      rdGapRoot,
      rdGapPage,
      clientDR,
      clientRDs,
      pageRDs:          rdGapPage,
      toxicCount,
      topAnchors,
      newLastWeek,
      lostLastWeek,
      dofollowRatio:    0,
      opportunityDoms,
      intentMismatch:   aiResult.intentMismatch,
      intentNote:       aiResult.intentNote,
      contentTypeTop10: aiResult.contentTypeTop10,
      disclaimerNeeded,
      cachedAt:         new Date().toISOString(),
    };

    return { data: result, error: null };
  } catch (err) {
    logger.error("[SerpAnalysis] Pipeline failed", { keyword, siteId, error: String(err) });
    return { data: null, error: "Analysis failed. Please try again." };
  }
}

export async function forceRefreshSerpAnalysis(siteId: string, keyword: string, landingPageUrl: string) {
  await prisma.keywordSerpAnalysis.deleteMany({ where: { siteId, keyword } });
  return analyseKeywordVsSerp(siteId, keyword, landingPageUrl);
}
