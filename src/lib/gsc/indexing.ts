import { logger } from "@/lib/logger";
/**
 * src/lib/gsc/indexing.ts
 * Google Indexing API Integration
 */

import { getUserGscToken } from "@/lib/gsc/token";

export type IndexingType = "URL_UPDATED" | "URL_DELETED";

type GoogleErrorBody = {
    error?: {
        status?: string;
        message?: string;
    };
};

type IndexingApiResponse = {
    urlNotificationMetadata?: {
        url?: string;
        latestUpdate?: {
            type?: string;
            notifyTime?: string;
        };
    };
};

export type IndexingResult =
    | { success: true; metadata?: IndexingApiResponse }
    | {
        success: false;
        code: "API_DISABLED" | "AUTH_FAILED" | "PERMISSION_DENIED" | "RATE_LIMITED" | "UNKNOWN";
        message: string;
        debug?: string;
    };

const INDEXING_API_TIMEOUT_MS = 8_000;
const INDEXING_API_RETRY_DELAY_MS = 500;
const MAX_RETRIES = 1;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function jitteredDelay(baseMs: number): Promise<void> {
    return sleep(baseMs + Math.random() * 100);
}

function isValidUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function isRetryableStatus(status: number): boolean {
    return status >= 500;
}

function isNonRetryableStatus(status: number): boolean {
    return status === 400 || status === 401 || status === 403 || status === 429;
}

async function getAccessTokenSafe(userId: string): Promise<string | IndexingResult> {
    try {
        return await getUserGscToken(userId);
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        const msg = err.message;
        if (msg === "GSC_NOT_CONNECTED" || msg === "GSC_REFRESH_TOKEN_MISSING") {
            return { success: false, code: "AUTH_FAILED", message: "Connect Google Search Console to enable indexing." };
        }
        return {
            success: false,
            code: "AUTH_FAILED",
            message: "Could not acquire a Google access token.",
            debug: msg,
        };
    }
}

async function callIndexingApi(
    url: string,
    type: IndexingType,
    accessToken: string,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ url, type }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function parseGoogleError(res: Response): Promise<{
    statusCode: number;
    status?: string;
    message: string;
}> {
    const text = await res.text();
    let body: GoogleErrorBody = {};
    try { body = JSON.parse(text); } catch { /* non-JSON body */ }
    return {
        statusCode: res.status,
        status: body.error?.status,
        message: body.error?.message ?? text,
    };
}

function mapToIndexingResult(error: {
    statusCode: number;
    status?: string;
    message: string;
}): IndexingResult {
    const { statusCode, status, message } = error;

    if (
        statusCode === 403 &&
        status === "PERMISSION_DENIED" &&
        (message.includes("has not been used") || message.includes("is disabled"))
    ) {
        const projectMatch = message.match(/projects?\/(\d+)/i);
        const projectId = projectMatch ? projectMatch[1] : null;
        const consoleUrl = projectId
            ? `https://console.developers.google.com/apis/api/indexing.googleapis.com/overview?project=${projectId}`
            : "https://console.developers.google.com/apis/api/indexing.googleapis.com";
        return {
            success: false,
            code: "API_DISABLED",
            message: "Enable the Google Indexing API for your Cloud project.",
            debug: consoleUrl,
        };
    }

    if (statusCode === 403) {
        return {
            success: false,
            code: "PERMISSION_DENIED",
            message: "Permission denied. Make sure you are a verified owner of this site in Google Search Console.",
            debug: message,
        };
    }

    if (statusCode === 429) {
        return {
            success: false,
            code: "RATE_LIMITED",
            message: "Too many requests to Google Indexing API. Please try again later.",
            debug: message,
        };
    }

    if (statusCode >= 500) {
        return {
            success: false,
            code: "UNKNOWN",
            message: "Google API temporarily unavailable. Try again.",
            debug: message,
        };
    }

    return {
        success: false,
        code: "UNKNOWN",
        message: `Google API error (${statusCode}): ${message}`,
        debug: message,
    };
}

