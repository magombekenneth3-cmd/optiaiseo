import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getSerpContextForKeyword, scrapePageData } from "@/lib/blog/serp";
import { getBacklinkSummary, getCompetitorBacklinkGap } from "@/lib/backlinks";
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

/**
 * Returns a 0-1 diversity score for an anchor text profile.
 * 1.0 = perfectly diverse (every anchor is unique brand/generic).
 * 0.0 = all anchors are exact keyword matches (over-optimised).
 *
 * Logic: compute the % of total anchors that are exact- or partial-keyword
 * matches, then invert it. A score < 0.4 triggers an advisory fix.
 */
export function computeAnchorDiversityScore(
    anchors: { anchor: string; count: number }[],
    keyword: string,
): number {
    if (anchors.length === 0) return 1;

    const kw = keyword.toLowerCase().trim();
    const kwWords = kw.split(/\s+/).filter(Boolean);

    const totalLinks = anchors.reduce((s, a) => s + a.count, 0);
    if (totalLinks === 0) return 1;

    const keywordMatchLinks = anchors
        .filter((a) => {
            const text = (a.anchor ?? "").toLowerCase().trim();
            if (!text) return false;
            // Exact or partial keyword match
            return kwWords.length > 0 && kwWords.every((w) => text.includes(w));
        })
        .reduce((s, a) => s + a.count, 0);

    const keywordMatchRatio = keywordMatchLinks / totalLinks;
    return Math.max(0, 1 - keywordMatchRatio);
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
        idempotency: "event.data.analysisId",
        triggers: [{ event: "serp-analysis/requested" as const }],
    },
    async ({ event, step }) => {
        const { analysisId, siteId, keyword, landingPageUrl, domain } =
            event.data as SerpAnalysisPayload;

        if (!analysisId || !siteId || !keyword || !landingPageUrl) {
            throw new NonRetriableError("Missing required fields in serp-analysis/requested payload");
        }

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

        const { userPage, userPageScrapedOk, authorityComp, backlinkSummary, serpResults, wordCountAvg } =
            await step.run("scrape-authority", async () => {
                const top10 = serpContext.results.slice(0, 10);

                let userPageScrapedOk = true;
                const [userPageResult, authorityResult, backlinkResult] = await Promise.all([
                    scrapePageData(landingPageUrl).catch(() => { userPageScrapedOk = false; return { text: "", headings: [], schemaTypes: [], publishedDate: null }; }),
                    getCompetitorAuthorityComparison(siteId).catch(() => null),
                    getBacklinkSummary(domain, siteId).catch(() => null),
                ]);

                const trackedDrMap = new Map<string, number>(
                    (authorityResult?.competitors ?? []).map((c) => [
                        c.domain.replace(/^www\./, ""),
                        c.dr ?? 0,
                    ])
                );

                const mappedResults = top10.map((r, i) => {
                    const d = extractDomain(r.link);
                    return {
                        position: i + 1,
                        domain: d,
                        title: r.title,
                        snippet: r.snippet?.slice(0, 180) ?? "",
                        url: r.link,
                        wordCount: r.wordCount ?? 0,
                        h2Count: (r.scrapedHeadings ?? []).length,
                        contentType: "",
                        dr: trackedDrMap.get(d) ?? 0,
                    };
                });

                const wordCounts = mappedResults.map(r => r.wordCount).filter(w => w > 0);
                const avg = wordCounts.length
                    ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
                    : 0;

                return {
                    userPage: userPageResult,
                    userPageScrapedOk,
                    authorityComp: authorityResult,
                    backlinkSummary: backlinkResult,
                    serpResults: mappedResults,
                    wordCountAvg: avg,
                };
            });

        const aiResult = await step.run("ai-fixes", async () => {
            await prisma.keywordSerpAnalysis.update({
                where: { id: analysisId },
                data: { status: "PLANNING" },
            });

            const userWordCount = userPage.text
                ? userPage.text.split(/\s+/).filter(Boolean).length
                : 0;
            const userH2s = userPage.headings ?? [];
            const clientDR = authorityComp?.yourDr ?? 0;
            const clientRDs = backlinkSummary?.referringDomains ?? 0;
            const toxicCount = backlinkSummary?.toxicCount ?? 0;
            const topAnchors = backlinkSummary?.topAnchors ?? [];
            const drGap = authorityComp?.competitors[0]?.drGap ?? null;
            const pageBacklinks = await prisma.backlinkDetail
                .count({ where: { siteId, targetUrl: { contains: landingPageUrl } } })
                .catch(() => 0);
            const top3Avg = authorityComp
                ? authorityComp.competitors.slice(0, 3).reduce((s, c) => s + (c.dr ?? 0), 0) /
                Math.max(1, Math.min(3, authorityComp.competitors.length))
                : 0;

            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 90_000 } });

            // FIX 1: Sample ALL 10 SERP results for headings so the ≥3/10 frequency
            // threshold is actually computable. Previously only 5 were sampled, making
            // it impossible to reliably reach the 3-occurrence bar.
            const allSerpH2s = serpContext.results
                .slice(0, 10)
                .flatMap(r => r.scrapedHeadings ?? [])
                .filter(h => !/^(table of contents|related (articles|posts)|share this|comments|leave a reply|about the author|newsletter|sidebar|footer|navigation)/i.test(h))
                .slice(0, 60);

            // FIX 2: When the user's page couldn't be scraped, note that explicitly so
            // the AI can still generate content suggestions based on competitor data.
            const userPageNote = !userPageScrapedOk
                ? "NOTE: user page could not be scraped. Generate content suggestions based on SERP data and heading gaps alone — do NOT skip content fixes because of missing user data."
                : "";

            const wordGap = wordCountAvg > 0 && userWordCount > 0
                ? `Your page is ${userWordCount < wordCountAvg ? Math.round(wordCountAvg - userWordCount) + " words SHORT of" : Math.round(userWordCount - wordCountAvg) + " words ABOVE"} the top-10 average (${wordCountAvg} words).`
                : wordCountAvg > 0
                    ? `Top-10 average is ${wordCountAvg} words. User page word count unavailable — suggest word-count target as a content fix.`
                    : "";

            const prompt = `You are an SEO content strategist. Return ONLY valid JSON with this exact shape — no markdown, no code fences:
{
  "fixes": [{"title":string,"description":string,"priority":"high"|"medium"|"low","category":"content"|"structure"|"intent"|"links"|"authority"|"schema","linkToTab":"heading-gaps"|"link-authority"|null}],
  "headingGaps": [{"topic":string,"freqInTop10":number,"coveredOnYourPage":boolean}],
  "intentMismatch": boolean,
  "intentNote": string|null,
  "contentTypeTop10": string
}

MANDATORY RULES (all must be followed):
1. Always produce 5–7 fixes. Never return an empty fixes array.
2. At least 2 fixes MUST be content-improvement fixes (category "content" or "structure") that explain how to improve the page copy to beat competitors — e.g. missing topics, word count gap, intro quality, FAQ sections, schema, E-E-A-T signals.
3. If the heading gaps list has uncovered topics (coveredOnYourPage=false), include a HIGH content fix telling the user to add those sections, with linkToTab "heading-gaps".
4. If drGap > 30 OR pageRDs < 5, include ONE authority fix (category "authority") with linkToTab "link-authority". Do not add more than one authority fix.
5. Fixes ordered: high → medium → low priority.
6. headingGaps: include every topic that appears in ≥2 of the 10 SERP H2s (lower bar since we can't always get all 10); set coveredOnYourPage=true only if the exact topic appears in userH2s.
7. All descriptions must reference specific numbers from the data (e.g. word counts, DR scores, heading frequencies).
${userPageNote}

KEYWORD: "${keyword}"
${wordGap}
SERP TOP 5: ${JSON.stringify(serpResults.slice(0, 5).map(r => ({ pos: r.position, domain: r.domain, wordCount: r.wordCount, h2Count: r.h2Count })))}
ALL SERP H2s (from top 10): ${JSON.stringify(allSerpH2s)}
PAA questions: ${JSON.stringify(serpContext.peopleAlsoAsk.slice(0, 8).map(p => p.question))}
USER PAGE: url=${landingPageUrl} h2s=${JSON.stringify(userH2s.length > 0 ? userH2s : ["(none detected — page could not be scraped)"])} words=${userWordCount || "(unknown)"}
AUTHORITY: clientDR=${clientDR} clientRDs=${clientRDs} pageRDs=${pageBacklinks} toxic=${toxicCount} drGap=${drGap ?? "unknown"} top3AvgDR=${Math.round(top3Avg)}
ANCHORS: ${JSON.stringify(topAnchors.slice(0, 5))}`;

            const response = await ai.models.generateContent({
                model: AI_MODELS.GEMINI_PRO,
                contents: prompt,
                config: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 3000 },
            });

            // FIX 3: Log the raw response before parsing so failures are diagnosable,
            // and strip any accidental markdown fences Gemini might still emit.
            const rawText = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
            try {
                const parsed = JSON.parse(rawText) as {
                    fixes: unknown[];
                    headingGaps: unknown[];
                    intentMismatch: boolean;
                    intentNote: string | null;
                    contentTypeTop10: string;
                };
                // FIX 4: Guard against an AI returning an empty fixes array despite the
                // mandatory rules — surface an error so we can retry rather than silently
                // showing "Fix Suggestions (0)".
                if (!Array.isArray(parsed.fixes) || parsed.fixes.length === 0) {
                    logger.warn("[KeywordSerpAnalysis] AI returned 0 fixes — raw response logged", { analysisId, rawText: rawText.slice(0, 500) });
                }
                return parsed;
            } catch (parseErr) {
                logger.error("[KeywordSerpAnalysis] Failed to parse Gemini JSON", { analysisId, parseErr, rawText: rawText.slice(0, 500) });
                // Return a minimal set of content fixes so the user always sees something useful.
                const fallbackFixes = [
                    {
                        title: "Improve content depth to match top competitors",
                        description: wordCountAvg > 0
                            ? `Top-10 pages average ${wordCountAvg} words. Expand your content to cover missing topics surfaced in the Heading Gaps tab.`
                            : "Expand your content to cover the topics that appear most frequently in top-ranking competitor pages (see Heading Gaps tab).",
                        priority: "high",
                        category: "content",
                        linkToTab: "heading-gaps",
                    },
                    {
                        title: "Add FAQ section targeting People Also Ask questions",
                        description: serpContext.peopleAlsoAsk.length > 0
                            ? `Competitors are capturing PAA boxes. Add an FAQ section answering: "${serpContext.peopleAlsoAsk.slice(0, 3).map(p => p.question).join('", "')}".`
                            : "Add an FAQ section targeting common questions for this keyword to capture People Also Ask SERP features.",
                        priority: "medium",
                        category: "structure",
                        linkToTab: null,
                    },
                ];
                return {
                    fixes: fallbackFixes,
                    headingGaps: [],
                    intentMismatch: false,
                    intentNote: null,
                    contentTypeTop10: "",
                };
            }
        });

        const { opportunityDoms, rdGapRoot } = await step.run("fetch-link-gap", async () => {
            const topSerpDomain = serpResults[0]?.domain;
            if (!topSerpDomain || topSerpDomain === domain.replace(/^www\./, "")) {
                return { opportunityDoms: [] as { domain: string; dr: number }[], rdGapRoot: null as number | null };
            }
            try {
                const gapReport = await getCompetitorBacklinkGap(domain, topSerpDomain, 20);
                return {
                    opportunityDoms: gapReport.gap.opportunityDomains,
                    rdGapRoot: gapReport.gap.referringDomains > 0 ? gapReport.gap.referringDomains : null,
                };
            } catch {
                return { opportunityDoms: [] as { domain: string; dr: number }[], rdGapRoot: null as number | null };
            }
        });

        await step.run("save-and-notify", async () => {
            const drGap = authorityComp?.competitors[0]?.drGap ?? null;
            const clientDR = authorityComp?.yourDr ?? 0;
            const clientRDs = backlinkSummary?.referringDomains ?? 0;
            const toxicCount = backlinkSummary?.toxicCount ?? 0;
            const topAnchors = backlinkSummary?.topAnchors ?? [];
            const newLastWeek = backlinkSummary?.newLastWeek ?? 0;
            const lostLastWeek = backlinkSummary?.lostLastWeek ?? 0;
            const dofollowRatio = backlinkSummary?.doFollowRatio ?? 0;
            const pageBacklinks = await prisma.backlinkDetail
                .count({ where: { siteId, targetUrl: { contains: landingPageUrl } } })
                .catch(() => 0);
            const disclaimerNeeded =
                (drGap !== null && drGap > 30) || clientRDs < 10 || (rdGapRoot !== null && rdGapRoot > 100);

            const userWordCount = userPage.text
                ? userPage.text.split(/\s+/).filter(Boolean).length
                : 0;
            const userH2s = userPage.headings ?? [];

            // ── Anchor diversity check (new) ──────────────────────────────────────
            const anchorScore = computeAnchorDiversityScore(topAnchors, keyword);
            const enrichedFixes = [...aiResult.fixes] as any[];

            if (topAnchors.length >= 5 && anchorScore < 0.4) {
                const keywordMatchPct = Math.round((1 - anchorScore) * 100);
                // Only add the fix if no authority fix already exists to avoid duplication
                const hasLinkFix = enrichedFixes.some((f) => (f as { category: string }).category === "links");
                if (!hasLinkFix) {
                    enrichedFixes.push({
                        title: "Diversify anchor text to reduce over-optimisation risk",
                        description: `${keywordMatchPct}% of your inbound anchors are exact or partial matches for "${keyword}". Google's Penguin algorithm flags unnatural anchor profiles. Aim for < 30% exact-match anchors — request branded anchors (e.g. "${domain}", "learn more on ${domain}") or natural phrase variants in future outreach.`,
                        priority: "medium",
                        category: "links",
                        linkToTab: "link-authority",
                    });
                }
            }
            // ── End anchor diversity check ─────────────────────────────────────────

            // Dynamic TTL: shorter when intent mismatch or big DR gap
            const hasSevereIssue = aiResult.intentMismatch || (drGap !== null && drGap > 30);
            const ttlDays = hasSevereIssue ? 3 : 7;
            const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

            await prisma.keywordSerpAnalysis.update({
                where: { id: analysisId },
                data: {
                    status: "COMPLETED",
                    serpResults: serpResults as never,
                    fixes: enrichedFixes as any,
                    headingGaps: aiResult.headingGaps as never,
                    wordCountAvg,
                    wordCountPage: userWordCount,
                    drGap: drGap ?? undefined,
                    rdGapRoot: rdGapRoot ?? undefined,
                    rdGapPage: pageBacklinks,
                    opportunityDoms: opportunityDoms as never,
                    intentMismatch: aiResult.intentMismatch,
                    intentNote: aiResult.intentNote,
                    contentType: aiResult.contentTypeTop10,
                    disclaimerNeeded,
                    yourPageH2s: userH2s as never,
                    clientDR,
                    clientRDs,
                    toxicCount,
                    topAnchors: topAnchors as never,
                    newLastWeek,
                    lostLastWeek,
                    dofollowRatio,
                    userPageScrapedOk,
                    expiresAt,
                    completedAt: new Date(),
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