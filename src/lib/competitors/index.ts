import { logger } from "@/lib/logger";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { throttledGeminiCall } from "@/lib/gemini/throttle";
import { prisma } from "@/lib/prisma";
import { fetchCompetitorPageHtml } from "./page-fetcher";
import { isSafeUrl } from "@/lib/security/safe-url";
import { getDomainMetrics, getKeywordMetricsBatch, resolveLocationCode } from "@/lib/keywords/dataforseo";
import { resolveCountryCode } from "./country";


/**
 * src/lib/competitors/index.ts
 *
 * Competitor Intelligence Engine
 * - Uses Serper.dev for SERP-based keyword gap discovery
 * - Estimates per-keyword monthly visits using the standard CTR curve
 * - Uses Gemini AI to estimate domain-level traffic intelligence
 */

export const CTR_CURVE: Record<number, number> = {
    1: 0.278,
    2: 0.154,
    3: 0.113,
    4: 0.082,
    5: 0.062,
    6: 0.048,
    7: 0.038,
    8: 0.031,
    9: 0.025,
    10: 0.022,
};

interface SerpFeatures {
    hasAnswerBox: boolean;
    hasLocalPack: boolean;
    hasShopping: boolean;
}

export function getDynamicCtr(position: number, serpFeatures?: Partial<SerpFeatures>): number {
    let ctr = CTR_CURVE[Math.min(position, 10)] ?? 0.01;
    if (serpFeatures?.hasAnswerBox) ctr *= 0.78;
    if (serpFeatures?.hasLocalPack) ctr *= 0.85;
    if (serpFeatures?.hasShopping) ctr *= 0.90;
    return ctr;
}

function estimateMonthlyVisits(position: number, searchVolume: number, serpFeatures?: Partial<SerpFeatures>): number {
    const ctr = getDynamicCtr(position, serpFeatures);
    return Math.round(searchVolume * ctr);
}

// ─── Country → Serper gl code mapping ────────────────────────────────────────
export function parseCountryCode(text: string | null | undefined): string {
    return resolveCountryCode(text ?? "") || "us";
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CompetitorKeywordGap {
    keyword: string;
    searchVolume: number;
    difficulty: number;
    position: number;
    url?: string;
    estimatedMonthlyVisits: number;
    intent?: "informational" | "commercial" | "transactional" | "navigational";
    serpFeatures?: Partial<SerpFeatures>;
}

export type TrafficTier = "low" | "medium" | "high" | "enterprise";

export interface TopicCluster {
    name: string;
    keywords: string[];
    totalVolume: number;
}

export interface CompetitorProfile {
    domain: string;
    estimatedMonthlyVisits: number;
    trafficTier: TrafficTier;
    domainAuthorityTier: "new" | "growing" | "established" | "authority";
    topContentPillars: string[];
    growthTrend: "declining" | "stable" | "growing" | "surging";
    trafficSources: { organic: number; paid: number; social: number; direct: number };
    topKeywordGapCount: number;
    analysisNote: string;
    // FIX #29
    topicClusters?: TopicCluster[];
}

// ─── Traffic tiers ────────────────────────────────────────────────────────────
function classifyTraffic(visits: number): TrafficTier {
    if (visits >= 500_000) return "enterprise";
    if (visits >= 50_000) return "high";
    if (visits >= 5_000) return "medium";
    return "low";
}

const TRAFFIC_TIER_LABELS: Record<TrafficTier, string> = {
    low: "< 5K visits/mo",
    medium: "5K–50K visits/mo",
    high: "50K–500K visits/mo",
    enterprise: "500K+ visits/mo",
};

// ─── FIX #29: Topic Cluster Gap Detection ────────────────────────────────────
async function clusterKeywordGaps(
    gaps: CompetitorKeywordGap[],
    hostDomain: string
): Promise<TopicCluster[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || gaps.length < 3) return [];

    const kwList = gaps.slice(0, 50).map(g => `${g.keyword} (${g.searchVolume} vol)`).join('\n');
    const prompt = `You are a content strategist. Group the following keyword gaps into 5-8 topic clusters for "${hostDomain}". Each cluster should represent a content pillar theme.

Keywords:
${kwList}

Respond ONLY with JSON array:
[{ "name": "Topic Name", "keywords": ["kw1","kw2"], "totalVolume": 1234 }]`;

    try {
        const res = await throttledGeminiCall(() =>
            fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.GEMINI_FLASH}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
                    }),
                    signal: AbortSignal.timeout(15000),
                }
            )
        );
        if (!res.ok) return [];
        const data = await res.json();
        const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return [];
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) return parsed as TopicCluster[];
        return [];
    } catch (e: unknown) {
        logger.warn('[Competitor Engine] Topic cluster failed:', { error: (e as Error)?.message || String(e) });
    }
    return [];
}

