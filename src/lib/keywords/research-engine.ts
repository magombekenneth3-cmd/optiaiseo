/**
 * Canonical Keyword Research Engine
 *
 * This is the single orchestrator for the evidence-based keyword research pipeline:
 *
 *   Candidate keywords (+ Gemini qualitative hints: intent, content type, topic)
 *       ↓
 *   Data enrichment (parallel)
 *   ┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
 *   ↓              ↓              ↓              ↓              ↓              ↓
 * DataForSEO     DataForSEO     GSC            Competitor     Reddit        News
 * (volume/CPC)   (organic KD)   performance    positions      signals       headlines
 *   └──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
 *       ↓
 *   Live SERP feasibility (top N by volume, deadline-bounded)
 *       ↓
 *   Evidence merge + provenance
 *       ↓
 *   Deterministic opportunity scoring
 *       ↓
 *   Persist evidence to DB (KeywordResearchRun + snapshots)
 *       ↓
 *   Return enriched keyword evidence
 *
 * Gemini ONLY does: intent classification, content type recommendation,
 * topical clustering, and final narrative interpretation.
 * Gemini does NOT generate: search volume, KD, SERP scores, trend labels.
 */

import { logger, formatError } from "@/lib/logger";
import {
    getKeywordMetricsBatch,
    getKeywordDifficultyBatch,
    getSerpData,
    DATAFORSEO_LOCATION_CODES,
    type KeywordMetrics,
    type SerpOrganicResult,
} from "./dataforseo";
import { feasibilityFromSerpData, type SerpFeasibilityResult } from "./serp-feasibility";
import {
    createBlankEvidence,
    mergeMetricsIntoEvidence,
    buildTrendEvidence,
    buildGscEvidence,
    trendFromVolumeHistory,
    classifyCompetitorGap,
    computeOpportunityFromEvidence,
    significantWords,
    type KeywordEvidence,
    type CompetitorPosition,
    type OpportunityComponents,
} from "./keyword-evidence";
import type { CommunityKeyword } from "./community";
import type { TrendSignals } from "@/lib/trending/fetch-trending";

// ── Types ───────────────────────────────────────────────────────────────────────

/** A candidate keyword plus optional qualitative hints (e.g. from Gemini). */
export interface CandidateKeyword {
    keyword: string;
    intent?: KeywordEvidence["intent"];
    contentType?: string | null;
    parentTopic?: string | null;
}

export interface ResearchEngineOptions {
    /** DataForSEO location code. Defaults to US (2840). */
    locationCode?: number;
    /** Language code for DataForSEO + snapshots. Default: "en" */
    languageCode?: string;
    /** Max keywords to fetch SERP data for (costs API credits). Default: 10 */
    maxSerpKeywords?: number;
    /** Skip SERP fetching entirely (faster, no SERP feasibility scores) */
    skipSerp?: boolean;
    /** Skip DataForSEO Labs KD fetch (faster, no organic difficulty) */
    skipDifficultyFetch?: boolean;
    /** Skip Reddit mining */
    skipCommunity?: boolean;
    /**
     * Pre-fetched news trend signals. Pass this when the caller already fetched
     * them, to avoid a duplicate Serper call. `undefined` = engine fetches;
     * `null` = caller tried and none were available.
     */
    trendSignals?: TrendSignals | null;
    /** Persist run + snapshots to the evidence DB. Default: true */
    persist?: boolean;
    /**
     * Soft wall-clock budget (ms) for the whole engine. Slow optional steps
     * (SERP) are cut off when the budget runs out. Default: 40 000.
     */
    budgetMs?: number;
}

export interface EnrichedKeywordResult {
    evidence: KeywordEvidence;
    opportunityScore: OpportunityComponents;
}

export type ResearchRunStatus = "COMPLETED" | "PARTIAL" | "FAILED";

export interface ResearchEngineResult {
    keywords: EnrichedKeywordResult[];
    /** ISO timestamp when this research was compiled */
    compiledAt: string;
    /** Location code used for this research */
    locationCode: number;
    /** Which data sources returned data */
    dataSources: string[];
    /** Sources that were attempted but failed or timed out */
    failedSources: string[];
    status: ResearchRunStatus;
    /** ID of the persisted KeywordResearchRun, null when not persisted */
    runId: string | null;
    /** News signals used for trend evidence (for headline citations in the UI) */
    trendSignals: TrendSignals | null;
}

