"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PercentileBand = "top10" | "top25" | "above_avg" | "below_avg" | "bottom25";
export type ConfidenceLevel = "high" | "medium" | "low";
export type TrendDirection = "improving" | "worsening" | "stable" | null;

export interface MetricBenchmark {
    metric: string;
    label: string;
    yourValue: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    sampleSize: number;
    confidence: ConfidenceLevel;
    band: PercentileBand;
    bandLabel: string;
    percentileExact: number;
    /** How far the site is from the competitive threshold (p75 for higher-is-better, p25 for lower). */
    opportunityGap: number;
    unit?: string;
    higherIsBetter: boolean;
    trend: TrendDirection;
}

export interface SiteBenchmarkContext {
    siteId: string;
    domain: string;
    niche: string;
    techStack: string;
    nicheLabel: string;
    techStackLabel: string;
    sampleSizeMin: number;
    hasEnoughData: boolean;
    metrics: MetricBenchmark[];
    summary: {
        strongMetrics: string[];
        weakMetrics: string[];
        overallBand: PercentileBand;
        topInsight: string;
        /** Metrics sorted by opportunity gap, largest first. */
        priorityOrder: string[];
    };
    benchmarkUpdatedAt: Date | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_SAMPLE = 30;   // below this: statistically unreliable
const IDEAL_SAMPLE = 100; // above this: high confidence

const NICHE_LABELS: Record<string, string> = {
    saas: "SaaS tools",
    ecommerce: "e-commerce",
    local: "local businesses",
    agency: "digital agencies",
    blog: "content / blogs",
    other: "general websites",
};

const TECH_LABELS: Record<string, string> = {
    nextjs: "Next.js",
    wordpress: "WordPress",
    shopify: "Shopify",
    other: "other frameworks",
};

const METRIC_META: Record<string, { label: string; unit: string; higherIsBetter: boolean }> = {
    overallScore: { label: "SEO score", unit: "%", higherIsBetter: true },
    aeoScore: { label: "AEO score", unit: "%", higherIsBetter: true },
    lcp: { label: "Largest Contentful Paint", unit: "ms", higherIsBetter: false },
    cls: { label: "Cumulative Layout Shift", unit: "", higherIsBetter: false },
    inp: { label: "Interaction to Next Paint", unit: "ms", higherIsBetter: false },
};

/**
 * Weights used to compute the overall percentile band.
 * SEO and AEO scores carry the most weight; Core Web Vitals are supporting signals.
 * Must sum to 1.0.
 */
const METRIC_WEIGHTS: Record<string, number> = {
    overallScore: 0.40,
    aeoScore: 0.30,
    lcp: 0.12,
    cls: 0.10,
    inp: 0.08,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Normalizes a value so that "higher is always better" after this call.
 * Lower-is-better metrics (LCP, CLS, INP) are negated so comparisons are uniform.
 */
function normalize(value: number, higherIsBetter: boolean): number {
    return higherIsBetter ? value : -value;
}

function toBand(
    value: number,
    stat: { p25: number; p50: number; p75: number; p90: number },
    higherIsBetter: boolean
): PercentileBand {
    const v = normalize(value, higherIsBetter);
    const p25 = normalize(stat.p25, higherIsBetter);
    const p50 = normalize(stat.p50, higherIsBetter);
    const p75 = normalize(stat.p75, higherIsBetter);
    const p90 = normalize(stat.p90, higherIsBetter);

    // For lower-is-better metrics, negation flips the ordering so p90 < p75 < p50 < p25.
    // We clamp with Math.min/max to preserve the correct direction after negation.
    const [lo25, lo50, lo75, lo90] = higherIsBetter
        ? [p25, p50, p75, p90]
        : [p90, p75, p50, p25]; // negated order: -stat.p90 < -stat.p75 < …

    if (v >= lo90) return "top10";
    if (v >= lo75) return "top25";
    if (v >= lo50) return "above_avg";
    if (v >= lo25) return "below_avg";
    return "bottom25";
}

function bandLabel(band: PercentileBand): string {
    switch (band) {
        case "top10": return "top 10%";
        case "top25": return "top 25%";
        case "above_avg": return "above average";
        case "below_avg": return "below average";
        case "bottom25": return "bottom 25%";
    }
}

/**
 * Interpolates an approximate percentile rank (0–100) using the four known
 * percentile breakpoints. Operates entirely in normalized space so
 * higher-is-better and lower-is-better metrics use identical logic.
 */
function interpolatePercentile(
    value: number,
    stat: { p25: number; p50: number; p75: number; p90: number },
    higherIsBetter: boolean
): number {
    const v = normalize(value, higherIsBetter);
    const p25 = normalize(stat.p25, higherIsBetter);
    const p50 = normalize(stat.p50, higherIsBetter);
    const p75 = normalize(stat.p75, higherIsBetter);
    const p90 = normalize(stat.p90, higherIsBetter);

    // Sort the normalized breakpoints in ascending order so bounds are always lo < hi.
    const sorted = [p25, p50, p75, p90].sort((a, b) => a - b);
    const [s25, s50, s75, s90] = sorted;

    const bounds = [
        { lo: -Infinity, hi: s25, pLo: 0, pHi: 25 },
        { lo: s25, hi: s50, pLo: 25, pHi: 50 },
        { lo: s50, hi: s75, pLo: 50, pHi: 75 },
        { lo: s75, hi: s90, pLo: 75, pHi: 90 },
        { lo: s90, hi: Infinity, pLo: 90, pHi: 100 },
    ];

    for (const { lo, hi, pLo, pHi } of bounds) {
        if (v >= lo && v < hi) {
            if (!isFinite(lo)) return pLo + 5;
            if (!isFinite(hi)) return 95;
            return Math.round(pLo + ((v - lo) / (hi - lo)) * (pHi - pLo));
        }
    }
    return 50; // fallback — should not be reached
}

/**
 * Computes the overall band using a weighted average of per-metric percentile scores.
 * Falls back to the worst-metric approach if no weights are defined.
 */
function computeOverallBand(metrics: MetricBenchmark[]): PercentileBand {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const m of metrics) {
        const w = METRIC_WEIGHTS[m.metric] ?? 0;
        if (w === 0) continue;
        weightedSum += (m.percentileExact / 100) * w;
        totalWeight += w;
    }

    if (totalWeight === 0) {
        // Fallback: use simple average of percentiles
        const avg = metrics.reduce((sum, m) => sum + m.percentileExact, 0) / metrics.length;
        weightedSum = avg / 100;
        totalWeight = 1;
    }

    const score = weightedSum / totalWeight; // 0–1

    if (score >= 0.90) return "top10";
    if (score >= 0.75) return "top25";
    if (score >= 0.50) return "above_avg";
    if (score >= 0.25) return "below_avg";
    return "bottom25";
}

/**
 * Returns how far the site is from the competitive threshold.
 * Positive = needs improvement; 0 or negative = already competitive.
 *
 * For higher-is-better: gap to p75 (top 25% threshold).
 * For lower-is-better: gap from p25 (top 25% threshold).
 */
function computeOpportunityGap(
    value: number,
    stat: { p25: number; p75: number },
    higherIsBetter: boolean
): number {
    return higherIsBetter
        ? Math.max(0, stat.p75 - value)
        : Math.max(0, value - stat.p25);
}

function toConfidence(sampleSize: number): ConfidenceLevel {
    if (sampleSize >= IDEAL_SAMPLE) return "high";
    if (sampleSize >= MIN_SAMPLE) return "medium";
    return "low";
}

function toTrend(delta: number | null, higherIsBetter: boolean): TrendDirection {
    if (delta === null) return null;
    const threshold = 2; // ignore noise smaller than 2 units
    if (Math.abs(delta) < threshold) return "stable";
    const improving = higherIsBetter ? delta > 0 : delta < 0;
    return improving ? "improving" : "worsening";
}

// ─── Insight generation ───────────────────────────────────────────────────────

function buildTopInsight(
    metrics: MetricBenchmark[],
    weakMetrics: string[],
    strongMetrics: string[],
    nicheLabel: string,
    techLabel: string,
): string {
    const aeo = metrics.find((m) => m.metric === "aeoScore");
    const seo = metrics.find((m) => m.metric === "overallScore");

    // Highest-opportunity weak metric
    const topWeak = metrics
        .filter((m) => m.band === "below_avg" || m.band === "bottom25")
        .sort((a, b) => b.opportunityGap - a.opportunityGap)[0];

    if (aeo?.band === "top10") {
        return `Your AEO score is in the top 10% of ${nicheLabel} on ${techLabel} — a strong competitive moat.`;
    }

    if (aeo && (aeo.band === "below_avg" || aeo.band === "bottom25")) {
        const gap = Math.round(aeo.opportunityGap);
        return `Your AEO score is ${gap} point${gap !== 1 ? "s" : ""} from the competitive threshold for ${nicheLabel}. `
            + `Focus on structured data, FAQ schema, and entity coverage to close the gap.`;
    }

    if (topWeak) {
        const gap = topWeak.unit
            ? `${Math.round(topWeak.opportunityGap)}${topWeak.unit}`
            : `${Math.round(topWeak.opportunityGap)} points`;
        const direction = topWeak.higherIsBetter ? "increase" : "reduce";
        return `${topWeak.label} is your biggest gap: ${direction} by ${gap} to reach the top 25% of ${nicheLabel}.`;
    }

    if (seo?.band === "top25") {
        return `Your SEO score is in the top 25% of ${nicheLabel} on ${techLabel}. Focus on AEO and Core Web Vitals to break into the top 10%.`;
    }

    if (strongMetrics.length > 0) {
        return `You're performing above average vs. ${nicheLabel} on ${techLabel}. ${strongMetrics[0]} is your strongest signal.`;
    }

    return `You're performing above average vs. comparable ${nicheLabel} sites on ${techLabel}.`;
}

// ─── Main action ──────────────────────────────────────────────────────────────

export async function getSiteBenchmarkContext(
    siteId: string
): Promise<SiteBenchmarkContext | null> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return null;

