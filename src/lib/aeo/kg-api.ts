/**
 * Google Knowledge Graph Search API client.
 *
 * Queries the public Knowledge Graph to verify whether a brand/domain
 * has a known entity entry in Google's knowledge base. This is a strong
 * signal for brand authority — entities in the KG are more likely to
 * appear in AI Overviews and featured snippets.
 *
 * Requires GOOGLE_KG_API_KEY env var (free tier: 100k req/day).
 * Falls back gracefully when the key is missing.
 */

import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeGraphEntity {
    /** Google KG machine ID, e.g. "/m/0wrt1" */
    entityId: string;
    /** Display name, e.g. "Shopify" */
    name: string;
    /** One-line description from KG */
    description?: string;
    /** Extended description (usually from Wikipedia) */
    detailedDescription?: string;
    /** Schema.org types, e.g. ["Organization", "Thing"] */
    types: string[];
    /** Official website URL */
    url?: string;
    /** Image URL from KG */
    imageUrl?: string;
    /** KG API confidence score (0–1000+) */
    score: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KG_API_URL = "https://kgsearch.googleapis.com/v1/entities:search";
const CACHE_TTL_S = 86400; // 24 hours
const REQUEST_TIMEOUT_MS = 8000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up a brand in the Google Knowledge Graph.
 *
 * @param query - brand name or domain to search for
 * @returns the top-scoring entity, or null if not found / unconfigured
 */
export async function lookupKnowledgeGraph(
    query: string,
): Promise<KnowledgeGraphEntity | null> {
    const apiKey = process.env.GOOGLE_KG_API_KEY;
    if (!apiKey) {
        logger.debug("[KG-API] GOOGLE_KG_API_KEY not set — skipping KG lookup");
        return null;
    }

    // Check cache first
    const cacheKey = `kg:lookup:${query.toLowerCase().trim()}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached !== null && cached !== undefined) {
            const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
            return parsed as KnowledgeGraphEntity | null;
        }
    } catch {
        // Cache miss — proceed to API
    }

    try {
        const params = new URLSearchParams({
            query,
            key: apiKey,
            limit: "3",
            indent: "false",
        });

        const res = await fetch(`${KG_API_URL}?${params}`, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
            logger.warn("[KG-API] API error", { status: res.status });
            return null;
        }

        const data = await res.json();
        const elements: unknown[] = data.itemListElement ?? [];

        if (elements.length === 0) {
            // Cache the negative result too to avoid repeated lookups
            await redis.set(cacheKey, JSON.stringify(null), { ex: CACHE_TTL_S }).catch(() => undefined);
            return null;
        }

        // Find the best match — highest resultScore
        let best: KnowledgeGraphEntity | null = null;
        let bestScore = 0;

        for (const el of elements) {
            const item = (el as Record<string, unknown>).result as Record<string, unknown> | undefined;
            const score = (el as Record<string, unknown>).resultScore as number ?? 0;

            if (!item || score < bestScore) continue;

            const types: string[] = [];
            const rawTypes = item["@type"] as string[] | undefined;
            if (Array.isArray(rawTypes)) {
                for (const t of rawTypes) {
                    if (t !== "Thing") types.push(t);
                }
            }

            const detailed = item.detailedDescription as Record<string, unknown> | undefined;

            best = {
                entityId: (item["@id"] as string) ?? "",
                name: (item.name as string) ?? query,
                description: (item.description as string) ?? undefined,
                detailedDescription: (detailed?.articleBody as string) ?? undefined,
                types: types.length > 0 ? types : ["Thing"],
                url: (item.url as string) ?? (detailed?.url as string) ?? undefined,
                imageUrl: ((item.image as Record<string, unknown>)?.contentUrl as string) ?? undefined,
                score,
            };
            bestScore = score;
        }

        // Cache result (including null) for 24 hours
        await redis.set(cacheKey, JSON.stringify(best), { ex: CACHE_TTL_S }).catch(() => undefined);

        if (best) {
            logger.info("[KG-API] Entity found", {
                query,
                entityId: best.entityId,
                name: best.name,
                score: best.score,
                types: best.types,
            });
        }

        return best;
    } catch (error: unknown) {
        logger.warn("[KG-API] Lookup failed", { query, error: (error as Error)?.message });
        return null;
    }
}

/**
 * Check if a KG entity is likely a match for a specific domain.
 * Compares the entity URL / name against the domain string.
 */
export function isEntityMatch(entity: KnowledgeGraphEntity, domain: string): boolean {
    const domainLower = domain.toLowerCase();
    const baseName = domainLower.split(".")[0];

    // URL match
    if (entity.url) {
        try {
            const entityHost = new URL(entity.url).hostname.toLowerCase();
            if (entityHost === domainLower || entityHost === `www.${domainLower}`) return true;
        } catch {
            // Invalid URL — fall through
        }
    }

    // Name match
    const nameLower = entity.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (nameLower === baseName || nameLower.includes(baseName) || baseName.includes(nameLower)) {
        return true;
    }

    return false;
}
