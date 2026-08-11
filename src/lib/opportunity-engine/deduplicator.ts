import { RawOpportunitySignal, ConsolidatedOpportunity, OpportunityCategory } from "./types";

const CATEGORY_PRIORITY: Record<OpportunityCategory, number> = {
    DECLINING: 1,
    QUICK_WIN: 2,
    CANNIBALIZATION: 3,
    ALMOST_RANKING: 4,
    STALE: 5,
    ORPHANED: 6,
    DEAD_WEIGHT: 7,
};

export function consolidateOpportunities(signals: RawOpportunitySignal[]): ConsolidatedOpportunity[] {
    const grouped = new Map<string, RawOpportunitySignal[]>();

    for (const signal of signals) {
        const existing = grouped.get(signal.url) || [];
        existing.push(signal);
        grouped.set(signal.url, existing);
    }

    const consolidated: ConsolidatedOpportunity[] = [];

    for (const [url, urlSignals] of grouped.entries()) {
        // Sort urlSignals by category priority so highest priority signal is selected
        const sortedSignals = [...urlSignals].sort(
            (a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category]
        );

        const primarySignal = sortedSignals[0];
        const categories = Array.from(new Set(sortedSignals.map(s => s.category)));

        consolidated.push({
            url,
            keyword: primarySignal.keyword,
            primaryCategory: primarySignal.category,
            categories,
            impressions: Math.max(...urlSignals.map(s => s.impressions)),
            clicks: Math.max(...urlSignals.map(s => s.clicks)),
            position: primarySignal.position,
            previousPosition: primarySignal.previousPosition,
            previousClicks: primarySignal.previousClicks,
            lastUpdated: primarySignal.lastUpdated,
            inboundInternalLinksCount: primarySignal.inboundInternalLinksCount,
            signals: urlSignals,
        });
    }

    return consolidated;
}
