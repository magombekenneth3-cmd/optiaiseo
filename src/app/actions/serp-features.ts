"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface AiOverviewStats {
    totalTracked: number;
    withAiOverview: number;
    brandInAio: number;
    withSnippet: number;
    withPaa: number;
    aioRate: number;
    brandAioRate: number;
    keywords: {
        keyword: string;
        hasAiOverview: boolean;
        brandInAio: boolean;
        hasSnippet: boolean;
        hasPaa: boolean;
        capturedAt: Date;
    }[];
}

export async function getAiOverviewStats(siteId: string): Promise<AiOverviewStats | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return null;

    const features = await prisma.serpFeature.findMany({
        where: { siteId },
        orderBy: { capturedAt: "desc" },
        distinct: ["keyword"],
        take: 50,
        select: {
            keyword: true,
            hasAiOverview: true,
            brandInAio: true,
            hasSnippet: true,
            hasPaa: true,
            capturedAt: true,
        },
    });

    if (features.length === 0) return null;

    const totalTracked = features.length;
    const withAiOverview = features.filter((f) => f.hasAiOverview).length;
    const brandInAio = features.filter((f) => f.brandInAio).length;
    const withSnippet = features.filter((f) => f.hasSnippet).length;
    const withPaa = features.filter((f) => f.hasPaa).length;

    return {
        totalTracked,
        withAiOverview,
        brandInAio,
        withSnippet,
        withPaa,
        aioRate: totalTracked > 0 ? Math.round((withAiOverview / totalTracked) * 100) : 0,
        brandAioRate: withAiOverview > 0 ? Math.round((brandInAio / withAiOverview) * 100) : 0,
        keywords: features,
    };
}

export interface SerpFeatureHistoryPoint {
    capturedAt: Date;
    keyword: string;
    hasAiOverview: boolean;
    hasSnippet: boolean;
    hasPaa: boolean;
    hasLocalPack: boolean;
    hasVideo: boolean;
    brandInAio: boolean;
}

export interface SerpFeatureHistory {
    keyword: string;
    /** Chronological snapshots oldest → newest. */
    snapshots: SerpFeatureHistoryPoint[];
    /** Delta vs. first snapshot in the window: +1 new feature gained, -1 lost. */
    aiOverviewDelta: number;
    snippetDelta: number;
}

/**
 * Returns historical SERP feature snapshots for a site, grouped by keyword.
 * Reads from SerpFeatureSnapshot which is written by captureSerpFeatures() (weekly cron).
 *
 * @param siteId   Prisma Site.id
 * @param days     Look-back window in days (default 90)
 * @param keywords Filter to specific keywords; omit for all (capped at 20)
 */
export async function getSerpFeatureHistory(
    siteId: string,
    days = 90,
    keywords?: string[],
): Promise<SerpFeatureHistory[]> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return [];

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await prisma.serpFeatureSnapshot.findMany({
        where: {
            siteId,
            capturedAt: { gte: since },
            ...(keywords && keywords.length > 0 ? { keyword: { in: keywords } } : {}),
        },
        orderBy: { capturedAt: "asc" },
        take: 2000, // safety cap — weekly cron × 20 keywords × 90 days ≈ 1,260 rows
        select: {
            keyword: true,
            hasAiOverview: true,
            hasSnippet: true,
            hasPaa: true,
            hasLocalPack: true,
            hasVideo: true,
            brandInAio: true,
            capturedAt: true,
        },
    });

    // Group by keyword, maintaining chronological order (guaranteed by orderBy above)
    const byKeyword = new Map<string, SerpFeatureHistoryPoint[]>();
    for (const snap of snapshots) {
        const existing = byKeyword.get(snap.keyword) ?? [];
        existing.push(snap);
        byKeyword.set(snap.keyword, existing);
    }

    // Build history objects, cap at 20 keywords
    const result: SerpFeatureHistory[] = [];
    for (const [keyword, points] of byKeyword) {
        if (result.length >= 20) break;
        const first = points[0];
        const last = points[points.length - 1];
        result.push({
            keyword,
            snapshots: points,
            aiOverviewDelta:
                first && last ? (last.hasAiOverview ? 1 : 0) - (first.hasAiOverview ? 1 : 0) : 0,
            snippetDelta:
                first && last ? (last.hasSnippet ? 1 : 0) - (first.hasSnippet ? 1 : 0) : 0,
        });
    }

    return result;
}
