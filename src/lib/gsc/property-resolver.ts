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
 *
 * Bug #5 fix: Property cache is now scoped to `{userId}:{domain}` instead of
 * just `{domain}`. This prevents different users accessing the same domain
 * from sharing (and potentially corrupting) each other's cached resolution.
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
 * Builds a cache key scoped to the user AND domain.
 * Bug #5 fix: previously was `gsc:property:{domain}` (globally shared).
 */
function cacheKey(userId: string, domain: string): string {
    return `${CACHE_KEY_PREFIX}${userId}:${domain.toLowerCase()}`;
}

/**
 * Resolves which GSC property the authenticated user has that matches
 * the given domain.
 *
 * Strategy:
 * 1. Check Redis cache (1-day TTL, user-scoped)
 * 2. Fetch user's verified properties via fetchGSCSites()
 * 3. Match against candidates in priority order
 * 4. Fall back to fuzzy bare-domain match
 *
 * Returns the resolution with provenance, or null if no matching property
 * exists in the user's GSC account.
 *
 * @param userId - The user ID to scope the cache to.
 * @param token  - A valid GSC access token for the user.
 * @param domain - The site domain to resolve.
 */
export async function resolveGscProperty(
    userId: string,
    token: string,
    domain: string,
): Promise<GscPropertyResolution | null> {
    const key = cacheKey(userId, domain);

    // 1. Cache check
    const redisClient = await getRedis();
    if (redisClient) {
        try {
            const cached = await redisClient.get(key);
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
            // Cache the successful resolution (user-scoped)
            if (redisClient) {
                await redisClient.set(key, JSON.stringify(resolution), { ex: CACHE_TTL_SECONDS }).catch(() => null);
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
            await redisClient.set(key, JSON.stringify(resolution), { ex: CACHE_TTL_SECONDS }).catch(() => null);
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
 * @param userId - The user ID (for cache scoping).
 * @param token  - A valid GSC access token.
 * @param domain - The site domain to resolve.
 * @returns The verified property URL string.
 * @throws Error with message "GSC_PROPERTY_UNAUTHORIZED" if no matching
 *         property is found in the user's account.
 */
export async function getAuthorizedGscProperty(
    userId: string,
    token: string,
    domain: string,
): Promise<string> {
    // First try: the normalised URL may be correct without live resolution
    // (most common case — avoids an extra API call for the happy path)
    const normalised = normaliseSiteUrl(domain);

    const resolution = await resolveGscProperty(userId, token, domain);

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
 * Invalidate the cached property resolution for a specific user + domain.
 * Call this when the user reconnects GSC or changes their site domain.
 */
export async function invalidatePropertyCache(userId: string, domain: string): Promise<void> {
    const redisClient = await getRedis();
    if (redisClient) {
        await redisClient.del(cacheKey(userId, domain)).catch(() => null);
    }
}

/**
 * Invalidate ALL cached property resolutions for a user.
 * Called on reconnect/disconnect to ensure no stale cached property
 * resolutions survive across the user's sites.
 *
 * Bug #6 fix: OAuth reconnect path now calls this to ensure stale
 * property resolutions are flushed.
 */
export async function invalidatePropertyCacheForUser(userId: string): Promise<void> {
    const redisClient = await getRedis();
    if (!redisClient) return;

    // Fetch all user sites and invalidate each one's cache
    try {
        const { prisma } = await import("@/lib/prisma");
        const sites = await prisma.site.findMany({
            where: { userId },
            select: { domain: true },
        });
        await Promise.all(
            sites.map((s: { domain: string }) =>
                redisClient.del(cacheKey(userId, s.domain)).catch(() => null)
            )
        );
        logger.info("[PropertyResolver] Invalidated property cache for user", {
            userId,
            siteCount: sites.length,
        });
    } catch (err) {
        logger.warn("[PropertyResolver] Failed to invalidate user property cache", {
            userId,
            error: (err as Error)?.message,
        });
    }
}
