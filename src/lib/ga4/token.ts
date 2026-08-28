import { logger, formatError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const TOKEN_CACHE_PREFIX = "ga4:token:";
const TOKEN_CACHE_TTL_SECONDS = 3500;
const REFRESH_COOLDOWN_PREFIX = "ga4:refresh_failed:";
const REFRESH_COOLDOWN_TTL_SECONDS = 300; // 5 minutes

async function getRedis() {
    try {
        const { redis } = await import("@/lib/redis");
        if (!redis) {
            logger.warn("[ga4-token] Redis client unavailable, cache disabled", {});
            return null;
        }
        return redis;
    } catch (err) {
        logger.error("[ga4-token] Redis import failed, cache disabled", { error: formatError(err) });
        return null;
    }
}

async function getCachedToken(userId: string): Promise<string | null> {
    const redis = await getRedis();
    if (!redis) return null;
    try {
        return await redis.get<string>(`${TOKEN_CACHE_PREFIX}${userId}`);
    } catch (err) {
        logger.warn("[ga4-token] Cache read failed", { userId, error: formatError(err) });
        return null;
    }
}

async function setCachedToken(userId: string, token: string): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;
    try {
        await redis.set(`${TOKEN_CACHE_PREFIX}${userId}`, token, { ex: TOKEN_CACHE_TTL_SECONDS });
    } catch (err) {
        logger.warn("[ga4-token] Cache write failed", { userId, error: formatError(err) });
    }
}

export async function invalidateGa4CachedToken(userId: string): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;
    try {
        await redis.del(`${TOKEN_CACHE_PREFIX}${userId}`);
    } catch (err) {
        logger.warn("[ga4-token] Cache invalidation failed", { userId, error: formatError(err) });
    }
}

function getOAuthCredentials(): { clientId: string; clientSecret: string } {
    const clientId = process.env.GOOGLE_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error(
            "Missing GOOGLE_ID/GOOGLE_CLIENT_ID or GOOGLE_SECRET/GOOGLE_CLIENT_SECRET."
        );
    }

    return { clientId, clientSecret };
}

/**
 * Retrieves a valid GA4 access token for the given user.
 *
 * Resolution order:
 * 1. Redis cache (`ga4:token:{userId}`)
 * 2. Dedicated `google-ga4` Account row
 * 3. Legacy fallback: `google-gsc` Account IF its scope includes `analytics.readonly`
 *
 * The legacy fallback ensures existing users who connected GSC with the combined
 * scope can still access GA4 data until they perform the separate GA4 connect.
 */
export async function getUserGa4Token(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const cached = await getCachedToken(userId);
    if (cached) return cached;

    // Primary: dedicated google-ga4 Account
    let acc = await prisma.account.findFirst({
        where: {
            userId,
            provider: "google-ga4",
        },
    });

    // Legacy fallback: google-gsc Account with analytics.readonly scope
    if (!acc) {
        acc = await prisma.account.findFirst({
            where: {
                userId,
                provider: { in: ["google-gsc", "google"] },
            },
            orderBy: [{ provider: "desc" }],
        });

        // Only use the legacy account if it actually has analytics scope
        if (acc && !acc.scope?.includes("analytics.readonly")) {
            acc = null;
        }
    }

    if (!acc?.access_token) {
        throw new Error("GA4_NOT_CONNECTED");
    }

    const isExpired = acc.expires_at && acc.expires_at < now + 60;

    if (!isExpired) {
        await setCachedToken(userId, acc.access_token);
        return acc.access_token;
    }

    if (!acc.refresh_token) {
        throw new Error("GA4_REFRESH_TOKEN_MISSING");
    }

    // Check refresh cooldown — prevent infinite refresh loops when
    // credentials are permanently revoked.
    const redisClient = await getRedis();
    if (redisClient) {
        try {
            const cooldownKey = `${REFRESH_COOLDOWN_PREFIX}${userId}`;
            const cooldown = await redisClient.get<string>(cooldownKey);
            if (cooldown) {
                throw new Error("GA4_REAUTHORIZATION_REQUIRED");
            }
        } catch (err) {
            // Re-throw our own error; swallow Redis failures
            if ((err as Error)?.message === "GA4_REAUTHORIZATION_REQUIRED") throw err;
        }
    }

    const { google } = await import("googleapis");
    const { clientId, clientSecret } = getOAuthCredentials();

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: acc.refresh_token });

    let credentials;
    try {
        const result = await oauth2Client.refreshAccessToken();
        credentials = result.credentials;
    } catch (err: unknown) {
        logger.error("[ga4-token] Token refresh failed", { userId, error: formatError(err) });

        // Set cooldown to prevent infinite refresh loops
        if (redisClient) {
            try {
                await redisClient.set(
                    `${REFRESH_COOLDOWN_PREFIX}${userId}`,
                    "1",
                    { ex: REFRESH_COOLDOWN_TTL_SECONDS },
                );
            } catch {
                // Non-fatal — cooldown is best-effort
            }
        }

        throw new Error("GA4_TOKEN_REFRESH_FAILED");
    }

    if (!credentials.access_token) {
        throw new Error("GA4_TOKEN_REFRESH_FAILED");
    }

    const newExpiresAt = credentials.expiry_date
        ? Math.floor(credentials.expiry_date / 1000)
        : now + 3600;

    // Persist the rotated refresh_token if Google returned a new one.
    await prisma.account.update({
        where: { id: acc.id },
        data: {
            access_token: credentials.access_token,
            expires_at: newExpiresAt,
            ...(credentials.refresh_token
                ? { refresh_token: credentials.refresh_token }
                : {}),
        },
    });

    await setCachedToken(userId, credentials.access_token);

    logger.info("[ga4-token] Token refreshed and persisted", {
        userId,
        provider: acc.provider,
        tokenRotated: !!credentials.refresh_token,
    });

    return credentials.access_token;
}
