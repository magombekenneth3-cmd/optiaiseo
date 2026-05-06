import { logger, formatError } from "@/lib/logger";

export interface CommunityKeyword {
  keyword: string;
  source: "Reddit" | "Quora";
  subreddit?: string;
  upvotes: number;
  questionPattern: string;
}

const FETCH_TIMEOUT_MS = 8000;

export async function mineRedditKeywords(
  niche: string,
  _domain: string
): Promise<CommunityKeyword[]> {
  const subreddits = inferSubreddits(niche);
  const results: CommunityKeyword[] = [];

  for (const sub of subreddits.slice(0, 3)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(
          `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(niche)}&sort=top&t=month&limit=25`,
          {
            headers: { "User-Agent": "SEO-research-bot/1.0" },
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) continue;

      const data = await res.json();
      const posts = data.data?.children ?? [];

      for (const post of posts) {
        const title: string = post.data?.title ?? "";
        const score: number = post.data?.score ?? 0;
        if (!isQuestionOrSearch(title)) continue;
        const keyword = extractKeyword(title);
        if (!keyword || keyword.length < 5) continue;
        results.push({ keyword, source: "Reddit", subreddit: sub, upvotes: score, questionPattern: title });
      }
    } catch (err: unknown) {
      logger.warn("[community] Reddit fetch failed", { subreddit: sub, error: formatError(err) });
    }
  }

  const seen = new Set<string>();
  return results
    .filter((r) => {
      if (seen.has(r.keyword)) return false;
      seen.add(r.keyword);
      return true;
    })
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, 20);
}

function inferSubreddits(niche: string): string[] {
  const n = niche.toLowerCase();
  if (n.includes("seo") || n.includes("marketing")) return ["SEO", "digital_marketing", "marketing"];
  if (n.includes("saas") || n.includes("startup")) return ["SaaS", "startups", "entrepreneur"];
  if (n.includes("ecommerce") || n.includes("shop")) return ["ecommerce", "Entrepreneur", "smallbusiness"];
  if (n.includes("health") || n.includes("fitness")) return ["fitness", "loseit", "nutrition"];
  if (n.includes("finance") || n.includes("invest")) return ["personalfinance", "investing", "financialindependence"];
  return [niche.replace(/\s+/g, ""), "entrepreneur", "smallbusiness"];
}

function isQuestionOrSearch(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes("?") ||
    t.startsWith("how") ||
    t.startsWith("what") ||
    t.startsWith("why") ||
    t.startsWith("best") ||
    t.startsWith("which") ||
    t.startsWith("looking for") ||
    t.startsWith("need help") ||
    t.includes("recommend")
  );
}

function extractKeyword(title: string): string {
  return title
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80);
}