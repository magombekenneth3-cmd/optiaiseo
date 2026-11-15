import { prisma } from '@/lib/prisma';
import { analyzeCannibalization, type CannibalizationRisk } from '@/lib/agents/cannibalization-agent';
import type { GscPerformanceRow } from '@/lib/agents/gsc-intelligence-agent';
import { fetchWithRedisCache } from './cache';
import { getUrlLookupVariants, normalizeAuditUrl } from './url';

export interface SiteCannibalizationResult {
    hasGscData: boolean;
    rowCount: number;
    risks: CannibalizationRisk[];
    totalQueriesChecked: number;
}

const GSC_CANNIBALIZATION_TTL_SECONDS = 1800; // 30 minutes
const GSC_LOOKBACK_DAYS = 30;

/**
 * Loads the last 30 days of GSC performance rows for `siteId`, runs
 * `analyzeCannibalization`, and caches the site summary in Redis across
 * sub-page audits. Returns `null` only if the DB query itself fails.
 */
export async function getSiteCannibalizationRisks(
    siteId: string,
): Promise<SiteCannibalizationResult | null> {
    if (!siteId) return null;

    return fetchWithRedisCache<SiteCannibalizationResult>(
        `gsc:cannibalization:${siteId}`,
        async () => {
            try {
                const startDate = new Date(Date.now() - GSC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 10);

                const rows = await prisma.gscDailyPerformance.findMany({
                    where: {
                        siteId,
                        date: { gte: startDate },
                    },
                    select: {
                        keyword: true,
                        url: true,
                        clicks: true,
                        impressions: true,
                        ctr: true,
                        position: true,
                        date: true,
                    },
                });

                if (rows.length === 0) {
                    return {
                        hasGscData: false,
                        rowCount: 0,
                        risks: [],
                        totalQueriesChecked: 0,
                    };
                }

                const dailyData: GscPerformanceRow[] = rows.map((r) => ({
                    query: r.keyword,
                    page: r.url,
                    clicks: r.clicks,
                    impressions: r.impressions,
                    ctr: r.ctr,
                    position: r.position,
                    date: r.date,
                }));

                const execution = analyzeCannibalization(siteId, dailyData);
                return {
                    hasGscData: true,
                    rowCount: rows.length,
                    risks: execution.data.risks,
                    totalQueriesChecked: execution.data.totalQueriesChecked,
                };
            } catch {
                return null;
            }
        },
        GSC_CANNIBALIZATION_TTL_SECONDS,
    );
}

/**
 * Returns cannibalization risks involving `pageUrl` or matching `primaryKeyword`
 * (or its topic-cluster variants), sorted highest risk first.
 */
export function matchCannibalizationRisksForPage(
    risks: CannibalizationRisk[],
    pageUrl: string,
    primaryKeyword?: string,
): CannibalizationRisk[] {
    const pageVariants = new Set(getUrlLookupVariants(pageUrl).map(normalizeAuditUrl));
    const pkLower = primaryKeyword?.toLowerCase().trim() ?? '';

    return risks
        .filter((risk) => {
            const urlMatch = risk.pages.some((p) => pageVariants.has(normalizeAuditUrl(p.url)));
            if (urlMatch) return true;
            if (!pkLower) return false;
            if (risk.query.toLowerCase().trim() === pkLower) return true;
            return risk.clusterQueries?.some((q) => q.toLowerCase().trim() === pkLower) ?? false;
        })
        .sort((a, b) => b.riskScore - a.riskScore);
}

