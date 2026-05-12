const useExperimental = process.env.GEMINI_EXPERIMENTAL_MODELS === "1";
const GEMINI_PRO_MODEL = useExperimental ? "gemini-2.0-pro-exp" : "gemini-2.5-flash";

export const GEMINI_2_5_FLASH = 'gemini-2.5-flash';

export const GEMINI_3_FLASH = 'gemini-2.5-flash';

export const GEMINI_2_0_FLASH = 'gemini-2.0-flash';


export const GEMINI_2_0_PRO = GEMINI_PRO_MODEL;

export const GEMINI_3_1_PRO = GEMINI_PRO_MODEL;
export const GEMINI_2_5_PRO = GEMINI_PRO_MODEL;

export const AI_MODELS = {

    GEMINI_FLASH: 'gemini-2.5-flash',
    GEMINI_FLASH_LITE: 'gemini-2.0-flash-lite',
    GEMINI_LIVE: 'gemini-2.0-flash-live-001',
    GEMINI_PRO: GEMINI_PRO_MODEL,
    GEMINI_3_FLASH: 'gemini-2.5-flash',
    GEMINI_3_1_PRO: GEMINI_PRO_MODEL,
    OPENAI_PRIMARY: 'gpt-4o',
    OPENAI_EMBEDDING: 'text-embedding-3-small',
    ANTHROPIC_PRIMARY: 'claude-haiku-4-5-20251001',
    // Use the versioned model ID — undated aliases can silently route to a
    // different snapshot and will 404 when the alias is retired.
    ANTHROPIC_SONNET: 'claude-sonnet-4-5-20251001',
    ANTHROPIC_OPUS: 'claude-opus-4-20250514',
} as const;

export type GeminiModel = typeof AI_MODELS.GEMINI_FLASH | typeof AI_MODELS.GEMINI_FLASH_LITE | typeof AI_MODELS.GEMINI_LIVE | string;
export type OpenAIModel = typeof AI_MODELS.OPENAI_PRIMARY | typeof AI_MODELS.OPENAI_EMBEDDING;
export type AnthropicModel = typeof AI_MODELS.ANTHROPIC_PRIMARY;