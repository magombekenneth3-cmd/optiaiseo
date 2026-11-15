import { redis } from '@/lib/redis';

const inFlightRequests = new Map<string, Promise<unknown>>();

export interface CacheOptions<T> {
    ttlSeconds?: number;
    /** Optional predicate to skip caching sentinel values such as `'timeout'`. Defaults to caching all non-nullish values. */
    shouldCache?: (value: T | null) => boolean;
}

/**
 * Returns `true` when Redis is configured via environment variables or provided as
 * a test mock `{ get, set }`, and `false` for unconfigured Upstash placeholder clients.
 */
export function isAuditRedisUsable(): boolean {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        return true;
    }
    try {
        const client = redis as unknown as {
            get?: { mock?: unknown } | ((...args: unknown[]) => unknown);
            set?: { mock?: unknown } | ((...args: unknown[]) => unknown);
            pipeline?: unknown;
        } | null | undefined;
        if (!client || typeof client.get !== 'function' || typeof client.set !== 'function') {
            return false;
        }
        if ((client.get as { mock?: unknown }).mock || (client.set as { mock?: unknown }).mock) {
            return true;
        }
        // Unconfigured Upstash Redis instances / lazy Proxies expose `pipeline`; minimal test mocks do not.
        return typeof client.pipeline !== 'function';
    } catch {
        return false;
    }
}

/**
 * Coalesces concurrent requests in-process and caches results in Redis.
 * Gracefully degrades to executing `fetcher` directly if Redis is unavailable.
 */
export async function fetchWithRedisCache<T>(
    key: string,
    fetcher: () => Promise<T | null>,
    options: CacheOptions<T> | number = {},
): Promise<T | null> {
    const existing = inFlightRequests.get(key) as Promise<T | null> | undefined;
    if (existing) return existing;

    const ttlSeconds = typeof options === 'number' ? options : (options.ttlSeconds ?? 86400);
    const shouldCache =
        typeof options === 'number' || !options.shouldCache
            ? (v: T | null) => v !== null && v !== undefined
            : options.shouldCache;

    const promise = (async (): Promise<T | null> => {
        try {
            if (!isAuditRedisUsable()) {
                return await fetcher();
            }
            const cached = await redis.get(key);
            if (cached !== null && cached !== undefined) {
                const parsed = typeof cached === 'string' ? JSON.parse(cached) as T : (cached as T);
                if (shouldCache(parsed)) return parsed;
            }
            const result = await fetcher();
            if (shouldCache(result)) {
                await redis.set(key, JSON.stringify(result), { ex: ttlSeconds }).catch(() => null);
            }
            return result;
        } catch {
            return fetcher().catch(() => null);
        } finally {
            inFlightRequests.delete(key);
        }
    })();

    inFlightRequests.set(key, promise);
    return promise;
}