        const site = await prisma.site.findFirst({
            where: { id: siteId, user: { email: session.user.email } },
            select: {
                id: true,
                domain: true,
                niche: true,
                techStack: true,
                audits: {
                    orderBy: { runTimestamp: "desc" },
                    take: 2, // take 2 to compute trend delta
                    select: { categoryScores: true, lcp: true, cls: true, inp: true },
                },
                aeoReports: {
                    orderBy: { createdAt: "desc" },
                    take: 2,
                    select: { score: true },
                },
            },
        });

        if (!site) return null;

        const niche = site.niche ?? "other";
        const techStack = site.techStack ?? "other";

        const benchmarkStats = await prisma.benchmarkStat.findMany({
            where: { niche, techStack },
            select: {
                metric: true,
                p25: true,
                p50: true,
                p75: true,
                p90: true,
                sampleSize: true,
                updatedAt: true,
            },
        });

        if (benchmarkStats.length === 0) return null;

        const latestAudit = site.audits[0];
        const prevAudit = site.audits[1] ?? null;
        const latestAeo = site.aeoReports[0];
        const prevAeo = site.aeoReports[1] ?? null;


        function computeOverallScore(audit: typeof latestAudit | undefined): number | null {
            if (!audit?.categoryScores) return null;
            const cats = audit.categoryScores;
            if (!cats || typeof cats !== "object") return null;
            const vals = Object.values(cats as Record<string, unknown>)
                .filter((v): v is number => typeof v === "number");
            return vals.length > 0
                ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
                : null;
        }

