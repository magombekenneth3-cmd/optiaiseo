import { getUserGscToken } from "@/lib/gsc/token";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GscPageMetric } from "./types";

export async function fetchGscEvidence(siteId: string): Promise<GscPageMetric[]> {
    try {
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { id: true, domain: true, userId: true }
        });

        if (!site) return [];

        const accessToken = await getUserGscToken(site.userId);
        if (!accessToken) {
            logger.info("[EvidenceProvider] No GSC access token found for site", { siteId });
            return [];
        }

        const siteUrl = normaliseSiteUrl(site.domain);
        const keywordRows = await fetchGSCKeywords(accessToken, siteUrl, 90, 3600);

        // Aggregate by URL
        const urlMap = new Map<string, {
            url: string;
            keyword: string;
            clicks: number;
            impressions: number;
            positionSum: number;
            count: number;
        }>();

        for (const row of keywordRows) {
            const cleanUrl = row.url.split("?")[0].replace(/\/$/, "");
            const existing = urlMap.get(cleanUrl) || {
                url: cleanUrl,
                keyword: row.keyword,
                clicks: 0,
                impressions: 0,
                positionSum: 0,
                count: 0
            };

            existing.clicks += row.clicks;
            existing.impressions += row.impressions;
            existing.positionSum += row.position * row.impressions;
            existing.count += row.impressions;

            // Keep highest impression keyword as primary keyword
            if (row.impressions > (existing.impressions - row.impressions)) {
                existing.keyword = row.keyword;
            }

            urlMap.set(cleanUrl, existing);
        }

        const metrics: GscPageMetric[] = [];
        for (const entry of urlMap.values()) {
            const avgPosition = entry.count > 0 ? parseFloat((entry.positionSum / entry.count).toFixed(1)) : 0;
            metrics.push({
                url: entry.url,
                keyword: entry.keyword,
                clicks: entry.clicks,
                impressions: entry.impressions,
                position: avgPosition,
            });
        }

        return metrics;
    } catch (err: unknown) {
        logger.error("[EvidenceProvider] Failed to fetch GSC evidence", { siteId, error: (err as Error)?.message || String(err) });
        return [];
    }
}
