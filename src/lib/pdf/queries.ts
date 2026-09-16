/**
 * Shared data-aggregation functions for PDF report generation.
 *
 * Used by both API routes and server actions — does NOT call server actions.
 * Queries Prisma directly and assembles data with explicit provenance.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ExecutiveDigestData } from "./executive-digest";
import type {
    ReportPeriod,
    AeoEngineMetric,
    GoogleAioMetric,
    DataSourceProvenance,
    TrendDirection,
} from "./report-types";
import { createProvenance, formatReportPeriod } from "./report-types";
import type { ProviderStatus } from "@/lib/aeo/provider-result";

// ─── Helpers ────────────────────────────────────────────────────────────────

function aeoGrade(score: number): string {
    if (score >= 90) return "A+";
    if (score >= 80) return "A";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    if (score >= 50) return "D";
    return "F";
}

function computeTrend(current: number, previous: number | null): TrendDirection {
    if (previous === null) return "stable";
    const delta = current - previous;
    if (delta >= 5) return "improving";
    if (delta <= -5) return "declining";
    return "stable";
}

/**
 * Compute aggregate AEO score from ONLY engines with displayable results.
 *
 * Critical invariant (review item #4):
 *   Unavailable engines (NO_API_KEY, PROVIDER_ERROR, TIMEOUT, CIRCUIT_OPEN)
 *   are EXCLUDED from the average — they do NOT contribute zero.
 *
 *   NO_RESULT (provider succeeded but found nothing) contributes score=0.
 *   This is truthful: the engine was asked and found nothing.
 *
 * Returns null if no engines have displayable scores.
 */
function computeObservedAeoScore(engines: AeoEngineMetric[]): number | null {
    const displayable = engines.filter(m =>
        m.status === "SUCCESS" || m.status === "NO_RESULT"
    );
    if (displayable.length === 0) return null;
    const sum = displayable.reduce((acc, m) => acc + (m.score ?? 0), 0);
    return Math.round(sum / displayable.length);
}

/**
 * Extract per-engine metrics from the raw modelScores JSON stored in AeoReport.
 * Preserves provider status: engines with missing API keys or errors are
 * NOT treated as 0%.
 */
function extractEngineMetrics(
    modelScores: Record<string, unknown> | null | undefined,
    prevModelScores: Record<string, unknown> | null | undefined,
): AeoEngineMetric[] {
    const KNOWN_ENGINES = ["Perplexity", "Claude", "ChatGPT", "Gemini", "Grok", "Copilot", "DeepSeek"];

    return KNOWN_ENGINES.map((engine): AeoEngineMetric => {
        const raw = modelScores?.[engine];
        const prevRaw = prevModelScores?.[engine];

        // Determine status from the stored value
        let status: ProviderStatus = "NO_API_KEY";
        let score: number | null = null;
        let previousScore: number | null = null;

        if (typeof raw === "number") {
            status = raw === 0 ? "NO_RESULT" : "SUCCESS";
            score = raw;
        } else if (raw === null || raw === undefined) {
            status = "NO_API_KEY";
        } else if (typeof raw === "object" && raw !== null) {
            // Extended format: { score: number, status: ProviderStatus }
            const obj = raw as { score?: number; status?: string };
            if (typeof obj.score === "number") {
                score = obj.score;
                status = (obj.status as ProviderStatus) ?? (score === 0 ? "NO_RESULT" : "SUCCESS");
            }
        }

        if (typeof prevRaw === "number") {
            previousScore = prevRaw;
        } else if (typeof prevRaw === "object" && prevRaw !== null) {
            const obj = prevRaw as { score?: number };
            if (typeof obj.score === "number") previousScore = obj.score;
        }

        return { engine, score, previousScore, status };
    });
}

/**
 * Extract Google AIO metric from raw AeoReport data.
 */
function extractGoogleAioMetric(
    report: Record<string, unknown> | null,
): GoogleAioMetric {
    if (!report) {
        return { eligibilityScore: 0, hasObservedOverview: null, brandMentionedInOverview: null, status: "NO_API_KEY" };
    }

    const aioData = report.googleAio as Record<string, unknown> | undefined;
    if (!aioData) {
        return { eligibilityScore: 0, hasObservedOverview: null, brandMentionedInOverview: null, status: "NO_API_KEY" };
    }

    return {
        eligibilityScore: typeof aioData.eligibilityScore === "number" ? aioData.eligibilityScore : 0,
        hasObservedOverview: typeof aioData.hasOverview === "boolean" ? aioData.hasOverview : null,
        brandMentionedInOverview: typeof aioData.brandMentioned === "boolean" ? aioData.brandMentioned : null,
        status: typeof aioData.eligibilityScore === "number" ? "SUCCESS" : "NO_API_KEY",
    };
}

// ─── Main aggregator ────────────────────────────────────────────────────────