        const currentOverall = computeOverallScore(latestAudit);
        const prevOverall = computeOverallScore(prevAudit);

        const siteValues: Record<string, number | null> = {
            overallScore: currentOverall,
            aeoScore: latestAeo?.score ?? null,
            lcp: latestAudit?.lcp ?? null,
            cls: latestAudit?.cls ?? null,
            inp: latestAudit?.inp ?? null,
        };

        const prevValues: Record<string, number | null> = {
            overallScore: prevOverall,
            aeoScore: prevAeo?.score ?? null,
            lcp: prevAudit?.lcp ?? null,
            cls: prevAudit?.cls ?? null,
            inp: prevAudit?.inp ?? null,
        };


        const metrics: MetricBenchmark[] = [];
        let benchmarkUpdatedAt: Date | null = null;

        for (const stat of benchmarkStats) {
            const meta = METRIC_META[stat.metric];
            if (!meta) continue;

            const yourValue = siteValues[stat.metric];
            if (yourValue === null || yourValue === undefined) continue;

            // Skip low-confidence stats; expose medium-confidence with a flag
            if (stat.sampleSize < MIN_SAMPLE) continue;

            if (!benchmarkUpdatedAt || stat.updatedAt > benchmarkUpdatedAt) {
                benchmarkUpdatedAt = stat.updatedAt;
            }

            const prevValue = prevValues[stat.metric];
            const delta = prevValue !== null ? yourValue - prevValue : null;

            const band = toBand(yourValue, stat, meta.higherIsBetter);
            const percentileExact = interpolatePercentile(yourValue, stat, meta.higherIsBetter);
            const opportunityGap = computeOpportunityGap(yourValue, stat, meta.higherIsBetter);
            const confidence = toConfidence(stat.sampleSize);
            const trend = toTrend(delta, meta.higherIsBetter);

            metrics.push({
                metric: stat.metric,
                label: meta.label,
                yourValue,
                p25: stat.p25,
                p50: stat.p50,
                p75: stat.p75,
                p90: stat.p90,
                sampleSize: stat.sampleSize,
                confidence,
                band,
                bandLabel: bandLabel(band),
                percentileExact,
                opportunityGap,
                unit: meta.unit,
                higherIsBetter: meta.higherIsBetter,
                trend,
            });
        }

