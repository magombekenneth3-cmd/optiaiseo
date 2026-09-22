/**
 * Central AI model registry — single source of truth for all model IDs.
 *
 * Gemini 3.x production chain (Sep 2026):
 *   gemini-3.8-flash → gemini-3.7-flash → gemini-3.6-flash → gemini-3.1-flash-lite
 *
 * Every call site must reference these constants. Hardcoded model strings are
 * forbidden — the `sanitizeGeminiModel()` guard in gemini/client.ts intercepts
 * any stale ID that slips through.
 */

export const GEMINI_PRODUCTION_CHAIN = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite',
] as const;

export const AI_MODELS = {
    // Gemini 3.x — production chain
    GEMINI_FLASH:      'gemini-3.8-flash',
    GEMINI_FLASH_LITE: 'gemini-3.1-flash-lite',
    GEMINI_FLASH_2_0:  'gemini-3.7-flash',   // compat alias → second-tier fallback
    GEMINI_LIVE:       'gemini-2.0-flash-live-001',  // voice-only — separate chain
    GEMINI_PRO:        'gemini-3.8-flash',

    // OpenAI
    OPENAI_PRIMARY:    'gpt-4o',
    OPENAI_EMBEDDING:  'text-embedding-3-small',

    // Anthropic — full model strings with date stamps as required by the API
    ANTHROPIC_PRIMARY: 'claude-sonnet-4-5-20250929',
    ANTHROPIC_HAIKU:   'claude-haiku-4-5-20251015',
    ANTHROPIC_SONNET:  'claude-sonnet-4-5-20250929',
    ANTHROPIC_OPUS:    'claude-opus-4-5-20251124',
} as const;

// Backward-compat aliases for any existing imports
export const GEMINI_2_5_FLASH = AI_MODELS.GEMINI_FLASH;
export const GEMINI_2_0_FLASH = AI_MODELS.GEMINI_FLASH_2_0;

export type GeminiModel = typeof AI_MODELS.GEMINI_FLASH | typeof AI_MODELS.GEMINI_FLASH_LITE | typeof AI_MODELS.GEMINI_LIVE | string;
export type OpenAIModel = typeof AI_MODELS.OPENAI_PRIMARY | typeof AI_MODELS.OPENAI_EMBEDDING;
export type AnthropicModel = typeof AI_MODELS.ANTHROPIC_PRIMARY | typeof AI_MODELS.ANTHROPIC_HAIKU | typeof AI_MODELS.ANTHROPIC_SONNET | typeof AI_MODELS.ANTHROPIC_OPUS;