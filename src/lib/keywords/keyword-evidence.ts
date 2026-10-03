/**
 * Keyword Evidence Layer
 *
 * Merges evidence from multiple real data sources into a single
 * structured evidence object per keyword. Every data point carries
 * provenance (source name + observed timestamp) so the UI can
 * display "Volume: 1,300 · DataForSEO" rather than an unsourced number.
 */

import type { KeywordMetrics } from "./dataforseo";
import type { SerpFeasibilityResult } from "./serp-feasibility";
import type { CommunityKeyword } from "./community";

// ── Trend evidence ─────────────────────────────────────────────────────────────

export type TrendDirection = "Rising" | "Steady" | "Declining" | "Unknown";

export interface TrendEvidence {
    direction: TrendDirection;
    /** Where the signal came from (e.g. "Serper News", "Google Trends") */
    source: string;
    /** When the signal was observed */
    observedAt: Date;
    /** Supporting news headlines or keywords that triggered this signal */
    matchedSignals: string[];
    /** 0-1 confidence level based on number of matching signals */
    confidence: number;
}

// ── GSC evidence ───────────────────────────────────────────────────────────────

export interface GscEvidence {
    currentPosition: number | null;
    clicks: number;
    impressions: number;
    ctr: number;
    topUrl: string | null;
    /** The date range this GSC data covers */
    dateRange: { from: string; to: string } | null;
}

// ── Competitor position ────────────────────────────────────────────────────────

export interface CompetitorPosition {
    domain: string;
    position: number;
    url: string;
}

export type CompetitorGapType =
    | "MISSING"          // You don't rank at all, competitors do
    | "UNDERPERFORMING"  // You rank but much lower than competitors
    | "WEAKLY_DEFENDED"  // You rank, competitors rank nearby — defend it
    | "NEW_OPPORTUNITY"  // Nobody strong ranks — wide open
    | "DOMINATED";       // Major brands dominate — very hard to enter

// ── Full keyword evidence object ───────────────────────────────────────────────

export interface KeywordEvidence {
    keyword: string;

    // --- Quantitative metrics (all from real data sources, never AI-generated) ---

    /** Monthly search volume. Source: DataForSEO Google Ads. Null = not fetched. */
    searchVolume: number | null;
    /** Organic SEO difficulty 0-100. Source: DataForSEO Labs. Null = not fetched. */
    keywordDifficulty: number | null;
    /** Paid-search competition index 0-100. Source: Google Ads. Not organic difficulty. */
    competitionIndex: number | null;
    /** Cost per click in USD. Source: DataForSEO. */
    cpc: number | null;
    /** Monthly volume trend array (12 months). Source: DataForSEO. */
    volumeTrend: number[];

    // --- SERP evidence ---

    /** Deterministic SERP feasibility score 1-10. Source: live SERP data. */
    serpFeasibility: SerpFeasibilityResult | null;

    // --- GSC evidence ---

    gsc: GscEvidence | null;

    // --- Community evidence ---

    /** Real Reddit signals observed for this keyword */
    communitySignals: CommunityKeyword[];

    // --- Competitor evidence ---

    /** Your competitors' organic positions for this keyword */
    competitorPositions: CompetitorPosition[];
    /** Gap classification based on your vs. competitor positions */
    gapType: CompetitorGapType | null;

    // --- Trend evidence ---

    trend: TrendEvidence | null;

    // --- Metadata ---

    /** Intent classification from Gemini (qualitative, not a metric) */
    intent: "informational" | "commercial" | "transactional" | "navigational" | null;
    /** Content type recommendation from Gemini */
    contentType: string | null;
    /** Parent topic for topical clustering */
    parentTopic: string | null;
    /** When this evidence was assembled */
    evidenceCompiledAt: Date;
}

// ── Opportunity score components ───────────────────────────────────────────────

export interface OpportunityComponents {
    /** Raw demand score (volume-based) */
    demand: number;
    /** Business value multiplier */
    businessValue: number;
    /** Ranking feasibility (inverse of KD) */
    rankingFeasibility: number;
    /** SERP opportunity (from feasibility score) */
    serpOpportunity: number;
    /** Competitive gap score */
    competitorGap: number;
    /** Trend multiplier */
    trendScore: number;
    /** GSC existing performance bonus */
    existingPerformance: number;
    /** Final composite score */
    finalScore: number;
    /** Human-readable recommendation */
    recommendation: string;
    /**
     * Inputs that were unavailable and replaced by a neutral scoring weight
     * (e.g. "keywordDifficulty", "serp"). These are never shown as metrics.
     */
    missingInputs: string[];
}

// ── Merge helpers ──────────────────────────────────────────────────────────────

/**
 * Populates the GSC evidence section from raw GSC performance data.
 */
export function buildGscEvidence(gscData: {
    position: number | null;
    clicks: number;
    impressions: number;
    ctr: number;
    url: string | null;
} | null): GscEvidence | null {
    if (!gscData) return null;
    return {
        currentPosition: gscData.position,
        clicks: gscData.clicks,
        impressions: gscData.impressions,
        ctr: gscData.ctr,
        topUrl: gscData.url,
        dateRange: null, // populated by caller when date range is known
    };
}