interface SerpSnapshot {
    results: SerpOrganicResult[];
    featureTypes: string[];
    feasibility: SerpFeasibilityResult;
    observedAt: Date;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function normalizeKeyword(k: string): string {
    return k.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeCandidates(candidates: Array<string | CandidateKeyword>): CandidateKeyword[] {
    const byKeyword = new Map<string, CandidateKeyword>();
    for (const c of candidates) {
        const candidate = typeof c === "string" ? { keyword: c } : c;
        const kw = normalizeKeyword(candidate.keyword ?? "");
        if (!kw || kw.length < 2) continue;
        const existing = byKeyword.get(kw);
        // Merge hints: first non-empty value wins.
        byKeyword.set(kw, {
            keyword: kw,
            intent: existing?.intent ?? candidate.intent ?? null,
            contentType: existing?.contentType ?? candidate.contentType ?? null,
            parentTopic: existing?.parentTopic ?? candidate.parentTopic ?? null,
        });
    }
    return [...byKeyword.values()];
}

/** Resolves to `fallback` if `promise` doesn't settle within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<{ value: T; timedOut: boolean }> {
    if (ms <= 0) return { value: fallback, timedOut: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms);
    });
    try {
        return await Promise.race([promise.then((value) => ({ value, timedOut: false })), timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ── Loaders ─────────────────────────────────────────────────────────────────────

type GscRow = { position: number | null; clicks: number; impressions: number; ctr: number; url: string | null };

async function loadGscEvidence(
    siteId: string,
    keywords: string[]
): Promise<{ rows: Map<string, GscRow>; dateRange: { from: string; to: string } }> {
    const rows = new Map<string, GscRow>();
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const dateRange = { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] };

    const { prisma } = await import("@/lib/prisma");
    // Last 30 days of GSC data aggregated per query
    const grouped = await prisma.gscDailyPerformance.groupBy({
        by: ["keyword"],
        where: {
            siteId,
            keyword: { in: keywords },
            date: { gte: dateRange.from },
        },
        _sum: { clicks: true, impressions: true },
        _avg: { position: true, ctr: true },
    });

    for (const row of grouped) {
        const kw = normalizeKeyword(row.keyword);
        rows.set(kw, {
            position: row._avg.position ? Math.round(row._avg.position) : null,
            clicks: row._sum.clicks ?? 0,
            impressions: row._sum.impressions ?? 0,
            ctr: row._avg.ctr ?? 0,
            url: null, // URL is per-date; not aggregating here
        });
    }
    return { rows, dateRange };
}

async function loadCompetitorPositions(
    siteId: string,
    keywords: string[]
): Promise<Map<string, CompetitorPosition[]>> {
    const result = new Map<string, CompetitorPosition[]>();
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.competitorKeyword.findMany({
        where: {
            competitor: { siteId },
            keyword: { in: keywords },
            position: { not: null },
        },
        select: {
            keyword: true,
            position: true,
            url: true,
            competitor: { select: { domain: true } },
        },
        orderBy: { position: "asc" },
    });

    for (const row of rows) {
        const kw = normalizeKeyword(row.keyword);
        const existing = result.get(kw) ?? [];
        existing.push({
            domain: row.competitor.domain,
            position: row.position!,
            url: row.url ?? "",
        });
        result.set(kw, existing);
    }
    return result;
}

/**
 * Matches mined Reddit threads to target keywords. A thread matches when it
 * shares at least two significant words with the keyword (or the only
 * significant word, for one-word keywords).
 */
async function loadCommunitySignals(
    niche: string,
    domain: string,
    keywords: string[]
): Promise<Map<string, CommunityKeyword[]>> {
    const result = new Map<string, CommunityKeyword[]>();
    const { mineRedditKeywords } = await import("./community");
    const communityKws = await mineRedditKeywords(niche, domain);
    if (communityKws.length === 0) return result;

    const threadWords = communityKws.map((ck) => new Set(significantWords(`${ck.keyword} ${ck.questionPattern}`)));

    for (const target of keywords) {
        const targetWords = significantWords(target);
        const required = Math.min(2, targetWords.length);
        if (required === 0) continue;
        const matches = communityKws.filter((_, i) =>
            targetWords.filter((w) => threadWords[i].has(w)).length >= required
        );
        if (matches.length > 0) {
            result.set(target, matches.slice(0, 5));
        }
    }
    return result;
}

// ── Persistence ─────────────────────────────────────────────────────────────────

async function createRun(siteId: string, locationCode: number, languageCode: string): Promise<string | null> {
    try {
        const { prisma } = await import("@/lib/prisma");
        const run = await prisma.keywordResearchRun.create({
            data: { siteId, locationCode, languageCode, status: "RUNNING" },
            select: { id: true },
        });
        return run.id;
    } catch (err: unknown) {
        logger.warn("[research-engine] Could not create research run — continuing without persistence", {
            error: formatError(err),
        });
        return null;
    }
}

async function persistRun(opts: {
    runId: string;
    status: ResearchRunStatus;
    dataSources: string[];
    locationCode: number;
    languageCode: string;
    metrics: Map<string, KeywordMetrics>;
    difficulty: Map<string, number>;
    metricsObservedAt: Date;
    serps: Map<string, SerpSnapshot>;
    community: Map<string, CommunityKeyword[]>;
}): Promise<void> {
    const { runId, status, dataSources, locationCode, languageCode } = opts;
    try {
        const { prisma } = await import("@/lib/prisma");

        const metricRows = [...new Set([...opts.metrics.keys(), ...opts.difficulty.keys()])].map((kw) => {
            const m = opts.metrics.get(kw);
            return {
                runId,
                keyword: kw,
                searchVolume: m ? m.searchVolume : null,
                keywordDifficulty: opts.difficulty.get(kw) ?? null,
                competitionIndex: m ? m.competitionIndex : null,
                cpc: m ? m.cpc : null,
                trendData: m && m.trend.length > 0 ? m.trend : undefined,
                source: m && opts.difficulty.has(kw)
                    ? "DataForSEO Google Ads + Labs"
                    : m ? "DataForSEO Google Ads" : "DataForSEO Labs",
                locationCode,
                languageCode,
                observedAt: opts.metricsObservedAt,
            };
        });

        const serpRows = [...opts.serps.entries()].map(([kw, s]) => ({
            runId,
            keyword: kw,
            locationCode,
            languageCode,
            device: "desktop",
            results: s.results as unknown as object[],
            featureTypes: s.featureTypes,
            feasibility: s.feasibility.score,
            signals: s.feasibility.signals as unknown as object[],
            observedAt: s.observedAt,
        }));

        const communityRows = [...opts.community.entries()].flatMap(([kw, signals]) =>
            signals.map((s) => ({
                runId,
                keyword: kw,
                source: s.source,
                sourceUrl: s.postUrl ?? null,
                community: s.subreddit ?? null,
                title: s.questionPattern ?? null,
                upvotes: s.upvotes ?? null,
                publishedAt: s.postCreatedAt ?? null,
                retrievedAt: s.retrievedAt,
            }))
        );

        await prisma.$transaction([
            prisma.keywordMetricSnapshot.createMany({ data: metricRows }),
            prisma.keywordSerpSnapshot.createMany({ data: serpRows }),
            prisma.keywordCommunityEvidence.createMany({ data: communityRows }),
            prisma.keywordResearchRun.update({
                where: { id: runId },
                data: { status, dataSources, completedAt: new Date() },
            }),
        ]);
    } catch (err: unknown) {
        logger.error("[research-engine] Failed to persist research evidence", { runId, error: formatError(err) });
        try {
            const { prisma } = await import("@/lib/prisma");
            await prisma.keywordResearchRun.update({
                where: { id: runId },
                data: { status: "FAILED", dataSources, completedAt: new Date() },
            });
        } catch {
            /* best effort */
        }
    }
}

// ── Main research function ──────────────────────────────────────────────────────

/**
 * The canonical keyword research pipeline.
 *
 * Takes a list of candidate keywords and enriches each one with
 * real data from DataForSEO, GSC, SERP, Reddit, and trending signals.
 *
 * Returns a complete evidence object for each keyword with a
 * deterministically computed opportunity score. Missing data stays null —
 * it is never estimated.
 */
export async function researchKeywords(
    siteId: string,
    candidates: Array<string | CandidateKeyword>,
    options: ResearchEngineOptions = {}
): Promise<ResearchEngineResult> {
    const {
        locationCode = DATAFORSEO_LOCATION_CODES.us,
        languageCode = "en",
        maxSerpKeywords = 10,
        skipSerp = false,
        skipDifficultyFetch = false,
        skipCommunity = false,
        persist = true,
        budgetMs = 40_000,
    } = options;

    const startedAt = Date.now();
    const remaining = () => budgetMs - (Date.now() - startedAt);

    const normalizedCandidates = normalizeCandidates(candidates);
    const normalized = normalizedCandidates.map((c) => c.keyword);
    const compiledAt = new Date().toISOString();
    const dataSources: string[] = [];
    const failedSources: string[] = [];
    const hasDataForSeo = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

    logger.info("[research-engine] Starting keyword research", {
        siteId,
        keywordCount: normalized.length,
        locationCode,
    });

    const runIdPromise = persist && normalized.length > 0
        ? createRun(siteId, locationCode, languageCode)
        : Promise.resolve(null);

    // Initialize evidence objects with Gemini's qualitative hints only.
    const evidenceMap = new Map<string, KeywordEvidence>(
        normalizedCandidates.map((c) => [c.keyword, {
            ...createBlankEvidence(c.keyword),
            intent: c.intent ?? null,
            contentType: c.contentType ?? null,
            parentTopic: c.parentTopic ?? null,
        }])
    );

    // Site context (fetched once, shared by community + trend loaders)
    const { prisma } = await import("@/lib/prisma");
    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { niche: true, coreServices: true, domain: true, location: true },
    });
    const niche = site?.niche ?? site?.coreServices ?? site?.domain ?? "";

