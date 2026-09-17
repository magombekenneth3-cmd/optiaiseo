/**
 * Shared DataForSEO client — credentials, timeout handling, envelope
 * validation, and a lightweight Redis-backed circuit breaker.
 */

import { logger } from "@/lib/logger";

const LOGIN = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;

const CB_THRESHOLD = Number(process.env.DATAFORSEO_CB_THRESHOLD ?? 3);
const CB_RESET_MS = Number(process.env.DATAFORSEO_CB_RESET_MS ?? 120_000);
const TIMEOUT_MS = Number(process.env.DATAFORSEO_TIMEOUT_MS ?? 15_000);

const CB_KEY = "cb:dataforseo:state";
const CB_FAIL_KEY = "cb:dataforseo:failures";
const CB_OPEN_AT = "cb:dataforseo:openedAt";

export function isConfigured(): boolean {
    return Boolean(LOGIN && PASSWORD);
}

export function getAuthHeader(): string {
    if (!isConfigured()) {
        throw new Error("DataForSEO credentials are not configured.");
    }
    return "Basic " + Buffer.from(String(LOGIN) + ":" + String(PASSWORD)).toString("base64");
}

async function getRedis() {
    try {
        const { redis } = await import("@/lib/redis");
        return redis;
    } catch {
        return null;
    }
}

async function isCircuitOpen(): Promise<boolean> {
    const redis = await getRedis();
    if (!redis) return false;

    try {
        const state = await redis.get<string>(CB_KEY);
        if (state !== "OPEN") return false;

        const openedAt = await redis.get<number>(CB_OPEN_AT);
        if (openedAt && Date.now() - openedAt >= CB_RESET_MS) {
            await redis.del(CB_KEY).catch(() => null);
            logger.info("[DataForSEO/CB] Cool-down elapsed — allowing a probe request");
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

async function recordFailure(): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;

    try {
        const failures = await redis.incr(CB_FAIL_KEY);
        await redis.expire(CB_FAIL_KEY, Math.ceil(CB_RESET_MS / 1000) * 2);
        if (failures >= CB_THRESHOLD) {
            await redis.set(CB_KEY, "OPEN");
            await redis.set(CB_OPEN_AT, Date.now());
            logger.warn("[DataForSEO/CB] Circuit opened after consecutive failures", { failures });
        }
    } catch {
        // A circuit breaker must never make a provider error worse.
    }
}

async function recordSuccess(): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;

    try {
        await redis.del(CB_KEY);
        await redis.del(CB_FAIL_KEY);
        await redis.del(CB_OPEN_AT);
    } catch {
        // Non-fatal.
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/**
 * DataForSEO reports task errors in a JSON body with HTTP 200. Treat those as
 * failures so callers do not mistake an API error for an empty backlink set.
 */
function responseError(payload: unknown): string | null {
    const root = asRecord(payload);
    if (!root) return "DataForSEO returned a malformed JSON response.";

    if (typeof root.status_code === "number" && root.status_code !== 20000) {
        return "DataForSEO request failed: " + String(root.status_message ?? root.status_code);
    }

    const tasks = Array.isArray(root.tasks) ? root.tasks : [];
    const task = asRecord(tasks[0]);
    if (!task) return "DataForSEO returned no task result.";
    if (typeof task.status_code === "number" && task.status_code !== 20000) {
        return "DataForSEO task failed: " + String(task.status_message ?? task.status_code);
    }
    return null;
}

/**
 * POST to the DataForSEO v3 API. A non-2xx response and an in-envelope task
 * failure are both surfaced as errors and count once toward the circuit breaker.
 */
export async function dataForSeoPost<T>(path: string, body: unknown): Promise<T> {
    if (await isCircuitOpen()) {
        throw new Error("DataForSEO circuit is OPEN — request skipped to protect credits.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch("https://api.dataforseo.com/v3" + path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: getAuthHeader(),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error("DataForSEO " + path + " returned HTTP " + response.status);
        }

        const payload: unknown = await response.json();
        const providerError = responseError(payload);
        if (providerError) throw new Error(providerError);

        await recordSuccess();
        return payload as T;
    } catch (error) {
        if ((error as Error)?.name === "AbortError") {
            logger.warn("[DataForSEO/CB] Request timed out", { path, timeoutMs: TIMEOUT_MS });
        }
        await recordFailure();
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
