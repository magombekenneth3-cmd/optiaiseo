import { logger } from "@/lib/logger";
/**
 * src/lib/gsc/indexing.ts
 * Google Indexing API Integration
 */

import { getUserGscToken } from "@/lib/gsc/token";
import { normaliseSiteUrl } from "@/lib/gsc";

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

export type GoogleApiFailureCode =
    | "API_DISABLED"
    | "AUTH_FAILED"
    | "PERMISSION_DENIED"
    | "RATE_LIMITED"
    | "UNKNOWN";

export type GoogleApiFailureResult = {
    success: false;
    code: GoogleApiFailureCode;
    message: string;
    debug?: string;
};

export type IndexingResult =
    | { success: true; metadata?: IndexingApiResponse }
    | GoogleApiFailureResult;

type UrlInspectionApiResponse = {
    inspectionResult?: {
        inspectionResultLink?: string;
        indexStatusResult?: {
            verdict?: string;
            coverageState?: string;
            robotsTxtState?: string;
            indexingState?: string;
            lastCrawlTime?: string;
            pageFetchState?: string;
            googleCanonical?: string;
            userCanonical?: string;
            referringUrls?: string[];
            crawledAs?: string;
        };
        mobileUsabilityResult?: { verdict?: string };
        richResultsResult?: { verdict?: string };
    };
};

export interface GscUrlInspectionDetails {
    verdict?: string;
    coverageState?: string;
    robotsTxtState?: string;
    indexingState?: string;
    lastCrawlTime?: string;
    pageFetchState?: string;
    googleCanonical?: string;
    userCanonical?: string;
    referringUrls?: string[];
    crawledAs?: string;
    mobileUsabilityVerdict?: string;
    richResultsVerdict?: string;
    inspectionResultLink?: string;
    inspectedSiteUrl: string;
}

export type GscUrlInspectionResult =
    | { success: true; data: GscUrlInspectionDetails }
    | GoogleApiFailureResult;

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

