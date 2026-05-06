import { fetchGSCKeywords, type KeywordRow } from "@/lib/gsc";
import { getUserGscToken }                   from "@/lib/gsc/token";
import { logger, formatError }               from "@/lib/logger";

export interface PageKeywords {
  url:      string;
  keywords: Array<{
    keyword:     string;
    position:    number;
    impressions: number;
    clicks:      number;
    ctr:         number; // decimal 0–1 (normalised from KeywordRow.ctr which is ×100)
  }>;
  /** Sum of impressions across all keywords for this page */
  totalImpressions: number;
}

/**
 * Returns pages sorted by total impressions descending, each page carrying
 * its top-10 keywords sorted by impressions.
 *
 * Filters:
 *  - position 1–30 (beyond this is noise)
 *  - impressions ≥ 10 (avoids one-off queries skewing briefs)
 *  - url must be non-empty (GSC occasionally returns blank URLs)
 *
 * All errors are caught and logged — callers receive [] on any failure.
 */
export async function getKeywordsByPage(
  userId: string,
  domain: string,
  days = 90,
): Promise<PageKeywords[]> {
  let token: string;

  try {
    token = await getUserGscToken(userId);
  } catch (err: unknown) {
    logger.warn("[keywords-by-page] No GSC token", {
      userId,
      error: formatError(err),
    });
    return [];
  }

  let rows: KeywordRow[];
  try {
    rows = await fetchGSCKeywords(token, domain, days);
  } catch (err: unknown) {
    logger.warn("[keywords-by-page] GSC fetch failed", {
      domain,
      error: formatError(err),
    });
    return [];
  }

  if (!rows.length) return [];

  // Group by URL, applying filters
  const byUrl = new Map<string, PageKeywords["keywords"]>();

  for (const row of rows) {
    if (!row.url)                                   continue;
    if (row.position < 1 || row.position > 30)      continue;
    if (row.impressions < 10)                        continue;

    const existing = byUrl.get(row.url) ?? [];
    existing.push({
      keyword:     row.keyword,
      position:    Math.round(row.position * 10) / 10,
      impressions: row.impressions,
      clicks:      row.clicks,
      // KeywordRow.ctr is a percentage (rowToKeyword multiplies raw decimal ×100).
      // Normalise to decimal here so all downstream consumers (brief, engine) work in 0–1.
      ctr:         row.ctr / 100,
    });
    byUrl.set(row.url, existing);
  }

  // Sort each page's keywords by impressions desc, cap at 10
  return Array.from(byUrl.entries())
    .map(([url, keywords]) => {
      const sorted = keywords.sort((a, b) => b.impressions - a.impressions);
      return {
        url,
        keywords:         sorted.slice(0, 10),
        totalImpressions: sorted.reduce((s, k) => s + k.impressions, 0),
      };
    })
    // Process highest-value pages first
    .sort((a, b) => b.totalImpressions - a.totalImpressions);
}
