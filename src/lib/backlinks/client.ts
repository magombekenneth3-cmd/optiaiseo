/**
 * Shared DataForSEO client — single place for credentials, auth header,
 * timeout guard, and a lightweight Redis-backed circuit breaker.
 *
 * Circuit breaker states (stored in Redis):
 *   CLOSED  — normal operation (default)
 *   OPEN    — too many recent failures; all requests rejected immediately
 *   HALF    — cool-down elapsed; one probe request allowed through
 *
 * Thresholds (tunable via env):
 *   DATAFORSEO_CB_THRESHOLD   — consecutive failures before opening (default 3)
 *   DATAFORSEO_CB_RESET_MS    — ms before attempting half-open (default 120 000)
 *   DATAFORSEO_TIMEOUT_MS     — per-request timeout in ms (default 15 000)
 */

import { logger } from "@/lib/logger";

const LOGIN    = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;

const CB_THRESHOLD  = Number(process.env.DATAFORSEO_CB_THRESHOLD  ?? 3);
const CB_RESET_MS   = Number(process.env.DATAFORSEO_CB_RESET_MS   ?? 120_000);
const TIMEOUT_MS    = Number(process.env.DATAFORSEO_TIMEOUT_MS    ?? 15_000);

const CB_KEY        = "cb:dataforseo:state";     // "OPEN" | "CLOSED"
const CB_FAIL_KEY   = "cb:dataforseo:failures";  // integer counter
const CB_OPEN_AT    = "cb:dataforseo:openedAt";  // unix ms timestamp

/** True when DataForSEO credentials are present in the environment */
export function isConfigured(): boolean {
    return Boolean(LOGIN && PASSWORD);
}

/** Returns the Base64-encoded Basic auth header value */
export function getAuthHeader(): string {
    if (!isConfigured()) {
        throw new Error("[Backlinks/client] DataForSEO credentials not set");
    }
    return `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64")}`;
}

// ─── Circuit breaker helpers ──────────────────────────────────────────────────

async function getRedis() {
    try {
        const { redis } = await import("@/lib/redis");
        return redis;
    } catch {
        return null; // Redis unavailable — fail open
    }
}

async function isCircuitOpen(): Promise<boolean> {
    const r = await getRedis();
    if (!r) return false;
    try {
        const state = await r.get<string>(CB_KEY);
        if (state !== "OPEN") return false;

        // Check if the cool-down has elapsed → allow one half-open probe
        const openedAt = await r.get<number>(CB_OPEN_AT);
        if (openedAt && Date.now() - openedAt >= CB_RESET_MS) {
            // Transition to HALF-OPEN: clear the state so the next call goes through
            await r.del(CB_KEY).catch(() => null);
            logger.info("[DataForSEO/CB] Cool-down elapsed — entering half-open");
            return false; // let the probe through
        }
        return true;
    } catch {
        return false; // fail open on Redis errors
    }
}

async function recordFailure(): Promise<void> {
    const r = await getRedis();
    if (!r) return;
    try {
        const failures = await r.incr(CB_FAIL_KEY);
        // Set a TTL on the counter so stale failures don't permanently accumulate
        await r.expire(CB_FAIL_KEY, Math.ceil(CB_RESET_MS / 1000) * 2);
        if (failures >= CB_THRESHOLD) {
            await r.set(CB_KEY, "OPEN");
            await r.set(CB_OPEN_AT, Date.now());
            logger.warn("[DataForSEO/CB] Circuit OPENED after consecutive failures", { failures });
        }
    } catch { /* non-fatal */ }
}

async function recordSuccess(): Promise<void> {
    const r = await getRedis();
    if (!r) return;
    try {
        await r.del(CB_KEY);
        await r.del(CB_FAIL_KEY);
        await r.del(CB_OPEN_AT);
    } catch { /* non-fatal */ }
}

// ─── Public POST helper ───────────────────────────────────────────────────────

/**
 * POST to the DataForSEO v3 API.
 * - Rejects immediately when the circuit is OPEN (saves credits & avoids hangs)
 * - Enforces a per-request timeout (default 15 s) via AbortSignal
 * - Records failures/successes for the circuit breaker
 * Throws on non-2xx responses so callers only need to handle success.
 */
export async function dataForSeoPost<T>(
    path: string,
    body: unknown,
): Promise<T> {
    if (await isCircuitOpen()) {
        throw new Error(`[DataForSEO/CB] Circuit is OPEN — skipping ${path} to protect credits`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`https://api.dataforseo.com/v3${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: getAuthHeader(),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!res.ok) {
            logger.error(`[Backlinks/client] DataForSEO ${path} returned ${res.status}`);
            await recordFailure();
            throw new Error(`DataForSEO ${path} returned ${res.status}`);
        }

        await recordSuccess();
        return res.json() as Promise<T>;
    } catch (e: unknown) {
        const isAbort = (e as Error)?.name === "AbortError";
        if (isAbort) {
            logger.warn(`[DataForSEO/CB] Request timed out after ${TIMEOUT_MS}ms — ${path}`);
        }
        await recordFailure();
        throw e;
    } finally {
        clearTimeout(timer);
    }
}