const TREND_STOP_WORDS = new Set([
    "best", "what", "when", "where", "which", "with", "without", "from", "that",
    "this", "your", "have", "does", "how", "why", "for", "the", "and", "guide",
    "tips", "free", "online", "near",
]);

/** Lowercased words longer than 3 chars, minus generic SEO filler words. */
export function significantWords(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !TREND_STOP_WORDS.has(w));
}

/**
 * Derives trend direction from DataForSEO's monthly search-volume history.
 * This is the strongest trend evidence available: it is measured search demand.
 *
 * @param volumeTrend Monthly volumes, NEWEST FIRST (as returned by getKeywordMetricsBatch).
 * Requires at least 6 months of data; returns null otherwise.
 */
export function trendFromVolumeHistory(
    volumeTrend: number[],
    observedAt: Date,
): TrendEvidence | null {
    if (volumeTrend.length < 6) return null;

    const recent = volumeTrend.slice(0, 3);
    const baseline = volumeTrend.slice(3, 12);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const recentAvg = avg(recent);
    const baselineAvg = avg(baseline);

    if (baselineAvg <= 0 && recentAvg <= 0) return null;

    const change = baselineAvg > 0 ? (recentAvg - baselineAvg) / baselineAvg : 1;
    const direction: TrendDirection =
        change >= 0.2 ? "Rising" :
        change <= -0.2 ? "Declining" :
        "Steady";

    const pct = Math.round(change * 100);
    return {
        direction,
        source: "DataForSEO monthly search volume",
        observedAt,
        matchedSignals: [
            `Last 3 months avg ${Math.round(recentAvg).toLocaleString()}/mo vs prior ${baseline.length} months avg ${Math.round(baselineAvg).toLocaleString()}/mo (${pct >= 0 ? "+" : ""}${pct}%)`,
        ],
        // More months of history → more confidence; capped at 1.
        confidence: Math.min(1, volumeTrend.length / 12),
    };
}

/**
 * Builds trend evidence by matching a keyword against real news headlines.
 * Does NOT use an LLM — purely string matching against observed signals.
 *
 * A headline only counts if it contains at least two of the keyword's significant
 * words (or the single significant word for one-word keywords). News coverage is
 * weaker evidence than search-volume history: prefer trendFromVolumeHistory().
 */
export function buildTrendEvidence(
    keyword: string,
    trendingSignals: string[],
    source: string,
    observedAt: Date,
): TrendEvidence {
    const kwWords = significantWords(keyword);
    const required = Math.min(2, kwWords.length);

    const matchedSignals = required === 0 ? [] : trendingSignals.filter((signal) => {
        const sigWords = new Set(significantWords(signal));
        const hits = kwWords.filter((w) => sigWords.has(w)).length;
        return hits >= required;
    });

    const confidence = Math.min(1, matchedSignals.length / 3);

    let direction: TrendDirection;
    if (matchedSignals.length >= 3) {
        direction = "Rising";
    } else if (matchedSignals.length >= 1) {
        direction = "Steady";
    } else {
        direction = "Unknown";
    }

    return {
        direction,
        source,
        observedAt,
        matchedSignals: matchedSignals.slice(0, 5),
        confidence,
    };
}

/**
 * Classifies competitor gap type from your position vs. competitor positions.
 */
export function classifyCompetitorGap(
    yourPosition: number | null,
    competitorPositions: CompetitorPosition[],
): CompetitorGapType | null {
    if (competitorPositions.length === 0) return null;

    const topCompetitorPos = Math.min(...competitorPositions.map((c) => c.position));

    if (!yourPosition || yourPosition > 100) {
        // You don't rank at all
        if (topCompetitorPos <= 10) return "MISSING";
        return "NEW_OPPORTUNITY";
    }

    if (yourPosition <= 10 && topCompetitorPos <= 10) {
        return "WEAKLY_DEFENDED";
    }

    if (yourPosition > 20 && topCompetitorPos <= 10) {
        return "UNDERPERFORMING";
    }

    return "NEW_OPPORTUNITY";
}

/**
 * Merges metrics from getKeywordMetricsBatch into an evidence object.
 */
export function mergeMetricsIntoEvidence(
    evidence: KeywordEvidence,
    metrics: KeywordMetrics,
    keywordDifficulty: number | null,
): KeywordEvidence {
    return {
        ...evidence,
        searchVolume: metrics.searchVolume > 0 ? metrics.searchVolume : evidence.searchVolume,
        keywordDifficulty: keywordDifficulty ?? evidence.keywordDifficulty,
        competitionIndex: metrics.competitionIndex,
        cpc: metrics.cpc > 0 ? metrics.cpc : evidence.cpc,
        volumeTrend: metrics.trend.length > 0 ? metrics.trend : evidence.volumeTrend,
    };
}

/**
 * Creates a blank evidence object for a keyword.
 */
