/**
 * Shared Google Custom Search helper for free (unauthenticated) tools.
 * No DB access — pure API passthrough.
 */
export interface GoogleSearchItem {
    link: string;
    title: string;
    snippet: string;
}

export async function googleCustomSearch(query: string): Promise<GoogleSearchItem[]> {
    const key = process.env.GOOGLE_SEARCH_API_KEY;
    const cx  = process.env.GOOGLE_SEARCH_CX;
    if (!key || !cx) return [];

    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json() as { items?: GoogleSearchItem[] };
    return data.items ?? [];
}

function parseSubreddit(url: string): string {
    const m = url.match(/reddit\.com\/r\/([^/]+)/);
    return m ? `r/${m[1]}` : "r/unknown";
}

function estimateTraffic(position: number): number {
    const ctrCurve = [0.28, 0.15, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01];
    const ctr = ctrCurve[position - 1] ?? 0.01;
    return Math.round(1000 * ctr);
}

export interface FreeRedditResult {
    keyword: string;
    threadTitle: string;
    subreddit: string;
    redditUrl: string;
    googlePosition: number;
    estimatedTraffic: number;
    brandMentioned: boolean;
    competitorMentioned: boolean;
}

export function parseRedditResults(items: GoogleSearchItem[], keyword: string): FreeRedditResult[] {
    return items
        .filter(r => r.link.includes("reddit.com"))
        .map((r, i) => ({
            keyword,
            threadTitle: r.title,
            subreddit: parseSubreddit(r.link),
            redditUrl: r.link,
            googlePosition: i + 1,
            estimatedTraffic: estimateTraffic(i + 1),
            brandMentioned: false,       // Brand unknown without auth
            competitorMentioned: false,  // Competitors unknown without auth
        }));
}
