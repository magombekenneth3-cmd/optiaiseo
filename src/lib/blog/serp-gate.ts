/**
 * src/lib/blog/serp-gate.ts
 *
 * SERP Intent Pre-Gate.
 *
 * Architecture:
 *   fetchGoogleSerp()          — I/O (lives in serp.ts)
 *   classifySerpFormat()       — I/O wrapper (lives in serp.ts)
 *   evaluateSerpIntentGate()   — PURE: signal → decision (this file)
 *   storeSerpPreflight()       — Redis write (this file)
 *   validateSerpPreflight()    — Redis read + ownership check (this file)
 *
 * Invariants enforced by this module:
 *   BLOCK                → consumeCredits() MUST NOT execute
 *   WARN + no override   → consumeCredits() MUST NOT execute
 *   WARN + valid override + valid preflight → consumeCredits() executes
 *   ALLOW + valid preflight                → consumeCredits() executes
 *   SKIP                → generation proceeds without gating
 *   forceSerpMismatch=true without valid preflight → MUST NOT bypass gate
 */

import { randomUUID } from "crypto";
import type { SerpFormat, SerpFormatSignal, SerpConfidence } from "./serp";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/**
 * Canonical keyword normalization.
 * Applied identically when storing a preflight and when validating one.
 * Rule: lowercase + collapse whitespace + trim.
 * Special chars (punctuation) are preserved so "C# programming" != "C programming".
 */
