/**
 * Centralized GSC property resolution.
 *
 * Replaces duplicated property-discovery logic previously scattered across
 * crawler.ts and keywords.ts. Every GSC API consumer should resolve the
 * property through this module rather than using normaliseSiteUrl() directly.
 *
 * normaliseSiteUrl() remains as a string-formatting primitive. This module
 * uses it as the first resolution candidate, then falls back to live property
 * discovery via fetchGSCSites() if the initial guess doesn't match any
 * verified property.
 */

import { logger } from "@/lib/logger";
import { fetchGSCSites, normaliseSiteUrl } from "@/lib/gsc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redis: any = null;

async function getRedis() {
    if (redis !== null) return redis;
    try {
        const mod = await import("@/lib/redis");
        redis = (mod as Record<string, unknown>).redis ?? null;
    } catch {
        redis = null;
    }
    return redis;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GscPropertyResolution {
    /** The GSC property URL to use in API requests. */
    property: string;
    /** How the property was matched to the domain. */
    matchedBy:
        | "EXACT_URL"       // normaliseSiteUrl() matched directly
        | "DOMAIN_PROPERTY" // sc-domain:{bare}
        | "WWW_VARIANT"     // https://www.{bare}/
        | "BARE_DOMAIN";    // Fuzzy match on bare domain string
    /** ISO timestamp of when the resolution was performed. */
    verifiedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build candidate GSC property URLs for a domain, in priority order.
 * Mirrors Google's property formats: URL prefix and Domain properties.
 */
function gscUrlCandidates(domain: string): { url: string; matchedBy: GscPropertyResolution["matchedBy"] }[] {
    const clean = domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "");

    return [
        { url: `https://www.${clean}/`, matchedBy: "WWW_VARIANT" },
        { url: `https://${clean}/`, matchedBy: "EXACT_URL" },
        { url: `sc-domain:${clean}`, matchedBy: "DOMAIN_PROPERTY" },
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Core resolution
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = "gsc:property:";
const CACHE_TTL_SECONDS = 86_400; // 1 day

/**
 * Resolves which GSC property the authenticated user has that matches
 * the given domain.
 *
 * Strategy:
 * 1. Check Redis cache (1-day TTL)
 * 2. Fetch user's verified properties via fetchGSCSites()
 * 3. Match against candidates in priority order
 * 4. Fall back to fuzzy bare-domain match
 *
 * Returns the resolution with provenance, or null if no matching property
 * exists in the user's GSC account.
 */
export async function resolveGscProperty(
    token: string,
    domain: string,
): Promise<GscPropertyResolution | null> {
    const cacheKey = `${CACHE_KEY_PREFIX}${domain}`;

    // 1. Cache check
    const redisClient = await getRedis();
    if (redisClient) {
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                try {
                    return JSON.parse(cached) as GscPropertyResolution;
                } catch {
                    // Malformed cache entry — proceed to live resolution
                }
            }
        } catch {
            // Redis unavailable — non-fatal
        }
    }

    // 2. Live resolution
    let sites: string[];
    try {
        sites = await fetchGSCSites(token);
    } catch (err) {
        logger.warn("[PropertyResolver] fetchGSCSites failed", {
            domain,
            error: (err as Error)?.message,
        });
        return null;
    }

    if (sites.length === 0) {
        return null;
    }

    // 3. Priority candidate matching
    const candidates = gscUrlCandidates(domain);
    for (const candidate of candidates) {
        if (sites.some((s) => s.toLowerCase() === candidate.url.toLowerCase())) {
            const resolution: GscPropertyResolution = {
                property: candidate.url,
                matchedBy: candidate.matchedBy,
                verifiedAt: new Date().toISOString(),
            };
            // Cache the successful resolution
            if (redisClient) {
                await redisClient.set(cacheKey, JSON.stringify(resolution), { ex: CACHE_TTL_SECONDS }).catch(() => null);
            }
            return resolution;
        }
    }

    // 4. Fuzzy bare-domain fallback
    const bare = domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "");

    const fuzzyMatch = sites.find((s) => s.includes(bare));
    if (fuzzyMatch) {
        const resolution: GscPropertyResolution = {
            property: fuzzyMatch,
            matchedBy: "BARE_DOMAIN",
            verifiedAt: new Date().toISOString(),
        };
        if (redisClient) {
            await redisClient.set(cacheKey, JSON.stringify(resolution), { ex: CACHE_TTL_SECONDS }).catch(() => null);
        }
        return resolution;
    }

    return null;
}

/**
 * Get the authorized GSC property URL for API requests.
 *
 * This is the primary entry point for GSC consumers. It resolves the
 * property up front rather than attempting an API call and recovering
 * from 403.
 *
 * @returns The verified property URL string.
 * @throws Error with message "GSC_PROPERTY_UNAUTHORIZED" if no matching
 *         property is found in the user's account.
 */
export async function getAuthorizedGscProperty(
    token: string,
    domain: string,
): Promise<string> {
    // First try: the normalised URL may be correct without live resolution
    // (most common case — avoids an extra API call for the happy path)
    const normalised = normaliseSiteUrl(domain);

    const resolution = await resolveGscProperty(token, domain);

    if (resolution) {
        logger.info("[PropertyResolver] Resolved GSC property", {
            domain,
            property: resolution.property,
            matchedBy: resolution.matchedBy,
        });
        return resolution.property;
    }

    // No matching property found — throw typed error
    logger.warn("[PropertyResolver] No matching GSC property found for domain", {
        domain,
        tried: normalised,
    });
    throw new Error(
        "GSC_PROPERTY_UNAUTHORIZED: No verified GSC property found for this domain. " +
        "Add and verify your property at search.google.com/search-console then reconnect."
    );
}

/**
 * Invalidate the cached property resolution for a domain.
 * Call this when the user reconnects GSC or changes their site domain.
 */
export async function invalidatePropertyCache(domain: string): Promise<void> {
    const redisClient = await getRedis();
    if (redisClient) {
        await redisClient.del(`${CACHE_KEY_PREFIX}${domain}`).catch(() => null);
    }
}
