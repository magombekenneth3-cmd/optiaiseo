import { logger, formatError } from "@/lib/logger";
import prisma from "@/lib/prisma";

const TOKEN_CACHE_PREFIX = "gsc:token:";
const TOKEN_CACHE_TTL_SECONDS = 3500;

async function getRedis() {
    try {
        const { redis } = await import("@/lib/redis");
        if (!redis) {
            logger.warn("[gsc-token] Redis client unavailable, cache disabled", {});
            return null;
        }
        return redis;
    } catch (err) {
        logger.error("[gsc-token] Redis import failed, cache disabled", { error: formatError(err) });
        return null;
    }
}

async function getCachedToken(userId: string): Promise<string | null> {
    const redis = await getRedis();
    if (!redis) return null;
    try {
        return await redis.get<string>(`${TOKEN_CACHE_PREFIX}${userId}`);
    } catch (err) {
        logger.warn("[gsc-token] Cache read failed", { userId, error: formatError(err) });
        return null;
    }
}

async function setCachedToken(userId: string, token: string): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;
    try {
        await redis.set(`${TOKEN_CACHE_PREFIX}${userId}`, token, { ex: TOKEN_CACHE_TTL_SECONDS });
    } catch (err) {
        logger.warn("[gsc-token] Cache write failed", { userId, error: formatError(err) });
    }
}

async function invalidateCachedToken(userId: string): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;
    try {
        await redis.del(`${TOKEN_CACHE_PREFIX}${userId}`);
    } catch (err) {
        logger.warn("[gsc-token] Cache invalidation failed", { userId, error: formatError(err) });
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

export async function getUserGscToken(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const cached = await getCachedToken(userId);
    if (cached) return cached;

    const acc = await prisma.account.findFirst({
        where: {
            userId,
            provider: { in: ["google-gsc", "google"] },
        },
        orderBy: [{ provider: "desc" }],
    });

    if (!acc?.access_token) {
        throw new Error("GSC_NOT_CONNECTED");
    }

    const isExpired = acc.expires_at && acc.expires_at < now + 60;

    if (!isExpired) {
        await setCachedToken(userId, acc.access_token);
        prisma.user.updateMany({
            where: { id: userId, gscConnected: false },
            data: { gscConnected: true },
        }).catch((err) => {
            logger.warn("[gsc-token] Failed to update gscConnected flag", { userId, error: formatError(err) });
        });
        return acc.access_token;
    }

    if (!acc.refresh_token) {
        throw new Error("GSC_REFRESH_TOKEN_MISSING");
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
        logger.error("[gsc-token] Token refresh failed", { userId, error: formatError(err) });

        await prisma.user.update({
            where: { id: userId },
            data: { gscConnected: false },
        }).catch((e) => {
            logger.warn("[gsc-token] Failed to update gscConnected flag after refresh failure", {
                userId,
                error: formatError(e),
            });
        });

        throw new Error("GSC_TOKEN_REFRESH_FAILED");
    }

    if (!credentials.access_token) {
        throw new Error("GSC_TOKEN_REFRESH_FAILED");
    }

    const newExpiresAt = credentials.expiry_date
        ? Math.floor(credentials.expiry_date / 1000)
        : now + 3600;

    // CRITICAL: persist the rotated refresh_token if Google returned a new one.
    // Google rotates refresh tokens in some circumstances (re-consent, suspicious activity).
    // If we don't write it back, the next refresh will fail with invalid_grant,
    // silently disconnecting the user's GSC integration.
    await prisma.account.update({
        where: { id: acc.id },
        data: {
            access_token: credentials.access_token,
            expires_at: newExpiresAt,
            // Only overwrite refresh_token if Google actually returned a new one —
            // null means "unchanged", not "revoked"
            ...(credentials.refresh_token
                ? { refresh_token: credentials.refresh_token }
                : {}),
        },
    });

    await setCachedToken(userId, credentials.access_token);

    logger.info("[gsc-token] Token refreshed and persisted", {
        userId,
        tokenRotated: !!credentials.refresh_token,
    });

    return credentials.access_token;
}

export async function checkGscConnected(userId: string): Promise<boolean> {
    const account = await prisma.account.findFirst({
        where: { userId, provider: "google-gsc" },
        select: { id: true },
    });
    return !!account;
}

export async function disconnectGsc(userId: string): Promise<void> {
    await invalidateCachedToken(userId);
    await prisma.account.deleteMany({
        where: { userId, provider: "google-gsc" },
    });
    await prisma.user.update({
        where: { id: userId },
        data: { gscConnected: false },
    });

    // Bust the Next.js unstable_cache entries for every site belonging to this
    // user so that a subsequent reconnect always fetches live GSC data.
    const sites = await prisma.site.findMany({
        where: { userId },
        select: { id: true },
    });
    const { revalidateTag } = await import("next/cache");
    for (const site of sites) {
        revalidateTag(`gsc-keywords-${site.id}`);
    }
}