        if (metrics.length === 0) return null;


        const strongMetrics = metrics
            .filter((m) => m.band === "top10" || m.band === "top25")
            .map((m) => m.label);

        const weakMetrics = metrics
            .filter((m) => m.band === "below_avg" || m.band === "bottom25")
            .map((m) => m.label);

        // Priority order: sort by opportunity gap descending (biggest wins first)
        const priorityOrder = [...metrics]
            .sort((a, b) => b.opportunityGap - a.opportunityGap)
            .map((m) => m.label);

        const overall = computeOverallBand(metrics);
        const sampleMin = Math.min(...metrics.map((m) => m.sampleSize));
        const nicheLabel = NICHE_LABELS[niche] ?? niche;
        const techLabel = TECH_LABELS[techStack] ?? techStack;

        const topInsight = buildTopInsight(metrics, weakMetrics, strongMetrics, nicheLabel, techLabel);

        return {
            siteId,
            domain: site.domain,
            niche,
            techStack,
            nicheLabel,
            techStackLabel: techLabel,
            sampleSizeMin: sampleMin,
            hasEnoughData: sampleMin >= MIN_SAMPLE,
            metrics,
            summary: {
                strongMetrics,
                weakMetrics,
                overallBand: overall,
                topInsight,
                priorityOrder,
            },
            benchmarkUpdatedAt,
        };
    } catch (err: unknown) {
        logger.error("[Benchmarks] getSiteBenchmarkContext failed", {
            siteId,
            error: (err as Error)?.message,
        });
        return null;
    }
}