    // ── Phase 1: independent sources in parallel ───────────────────────────────
    // Each loader is bounded so slow upstream APIs can't blow the server-action
    // budget. A timed-out source counts as failed — it is never estimated.

    const phase1Ms = Math.max(5_000, remaining() - 15_000);
    const bounded = <T,>(p: Promise<T>, label: string): Promise<T> =>
        withTimeout(p, phase1Ms, undefined as T | undefined).then(({ value, timedOut }) => {
            if (timedOut) throw new Error(`${label} exceeded ${phase1Ms}ms budget`);
            return value as T;
        });

    const metricsObservedAt = new Date();
    const [metricsRes, kdRes, gscRes, compRes, communityRes, trendRes] = await Promise.allSettled([
        hasDataForSeo ? bounded(getKeywordMetricsBatch(normalized, locationCode), "DataForSEO metrics") : Promise.resolve(new Map<string, KeywordMetrics>()),
        hasDataForSeo && !skipDifficultyFetch ? bounded(getKeywordDifficultyBatch(normalized, locationCode), "DataForSEO KD") : Promise.resolve(new Map<string, number>()),
        bounded(loadGscEvidence(siteId, normalized), "GSC"),
        bounded(loadCompetitorPositions(siteId, normalized), "Competitor positions"),
        skipCommunity || !niche ? Promise.resolve(new Map<string, CommunityKeyword[]>()) : bounded(loadCommunitySignals(niche, site?.domain ?? "", normalized), "Reddit"),
        options.trendSignals !== undefined
            ? Promise.resolve(options.trendSignals)
            : bounded(
                import("@/lib/trending/fetch-trending").then(({ fetchTrendSignals }) =>
                    fetchTrendSignals(niche || "technology", site?.location ?? "US")
                ),
                "Serper News",
            ),
    ]);