export function normalizeKeyword(keyword: string): string {
    return keyword.toLowerCase().replace(/\s+/g, " ").trim();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SerpGateVerdict = "ALLOW" | "WARN" | "BLOCK" | "SKIP";

export type SerpGateDecision =
    | {
          verdict: "ALLOW";
          format: SerpFormat;
          confidence: SerpConfidence;
          hint: string;
      }
    | {
          verdict: "WARN";
          format: SerpFormat;
          confidence: SerpConfidence;
          /** Evidence-based explanation — never claims blog "will never rank". */
          reason: string;
          hint: string;
      }
    | {
          verdict: "BLOCK";
          format: SerpFormat;
          confidence: SerpConfidence;
          /** Evidence-based explanation — never claims blog "will never rank". */
          reason: string;
      }
    | {
          verdict: "SKIP";
          /**
           * SERP_NOT_CONFIGURED — SERPER_API_KEY missing.
           * SERP_PROVIDER_UNAVAILABLE — API call failed unexpectedly.
           * SERP_NO_KEYWORD — no keyword to classify.
           * SERP_NO_RESULTS — API returned zero organic results.
           */
          reason:
              | "SERP_NOT_CONFIGURED"
              | "SERP_PROVIDER_UNAVAILABLE"
              | "SERP_NO_KEYWORD"
              | "SERP_NO_RESULTS";
      };

/** Stored in Redis — carries everything needed to re-validate on generation. */
export interface SerpPreflightRecord {
    preflightId: string;
    userId: string;
    siteId: string;
    keyword: string;
    signal: SerpFormatSignal;
    decision: SerpGateDecision;
    checkedAt: string; // ISO-8601
}

// ─── Pure evaluator ───────────────────────────────────────────────────────────

const FORMAT_HINTS: Record<SerpFormat, string> = {
    tool:       "Consider targeting a long-tail informational keyword instead, e.g. \"how to [task] manually\" or \"[topic] explained\".",
    video:      "Consider targeting a long-tail keyword where text content can rank alongside video results.",
    product:    "Structure as a buying guide: who-should-buy summary, comparison table with specs/pricing, and a recommendation segmented by use case.",
    listicle:   "Use a numbered H1 (e.g. \"11 Best…\"), one H2 per item, and a comparison table near the end.",
    comparison: "Lead with a direct verdict, use consistent comparison tables, and declare winners for at least 3 distinct buyer profiles.",
    guide:      "Standard long-form guide format aligns well with this SERP.",
    general:    "No dominant format detected — a comprehensive guide with a direct opening answer and skimmable H2 structure will work.",
};

/**
 * PURE — no I/O. Converts a SerpFormatSignal into a gate decision.
 * Unit-testable without touching Serper, Redis, or any DB.
 */
export function evaluateSerpIntentGate(
    signal: SerpFormatSignal | null
): SerpGateDecision {
    if (!signal) {
        return { verdict: "SKIP", reason: "SERP_NO_RESULTS" };
    }

    const { format, confidence } = signal;
    const hint = FORMAT_HINTS[format];

    // ── Hard blocks (high confidence only) ───────────────────────────────────
    if (format === "tool" && confidence === "high") {
        return {
            verdict: "BLOCK",
            format,
            confidence,
            reason:
                `The current SERP for this keyword is strongly tool-dominated (${signal.reasoning}). ` +
                "A long-form blog post is unlikely to match the dominant search intent. " +
                hint,
        };
    }

    if (format === "video" && confidence === "high") {
        return {
            verdict: "BLOCK",
            format,
            confidence,
            reason:
                `The current SERP for this keyword is strongly video-oriented (${signal.reasoning}). ` +
                "A standard long-form article is unlikely to match the dominant search intent. " +
                hint,
        };
    }

    // ── Warnings — user can override ─────────────────────────────────────────
    if (format === "tool") {
        return {
            verdict: "WARN",
            format,
            confidence,
            reason:
                `The SERP shows tool-oriented results (${signal.reasoning}). ` +
                "A blog post may underperform unless it provides substantial how-to content.",
            hint,
        };
    }

    if (format === "video") {
        return {
            verdict: "WARN",
            format,
            confidence,
            reason:
                `The SERP shows video-dominated results (${signal.reasoning}). ` +
                "A blog post can still rank but consider targeting a more text-friendly keyword.",
            hint,
        };
    }

    if (format === "product") {
        return {
            verdict: "WARN",
            format,
            confidence,
            reason:
                `The SERP shows strong commercial/product intent (${signal.reasoning}). ` +
                "A buying guide format is more likely to rank than a standard blog post.",
            hint,
        };
    }

    if (format === "listicle") {
        return {
            verdict: "WARN",
            format,
            confidence,
            reason:
                `The SERP is dominated by listicle content (${signal.reasoning}). ` +
                "A numbered list format will significantly outperform a standard prose article.",
            hint,
        };
    }

    if (format === "comparison") {
        return {
            verdict: "WARN",
            format,
            confidence,
            reason:
                `The SERP is dominated by comparison content (${signal.reasoning}). ` +
                "A side-by-side comparison format will outperform a standard blog post.",
            hint,
        };
    }

    // ── Allow ─────────────────────────────────────────────────────────────────
    // guide | general — blog post aligns with SERP intent
    return {
        verdict: "ALLOW",
        format,
        confidence,
        hint,
    };
}

// ─── Redis preflight storage ──────────────────────────────────────────────────

const PREFLIGHT_TTL_SECONDS = 5 * 60; // 5 minutes
const PREFLIGHT_KEY = (id: string) => `serp-preflight:${id}`;

/**
 * Stores a preflight record in Redis and returns the preflightId.
 * Falls back gracefully if Redis is not configured (returns null).
 *
 * **Replay semantics (intentional):** A preflightId is NOT single-use.
 * Within its 5-minute TTL the same token can authorize multiple generations
 * for the same keyword + user + site. Credits are the rate limiter;
 * the gate's job is SERP-format enforcement, not generation counting.
 */
export async function storeSerpPreflight(
    record: Omit<SerpPreflightRecord, "preflightId">
): Promise<string | null> {
    const redis = getRedis();
    if (!redis) {
        logger.warn("[SerpGate] Redis not configured — preflight token not stored. Gate will re-run server-side.");
        return null;
    }

    const preflightId = randomUUID();
    const payload: SerpPreflightRecord = {
        ...record,
        preflightId,
        // Normalize keyword at storage time so validation comparison is consistent.
        keyword: normalizeKeyword(record.keyword),
    };

    try {
        await redis.set(PREFLIGHT_KEY(preflightId), JSON.stringify(payload), {
            ex: PREFLIGHT_TTL_SECONDS,
        });
        return preflightId;
    } catch (err) {
        logger.error("[SerpGate] Failed to store preflight:", {
            error: (err as Error)?.message,
        });
        return null;
    }
}

export type PreflightValidationResult =
    | { valid: true; record: SerpPreflightRecord }
    | { valid: false; reason: string };

/**
 * Validates a preflightId from the server action.
 * Checks: exists, not expired, userId matches, siteId matches, keyword matches.
 *
 * Failure reason taxonomy:
 *   REDIS_NOT_CONFIGURED   — Redis env vars absent (infra/config issue).
 *                            Caller MUST re-run the gate fresh.
 *   REDIS_ERROR            — Redis is configured but threw at runtime (outage).
 *                            Caller MUST re-run the gate fresh.
 *                            If the fresh gate also fails → SKIP (fail-open).
 *   PREFLIGHT_NOT_FOUND_OR_EXPIRED — token never existed or TTL elapsed.
 *                            Legitimate staleness; caller re-runs gate.
 *   PREFLIGHT_USER_MISMATCH / PREFLIGHT_SITE_MISMATCH — ownership error.
 *                            Caller SHOULD re-run gate, not silently allow.
 *   PREFLIGHT_KEYWORD_MISMATCH — keyword drifted between preflight and action.
 *   PREFLIGHT_CORRUPTED    — Redis value unparseable.
 */
export async function validateSerpPreflight(
    preflightId: string,
    userId: string,
    siteId: string,
    keyword: string
): Promise<PreflightValidationResult> {
    const redis = getRedis();
    if (!redis) {
        // REDIS_NOT_CONFIGURED: infra issue — gate will re-run server-side.
        return { valid: false, reason: "REDIS_NOT_CONFIGURED" };
    }

    let raw: string | null;
    try {
        raw = await redis.get<string>(PREFLIGHT_KEY(preflightId));
    } catch (err) {
        // REDIS_ERROR: runtime outage — caller must re-run gate fresh.
        // Note: a double-failure (Redis down + Serper down) will produce SKIP
        // (fail-open). This is the explicit policy: infrastructure failures
        // should never permanently block generation.
        logger.error("[SerpGate] Redis error during preflight validation:", {
            error: (err as Error)?.message,
        });
        return { valid: false, reason: "REDIS_ERROR" };
    }

    if (!raw) return { valid: false, reason: "PREFLIGHT_NOT_FOUND_OR_EXPIRED" };

    let record: SerpPreflightRecord;
    try {
        record = JSON.parse(raw) as SerpPreflightRecord;
    } catch {
        return { valid: false, reason: "PREFLIGHT_CORRUPTED" };
    }

    if (record.userId !== userId) {
        return { valid: false, reason: "PREFLIGHT_USER_MISMATCH" };
    }

    if (record.siteId !== siteId) {
        return { valid: false, reason: "PREFLIGHT_SITE_MISMATCH" };
    }

    // Use normalizeKeyword on both sides — storage already normalized at write time.
    if (normalizeKeyword(record.keyword) !== normalizeKeyword(keyword)) {
        return { valid: false, reason: "PREFLIGHT_KEYWORD_MISMATCH" };
    }

    return { valid: true, record };
}
