import { prisma } from "@/lib/prisma";
import { logger, formatError } from "@/lib/logger";
import { pingGoogleIndexingApi } from "@/lib/gsc/indexing";
import { getIndexNowConfig } from "@/lib/indexnow-config";
import { getRedis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SubmissionStatus =
    | "SUCCESS"
    | "REJECTED"
    | "NETWORK_ERROR"
    | "TIMEOUT"
    | "NOT_CONFIGURED"
    | "QUOTA_EXHAUSTED";

export interface ProviderResult {
    provider: "GOOGLE" | "INDEXNOW";
    status: SubmissionStatus;
    message?: string;
}

export interface InstantIndexingResult {
    siteId: string;
    domain: string;
    urls: string[];
    google: ProviderResult;
    indexNow: ProviderResult;
    success: boolean;
    timestamp: Date;
}

// ---------------------------------------------------------------------------
// IndexNow payload type
// ---------------------------------------------------------------------------

export interface IndexNowPayload {
    host: string;
    key: string;
    keyLocation?: string;
    urlList: string[];
}

// ---------------------------------------------------------------------------
// IndexNow submission — uses per-site key from getIndexNowConfig
// ---------------------------------------------------------------------------

const INDEXNOW_TIMEOUT_MS = 5_000;

export async function submitIndexNow(
    siteId: string,
    urls: string[],
): Promise<ProviderResult> {
    const config = await getIndexNowConfig(siteId);

    if (!config) {
        logger.info("[InstantIndexing] IndexNow not configured for site", { siteId });
        return {
            provider: "INDEXNOW",
            status: "NOT_CONFIGURED",
            message: "IndexNow API key not configured for this site.",
        };
    }

    const cleanHost = config.host.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const formattedUrls = urls.map((u) => {
        if (u.startsWith("http://") || u.startsWith("https://")) return u;
        return `https://${cleanHost}${u.startsWith("/") ? u : "/" + u}`;
    });

    const payload: IndexNowPayload = {
        host: cleanHost,
        key: config.apiKey,
        keyLocation: `https://${cleanHost}/${config.apiKey}.txt`,
        urlList: formattedUrls,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INDEXNOW_TIMEOUT_MS);

    try {
        const res = await fetch("https://api.indexnow.org/indexnow", {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (res.ok || res.status === 202) {
            logger.info("[InstantIndexing] IndexNow accepted", {
                host: cleanHost,
                count: urls.length,
                status: res.status,
            });
            return { provider: "INDEXNOW", status: "SUCCESS" };
        }

        const text = await res.text().catch(() => "");
        logger.error("[InstantIndexing] IndexNow rejected", {
            host: cleanHost,
            status: res.status,
            body: text,
        });
        return {
            provider: "INDEXNOW",
            status: "REJECTED",
            message: `IndexNow returned ${res.status}`,
        };
    } catch (err: unknown) {
        clearTimeout(timeout);
        const error = err instanceof Error ? err : new Error(String(err));

        if (error.name === "AbortError") {
            logger.error("[InstantIndexing] IndexNow request timed out", { siteId });
            return {
                provider: "INDEXNOW",
                status: "TIMEOUT",
                message: "IndexNow request timed out.",
            };
        }

        logger.error("[InstantIndexing] IndexNow network error", {
            siteId,
            error: formatError(err),
        });
        return {
            provider: "INDEXNOW",
            status: "NETWORK_ERROR",
            message: error.message,
        };
    } finally {
        clearTimeout(timeout);
    }
}

// ---------------------------------------------------------------------------
// Google Indexing API — uses existing OAuth via pingGoogleIndexingApi
// ---------------------------------------------------------------------------

const GOOGLE_QUOTA_KEY_PREFIX = "indexing:google:quota:";
const GOOGLE_DAILY_LIMIT = 200;

export async function submitGoogleIndexingApi(
    siteId: string,
    urls: string[],
    userId: string,
): Promise<ProviderResult> {
    if (!userId) {
        return {
            provider: "GOOGLE",
            status: "NOT_CONFIGURED",
            message: "No user context for Google Indexing API authentication.",
        };
    }

    // Atomic quota enforcement via Upstash HTTP Redis
    const redis = getRedis();
    if (redis) {
        const today = new Date().toISOString().slice(0, 10);
        const quotaKey = `${GOOGLE_QUOTA_KEY_PREFIX}${today}`;

        try {
            const current = await redis.get<number>(quotaKey) ?? 0;
            const remaining = GOOGLE_DAILY_LIMIT - current;

            if (remaining <= 0) {
                logger.warn("[InstantIndexing] Daily Google quota exhausted", {
                    siteId,
                    total: urls.length,
                });
                return {
                    provider: "GOOGLE",
                    status: "QUOTA_EXHAUSTED",
                    message: "Daily Google Indexing API quota (200 URLs) reached.",
                };
            }

            // Reserve quota — cap to remaining
            const allowed = Math.min(urls.length, remaining);
            await redis.incrby(quotaKey, allowed);
            // Set TTL to 48h if not already set (belt-and-suspenders)
            await redis.expire(quotaKey, 172800);
            urls = urls.slice(0, allowed);
        } catch (err: unknown) {
            // Quota enforcement failed — do NOT silently skip.
            // Log the failure and continue with conservative behavior.
            logger.error("[InstantIndexing] Redis quota check failed — proceeding without quota enforcement", {
                siteId,
                error: formatError(err),
            });
        }
    } else {
        logger.warn("[InstantIndexing] Redis not configured — Google quota enforcement disabled", { siteId });
    }

    // Submit each URL via the existing authenticated Google Indexing API
    let succeeded = 0;
    let lastError: string | undefined;

    for (const url of urls) {
        const result = await pingGoogleIndexingApi(url, "URL_UPDATED", userId);
        if (result.success) {
            succeeded++;
        } else {
            lastError = result.message;
            logger.error("[InstantIndexing] Google Indexing API rejected URL", {
                url,
                code: result.code,
                message: result.message,
            });
            // If auth failed, stop — all subsequent calls will fail too
            if (result.code === "AUTH_FAILED" || result.code === "API_DISABLED") {
                return {
                    provider: "GOOGLE",
                    status: "NOT_CONFIGURED",
                    message: result.message,
                };
            }
        }

        // Throttle between requests
        if (urls.length > 1) {
            await new Promise((r) => setTimeout(r, 100));
        }
    }

    if (succeeded === 0 && urls.length > 0) {
        return {
            provider: "GOOGLE",
            status: "REJECTED",
            message: lastError ?? "All URLs rejected by Google Indexing API.",
        };
    }

    if (succeeded < urls.length) {
        logger.warn("[InstantIndexing] Google partial success", {
            siteId,
            succeeded,
            total: urls.length,
        });
    }

    logger.info("[InstantIndexing] Google Indexing API submission complete", {
        siteId,
        succeeded,
        total: urls.length,
    });

    return { provider: "GOOGLE", status: "SUCCESS" };
}

// ---------------------------------------------------------------------------
// Orchestrator — runs both providers independently
// ---------------------------------------------------------------------------

export async function triggerInstantIndexing(
    siteId: string,
    urls: string[],
    userId?: string,
): Promise<InstantIndexingResult> {
    const timestamp = new Date();

    // Look up domain — fail explicitly if not found
    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { domain: true, userId: true },
    });

    if (!site?.domain) {
        logger.error("[InstantIndexing] Site not found or has no domain", { siteId });
        return {
            siteId,
            domain: "",
            urls,
            google: { provider: "GOOGLE", status: "NOT_CONFIGURED", message: "Site not found." },
            indexNow: { provider: "INDEXNOW", status: "NOT_CONFIGURED", message: "Site not found." },
            success: false,
            timestamp,
        };
    }

    const effectiveUserId = userId ?? site.userId;

    // Run both providers independently — neither blocks the other
    const [google, indexNow] = await Promise.all([
        submitGoogleIndexingApi(siteId, urls, effectiveUserId),
        submitIndexNow(siteId, urls),
    ]);

    const success = google.status === "SUCCESS" || indexNow.status === "SUCCESS";

    logger.info("[InstantIndexing] Instant indexing pipeline completed", {
        siteId,
        domain: site.domain,
        urlsCount: urls.length,
        googleStatus: google.status,
        indexNowStatus: indexNow.status,
        overallSuccess: success,
    });

    return {
        siteId,
        domain: site.domain,
        urls,
        google,
        indexNow,
        success,
        timestamp,
    };
}