// ─── Gemini domain intelligence ───────────────────────────────────────────────
async function analyzeCompetitorWithGemini(
    competitorDomain: string,
    hostDomain: string,
    serperKeywords: CompetitorKeywordGap[]
): Promise<Partial<CompetitorProfile>> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return {};

    const topKws = serperKeywords.slice(0, 8).map(k => `- "${k.keyword}" (pos ${k.position}, ~${k.searchVolume.toLocaleString()} searches/mo, est. ${k.estimatedMonthlyVisits.toLocaleString()} visits)`).join("\n");

    const prompt = `You are a competitive intelligence analyst. Analyse the website "${competitorDomain}" as a competitor to "${hostDomain}".

Based on typical websites in this niche and the following keywords they appear to rank for:
${topKws}

Respond ONLY with a valid JSON object (no markdown, no explanation) with these exact fields:
{
  "estimatedMonthlyVisits": <integer, realistic monthly organic visits>,
  "domainAuthorityTier": <"new"|"growing"|"established"|"authority">,
  "topContentPillars": [<3 short topic strings, e.g. "SEO guides", "Tool comparisons">],
  "growthTrend": <"declining"|"stable"|"growing"|"surging">,
  "trafficSources": { "organic": <0-100 pct>, "paid": <0-100 pct>, "social": <0-100 pct>, "direct": <0-100 pct> },
  "analysisNote": <one sentence insight about their strength or weakness vs ${hostDomain}>
}`;

    try {
        const res = await throttledGeminiCall(() =>
            fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.GEMINI_FLASH}:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
                    }),
                    signal: AbortSignal.timeout(20000),
                }
            )
        );

        if (!res.ok) return {};
        const data = await res.json();
        const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return {};
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return {
            estimatedMonthlyVisits: typeof parsed.estimatedMonthlyVisits === 'number' ? parsed.estimatedMonthlyVisits : undefined,
            domainAuthorityTier: ['new', 'growing', 'established', 'authority'].includes(parsed.domainAuthorityTier as string)
                ? parsed.domainAuthorityTier as CompetitorProfile['domainAuthorityTier']
                : undefined,
            topContentPillars: Array.isArray(parsed.topContentPillars) ? parsed.topContentPillars.map(String) : [],
            growthTrend: ['declining', 'stable', 'growing', 'surging'].includes(parsed.growthTrend as string)
                ? parsed.growthTrend as CompetitorProfile['growthTrend']
                : undefined,
            trafficSources: parsed.trafficSources && typeof parsed.trafficSources === 'object'
                ? parsed.trafficSources as CompetitorProfile['trafficSources']
                : undefined,
            analysisNote: typeof parsed.analysisNote === 'string' ? parsed.analysisNote : undefined,
        };

    } catch (e: unknown) {
        logger.warn("[Competitor Engine] Gemini analysis failed:", { error: (e as Error)?.message || String(e) });
        return {
            estimatedMonthlyVisits: 0,
            domainAuthorityTier: "growing",
            topContentPillars: [],
            growthTrend: "stable",
            trafficSources: { organic: 0, paid: 0, social: 0, direct: 0 },
            analysisNote: `Fallback analysis: Comparing ${hostDomain} against ${competitorDomain} (AI parsing failed).`
        };
    }
}

// ─── Intent detection ─────────────────────────────────────────────────────────
function detectIntent(keyword: string): CompetitorKeywordGap["intent"] {
    const kw = keyword.toLowerCase();
    if (/\b(buy|price|cost|pricing|cheap|deal|order|subscribe|get|download|coupon|discount)\b/.test(kw)) return "transactional";
    if (/\b(best|top|review|vs|compare|alternative|versus|recommend)\b/.test(kw)) return "commercial";
    if (/^(how|what|why|when|where|who|is|are|can|does|do|should)\b/.test(kw)) return "informational";
    if (/\b(login|sign in|sign up|dashboard|download|app|portal|account)\b/.test(kw)) return "navigational";
    return "informational";
}