    // Step 1 + 2: DataForSEO metrics and organic KD
    const metrics = metricsRes.status === "fulfilled" ? metricsRes.value : new Map<string, KeywordMetrics>();
    const difficulty = kdRes.status === "fulfilled" ? kdRes.value : new Map<string, number>();
    if (hasDataForSeo) {
        if (metrics.size > 0) dataSources.push("DataForSEO Google Ads");
        else failedSources.push("DataForSEO Google Ads");
        if (!skipDifficultyFetch) {
            if (difficulty.size > 0) dataSources.push("DataForSEO Labs");
            else failedSources.push("DataForSEO Labs");
        }
    }
    if (metricsRes.status === "rejected") {
        logger.warn("[research-engine] DataForSEO metrics failed", { error: formatError(metricsRes.reason) });
    }
    if (kdRes.status === "rejected") {
        logger.warn("[research-engine] KD batch failed", { error: formatError(kdRes.reason) });
    }

    for (const kw of normalized) {
        const evidence = evidenceMap.get(kw)!;
        const metric = metrics.get(kw);
        const kd = difficulty.get(kw) ?? null;
        if (metric) {
            evidenceMap.set(kw, mergeMetricsIntoEvidence(evidence, metric, kd));
        } else if (kd !== null) {
            evidenceMap.set(kw, { ...evidence, keywordDifficulty: kd });
        }
    }

