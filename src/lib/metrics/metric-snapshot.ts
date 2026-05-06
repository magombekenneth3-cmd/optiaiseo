/**
 * 2.1: MetricSnapshot writer — called after every completed audit.
 * Captures a point-in-time baseline that feeds 6-month sparkline charts
 * and week-over-week drop alerts.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendSEODigest } from "@/lib/email";

export interface AuditMetricsInput {
    siteId: string;
    overallScore?: number | null;
    aeoScore?: number | null;
    lcp?: number | null;
    cls?: number | null;
    inp?: number | null;
    schemaScore?: number | null;
    keywordCount?: number | null;
    backlinksCount?: number | null;
    organicTraffic?: number | null;
}

/** Composite CWV score: average of normalised LCP/CLS/INP percentages */
function cwvComposite(lcp?: number | null, cls?: number | null, inp?: number | null): number | null {
    // LCP: good < 2500ms → score = clamp(1 - lcp/4000, 0, 1) * 100
    // CLS: good < 0.1 → score = clamp(1 - cls/0.25, 0, 1) * 100
    // INP: good < 200ms → score = clamp(1 - inp/500, 0, 1) * 100
    const scores: number[] = [];
    if (lcp != null) scores.push(Math.max(0, Math.min(100, (1 - lcp / 4000) * 100)));
    if (cls != null) scores.push(Math.max(0, Math.min(100, (1 - cls / 0.25) * 100)));
    if (inp != null) scores.push(Math.max(0, Math.min(100, (1 - inp / 500) * 100)));
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export async function writeMetricSnapshot(input: AuditMetricsInput): Promise<void> {
    try {
        const coreWebVitals = cwvComposite(input.lcp, input.cls, input.inp);

        await prisma.metricSnapshot.create({
            data: {
                siteId: input.siteId,
                overallScore: input.overallScore ?? null,
                aeoScore: input.aeoScore ?? null,
                coreWebVitals,
                schemaScore: input.schemaScore ?? null,
                keywordCount: input.keywordCount ?? null,
                backlinksCount: input.backlinksCount ?? null,
                organicTraffic: input.organicTraffic ?? null,
            },
        });

        // Check week-over-week drop — alert if any metric fell > 10%
        await checkAndAlertDrop(input.siteId, input.overallScore ?? null, coreWebVitals);
    } catch (e: unknown) {
        logger.warn("[MetricSnapshot] Failed to write snapshot", { error: (e as Error)?.message });
    }
}

async function checkAndAlertDrop(
    siteId: string,
    currentScore: number | null,
    currentCwv: number | null
): Promise<void> {
    if (currentScore == null && currentCwv == null) return;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const prev = await prisma.metricSnapshot.findFirst({
        where: { siteId, capturedAt: { lt: oneWeekAgo } },
        orderBy: { capturedAt: "desc" },
        select: { overallScore: true, coreWebVitals: true },
    });

    if (!prev) return;

    const drops: string[] = [];
    if (currentScore != null && prev.overallScore != null && prev.overallScore > 0) {
        const drop = (prev.overallScore - currentScore) / prev.overallScore;
        if (drop > 0.10) drops.push(`Overall score dropped ${Math.round(drop * 100)}% (${prev.overallScore.toFixed(0)} → ${currentScore.toFixed(0)})`);
    }
    if (currentCwv != null && prev.coreWebVitals != null && prev.coreWebVitals > 0) {
        const drop = (prev.coreWebVitals - currentCwv) / prev.coreWebVitals;
        if (drop > 0.10) drops.push(`Core Web Vitals dropped ${Math.round(drop * 100)}% (${prev.coreWebVitals.toFixed(0)} → ${currentCwv.toFixed(0)})`);
    }

    if (drops.length === 0) return;

    // Find site owner email
    const site = await prisma.site.findUnique({
        where: { id: siteId },
        include: { user: true },
    });
    if (!site?.user?.email) return;

    await sendSEODigest(site.user.email, {
        userName: site.user.name ?? "there",
        domain: site.domain,
        auditScore: currentScore ?? 0,
        auditScoreChange: prev.overallScore != null ? Math.round(currentScore! - prev.overallScore) : 0,
        topOpportunities: [],
        newBacklinks: 0,
        lostBacklinks: 0,
        topPage: { url: `https://${site.domain}`, clicks: 0 },
    }).catch(() => {/* non-fatal */});
}

/** Fetch the last 6 months of snapshots for sparkline rendering */
export async function getMetricTrend(siteId: string, months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    return prisma.metricSnapshot.findMany({
        where: { siteId, capturedAt: { gte: since } },
        orderBy: { capturedAt: "asc" },
        select: {
            capturedAt: true,
            overallScore: true,
            aeoScore: true,
            coreWebVitals: true,
            schemaScore: true,
            organicTraffic: true,
        },
    });
}
