import { fetchGSCKeywords, classifyIntent } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { logger, formatError } from "@/lib/logger";

export interface GscOpportunity {
    keyword: string;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    opportunityScore: number;
    opportunityType: "page-1-push" | "top-3-push" | "featured-snippet" | "low-hanging";
    recommendedAction: string;
    source: "gsc";
    intent?: string;
}

export async function getGscOpportunities(
    userId: string,
    domain: string,
    options?: { throwOnAuthError?: boolean }
): Promise<GscOpportunity[]> {
    let token: string;

    try {
        token = await getUserGscToken(userId);
    } catch (err: unknown) {
        logger.warn("[gsc-opportunities] Could not retrieve GSC token", {
            userId,
            error: formatError(err),
        });
        if (options?.throwOnAuthError) throw err;
        return [];
    }

    let keywords;
    try {
        const { resolveGscProperty } = await import("@/lib/gsc/property-resolver");
        const resolution = await resolveGscProperty(userId, token, domain).catch(() => null);
        const targetProperty = resolution?.property ?? domain;
        keywords = await fetchGSCKeywords(token, targetProperty, 90, 500);
    } catch (err: unknown) {
        logger.warn("[gsc-opportunities] GSC keyword fetch failed", {
            userId,
            domain,
            error: formatError(err),
        });
        return [];
    }

    if (!keywords?.length) return [];

    return keywords
        .filter((k) =>
            k.position >= 4 &&
            k.position <= 20 &&
            k.impressions >= 50 &&
            !isLikelyBranded(k.keyword, domain)
        )
        .map((k) => {
            // k.ctr is already a percentage (e.g. 3.2 means 3.2%) — it was
            // multiplied ×100 inside rowToKeyword in src/lib/gsc/index.ts.
            // Convert back to a decimal for score math; keep the percent for display.
            const ctrPercent  = k.ctr;                       // e.g. 3.2
            const ctrDecimal  = k.ctr / 100;                 // e.g. 0.032
 
            // Intent weighting: transactional/commercial keywords convert better
            const intent = classifyIntent(k.keyword);
            const hasHighIntentSignal = hasCommercialOrTransactionalIntent(k.keyword);
            const intentMultiplier = intent === "transactional" ? 1.5
                : (intent === "commercial" || hasHighIntentSignal) ? 1.3
                : 1;
            const opportunityScore = Math.round(
                k.impressions * Math.max(0, 1 - ctrDecimal) * intentMultiplier
            );
 
            let opportunityType: GscOpportunity["opportunityType"];
            let recommendedAction: string;
 
            if (k.position <= 5) {
                opportunityType = "top-3-push";
                recommendedAction = `Ranking #${Math.round(k.position)} — add internal links from high-authority pages and improve title tag to include exact query.`;
            } else if (k.position <= 10) {
                opportunityType = "page-1-push";
                recommendedAction = `Ranking #${Math.round(k.position)} — expand content depth, add FAQ schema, and build 2-3 topically relevant internal links.`;
            } else if (k.impressions > 500 && k.position <= 20) {
                opportunityType = "featured-snippet";
                recommendedAction = `High impressions at position #${Math.round(k.position)} — structure content with a direct answer in the first paragraph and add a summary table.`;
            } else {
                opportunityType = "low-hanging";
                recommendedAction = `Position #${Math.round(k.position)} — refresh the page content, update the title tag to match the query intent more precisely.`;
            }
 
            return {
                keyword: k.keyword,
                position: Math.round(k.position * 10) / 10,
                impressions: k.impressions,
                clicks: k.clicks,
                ctr: ctrPercent,
                opportunityScore,
                opportunityType,
                recommendedAction,
                intent,
                source: "gsc" as const,
            };
        })
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, 50);
}

function isLikelyBranded(keyword: string, domain?: string): boolean {
    const kw = keyword.toLowerCase().trim();
    if (!domain) return false;
    const cleanDomain = domain
        .replace(/^sc-domain:/i, "")
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split("/")[0]
        .toLowerCase();
    const brandRoot = cleanDomain.split(".")[0] ?? "";
    if (brandRoot.length >= 3 && (kw === brandRoot || kw === cleanDomain || kw.includes(`${brandRoot} `))) {
        return true;
    }
    return false;
}

function hasCommercialOrTransactionalIntent(keyword: string): boolean {
    const signals = [
        "best", "top", "review", "vs", "versus", "compare", "alternative",
        "near me", "hire", "cost", "price", "pricing", "cheap", "buy",
        "service", "company", "agency", "software", "tool", "platform",
        "near", "local",
    ];
    const lower = keyword.toLowerCase();
    return signals.some((t) => lower.includes(t));
}