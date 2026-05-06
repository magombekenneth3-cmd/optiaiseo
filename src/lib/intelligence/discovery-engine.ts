import { CategoryProfile } from "./category-ai";

export function generateMarketQueries(profile: CategoryProfile): string[] {
  const geo = profile.geo.toLowerCase() === "global" ? "" : profile.geo;
  const queries = [
    `${profile.subcategory} providers ${geo}`.trim(),
    `${profile.category} companies ${geo}`.trim(),
    `best ${profile.subcategory} ${geo}`.trim(),
    `top ${profile.subcategory} ${geo}`.trim(),
    `${profile.subcategory} services ${geo}`.trim(),
  ];
  return Array.from(new Set(queries));
}

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
}

export async function fetchMarketSources(queries: string[]): Promise<SerperResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("SERPER_API_KEY is missing");

  const results: SerperResult[] = [];
  const seenLinks = new Set<string>();

  // Run in parallel
  await Promise.allSettled(
    queries.map(async (q) => {
      try {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q,
            num: 20, // get more results to find listicles/directories
          }),
        });
        
        if (!res.ok) return;
        const data = await res.json();
        
        const organic = data.organic || [];
        for (const item of organic) {
          if (!seenLinks.has(item.link)) {
            seenLinks.add(item.link);
            results.push({
              title: item.title || "",
              link: item.link || "",
              snippet: item.snippet || "",
            });
          }
        }
      } catch (err) {
        console.error(`Serper query failed for "${q}":`, err);
      }
    })
  );

  return results;
}

export function isListArticleOrDirectory(result: SerperResult): boolean {
  const lowerTitle = result.title.toLowerCase();
  const lowerSnippet = result.snippet.toLowerCase();
  const combined = lowerTitle + " " + lowerSnippet;

  const patterns = [
    /best \d+/i,
    /top \d+/i,
    /directory/i,
    /list of/i,
    /alternatives/i,
    /compared/i,
  ];

  return patterns.some(p => p.test(combined));
}
