/**
 * Shared AEO prompt builder — ensures all 7 AI engines receive
 * the identical question text for fair cross-engine benchmarking.
 *
 * Engine-specific differences (web search tools, JSON response format,
 * API wrappers) are handled in each checker file, not here.
 *
 * The question is deliberately neutral and user-like — it mimics
 * how a real person would query an AI search engine.
 */

export type AeoPromptMode = "keyword" | "services" | "brand";

export interface AeoPromptInput {
    domain: string;
    /** A complete user query. Unlike `keyword`, it must be sent verbatim. */
    question?: string | null;
    keyword?: string | null;
    coreServices?: string | null;
}

/**
 * Determine which prompt mode applies based on available inputs.
 * Priority: keyword > coreServices > brand fallback.
 */
export function resolvePromptMode(input: AeoPromptInput): AeoPromptMode {
    if (input.keyword) return "keyword";
    if (input.coreServices) return "services";
    return "brand";
}

/**
 * Build the standard AEO question.
 *
 * All engines receive the same question text so scores are
 * directly comparable across models.
 */
export function buildAeoQuestion(input: AeoPromptInput): string {
    // Query tracking already has a real user question. Do not turn it into a
    // second "best tools" question: that changes the intent being measured.
    if (input.question?.trim()) return input.question.trim();
    const mode = resolvePromptMode(input);

    switch (mode) {
        case "keyword":
            return `What are the best ${input.keyword} tools and services? List the top options with their key features.`;

        case "services":
            return `What are the best tools and platforms for ${input.coreServices}? Compare the top options.`;

        case "brand":
            return `Tell me about ${input.domain} — what do they offer and how do they compare to alternatives?`;
    }
}