    // Step 4: GSC existing performance
    if (gscRes.status === "fulfilled") {
        const { rows, dateRange } = gscRes.value;
        if (rows.size > 0) dataSources.push("Google Search Console");
        for (const [kw, row] of rows) {
            const evidence = evidenceMap.get(kw);
            if (!evidence) continue;
            const gsc = buildGscEvidence(row);
            evidenceMap.set(kw, { ...evidence, gsc: gsc ? { ...gsc, dateRange } : null });
        }
    } else {
        failedSources.push("Google Search Console");
        logger.warn("[research-engine] GSC evidence failed", { error: formatError(gscRes.reason) });
    }

    // Step 5: Competitor positions
    if (compRes.status === "fulfilled") {
        if (compRes.value.size > 0) dataSources.push("Tracked competitor rankings");
        for (const [kw, competitorPositions] of compRes.value) {
            const evidence = evidenceMap.get(kw);
            if (!evidence) continue;
            const gapType = classifyCompetitorGap(evidence.gsc?.currentPosition ?? null, competitorPositions);
            evidenceMap.set(kw, { ...evidence, competitorPositions, gapType });
        }
    } else {
        logger.warn("[research-engine] Competitor positions failed", { error: formatError(compRes.reason) });
    }

    // Step 6: Reddit community signals
    const community = communityRes.status === "fulfilled" ? communityRes.value : new Map<string, CommunityKeyword[]>();
    if (communityRes.status === "rejected") {
        failedSources.push("Reddit");
        logger.warn("[research-engine] Community signals failed", { error: formatError(communityRes.reason) });
    }
    if (community.size > 0) dataSources.push("Reddit");
    for (const [kw, communitySignals] of community) {
        const evidence = evidenceMap.get(kw);
        if (!evidence) continue;
        evidenceMap.set(kw, { ...evidence, communitySignals });
    }

    // Step 7: Trend evidence — volume history first, news headlines as fallback
    const trendSignals = trendRes.status === "fulfilled" ? trendRes.value : null;
    if (trendRes.status === "rejected") {
        failedSources.push("Serper News");
        logger.warn("[research-engine] Trend signals failed", { error: formatError(trendRes.reason) });
    }
    const headlineTitles = (trendSignals?.headlines ?? []).map((h) => h.title);
    let usedVolumeTrend = false;
    let usedNewsTrend = false;
    for (const kw of normalized) {
        const evidence = evidenceMap.get(kw)!;
        const fromVolume = trendFromVolumeHistory(evidence.volumeTrend, metricsObservedAt);
        if (fromVolume) {
            usedVolumeTrend = true;
            evidenceMap.set(kw, { ...evidence, trend: fromVolume });
            continue;
        }
        if (trendSignals && headlineTitles.length > 0) {
            const fromNews = buildTrendEvidence(kw, headlineTitles, trendSignals.source, trendSignals.observedAt);
            // Only attach when there is an actual signal
            if (fromNews.direction !== "Unknown") {
                usedNewsTrend = true;
                evidenceMap.set(kw, { ...evidence, trend: fromNews });
            }
        }
    }
    if (usedNewsTrend || (trendSignals && headlineTitles.length > 0)) dataSources.push("Serper News");
    if (usedVolumeTrend && !dataSources.includes("DataForSEO Google Ads")) dataSources.push("DataForSEO Google Ads");