async function getAccessTokenSafe(userId: string): Promise<string | GoogleApiFailureResult> {
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

function mapToGoogleApiFailure(
    error: {
        statusCode: number;
        status?: string;
        message: string;
    },
    apiName: "Indexing API" | "Search Console API" = "Indexing API"
): GoogleApiFailureResult {
    const { statusCode, status, message } = error;

    if (
        statusCode === 403 &&
        (status === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
            /insufficient.*scope|webmasters/i.test(message))
    ) {
        return {
            success: false,
            code: "PERMISSION_DENIED",
            message: "Missing Google Search Console permission (webmasters.readonly scope). Reconnect Google Search Console.",
            debug: message,
        };
    }

    if (
        statusCode === 403 &&
        status === "PERMISSION_DENIED" &&
        (message.includes("has not been used") || message.includes("is disabled"))
    ) {
        const projectMatch = message.match(/projects?\/(\d+)/i);
        const projectId = projectMatch ? projectMatch[1] : null;
        const apiSlug =
            apiName === "Search Console API"
                ? "searchconsole.googleapis.com"
                : "indexing.googleapis.com";
        const consoleUrl = projectId
            ? `https://console.developers.google.com/apis/api/${apiSlug}/overview?project=${projectId}`
            : `https://console.developers.google.com/apis/api/${apiSlug}`;
        return {
            success: false,
            code: "API_DISABLED",
            message: `Enable the Google ${apiName} for your Cloud project.`,
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
            message: `Too many requests to Google ${apiName}. Please try again later.`,
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

async function executeGoogleJsonWithRetry<TResponse, TResult extends { success: boolean }>(params: {
    logTag: string;
    apiName: "Indexing API" | "Search Console API";
    logMeta: Record<string, unknown>;
    requestFn: () => Promise<Response>;
    mapSuccess: (data: TResponse | undefined) => TResult;
}): Promise<TResult | GoogleApiFailureResult> {
    const { logTag, apiName, logMeta, requestFn, mapSuccess } = params;
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            logger.debug(logTag, { event: "retrying", ...logMeta, attempt });
            await jitteredDelay(INDEXING_API_RETRY_DELAY_MS);
        }

        try {
            const res = await requestFn();

            if (isNonRetryableStatus(res.status)) {
                const parsedError = await parseGoogleError(res);
                const durationMs = Date.now() - startTime;
                logger.error(logTag, {
                    event: "request_failed",
                    ...logMeta,
                    statusCode: parsedError.statusCode,
                    message: parsedError.message,
                    durationMs,
                });
                return mapToGoogleApiFailure(parsedError, apiName);
            }

            if (isRetryableStatus(res.status)) {
                const parsedError = await parseGoogleError(res);
                const durationMs = Date.now() - startTime;
                logger.error(logTag, {
                    event: "server_error",
                    ...logMeta,
                    statusCode: parsedError.statusCode,
                    attempt,
                    durationMs,
                });

                if (attempt === MAX_RETRIES) {
                    return mapToGoogleApiFailure(parsedError, apiName);
                }

                lastError = new Error(parsedError.message);
                continue;
            }

            let data: TResponse | undefined;
            try { data = await res.json() as TResponse; } catch { data = undefined; }

            const durationMs = Date.now() - startTime;
            logger.debug(logTag, { event: "request_success", ...logMeta, durationMs });
            return mapSuccess(data);

        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));

            if (error.name === "AbortError") {
                const durationMs = Date.now() - startTime;
                logger.error(logTag, { event: "request_timeout", ...logMeta, durationMs });
                return {
                    success: false,
                    code: "UNKNOWN",
                    message: `Request to Google ${apiName} timed out.`,
                    debug: error.message,
                };
            }

            const isNetworkError = err instanceof TypeError;
            if (!isNetworkError || attempt === MAX_RETRIES) {
                const durationMs = Date.now() - startTime;
                logger.error(logTag, { event: "request_error", ...logMeta, error: error.message, durationMs });
                return {
                    success: false,
                    code: "UNKNOWN",
                    message: `Unexpected error contacting Google ${apiName}.`,
                    debug: error.message,
                };
            }

            lastError = error;
        }
    }

    const durationMs = Date.now() - startTime;
    logger.error(logTag, { event: "request_error", ...logMeta, error: lastError?.message, durationMs });
    return {
        success: false,
        code: "UNKNOWN",
        message: `Unexpected error contacting Google ${apiName}.`,
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

    return executeGoogleJsonWithRetry<IndexingApiResponse, IndexingResult>({
        logTag: "[Indexing API]",
        apiName: "Indexing API",
        logMeta: { requestId, url, type },
        requestFn: () => callIndexingApi(url, type, tokenResult, timeoutMs),
        mapSuccess: (data) => ({ success: true, metadata: data }),
    });
}

async function callUrlInspectionApi(
    inspectionUrl: string,
    siteUrl: string,
    accessToken: string,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                inspectionUrl,
                siteUrl,
                languageCode: "en-US",
            }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

function buildUrlInspectionCandidates(siteDomainOrProperty: string): string[] {
    const trimmed = siteDomainOrProperty.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("sc-domain:")) {
        return [trimmed];
    }

    const primary = normaliseSiteUrl(trimmed);
    const cleanHost = trimmed
        .replace(/^https?:\/\//i, "")
        .replace(/[/?#].*$/, "")
        .replace(/^www\./i, "")
        .trim();

    if (!cleanHost) return [primary];
    return Array.from(new Set([primary, `sc-domain:${cleanHost}`]));
}

/**
 * Inspects a live URL via Google Search Console URL Inspection API v1.
 * Gracefully handles missing `webmasters.readonly` scope (`403`) without throwing.
 */
export async function inspectGscUrl(
    userId: string,
    siteDomainOrProperty: string,
    inspectionUrl: string,
    options?: { timeoutMs?: number; requestId?: string }
): Promise<GscUrlInspectionResult> {
    if (!isValidUrl(inspectionUrl)) {
        return { success: false, code: "UNKNOWN", message: "Invalid URL. Must be a valid http or https address." };
    }

    const tokenResult = await getAccessTokenSafe(userId);
    if (typeof tokenResult !== "string") return tokenResult;

    const timeoutMs = options?.timeoutMs ?? INDEXING_API_TIMEOUT_MS;
    const requestId = options?.requestId;
    const siteUrlCandidates = buildUrlInspectionCandidates(siteDomainOrProperty);

    if (siteUrlCandidates.length === 0) {
        return { success: false, code: "UNKNOWN", message: "Site domain or Search Console property is required." };
    }

    let lastFailure: GoogleApiFailureResult | null = null;

    for (const candidateSiteUrl of siteUrlCandidates) {
        const result = await executeGoogleJsonWithRetry<UrlInspectionApiResponse, GscUrlInspectionResult>({
            logTag: "[GSC URL Inspection]",
            apiName: "Search Console API",
            logMeta: { requestId, inspectionUrl, siteUrl: candidateSiteUrl },
            requestFn: () => callUrlInspectionApi(inspectionUrl, candidateSiteUrl, tokenResult, timeoutMs),
            mapSuccess: (data) => {
                const idx = data?.inspectionResult?.indexStatusResult;
                return {
                    success: true,
                    data: {
                        verdict: idx?.verdict,
                        coverageState: idx?.coverageState,
                        robotsTxtState: idx?.robotsTxtState,
                        indexingState: idx?.indexingState,
                        lastCrawlTime: idx?.lastCrawlTime,
                        pageFetchState: idx?.pageFetchState,
                        googleCanonical: idx?.googleCanonical,
                        userCanonical: idx?.userCanonical,
                        referringUrls: idx?.referringUrls,
                        crawledAs: idx?.crawledAs,
                        mobileUsabilityVerdict: data?.inspectionResult?.mobileUsabilityResult?.verdict,
                        richResultsVerdict: data?.inspectionResult?.richResultsResult?.verdict,
                        inspectionResultLink: data?.inspectionResult?.inspectionResultLink,
                        inspectedSiteUrl: candidateSiteUrl,
                    },
                };
            },
        });

        if (result.success) {
            return result;
        }

        lastFailure = result;

        // If OAuth scope itself is missing, retrying another property prefix cannot help
        if (result.code === "PERMISSION_DENIED" && /webmasters\.readonly|scope/i.test(result.message)) {
            return result;
        }

        // Only try sc-domain: fallback if the URL-prefix property wasn't owned
        if (result.code !== "PERMISSION_DENIED") {
            return result;
        }
    }

    return lastFailure ?? {
        success: false,
        code: "UNKNOWN",
        message: "Failed to inspect URL in Google Search Console.",
    };
}