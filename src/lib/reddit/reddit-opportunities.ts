/**
 * 8.4: Reddit SEO Opportunity Finder
 * For each tracked keyword, searches site:reddit.com [keyword] via Google Custom Search API.
 * Filters for threads ranking in positions 1-10 on Google.
 * Surfaces as "Reddit opportunities" in the Keywords dashboard.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface RedditOpportunity {
    keyword:           string;
    threadTitle:       string;
    subreddit:         string;
    redditUrl:         string;
    googlePosition:    number;
    estimatedTraffic:  number;
    brandMentioned:    boolean;
    competitorMentioned: boolean;
}

async function googleCustomSearch(query: string): Promise<{
    link: string;
    title: string;
    snippet: string;
}[]> {
    const key = process.env.GOOGLE_SEARCH_API_KEY;
    const cx  = process.env.GOOGLE_SEARCH_CX;
    if (!key || !cx) return [];

    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const data = await res.json() as { items?: { link: string; title: string; snippet: string }[] };
        return data.items ?? [];
    } catch {
        return [];
    }
}

function parseSubreddit(url: string): string {
    const m = url.match(/reddit\.com\/r\/([^/]+)/);
    return m ? `r/${m[1]}` : "r/unknown";
}

function estimateTraffic(position: number): number {
    // Rough CTR curve: position 1 = 28%, 2 = 15%, 3 = 11%, etc.
    const ctrCurve = [0.28, 0.15, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01];
    const ctr = ctrCurve[position - 1] ?? 0.01;
    // Estimate search volume: use 1000 as a safe floor (actual volume unknown without paid API)
    return Math.round(1000 * ctr);
}

export async function findRedditOpportunities(
    domain: string,
    keywords: string[],
    competitors: string[] = [],
): Promise<RedditOpportunity[]> {
    const opportunities: RedditOpportunity[] = [];
    const domainCore = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

    for (const keyword of keywords.slice(0, 10)) {
        const results = await googleCustomSearch(`site:reddit.com ${keyword}`);

        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (!r.link.includes("reddit.com")) continue;

            const snippet   = (r.title + " " + r.snippet).toLowerCase();
            const brandMentioned = snippet.includes(domainCore.toLowerCase());
            const competitorMentioned = competitors.some(c =>
                snippet.includes(c.replace(/^www\./, "").toLowerCase())
            );

            opportunities.push({
                keyword,
                threadTitle:      r.title,
                subreddit:        parseSubreddit(r.link),
                redditUrl:        r.link,
                googlePosition:   i + 1,
                estimatedTraffic: estimateTraffic(i + 1),
                brandMentioned,
                competitorMentioned,
            });
        }

        // Polite delay
        await new Promise(res => setTimeout(res, 300));
    }

    logger.info(`[Reddit] Found ${opportunities.length} opportunities for ${domain}`);
    return opportunities;
}

/**
 * API helper: fetch keywords + competitors for a site, run Reddit search.
 */
export async function getRedditOpportunitiesForSite(siteId: string): Promise<RedditOpportunity[]> {
    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: {
            domain: true,
            rankSnapshots: {
                distinct:  ["keyword"],
                orderBy:   { recordedAt: "desc" },
                take:      10,
                select:    { keyword: true },
            },
            competitors: {
                take:   5,
                select: { domain: true },
            },
        },
    });

    if (!site) return [];

    const keywords    = site.rankSnapshots.map(r => r.keyword);
    const competitors = site.competitors.map(c => c.domain);

    return findRedditOpportunities(site.domain, keywords, competitors);
}