// ─── Main function ────────────────────────────────────────────────────────────
export interface CompetitorIntelligenceResult {
    gaps: CompetitorKeywordGap[];
    profile: CompetitorProfile;
}

export async function fetchCompetitorKeywordGaps(
    hostDomain: string,
    competitorDomain: string,
    siteId?: string
): Promise<CompetitorKeywordGap[]> {
    const result = await fetchCompetitorIntelligence(hostDomain, competitorDomain, siteId);
    return result.gaps;
}

export async function fetchCompetitorIntelligence(
    hostDomain: string,
    competitorDomain: string,
    siteId?: string
): Promise<CompetitorIntelligenceResult> {
    logger.debug(`[Competitor Engine] Analysing ${competitorDomain} vs ${hostDomain}...`);

    let gaps: CompetitorKeywordGap[] = [];

    if (!process.env.SERPER_API_KEY) {
        logger.warn("[Competitor Engine] No SERPER_API_KEY configured.");
        return {
            gaps: [],
            profile: {
                domain: competitorDomain,
                estimatedMonthlyVisits: 0,
                trafficTier: "low",
                domainAuthorityTier: "new",
                topContentPillars: [],
                growthTrend: "stable",
                trafficSources: { organic: 0, paid: 0, social: 0, direct: 0 },
                topKeywordGapCount: 0,
                analysisNote: "Competitor tracking requires SERPER_API_KEY. Get a free key at serper.dev."
            }
        };
    }

    // Hoist siteRecord so it's accessible both inside the try and in the
    // DataForSEO enrichment step that runs after the try/catch block.
    let siteRecord: { localContext?: string | null; targetKeyword?: string | null } | null = null;

    try {
        let glCode = "us";

        if (siteId) {
            try {
                siteRecord = await prisma.site.findUnique({
                    where: { id: siteId },
                    select: { localContext: true, targetKeyword: true },
                });
                // localContext often contains region/country info e.g. "Kampala, Uganda"
                if (siteRecord?.localContext) {

                    glCode = parseCountryCode(siteRecord.localContext);
                }

            } catch (e: unknown) {
                logger.warn("[Competitor Engine] Could not fetch site record:", { error: (e as Error)?.message || String(e) });
            }
        }

        let queries: string[] = [];
        let usingRealKeywords = false; // true when queries come from RankSnapshot / targetKeyword

        if (siteId) {
            try {
                // Fetch recent snapshots, deduplicate to top 8 unique keywords
                const snapshots = await prisma.rankSnapshot.findMany({
                    where: { siteId },
                    orderBy: { recordedAt: "desc" },
                    take: 200,
                    select: { keyword: true, position: true },
                });

                const seen = new Set<string>();
                const uniqueKeywords: string[] = [];
                for (const snap of snapshots) {
                    if (!seen.has(snap.keyword)) {
                        seen.add(snap.keyword);
                        uniqueKeywords.push(snap.keyword);
                    }
                    if (uniqueKeywords.length >= 8) break;
                }

                if (uniqueKeywords.length > 0) {

                    queries = uniqueKeywords;
                    usingRealKeywords = true;
                }

            } catch (e: unknown) {
                logger.warn("[Competitor Engine] Could not fetch RankSnapshots:", { error: (e as Error)?.message || String(e) });
            }
        }

        // Fallback 1: site's targetKeyword
        if (queries.length === 0 && siteRecord?.targetKeyword) {
            queries = [siteRecord.targetKeyword];
            usingRealKeywords = true;
        }

        // Fallback 2: domain-name extraction (original legacy approach)
        if (queries.length === 0) {
            const domainBase = competitorDomain.replace(/\.[^.]+$/, "");
            queries = [
                `site:${competitorDomain}`,
                `"${domainBase}" guide tutorial how-to`,
                `"${domainBase}" review best vs`,
            ];
        }

        const rawResults: CompetitorKeywordGap[] = [];
        const BATCH_SIZE = 4;
        const queryBatches: string[][] = [];
        for (let i = 0; i < queries.length; i += BATCH_SIZE)
            queryBatches.push(queries.slice(i, i + BATCH_SIZE));

        for (const batch of queryBatches) {
            await Promise.allSettled(batch.map(async (query) => {
                const response = await fetch("https://google.serper.dev/search", {
                    method: "POST",
                    headers: {
                        "X-API-KEY": process.env.SERPER_API_KEY!,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ q: query, gl: glCode, hl: "en", num: 10 }),
                });

                if (!response.ok) return;
                const data = await response.json();

                if (usingRealKeywords) {
                    // Real-keyword mode: scan full result set to find competitor's actual position
                    const organicResults: Array<{ link?: string; title?: string }> = data.organic ?? [];
                    const keyword = query.trim().toLowerCase().slice(0, 60);
                    const competitorIdx = organicResults.findIndex((r: { link?: string }) => r.link?.includes(competitorDomain));

                    // FIX #28: detect SERP features from Serper response
                    const serpFeatures: Partial<SerpFeatures> = {
                        hasAnswerBox: !!data.answerBox,
                        hasLocalPack: Array.isArray(data.localResults) && data.localResults.length > 0,
                        hasShopping: Array.isArray(data.shopping) && data.shopping.length > 0,
                    };

                    if (competitorIdx >= 0) {
                        const pos = competitorIdx + 1;
                        const vol = Math.max(100, 4000 - competitorIdx * 350);
                        const rawUrl = organicResults[competitorIdx].link ?? `https://${competitorDomain}`;
                        const urlCheck = isSafeUrl(rawUrl);
                        rawResults.push({
                            keyword,
                            searchVolume: vol,
                            difficulty: 25 + competitorIdx * 5,
                            position: pos,
                            url: urlCheck.ok ? rawUrl : `https://${competitorDomain}`,
                            estimatedMonthlyVisits: estimateMonthlyVisits(pos, vol, serpFeatures),
                            intent: detectIntent(keyword),
                            serpFeatures,
                        });
                    }
                    // If competitor not in top 10, skip — not a useful gap signal
                } else {
                    // Legacy mode: only include pages belonging to the competitor domain
                    for (const [i, item] of (data.organic ?? []).entries()) {
                        if (!item.link?.includes(competitorDomain)) continue;
                        const pos = i + 1;
                        const keyword = item.title?.replace(/[|–—-].*$/, "").trim().toLowerCase().slice(0, 60) ?? query;
                        const vol = Math.max(100, 4000 - i * 350);
                        rawResults.push({
                            keyword,
                            searchVolume: vol,
                            difficulty: 25 + i * 5,
                            position: pos,
                            url: item.link,
                            estimatedMonthlyVisits: estimateMonthlyVisits(pos, vol),
                            intent: detectIntent(keyword),
                        });
                    }
                }

                // Related searches = additional keyword gap opportunities
                for (const related of (data.relatedSearches ?? []).slice(0, 3)) {
                    const vol = 600;
                    rawResults.push({
                        keyword: related.query,
                        searchVolume: vol,
                        difficulty: 40,
                        position: 10,
                        url: `https://${competitorDomain}`,
                        estimatedMonthlyVisits: estimateMonthlyVisits(10, vol),
                        intent: detectIntent(related.query),
                    });
                }
            }));
        }

        // Deduplicate
        const seenKws = new Set<string>();
        gaps = rawResults.filter(r => {

            if (seenKws.has(r.keyword)) return false;
            seenKws.add(r.keyword);
            return true;
        }).slice(0, 20);


    } catch (e: unknown) {
        logger.error("[Competitor Engine] Serper failed:", { error: (e as Error)?.message || String(e) });
    }

    // Sort by estimated monthly visits descending
    gaps.sort((a, b) => b.estimatedMonthlyVisits - a.estimatedMonthlyVisits);

    // Replace the fake `4000 - i * 350` estimates with real search volumes.
    if (gaps.length > 0 && process.env.DATAFORSEO_LOGIN) {
        try {
            const locationCode = resolveLocationCode(
                siteRecord?.localContext ?? null
            );
            const metrics = await getKeywordMetricsBatch(
                gaps.map(g => g.keyword),
                locationCode
            );
            for (const gap of gaps) {
                const real = metrics.get(gap.keyword);
                if (real && real.searchVolume > 0) {
                    gap.searchVolume = real.searchVolume;
                    gap.difficulty = real.difficulty;
                    gap.estimatedMonthlyVisits = estimateMonthlyVisits(
                        gap.position,
                        real.searchVolume,
                        gap.serpFeatures
                    );
                }
            }
            logger.debug(`[Competitor Engine] DataForSEO enriched ${metrics.size}/${gaps.length} gap keywords`);
        } catch (err: unknown) {
            logger.warn("[Competitor Engine] DataForSEO volume enrichment failed:", {
                error: (err as Error)?.message,
            });
        }
    }

    // Re-sort after real volume enrichment
    gaps.sort((a, b) => b.estimatedMonthlyVisits - a.estimatedMonthlyVisits);

    // Estimate total competitor traffic from keyword gaps
    const totalEstimatedVisits = gaps.reduce((s, g) => s + g.estimatedMonthlyVisits, 0);

    // FIX #29: Topic cluster detection (async — non-blocking if it fails)
    const topicClusters = await clusterKeywordGaps(gaps, hostDomain).catch(() => [] as TopicCluster[]);

    let realDomainTraffic: number | null = null;
    try {
        const domainData = await getDomainMetrics(competitorDomain);
        if (domainData) {
            realDomainTraffic = domainData.organicTraffic;
            logger.debug(`[Competitor Engine] Real traffic for ${competitorDomain}: ${realDomainTraffic} (${domainData.dataSource})`);
        }
    } catch (err: unknown) {
        logger.warn("[Competitor Engine] getDomainMetrics failed:", { error: (err as Error)?.message });
    }

    // Gemini AI domain analysis (still used for content pillars, growth trend, analysis note)
    const aiAnalysis = await analyzeCompetitorWithGemini(competitorDomain, hostDomain, gaps);

    // Priority: real data > Gemini estimate > Serper-derived sum
    const estimatedMonthlyVisits =
        realDomainTraffic ??
        (aiAnalysis.estimatedMonthlyVisits ?? totalEstimatedVisits * 3);

    const profile: CompetitorProfile = {
        domain: competitorDomain,
        estimatedMonthlyVisits,
        trafficTier: classifyTraffic(estimatedMonthlyVisits),
        domainAuthorityTier: aiAnalysis.domainAuthorityTier ?? 'growing',
        topContentPillars: aiAnalysis.topContentPillars ?? [],
        growthTrend: aiAnalysis.growthTrend ?? 'stable',
        trafficSources: aiAnalysis.trafficSources ?? { organic: 70, paid: 10, social: 10, direct: 10 },
        topKeywordGapCount: gaps.length,
        analysisNote: aiAnalysis.analysisNote ?? `${competitorDomain} ranks for ${gaps.length} keywords you could target.`,
        topicClusters,
    };

    return { gaps, profile };
}