/**
 * Aggregates data from Audit, AeoReport, GSC, and CompetitorSnapshot tables
 * into a validated ExecutiveDigestData with explicit provenance.
 *
 * @param siteId - The site to generate the report for
 * @param userId - The authenticated user (for authorization)
 * @param startDate - ISO date string for report period start
 * @param endDate - ISO date string for report period end
 */
export async function aggregateExecutiveDigestData(
    siteId: string,
    userId: string,
    startDate: string,
    endDate: string,
): Promise<{
    data: ExecutiveDigestData;
    provenance: DataSourceProvenance[];
}> {
    const periodStart = new Date(startDate);
    const periodEnd = new Date(endDate);
    const reportPeriod = formatReportPeriod(startDate, endDate);
    const dataSources: DataSourceProvenance[] = [];

    // ── Fetch site + user (white-label is on User, not Site) ─────────

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId },
        select: {
            domain: true,
            user: {
                select: { whiteLabel: true },
            },
        },
    });

    if (!site) {
        throw new Error("Site not found or not authorized");
    }

    // ── Fetch latest audit within period ─────────────────────────────

    const latestAudit = await prisma.audit.findFirst({
        where: {
            siteId,
            runTimestamp: { lte: periodEnd },
        },
        orderBy: { runTimestamp: "desc" },
        select: {
            categoryScores: true,
            fixStatus: true,
            runTimestamp: true,
        },
    });

    const prevAudit = latestAudit
        ? await prisma.audit.findFirst({
            where: {
                siteId,
                runTimestamp: { lt: latestAudit.runTimestamp },
            },
            orderBy: { runTimestamp: "desc" },
            select: { categoryScores: true },
        })
        : null;

    if (latestAudit) {
        dataSources.push(createProvenance("SEO Audit", latestAudit.runTimestamp.toISOString(), endDate));
    }

    const categoryScores = (latestAudit?.categoryScores as Record<string, number>) ?? {};
    const seoScore = typeof categoryScores.seo === "number" ? Math.round(categoryScores.seo) : 0;
    const prevCategoryScores = (prevAudit?.categoryScores as Record<string, number>) ?? {};
    const prevSeoScore = typeof prevCategoryScores.seo === "number" ? Math.round(prevCategoryScores.seo) : null;

    // Count issues
    const issueStats = await prisma.audit.aggregate({
        where: { siteId },
        _count: true,
    });
    const fixedCount = await prisma.audit.count({
        where: { siteId, fixStatus: { in: ["FIXED", "COMPLETED"] } },
    });
    const issuesFixed = fixedCount;
    const issuesPending = Math.max(0, (issueStats._count ?? 0) - fixedCount);

    // ── Fetch latest AEO report ─────────────────────────────────────

    const latestAeo = await prisma.aeoReport.findFirst({
        where: {
            siteId,
            createdAt: { lte: periodEnd },
        },
        orderBy: { createdAt: "desc" },
    });

    const prevAeo = latestAeo
        ? await prisma.aeoReport.findFirst({
            where: {
                siteId,
                createdAt: { lt: latestAeo.createdAt },
            },
            orderBy: { createdAt: "desc" },
        })
        : null;

    if (latestAeo) {
        dataSources.push(createProvenance("AEO Report", latestAeo.createdAt.toISOString(), endDate));
    }

    const aeoScore = latestAeo?.score ?? 0;
    const prevAeoScore = prevAeo?.score ?? null;
    const rawReport = latestAeo as (typeof latestAeo & { modelScores?: Record<string, unknown>; shareOfVoice?: number; citationScore?: number; googleAio?: Record<string, unknown> }) | null;
    const prevRawReport = prevAeo as (typeof prevAeo & { modelScores?: Record<string, unknown> }) | null;

    const aeoEngineBreakdown = extractEngineMetrics(
        rawReport?.modelScores ?? null,
        prevRawReport?.modelScores ?? null,
    );
    const googleAio = extractGoogleAioMetric(rawReport as Record<string, unknown> | null);

    // ── GSC keyword data ────────────────────────────────────────────
    // TrackedKeyword stores keyword metadata; actual position + clicks
    // are in RankSnapshot (linked via snapshots relation).

    dataSources.push(createProvenance("GSC Data", periodEnd.toISOString(), endDate));

    const trackedKeywordRows = await prisma.trackedKeyword.findMany({
        where: { siteId },
        orderBy: { addedAt: "desc" },
        take: 50,
        select: {
            keyword: true,
            snapshots: {
                orderBy: { recordedAt: "desc" },
                take: 2,
                select: {
                    position: true,
                    searchVolume: true,
                    recordedAt: true,
                },
            },
        },
    }).catch(() => []);

    // Derive current/previous position and clicks from the two most recent snapshots
    const trackedKeywords = trackedKeywordRows.map(tk => {
        const current = tk.snapshots[0] ?? null;
        const previous = tk.snapshots[1] ?? null;
        return {
            keyword: tk.keyword,
            currentPosition: current?.position ?? null,
            previousPosition: previous?.position ?? null,
            clicks: current?.searchVolume ?? 0, // searchVolume is the closest proxy
        };
    });

    const keywordsImproved = trackedKeywords.filter(k =>
        k.currentPosition !== null && k.previousPosition !== null &&
        k.currentPosition < k.previousPosition,
    ).length;
    const keywordsDeclined = trackedKeywords.filter(k =>
        k.currentPosition !== null && k.previousPosition !== null &&
        k.currentPosition > k.previousPosition,
    ).length;

    const topKeywords = trackedKeywords.slice(0, 12).map(k => ({
        keyword: k.keyword,
        position: k.currentPosition ?? 0,
        change: k.previousPosition !== null && k.currentPosition !== null
            ? k.previousPosition - k.currentPosition
            : 0,
        clicks: k.clicks ?? 0,
    }));

    // ── Competitor data ─────────────────────────────────────────────
    // Traffic data lives in CompetitorTrafficSnapshot, not on Competitor.

    const competitors = await prisma.competitor.findMany({
        where: { siteId, deletedAt: null },
        take: 8,
        select: {
            domain: true,
            addedAt: true,
            snapshots: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                    estimatedVisits: true,
                    createdAt: true,
                },
            },
        },
    }).catch(() => []);

    if (competitors.length > 0) {
        const latestCompDate = competitors.reduce((latest, c) => {
            const snapDate = c.snapshots[0]?.createdAt ?? c.addedAt;
            return snapDate > latest ? snapDate : latest;
        }, competitors[0].snapshots[0]?.createdAt ?? competitors[0].addedAt);
        dataSources.push(createProvenance("Competitor Snapshot", latestCompDate.toISOString(), endDate));
    }

    const competitorSummary = competitors.map(c => ({
        domain: c.domain,
        estimatedVisits: c.snapshots[0]?.estimatedVisits ?? 0,
        trend: "flat" as const,
    }));

    // ── Recommendations ─────────────────────────────────────────────
    // AeoReport.checks is a Prisma Json field — cast through unknown.

    const rawChecks = latestAeo?.checks as unknown;
    const checksArray = Array.isArray(rawChecks) ? rawChecks as Array<Record<string, unknown>> : [];
    const topRecommendations = checksArray
        .filter(c => typeof c === "object" && c !== null && !c.passed && typeof c.recommendation === "string")
        .map(c => c.recommendation as string)
        .slice(0, 8);

    // ── White-label config (lives on User, not Site) ────────────────

    const rawWhiteLabel = site.user.whiteLabel as Record<string, unknown> | null;
    const whiteLabel = rawWhiteLabel ? {
        companyName: typeof rawWhiteLabel.companyName === "string" ? rawWhiteLabel.companyName : undefined,
        logoUrl: typeof rawWhiteLabel.logoUrl === "string" ? rawWhiteLabel.logoUrl : undefined,
        primaryColor: typeof rawWhiteLabel.primaryColor === "string" ? rawWhiteLabel.primaryColor : undefined,
        clientName: typeof rawWhiteLabel.clientName === "string" ? rawWhiteLabel.clientName : undefined,
    } : undefined;

    // ── Assemble ────────────────────────────────────────────────────

    // The stored AeoReport.score may include unavailable engines as zeros
    // in its average. Compute observed-only aggregate from the per-engine
    // breakdown (review item #4: aggregate AEO excludes unavailable providers).
    const observedAeoScore = computeObservedAeoScore(aeoEngineBreakdown);
    const effectiveAeoScore = observedAeoScore ?? aeoScore;

    const data: ExecutiveDigestData = {
        domain: site.domain,
        whiteLabel,
        reportPeriod,
        dataSources,

        seoScore,
        prevSeoScore,
        issuesFixed,
        issuesPending,
        categoryScores: Object.keys(categoryScores).length > 0 ? categoryScores : undefined,

        aeoScore: effectiveAeoScore,
        prevAeoScore,
        citationRate: rawReport?.citationScore ?? effectiveAeoScore,
        generativeShareOfVoice: rawReport?.shareOfVoice ?? 0,
        aeoEngineBreakdown,
        googleAio,
        aeoGrade: aeoGrade(effectiveAeoScore),
        aeoTrend: computeTrend(effectiveAeoScore, prevAeoScore),

        keywordsTracked: trackedKeywords.length,
        keywordsImproved,
        keywordsDeclined,
        topKeywords,

        competitorSummary,
        topRecommendations,
        createdAt: new Date().toISOString(),
    };

    logger.info("[ExecutiveDigest] Data aggregated", {
        siteId,
        seoScore,
        aeoScore,
        engines: aeoEngineBreakdown.length,
        keywords: trackedKeywords.length,
        competitors: competitorSummary.length,
        dataSources: dataSources.length,
    });

    return { data, provenance: dataSources };
}
