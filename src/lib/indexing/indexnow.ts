import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface IndexNowPayload {
    host: string;
    key: string;
    keyLocation?: string;
    urlList: string[];
}

export interface InstantIndexingResult {
    siteId: string;
    domain: string;
    urls: string[];
    indexNowSuccess: boolean;
    googleIndexingSuccess: boolean;
    timestamp: Date;
}

export async function submitIndexNow(
    siteHost: string,
    urls: string[],
    apiKey: string = "aiseo-indexnow-key"
): Promise<boolean> {
    try {
        const cleanHost = siteHost.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        const formattedUrls = urls.map(u => {
            if (u.startsWith("http://") || u.startsWith("https://")) return u;
            return `https://${cleanHost}${u.startsWith("/") ? u : "/" + u}`;
        });

        const payload: IndexNowPayload = {
            host: cleanHost,
            key: apiKey,
            keyLocation: `https://${cleanHost}/${apiKey}.txt`,
            urlList: formattedUrls,
        };

        const res = await fetch("https://api.indexnow.org/indexnow", {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000)
        });

        const ok = res.ok || res.status === 200 || res.status === 202;
        logger.info("[InstantIndexing] Submitted IndexNow request", { host: cleanHost, count: urls.length, status: res.status });
        return ok;
    } catch (err: unknown) {
        logger.warn("[InstantIndexing] IndexNow submission offline / failed", { siteHost, error: (err as Error)?.message || String(err) });
        return true; // Fail open
    }
}

import { reserveGoogleQuotaAtomic } from "./indexnow-lua";
import Redis from "ioredis";

let redisInstance: Redis | null = null;
function getRedisClient(): Redis | null {
    if (redisInstance) return redisInstance;
    if (!process.env.REDIS_URL) return null;
    try {
        redisInstance = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
        return redisInstance;
    } catch {
        return null;
    }
}

export async function submitGoogleIndexingApi(
    urls: string[]
): Promise<boolean> {
    try {
        const apiKey = process.env.GOOGLE_INDEXING_API_KEY;
        if (!apiKey) {
            logger.info("[InstantIndexing] Google Indexing API key omitted — skipped");
            return true;
        }

        // Atomic Lua Quota Reservation (max 200 URLs/day)
        const redis = getRedisClient();
        let allowedUrls = urls;
        if (redis) {
            const today = new Date().toISOString().slice(0, 10);
            const quotaKey = `indexing:google:quota:${today}`;
            const reserved = await reserveGoogleQuotaAtomic(redis, quotaKey, 200, urls.length);
            if (reserved === 0) {
                logger.warn("[InstantIndexing] Daily Google quota exhausted. Deferring all URLs.", { total: urls.length });
                return false;
            }
            allowedUrls = urls.slice(0, reserved);
        }

        // Chunk URLs into max 10 URLs per payload
        const CHUNK_SIZE = 10;
        for (let i = 0; i < allowedUrls.length; i += CHUNK_SIZE) {
            const chunk = allowedUrls.slice(i, i + CHUNK_SIZE);
            if (i > 0) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            for (const url of chunk) {
                await fetch(`https://indexing.googleapis.com/v13/urlNotifications:publish?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        url,
                        type: "URL_UPDATED"
                    }),
                    signal: AbortSignal.timeout(4000)
                }).catch(() => {});
            }
        }
        return true;
    } catch {
        return true; // Fail open
    }
}


export async function triggerInstantIndexing(
    siteId: string,
    urls: string[]
): Promise<InstantIndexingResult> {
    const timestamp = new Date();
    let domain = "optiaiseo.com";

    try {
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { domain: true }
        });
        if (site?.domain) domain = site.domain;
    } catch { /* Fallback */ }

    const [indexNowSuccess, googleIndexingSuccess] = await Promise.all([
        submitIndexNow(domain, urls),
        submitGoogleIndexingApi(urls)
    ]);

    logger.info("[InstantIndexing] Instant indexing pipeline completed", {
        siteId,
        domain,
        urlsCount: urls.length
    });

    return {
        siteId,
        domain,
        urls,
        indexNowSuccess,
        googleIndexingSuccess,
        timestamp
    };
}
