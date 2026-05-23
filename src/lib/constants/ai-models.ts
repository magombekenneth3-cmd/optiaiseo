const useExperimental = process.env.GEMINI_EXPERIMENTAL_MODELS === "1";

export const AI_MODELS = {
    // Gemini — real model strings only
    GEMINI_FLASH:      'gemini-2.5-flash',
    GEMINI_FLASH_LITE: 'gemini-2.0-flash-lite',
    GEMINI_FLASH_2_0:  'gemini-2.0-flash',
    GEMINI_LIVE:       'gemini-2.0-flash-live-001',
    GEMINI_PRO:        useExperimental ? 'gemini-2.0-pro-exp' : 'gemini-2.5-pro',

    // OpenAI
    OPENAI_PRIMARY:    'gpt-4o',
    OPENAI_EMBEDDING:  'text-embedding-3-small',

    // Anthropic — full model strings with date stamps as required by the API
    ANTHROPIC_HAIKU:   'claude-haiku-4-5-20251001',
    ANTHROPIC_SONNET:  'claude-sonnet-4-5-20251022',
    ANTHROPIC_OPUS:    'claude-opus-4-5-20251101',
} as const;

// Backward-compat aliases for any existing imports
export const GEMINI_2_5_FLASH = AI_MODELS.GEMINI_FLASH;
export const GEMINI_2_0_FLASH = AI_MODELS.GEMINI_FLASH_2_0;

export type GeminiModel = typeof AI_MODELS.GEMINI_FLASH | typeof AI_MODELS.GEMINI_FLASH_LITE | typeof AI_MODELS.GEMINI_LIVE | string;
export type OpenAIModel = typeof AI_MODELS.OPENAI_PRIMARY | typeof AI_MODELS.OPENAI_EMBEDDING;
export type AnthropicModel = typeof AI_MODELS.ANTHROPIC_HAIKU | typeof AI_MODELS.ANTHROPIC_SONNET | typeof AI_MODELS.ANTHROPIC_OPUS;