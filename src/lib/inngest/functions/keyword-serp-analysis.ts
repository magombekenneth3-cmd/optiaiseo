/**
 * Inngest background job — Keyword vs SERP Analysis
 *
 * Triggered by: "serp-analysis/requested"
 * Payload: { analysisId, siteId, userId, keyword, landingPageUrl, domain }
 *
 * Steps:
 *   1. fetch-serp         — getSerpContextForKeyword (Serper API)
 *   2. scrape-authority   — page scrape + authority comparison + backlink summary (parallel)
 *   3. ai-fixes           — Gemini structured output (fixes, heading gaps, intent)
 *   4. save-and-notify    — upsert KeywordSerpAnalysis to COMPLETED + fire completion event
 *
 * Concurrency: max 2 jobs per siteId — prevents one site from starving Serper quota.
 * Retries: 2 — transient network/API errors recover automatically.
 */

import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getSerpContextForKeyword, scrapePageData } from "@/lib/blog/serp";
import { getBacklinkSummary } from "@/lib/backlinks";
import { getCompetitorAuthorityComparison } from "@/lib/seo/competitor-authority";
import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "@/lib/constants/ai-models";

interface SerpAnalysisPayload {
    analysisId: string;
    siteId: string;
    userId: string;
    keyword: string;
    landingPageUrl: string;
    domain: string;
}

function extractDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export const runKeywordSerpAnalysisJob = inngest.createFunction(
    {
        id: "keyword-serp-analysis",
        name: "Keyword vs SERP Analysis",
        retries: 2,
        concurrency: {
            limit: 2,
            key: "event.data.siteId",
        },
        triggers: [{ event: "serp-analysis/requested" as const }],
    },
    async ({ event, step }) => {
        const { analysisId, siteId, keyword, landingPageUrl, domain } =
            event.data as SerpAnalysisPayload;

        if (!analysisId || !siteId || !keyword || !landingPageUrl) {
            throw new NonRetriableError("Missing required fields in serp-analysis/requested payload");
        }

        // ── Step 1: Fetch SERP ───────────────────────────────────────────────────
        const serpContext = await step.run("fetch-serp", async () => {
            await prisma.keywordSerpAnalysis.update({
                where: { id: analysisId },
                data: { status: "SCRAPING" },
            });

            const ctx = await getSerpContextForKeyword(keyword);
            if (!ctx) {
                await prisma.keywordSerpAnalysis.update({
                    where: { id: analysisId },
                    data: { status: "FAILED", errorMessage: "SERP fetch returned no results — check SERPER_API_KEY" },
                });
                throw new NonRetriableError("SERP fetch failed");
            }
            return ctx;
        });

        // ── Step 2: Scrape + authority (parallel) ────────────────────────────────
        const { userPage, authorityComp, backlinkSummary, serpResults, wordCountAvg } =
            await step.run("scrape-authority", async () => {
                const top10 = serpContext.results.slice(0, 10);

                const [userPageResult, authorityResult, backlinkResult] = await Promise.all([
                    scrapePageData(landingPageUrl).catch(() => ({ text: "", headings: [], schemaTypes: [], publishedDate: null })),
                    getCompetitorAuthorityComparison(siteId).catch(() => null),
                    getBacklinkSummary(domain, siteId).catch(() => null),
                ]);

                const mappedResults = top10.map((r, i) => ({
                    position:    i + 1,
                    domain:      extractDomain(r.link),
                    title:       r.title,
                    snippet:     r.snippet?.slice(0, 180) ?? "",
                    url:         r.link,
                    wordCount:   r.wordCount ?? 0,
                    h2Count:     (r.scrapedHeadings ?? []).length,
                    contentType: "",
                }));

                const wordCounts = mappedResults.map(r => r.wordCount).filter(w => w > 0);
                const avg = wordCounts.length
                    ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
                    : 0;

                return {
                    userPage:       userPageResult,
                    authorityComp:  authorityResult,
                    backlinkSummary: backlinkResult,
                    serpResults:    mappedResults,
                    wordCountAvg:   avg,
                };
            });

        // ── Step 3: AI fixes + heading gaps ─────────────────────────────────────
        const aiResult = await step.run("ai-fixes", async () => {
            await prisma.keywordSerpAnalysis.update({
                where: { id: analysisId },
                data: { status: "PLANNING" },
            });

            const userWordCount = userPage.text
                ? userPage.text.split(/\s+/).filter(Boolean).length
                : 0;
            const userH2s       = userPage.headings ?? [];
            const clientDR      = authorityComp?.yourDr ?? 0;
            const clientRDs     = backlinkSummary?.referringDomains ?? 0;
            const toxicCount    = backlinkSummary?.toxicCount ?? 0;
            const topAnchors    = backlinkSummary?.topAnchors ?? [];
            const drGap         = authorityComp?.competitors[0]?.drGap ?? null;
            const pageBacklinks = await prisma.backlinkDetail
                .count({ where: { siteId, targetUrl: { contains: landingPageUrl } } })
                .catch(() => 0);
            const top3Avg       = authorityComp
                ? authorityComp.competitors.slice(0, 3).reduce((s, c) => s + (c.dr ?? 0), 0) /
                  Math.max(1, Math.min(3, authorityComp.competitors.length))
                : 0;

            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 90_000 } });

            const prompt = `You are an SEO analyst. Return ONLY valid JSON with this exact shape — no markdown:
{
  "fixes": [{"title":string,"description":string,"priority":"high"|"medium"|"low","category":"content"|"structure"|"intent"|"links"|"authority"|"schema","linkToTab":"heading-gaps"|"link-authority"|null}],
  "headingGaps": [{"topic":string,"freqInTop10":number,"coveredOnYourPage":boolean}],
  "intentMismatch": boolean,
  "intentNote": string|null,
  "contentTypeTop10": string
}

Rules: max 7 fixes, ordered high→medium→low, descriptions reference actual numbers.
If rdGap > 100 or drGap > 30, include a HIGH authority fix.
headingGaps: topics in ≥3/10 top results only.

SERP: ${JSON.stringify(serpResults.slice(0,3).map(r => ({ pos: r.position, domain: r.domain, wordCount: r.wordCount, h2Count: r.h2Count })))}
Top H2s: ${JSON.stringify(serpContext.results.slice(0,5).flatMap(r => r.scrapedHeadings ?? []).slice(0,30))}
PAA: ${JSON.stringify(serpContext.peopleAlsoAsk.slice(0,5).map(p => p.question))}
USER: url=${landingPageUrl} h2s=${JSON.stringify(userH2s)} words=${userWordCount}
AUTHORITY: clientDR=${clientDR} clientRDs=${clientRDs} pageRDs=${pageBacklinks} toxic=${toxicCount} drGap=${drGap ?? "unknown"} top3AvgDR=${Math.round(top3Avg)}
ANCHORS: ${JSON.stringify(topAnchors.slice(0,5))}
AVG_WORDS=${wordCountAvg} YOUR_WORDS=${userWordCount}`;

            const response = await ai.models.generateContent({
                model: AI_MODELS.GEMINI_PRO,
                contents: prompt,
                config: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 3000 },
            });

            try {
                return JSON.parse(response.text ?? "{}") as {
                    fixes: unknown[];
                    headingGaps: unknown[];
                    intentMismatch: boolean;
                    intentNote: string | null;
                    contentTypeTop10: string;
                };
            } catch {
                return { fixes: [], headingGaps: [], intentMismatch: false, intentNote: null, contentTypeTop10: "" };
            }
        });

        // ── Step 4: Save + notify ────────────────────────────────────────────────
        await step.run("save-and-notify", async () => {
            const drGap         = authorityComp?.competitors[0]?.drGap ?? null;
            const clientRDs     = backlinkSummary?.referringDomains ?? 0;
            const pageBacklinks = await prisma.backlinkDetail
                .count({ where: { siteId, targetUrl: { contains: landingPageUrl } } })
                .catch(() => 0);
            const opportunityDoms = ([] as { domain: string; dr: number }[]);
            const disclaimerNeeded =
                (drGap !== null && drGap > 30) || clientRDs < 10;

            const userWordCount = userPage.text
                ? userPage.text.split(/\s+/).filter(Boolean).length
                : 0;

            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            await prisma.keywordSerpAnalysis.update({
                where: { id: analysisId },
                data: {
                    status:         "COMPLETED",
                    serpResults:    serpResults    as unknown as Prisma.InputJsonValue,
                    fixes:          aiResult.fixes as unknown as Prisma.InputJsonValue,
                    headingGaps:    aiResult.headingGaps as unknown as Prisma.InputJsonValue,
                    wordCountAvg,
                    wordCountPage:  userWordCount,
                    drGap:          drGap ?? undefined,
                    rdGapPage:      pageBacklinks,
                    opportunityDoms: opportunityDoms as unknown as Prisma.InputJsonValue,
                    intentMismatch: aiResult.intentMismatch,
                    intentNote:     aiResult.intentNote,
                    contentType:    aiResult.contentTypeTop10,
                    disclaimerNeeded,
                    expiresAt,
                    completedAt:    new Date(),
                },
            });

            logger.info("[KeywordSerpAnalysis] Completed", { analysisId, keyword });
        });

        await step.sendEvent("notify-complete", {
            name: "serp-analysis/completed",
            data: { analysisId, siteId, keyword },
        });

        return { analysisId, keyword };
    },
);