async function executeWithRetry(
    url: string,
    type: IndexingType,
    accessToken: string,
    timeoutMs: number,
    requestId: string | undefined
): Promise<IndexingResult> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            logger.debug("[Indexing API]", { event: "retrying", requestId, url, type, attempt });
            await jitteredDelay(INDEXING_API_RETRY_DELAY_MS);
        }

        try {
            const res = await callIndexingApi(url, type, accessToken, timeoutMs);

            if (isNonRetryableStatus(res.status)) {
                const parsedError = await parseGoogleError(res);
                const durationMs = Date.now() - startTime;
                logger.error("[Indexing API]", {
                    event: "request_failed",
                    requestId,
                    url,
                    type,
                    statusCode: parsedError.statusCode,
                    message: parsedError.message,
                    durationMs,
                });
                return mapToIndexingResult(parsedError);
            }

            if (isRetryableStatus(res.status)) {
                const parsedError = await parseGoogleError(res);
                const durationMs = Date.now() - startTime;
                logger.error("[Indexing API]", {
                    event: "server_error",
                    requestId,
                    url,
                    type,
                    statusCode: parsedError.statusCode,
                    attempt,
                    durationMs,
                });

                if (attempt === MAX_RETRIES) {
                    return mapToIndexingResult(parsedError);
                }

                lastError = new Error(parsedError.message);
                continue;
            }

            let data: IndexingApiResponse | undefined;
            try { data = await res.json() as IndexingApiResponse; } catch { data = undefined; }

            const durationMs = Date.now() - startTime;
            logger.debug("[Indexing API]", { event: "request_success", requestId, url, type, notified: true, durationMs });
            return { success: true, metadata: data };

        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));

            if (error.name === "AbortError") {
                const durationMs = Date.now() - startTime;
                logger.error("[Indexing API]", { event: "request_timeout", requestId, url, type, durationMs });
                return {
                    success: false,
                    code: "UNKNOWN",
                    message: "Request to Google Indexing API timed out.",
                    debug: error.message,
                };
            }

            const isNetworkError = err instanceof TypeError;
            if (!isNetworkError) {
                const durationMs = Date.now() - startTime;
                logger.error("[Indexing API]", { event: "request_error", requestId, url, type, error: error.message, durationMs });
                return {
                    success: false,
                    code: "UNKNOWN",
                    message: "Unexpected error contacting Google Indexing API.",
                    debug: error.message,
                };
            }

            lastError = error;

            if (attempt === MAX_RETRIES) {
                const durationMs = Date.now() - startTime;
                logger.error("[Indexing API]", { event: "request_error", requestId, url, type, error: error.message, durationMs });
                return {
                    success: false,
                    code: "UNKNOWN",
                    message: "Unexpected error contacting Google Indexing API.",
                    debug: error.message,
                };
            }
        }
    }

    const durationMs = Date.now() - startTime;
    logger.error("[Indexing API]", { event: "request_error", requestId, url, type, error: lastError?.message, durationMs });
    return {
        success: false,
        code: "UNKNOWN",
        message: "Unexpected error contacting Google Indexing API.",
        debug: lastError?.message,
    };
}

export async function pingGoogleIndexingApi(
    url: string,
    type: IndexingType = "URL_UPDATED",
    userId: string,
    options?: { timeoutMs?: number; requestId?: string }
): Promise<IndexingResult> {
    if (!isValidUrl(url)) {
        return { success: false, code: "UNKNOWN", message: "Invalid URL. Must be a valid http or https address." };
    }

    const tokenResult = await getAccessTokenSafe(userId);
    if (typeof tokenResult !== "string") return tokenResult;

    const timeoutMs = options?.timeoutMs ?? INDEXING_API_TIMEOUT_MS;
    const requestId = options?.requestId;

    return executeWithRetry(url, type, tokenResult, timeoutMs, requestId);
}