    // ── Phase 2: SERP feasibility (top N by volume, deadline-bounded) ──────────

    const serps = new Map<string, SerpSnapshot>();
    if (!skipSerp && hasDataForSeo && maxSerpKeywords > 0) {
        const volumeOf = (kw: string) => evidenceMap.get(kw)?.searchVolume ?? 0;
        const withVolume = normalized
            .filter((kw) => volumeOf(kw) > 0)
            .sort((a, b) => volumeOf(b) - volumeOf(a))
            .slice(0, maxSerpKeywords);
        const withoutVolume = normalized
            .filter((kw) => volumeOf(kw) <= 0)
            .slice(0, Math.max(0, maxSerpKeywords - withVolume.length));
        const serpBatch = [...withVolume, ...withoutVolume];

        const serpWork = Promise.allSettled(
            serpBatch.map(async (kw) => {
                const serpResult = await getSerpData(kw, locationCode);
                // Empty organic results = no evidence. Don't record a neutral score.
                if (serpResult.features.organicResults.length === 0) return;
                const feasibility = feasibilityFromSerpData(serpResult.features);
                serps.set(kw, {
                    results: serpResult.features.organicResults,
                    featureTypes: serpResult.features.featureTypes,
                    feasibility,
                    observedAt: new Date(),
                });
            })
        );

        // Leave ~3s for scoring + persistence.
        const { timedOut } = await withTimeout(serpWork, remaining() - 3_000, []);
        if (timedOut) {
            logger.warn("[research-engine] SERP batch hit time budget — using partial SERP data", {
                fetched: serps.size,
                requested: serpBatch.length,
            });
        }

        if (serps.size > 0) dataSources.push("Live Google SERP");
        if (serps.size < serpBatch.length) failedSources.push("Live Google SERP");

        for (const [kw, snap] of serps) {
            const evidence = evidenceMap.get(kw);
            if (evidence) evidenceMap.set(kw, { ...evidence, serpFeasibility: snap.feasibility });
        }
    }

    // ── Phase 3: Compute opportunity scores ────────────────────────────────────

    const keywords: EnrichedKeywordResult[] = normalized.map((kw) => {
        const evidence = evidenceMap.get(kw)!;
        const opportunityScore = computeOpportunityFromEvidence(evidence);
        return { evidence, opportunityScore };
    });
    keywords.sort((a, b) => b.opportunityScore.finalScore - a.opportunityScore.finalScore);

    const status: ResearchRunStatus =
        dataSources.length === 0 ? "FAILED" :
        failedSources.length > 0 ? "PARTIAL" :
        "COMPLETED";

    // ── Phase 4: Persist evidence ──────────────────────────────────────────────

    const runId = await runIdPromise;
    if (runId) {
        // Snapshot copies so late-arriving SERP results don't mutate what we persist.
        await persistRun({
            runId,
            status,
            dataSources,
            locationCode,
            languageCode,
            metrics,
            difficulty,
            metricsObservedAt,
            serps: new Map(serps),
            community,
        });
    }

    logger.info("[research-engine] Research complete", {
        siteId,
        runId,
        status,
        keywordCount: keywords.length,
        dataSources,
        failedSources,
        elapsedMs: Date.now() - startedAt,
    });

    return {
        keywords,
        compiledAt,
        locationCode,
        dataSources,
        failedSources,
        status,
        runId,
        trendSignals,
    };
}

/**
 * Lightweight version: only fetches volume + KD, no SERP, no community.
 * Use for bulk keyword enrichment where SERP costs matter.
 */
export async function enrichKeywordsLite(
    siteId: string,
    candidates: Array<string | CandidateKeyword>,
    locationCode = DATAFORSEO_LOCATION_CODES.us,
): Promise<ResearchEngineResult> {
    return researchKeywords(siteId, candidates, {
        locationCode,
        skipSerp: true,
        skipDifficultyFetch: false,
        skipCommunity: true,
        maxSerpKeywords: 0,
    });
}