export { TRAFFIC_TIER_LABELS, classifyTraffic };

// ─── Page-Level Competitor Analysis ──────────────────────────────────────────
export interface CompetitorPageAnalysis {
    url: string;
    keyword: string;
    wordCount: number;
    titleTag: string;
    h1: string;
    headings: string[];
    hasSchema: boolean;
    hasFAQ: boolean;
    internalLinkCount: number;
    /** Times the competitor page links back to yourDomain — outbound link signal */
    backlinksToYou: number;
    imageCount: number;
    metaDescription: string;
    contentGaps: string[];
    onPageScore: number;
    beatThemWith: string[];
    fetchSource?: string;
}

export async function analyseCompetitorPage(
    url: string,
    keyword: string,
    yourDomain: string,
): Promise<CompetitorPageAnalysis | null> {
    try {
        const fetchResult = await fetchCompetitorPageHtml(url);

        if (!fetchResult) {
            logger.warn(`[Competitor] All fetch layers failed for ${url}`);
            return null;
        }

        const { html, source: fetchSource } = fetchResult;
        logger.debug(`[Competitor] Fetched ${url} via ${fetchSource} (${html.length} chars)`);

        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const metaDescMatch =
            html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        const h2Matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
            .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
            .filter(Boolean);
        const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const wordCount = plainText.split(" ").filter(Boolean).length;
        const hasSchema = html.includes("application/ld+json");
        const hasFAQ =
            /faqpage|"@type":\s*"Question"/i.test(html) || /\bfaq\b/i.test(h2Matches.join(" "));

        // Fix: extract the competitor's own hostname to count their self-referencing
        // internal links — the genuine on-page SEO density signal.
        // The original code matched yourDomain (i.e. "how often do they link to us?")
        // which is nearly always 0 and reveals nothing about their page structure.
        let competitorHostname: string;
        try {
            competitorHostname = new URL(url).hostname.replace(/^www\./, "");
        } catch {
            // Malformed URL — graceful fallback; the regex simply won't match
            competitorHostname = url;
        }

        // Their own internal link density (real on-page SEO signal)
        const internalLinkCount = (
            html.match(new RegExp(`href=["'][^"']*${competitorHostname}[^"']*["']`, "gi")) ?? []
        ).length;

        // Separate signal: backlinks they give us (outbound link intelligence)
        const backlinksToYou = (
            html.match(new RegExp(`href=["'][^"']*${yourDomain}[^"']*["']`, "gi")) ?? []
        ).length;

        const imageCount = (html.match(/<img /gi) ?? []).length;

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return {
                url,
                keyword,
                wordCount,
                titleTag: titleMatch?.[1]?.trim() ?? "",
                h1: h1Match?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "",
                headings: h2Matches.slice(0, 8),
                hasSchema,
                hasFAQ,
                internalLinkCount,
                backlinksToYou,
                imageCount,
                metaDescription: metaDescMatch?.[1]?.trim() ?? "",
                contentGaps: [],
                onPageScore: 50,
                beatThemWith: [
                    `Write a more comprehensive guide targeting "${keyword}" (their page is ~${wordCount} words — aim for ${Math.round(wordCount * 1.3)}+)`,
                    hasFAQ ? "Match their FAQ schema" : "Add FAQ schema — they don't have it",
                    hasSchema ? "Match their structured data types" : "Add Article + FAQ JSON-LD schema markup",
                ],
                fetchSource,
            };
        }

        const textSample = plainText.slice(0, 4000);
        const prompt = `You are a senior SEO analyst. A competitor page ranks for the keyword "${keyword}".

Page URL: ${url}
Title: ${titleMatch?.[1]?.trim() ?? "unknown"}
H1: ${h1Match?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "unknown"}
H2 headings: ${h2Matches.slice(0, 8).join(" | ")}
Word count: ~${wordCount}
Has FAQ schema: ${hasFAQ}
Has structured data (JSON-LD): ${hasSchema}
Image count: ${imageCount}
Internal links (self-referencing): ${internalLinkCount}
Links pointing to ${yourDomain}: ${backlinksToYou}

Content sample:
"""
${textSample}
"""

For the site "${yourDomain}" trying to outrank this page, respond ONLY with valid JSON (no markdown):
{
  "contentGaps": ["topic the competitor covers that ${yourDomain} is likely missing", ...],
  "onPageScore": <integer 0-100 representing the strength of THIS page's on-page SEO>,
  "beatThemWith": [
    "Specific actionable tactic #1 to outrank this exact URL",
    ...
  ]
}
Rules:
- contentGaps: 3-5 items, specific topics or subtopics the competitor covers
- onPageScore: be honest — a long, well-structured page with schema and good headings scores 70-90
- beatThemWith: 4-6 specific, actionable tactics tailored to THIS page`;

        const geminiRes = await throttledGeminiCall(() =>
            fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.GEMINI_FLASH}:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { maxOutputTokens: 900, temperature: 0.2 },
                    }),
                    signal: AbortSignal.timeout(25_000),
                },
            ),
        );

        let contentGaps: string[] = [];
        let onPageScore = 50;
        let beatThemWith: string[] = [];

        if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const raw = (geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```\s*$/i, "")
                .trim();
            try {
                const parsed = JSON.parse(raw);
                contentGaps = parsed.contentGaps ?? [];
                onPageScore = parsed.onPageScore ?? 50;
                beatThemWith = parsed.beatThemWith ?? [];
            } catch {
                logger.warn("[Competitor] Failed to parse Gemini page analysis JSON", { url });
            }
        }

        return {
            url,
            keyword,
            wordCount,
            titleTag: titleMatch?.[1]?.trim() ?? "",
            h1: h1Match?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "",
            headings: h2Matches.slice(0, 8),
            hasSchema,
            hasFAQ,
            internalLinkCount,
            backlinksToYou,
            imageCount,
            metaDescription: metaDescMatch?.[1]?.trim() ?? "",
            contentGaps,
            onPageScore,
            beatThemWith,
            fetchSource,
        };
    } catch (e) {
        logger.warn("[Competitor] Page analysis failed:", { url, error: String(e) });
        return null;
    }
}