export function createBlankEvidence(keyword: string): KeywordEvidence {
    return {
        keyword: keyword.toLowerCase().trim(),
        searchVolume: null,
        keywordDifficulty: null,
        competitionIndex: null,
        cpc: null,
        volumeTrend: [],
        serpFeasibility: null,
        gsc: null,
        communitySignals: [],
        competitorPositions: [],
        gapType: null,
        trend: null,
        intent: null,
        contentType: null,
        parentTopic: null,
        evidenceCompiledAt: new Date(),
    };
}

/**
 * Computes a composite opportunity score from evidence components.
 *
 * IMPORTANT: GSC impressions are NOT used as a proxy for search volume.
 * They are used only as a traffic-signal bonus when real volume is available.
 */
export function computeOpportunityFromEvidence(evidence: KeywordEvidence): OpportunityComponents {
    // Demand: use real search volume only. Never substitute GSC impressions for volume.
    const volume = evidence.searchVolume ?? 0;
    const demand = volume > 0 ? Math.log10(Math.max(1, volume)) * 20 : 0;

    // Ranking feasibility: inverse of KD. Null KD → moderate assumption (50).
    const kd = evidence.keywordDifficulty ?? 50;
    const rankingFeasibility = Math.max(0, (100 - kd) / 100);

    // SERP opportunity: from deterministic SERP score.
    const serpOpportunity = evidence.serpFeasibility
        ? (evidence.serpFeasibility.score / 10)
        : 0.5; // neutral fallback when SERP not fetched

    // Business value: intent-based multiplier.
    const intentMultipliers: Record<string, number> = {
        transactional: 1.5,
        commercial: 1.2,
        informational: 0.8,
        navigational: 0.5,
    };
    const businessValue = intentMultipliers[evidence.intent ?? "informational"] ?? 1.0;

    // Competitor gap bonus.
    const gapMultipliers: Record<CompetitorGapType, number> = {
        MISSING: 1.3,
        UNDERPERFORMING: 1.2,
        WEAKLY_DEFENDED: 1.1,
        NEW_OPPORTUNITY: 1.15,
        DOMINATED: 0.7,
    };
    const competitorGap = evidence.gapType ? gapMultipliers[evidence.gapType] : 1.0;

    // Trend multiplier.
    const trendMultipliers: Record<TrendDirection, number> = {
        Rising: 1.2,
        Steady: 1.0,
        Declining: 0.8,
        Unknown: 1.0,
    };
    const trendScore = evidence.trend
        ? trendMultipliers[evidence.trend.direction]
        : 1.0;

    // GSC existing performance bonus (NOT a volume proxy — purely additive signal).
    const gscBonus = evidence.gsc?.clicks
        ? Math.min(20, Math.log10(evidence.gsc.clicks + 1) * 10)
        : 0;
    const existingPerformance = gscBonus;

    // Final composite score (0-100 range).
    const rawScore =
        demand *
        businessValue *
        rankingFeasibility *
        serpOpportunity *
        competitorGap *
        trendScore +
        existingPerformance;

    const finalScore = Math.min(100, Math.round(rawScore));

    const recommendation = buildRecommendation(evidence, finalScore);

    const missingInputs: string[] = [];
    if (evidence.searchVolume === null) missingInputs.push("searchVolume");
    if (evidence.keywordDifficulty === null) missingInputs.push("keywordDifficulty");
    if (!evidence.serpFeasibility) missingInputs.push("serp");
    if (!evidence.intent) missingInputs.push("intent");

    return {
        missingInputs,
        demand: Math.round(demand),
        businessValue,
        rankingFeasibility: Math.round(rankingFeasibility * 100),
        serpOpportunity: Math.round(serpOpportunity * 100),
        competitorGap,
        trendScore,
        existingPerformance: Math.round(existingPerformance),
        finalScore,
        recommendation,
    };
}

function buildRecommendation(evidence: KeywordEvidence, score: number): string {
    const kd = evidence.keywordDifficulty;
    const volume = evidence.searchVolume;
    const pos = evidence.gsc?.currentPosition;
    const gap = evidence.gapType;

    if (pos && pos > 10 && pos <= 20 && volume && volume > 100) {
        return `Ranking #${Math.round(pos)} — just off page 1. A content refresh could push this into top 10.`;
    }

    if (gap === "MISSING" && volume && volume > 500) {
        return `Competitors rank top 10 but you don't appear. ${volume.toLocaleString()} monthly searches — high-priority content gap.`;
    }

    if (gap === "UNDERPERFORMING") {
        return `You rank but competitors outperform you. Strengthen this content to close the gap.`;
    }

    if (kd !== null && kd < 40 && volume && volume > 200) {
        return `Low difficulty (${kd}/100), ${volume.toLocaleString()} searches/mo — strong quick-win opportunity.`;
    }

    if (score >= 60) {
        return `High-value keyword — prioritize this in your content roadmap.`;
    }

    return `Monitor and include in a broader topical cluster strategy.`;
}
