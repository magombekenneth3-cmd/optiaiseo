import { logger } from "@/lib/logger";
import { MentionResult, analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";

export async function checkChatGptMention(
    domain: string,
    coreServices?: string | null
): Promise<MentionResult> {
    if (!process.env.OPENAI_API_KEY) {
        return { model: "ChatGPT", mentioned: false, confidence: 0, details: "No API key" };
    }

    const question = coreServices
        ? `What are the best tools for ${coreServices}? List top options with descriptions.`
        : `What is ${domain} and what do they offer?`;

    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                // gpt-4o with web_search_preview matches how real users experience chatgpt.com
                // which browses the live web. gpt-4o-mini has no search capability.
                model: "gpt-4o",
                tools: [{ type: "web_search_preview" }],
                messages: [{ role: "user", content: question }],
            }),
            signal: AbortSignal.timeout(TIMEOUTS.AI_CLAUDE_MS),
        });

        if (!res.ok) {
            throw new Error(`OpenAI API error: ${res.status}`);
        }

        const data = await res.json();
        const content: string = data.choices?.[0]?.message?.content ?? "";
        const mentioned = content.toLowerCase().includes(domain.toLowerCase());

        // Use the same quality analysis as Perplexity for comparable scores
        const quality = analyzeCitationQuality(content, domain);

        return {
            model: "ChatGPT",
            mentioned,
            // Use position-aware quality score when mentioned, not a flat 85
            confidence: mentioned ? quality.positionScore : 15,
            snippet: content.substring(0, 300),
            details: mentioned
                ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}, authoritative: ${quality.isAuthoritative}`
                : "Not found in ChatGPT response",
            quality: mentioned ? quality : undefined,
        };
     
     
    } catch (error: unknown) {
        logger.error("[Multi-Model] ChatGPT check failed:", { error: (error as Error)?.message || String(error) });
        return { model: "ChatGPT", mentioned: false, confidence: 0, details: "Check failed" };
    }
}