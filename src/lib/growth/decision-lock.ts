import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const LOCK_TTL_SECONDS = 300; // 5 minutes

export async function acquireSyncLock(siteId: string): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true; // Fail open if Redis unavailable (no Redis instance)

    // Fail-closed: if the Redis command itself throws (connection drop, timeout),
    // propagate the error so the caller can abort execution safely.
    const key = `growth_sync_lock:${siteId}`;
    const acquired = await redis.set(key, "LOCKED", { nx: true, ex: LOCK_TTL_SECONDS });
    return !!acquired;
}

export async function releaseSyncLock(siteId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    try {
        await redis.del(`growth_sync_lock:${siteId}`);
    } catch { /* ignore */ }
}
