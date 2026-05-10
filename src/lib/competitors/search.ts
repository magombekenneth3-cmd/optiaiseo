// =============================================================================
// Competitor detection engine — search engine
// 6 intent-optimised Serper queries per service, run in parallel.
// Captures SERP snippet text to eliminate re-fetching during verification.
// =============================================================================

import { shouldExclude, extractRoot } from "./filters";
import type { SerperSearchResult } from "./types";

const DEFAULT_TIMEOUT_MS = 8_000;

// Query builder

/**
 * Builds 6 intent-optimised queries for a service name.
 *
 * Intent breakdown:
 *   1. Direct match       → businesses ranked for the exact service
 *   2. "+ company"        → pushes blog posts down, real companies up
 *   3. "+ alternative"    → surfaces what people compare when switching providers
 *   4. "top + companies"  → ranked lists of real providers
 *   5. "+ software tools" → SaaS/tool comparisons
 *   6. "+ vs"             → comparison pages
 *
 * Intentionally avoids "best X" (heavy on review blogs), "X pricing" (Capterra/G2),
 * "X provider" (Clutch/DesignRush directories).
 */
export function buildSearchQueries(
    serviceName: string,
    location:    string
): string[] {
    const loc  = location.trim();
    const name = serviceName.trim();

    const base =
        loc && !name.toLowerCase().includes(loc.toLowerCase())
            ? `${name} ${loc}`
            : name;

    return [
        base,                              // 1. direct match
        `${base} company`,                 // 2. real companies, not blogs
        `${base} alternative`,             // 3. switcher intent
        `top ${base} companies`,           // 4. ranked lists
        `best ${base} software tools`,     // 5. SaaS/tool comparisons
        `${base} vs`,                      // 6. comparison pages
    ]
        .map((q) => q.replace(/\s+/g, " ").trim())
        .filter((q) => q.length > 3);
}

// Serper runner

interface SerperOrganicResult {
    link?:    string;
    title?:   string;
    snippet?: string;
}

interface SerperResponse {
    organic?:         SerperOrganicResult[];
    relatedSearches?: Array<{ query: string }>;
}

/**
 * Runs queries through Serper in parallel.
 * Returns frequency, best-position, and snippet maps for all passing domains.
 *
 * Domains are filtered via shouldExclude() before being counted.
 * Domains mentioned in Serper's relatedSearches get a +0.5 frequency bonus.
 * Snippet text (title + snippet) is captured so downstream verification
 * can skip re-fetching each competitor's homepage.
 */
export async function runSearchQueries(opts: {
    queries:            string[];
    countryCode:        string;
    ownRoot:            string;
    apiKey:             string;
    extraBlockedRoots?: Set<string>;
    timeoutMs?:         number;
}): Promise<SerperSearchResult> {
    const {
        queries,
        countryCode,
        ownRoot,
        apiKey,
        extraBlockedRoots = new Set(),
        timeoutMs = DEFAULT_TIMEOUT_MS,
    } = opts;

    const domainFrequency    = new Map<string, number>();
    const domainBestPosition = new Map<string, number>();
    const domainSnippets     = new Map<string, string>();

    await Promise.allSettled(
        queries.map(async (query) => {
            let data: SerperResponse;

            try {
                const response = await fetch("https://google.serper.dev/search", {
                    method:  "POST",
                    headers: {
                        "X-API-KEY":    apiKey,
                        "Content-Type": "application/json",
                    },
                    body:   JSON.stringify({ q: query, gl: countryCode, hl: "en", num: 20 }),
                    signal: AbortSignal.timeout(timeoutMs),
                });

                if (!response.ok) return;
                data = await response.json() as SerperResponse;
            } catch {
                return; // network error / timeout — skip silently
            }

            const relatedText = (data.relatedSearches ?? [])
                .map((r) => r.query.toLowerCase())
                .join(" ");

            for (const [index, result] of (data.organic ?? []).entries()) {
                if (!result.link) continue;

                let hostname: string;
                try {
                    hostname = new URL(result.link).hostname
                        .replace(/^www\./, "")
                        .toLowerCase();
                } catch {
                    continue;
                }

                if (shouldExclude(hostname, ownRoot, extraBlockedRoots)) continue;

                const root         = extractRoot(hostname);
                const relatedBonus = relatedText.includes(root) ? 0.5 : 0;

                domainFrequency.set(
                    hostname,
                    (domainFrequency.get(hostname) ?? 0) + 1 + relatedBonus
                );
                domainBestPosition.set(
                    hostname,
                    Math.min(domainBestPosition.get(hostname) ?? 999, index + 1)
                );

                // Capture the richest snippet we've seen for this domain
                // (first occurrence wins — position 1 result tends to be most relevant)
                if (!domainSnippets.has(hostname)) {
                    const parts = [result.title, result.snippet].filter(Boolean);
                    if (parts.length > 0) {
                        domainSnippets.set(hostname, parts.join(" — ").slice(0, 300));
                    }
                }
            }
        })
    );

    return { domainFrequency, domainBestPosition, domainSnippets };
}
