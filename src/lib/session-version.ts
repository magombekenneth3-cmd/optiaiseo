import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { jwtCacheKey } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function bumpSessionVersion(userId: string): Promise<void> {
    const userRecord = await prisma.user
        .findUnique({
            where: { id: userId },
            select: { email: true, preferences: true },
        })
        .catch(() => null);

    const existing =
        userRecord?.preferences !== null &&
        typeof userRecord?.preferences === "object" &&
        !Array.isArray(userRecord?.preferences)
            ? (userRecord.preferences as Record<string, unknown>)
            : {};

    const updated = await prisma.user
        .update({
            where: { id: userId },
            data: { preferences: { ...existing, sessionVersion: Date.now() } },
            select: { email: true },
        })
        .catch((err: unknown) => {
            logger.warn("[Auth] Failed to bump sessionVersion", {
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        });

    const email = updated?.email ?? userRecord?.email;
    if (email) {
        await redis.del(jwtCacheKey(email)).catch(() => {});
    }
}
