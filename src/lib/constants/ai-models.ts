// Each constant maps to a genuinely distinct model so multi-model AEO checks
// use real model diversity rather than all resolving to the same endpoint.
// FIX #5: Previously GEMINI_PRO, GEMINI_3_1_PRO and GEMINI_2_5_PRO all aliased
// to 'gemini-2.5-flash', making multi-model AEO a single model called 4× over.

// Experimental Gemini models (gemini-2.0-pro-exp) are only used when
// GEMINI_EXPERIMENTAL_MODELS=1 is set. Production defaults to stable GA models.
const useExperimental = process.env.GEMINI_EXPERIMENTAL_MODELS === "1";
const GEMINI_PRO_MODEL = useExperimental ? "gemini-2.0-pro-exp" : "gemini-1.5-pro";

/**
 * @deprecated Use AI_MODELS.GEMINI_FLASH instead.
 * Kept for backward compatibility — do not use in new code.
 */
export const GEMINI_2_5_FLASH = 'gemini-2.5-flash';

/**
 * @deprecated Duplicate of GEMINI_2_5_FLASH. Use AI_MODELS.GEMINI_FLASH instead.
 * Kept for backward compatibility — do not use in new code.
 */
export const GEMINI_3_FLASH = 'gemini-2.5-flash';

/** Gemini 2.0 Flash — stable, fast, good general tasks */
export const GEMINI_2_0_FLASH = 'gemini-2.0-flash';

/**
 * @deprecated Misleading name — resolves to gemini-1.5-pro in production,
 * not Gemini 2.0 Pro. Use AI_MODELS.GEMINI_PRO instead.
 */
export const GEMINI_2_0_PRO = GEMINI_PRO_MODEL;

/**
 * Gemini Pro — used for brand-mention checks and complex AEO analysis.
 * Points to a genuinely different model from GEMINI_2_5_FLASH so that
 * multi-model diversity scores reflect real cross-model variance.
 * In production uses gemini-1.5-pro (stable GA). Set GEMINI_EXPERIMENTAL_MODELS=1
 * to use gemini-2.0-pro-exp in staging/testing only.
 * @deprecated Use AI_MODELS.GEMINI_PRO instead.
 */
export const GEMINI_3_1_PRO = GEMINI_PRO_MODEL;
/** @deprecated Use AI_MODELS.GEMINI_PRO instead. */
export const GEMINI_2_5_PRO  = GEMINI_PRO_MODEL;

/**
 * Central model registry — update versions here, nowhere else.
 * Import from this object at every call site.
 */
export const AI_MODELS = {
    // ── Gemini ──────────────────────────────────────────────────────────────
    /** Fast batch and general tasks */
    GEMINI_FLASH: 'gemini-2.5-flash',
    /** Very lightweight — keyword clustering, tag generation, summaries */
    GEMINI_FLASH_LITE: 'gemini-2.0-flash-lite',
    /** Realtime / Live WebSocket model — do NOT change: preview models cause WS 1006 errors */
    GEMINI_LIVE: 'gemini-2.0-flash-live-001',
    /**
     * Pro reasoning — brand mention checks, AEO multi-model, complex analysis.
     * Production: gemini-1.5-pro (stable GA).
     * Staging/testing: gemini-2.0-pro-exp (set GEMINI_EXPERIMENTAL_MODELS=1).
     */
    GEMINI_PRO: GEMINI_PRO_MODEL,
    /** 2.5 Flash constant for direct import (kept for backward compatibility) */
    GEMINI_3_FLASH: 'gemini-2.5-flash',
    /** Pro reasoning alias — same as GEMINI_PRO */
    GEMINI_3_1_PRO: GEMINI_PRO_MODEL,

    // ── OpenAI ──────────────────────────────────────────────────────────────
    /** Primary OpenAI model for citation checks and complex reasoning */
    OPENAI_PRIMARY: 'gpt-4o',
    /** Text embedding model for semantic search and vector gap analysis */
    OPENAI_EMBEDDING: 'text-embedding-3-small',

    // ── Anthropic ───────────────────────────────────────────────────────────
    /** Primary Anthropic model for brand mention and AEO diversity checks */
    // Updated May 2026: claude-haiku-4-6 provides better reasoning at the same price point.
    ANTHROPIC_PRIMARY: 'claude-haiku-4-6',
    /** Sonnet — editorial quality rewrites, blog E-E-A-T pass, deep analysis */
    ANTHROPIC_SONNET: 'claude-sonnet-4-5',
    /** Full Opus model — use only for complex generation (blog, deep analysis) */
    ANTHROPIC_OPUS: 'claude-opus-4-20250514',
} as const;

export type GeminiModel = typeof AI_MODELS.GEMINI_FLASH | typeof AI_MODELS.GEMINI_FLASH_LITE | typeof AI_MODELS.GEMINI_LIVE | string;
export type OpenAIModel = typeof AI_MODELS.OPENAI_PRIMARY | typeof AI_MODELS.OPENAI_EMBEDDING;
export type AnthropicModel = typeof AI_MODELS.ANTHROPIC_PRIMARY;