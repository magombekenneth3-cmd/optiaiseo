"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserGscToken } from "@/lib/gsc/token";
import { getUserGa4Token } from "@/lib/ga4/token";
import { logger } from "@/lib/logger";
import {
    fetchGSCKeywords,
    normaliseSiteUrl,
    buildRankingSummary,
} from "@/lib/gsc";
import { fetchGa4Metrics, type Ga4Metrics } from "@/lib/ga4";

// ─────────────────────────────────────────────────────────────────
// Error mapping: token manager error codes → user-facing statuses
// ─────────────────────────────────────────────────────────────────

type IntegrationErrorStatus =
    | "not_connected"
    | "reauthorization_required"
    | "property_access_denied"
    | "unknown_error";

function classifyGscError(err: unknown): IntegrationErrorStatus {
    const msg = (err instanceof Error ? err.message : String(err));
    if (msg.includes("GSC_NOT_CONNECTED")) return "not_connected";
    if (
        msg.includes("GSC_REFRESH_TOKEN_MISSING") ||
        msg.includes("GSC_TOKEN_REFRESH_FAILED") ||
        msg.includes("GSC_REAUTHORIZATION_REQUIRED")
    ) return "reauthorization_required";
    return "unknown_error";
}

function classifyGa4Error(err: unknown): IntegrationErrorStatus {
    const msg = (err instanceof Error ? err.message : String(err));
    if (msg.includes("GA4_NOT_CONNECTED")) return "not_connected";
    if (
        msg.includes("GA4_REFRESH_TOKEN_MISSING") ||
        msg.includes("GA4_TOKEN_REFRESH_FAILED") ||
        msg.includes("GA4_REAUTHORIZATION_REQUIRED")
    ) return "reauthorization_required";
    if (msg.includes("GA4_PERMISSION_DENIED")) return "property_access_denied";
    return "unknown_error";
}

// ─────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────

export interface UnifiedAnalytics {
    gsc: {
        totalKeywords: number;
        avgPosition: number;
        totalClicks: number;
        totalImpressions: number;
        page1Count: number;
        page1Pct: number;
        top3Count: number;
        ctr: number;
    } | null;
    ga4: Ga4Metrics | null;
    gscError: IntegrationErrorStatus | null;
    ga4Error: IntegrationErrorStatus | null;
    merged: {
        organicClicksGsc: number;
        organicSessionsGa4: number;
        clickToSessionRatio: number | null;
        topLandingPages: {
            path: string;
            gscClicks: number;
            ga4Views: number;
            gap: "gsc_only" | "ga4_only" | "both";
        }[];
    } | null;
}

export async function getUnifiedAnalytics(siteId: string): Promise<UnifiedAnalytics> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { gsc: null, ga4: null, gscError: null, ga4Error: null, merged: null };

    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { domain: true, userId: true, ga4PropertyId: true },
    });

    if (!site) return { gsc: null, ga4: null, gscError: null, ga4Error: null, merged: null };

    let gscData: UnifiedAnalytics["gsc"] = null;
    let gscError: IntegrationErrorStatus | null = null;
    let ga4Data: Ga4Metrics | null = null;
    let ga4Error: IntegrationErrorStatus | null = null;
    let gscKeywords: { keyword: string; clicks: number; impressions: number; ctr: number; position: number; url?: string }[] = [];

    // ── GSC fetch (independent — GA4 runs regardless of outcome) ──
    try {
        const accessToken = await getUserGscToken(site.userId);
        const siteUrl = normaliseSiteUrl(site.domain);
        const keywords = await fetchGSCKeywords(accessToken, siteUrl, 28, 500);
        gscKeywords = keywords as typeof gscKeywords;
        const summary = buildRankingSummary(keywords);

        const totalCtr = summary.totalImpressions > 0
            ? parseFloat(((summary.totalClicks / summary.totalImpressions) * 100).toFixed(2))
            : 0;

        gscData = {
            totalKeywords: summary.total,
            avgPosition: summary.avgPosition,
            totalClicks: summary.totalClicks,
            totalImpressions: summary.totalImpressions,
            page1Count: summary.page1Count,
            page1Pct: summary.page1Pct,
            top3Count: summary.top3Count,
            ctr: totalCtr,
        };
    } catch (err) {
        gscError = classifyGscError(err);
        logger.warn("[GSC] Unified analytics fetch failed", {
            siteId,
            userId: site.userId,
            errorStatus: gscError,
            error: (err as Error)?.message,
        });
    }

    // ── GA4 fetch (independent — runs even if GSC failed) ──
    if (site.ga4PropertyId) {
        try {
            const accessToken = await getUserGa4Token(site.userId);
            ga4Data = await fetchGa4Metrics(accessToken, site.ga4PropertyId, 28);
        } catch (err) {
            ga4Error = classifyGa4Error(err);
            logger.warn("[GA4] Unified analytics fetch failed", {
                siteId,
                userId: site.userId,
                errorStatus: ga4Error,
                error: (err as Error)?.message,
            });
        }
    }

    // ── Merge when EITHER source has data ──
    let merged: UnifiedAnalytics["merged"] = null;
    if (gscData || ga4Data) {
        const gscByUrl = new Map<string, number>();
        for (const kw of gscKeywords) {
            if (kw.url) {
                const path = new URL(kw.url).pathname;
                gscByUrl.set(path, (gscByUrl.get(path) ?? 0) + kw.clicks);
            }
        }

        const ga4ByPath = new Map<string, number>();
        if (ga4Data) {
            for (const page of ga4Data.topPages) {
                ga4ByPath.set(page.path, page.views);
            }
        }

        const allPaths = new Set([...gscByUrl.keys(), ...ga4ByPath.keys()]);
        const topLandingPages: { path: string; gscClicks: number; ga4Views: number; gap: "gsc_only" | "ga4_only" | "both" }[] = [];

        for (const path of allPaths) {
            const gscClicks = gscByUrl.get(path) ?? 0;
            const ga4Views = ga4ByPath.get(path) ?? 0;
            const gap = gscClicks > 0 && ga4Views > 0
                ? "both" as const
                : gscClicks > 0
                    ? "gsc_only" as const
                    : "ga4_only" as const;
            topLandingPages.push({ path, gscClicks, ga4Views, gap });
        }

        topLandingPages.sort((a, b) => (b.gscClicks + b.ga4Views) - (a.gscClicks + a.ga4Views));

        const organicClicksGsc = gscData?.totalClicks ?? 0;
        const organicSessionsGa4 = ga4Data?.organicSessions ?? 0;
        const ratio = organicSessionsGa4 > 0
            ? parseFloat((organicClicksGsc / organicSessionsGa4).toFixed(2))
            : null;

        merged = {
            organicClicksGsc,
            organicSessionsGa4,
            clickToSessionRatio: ratio,
            topLandingPages: topLandingPages.slice(0, 10),
        };
    }

    return { gsc: gscData, ga4: ga4Data, gscError, ga4Error, merged };
}

