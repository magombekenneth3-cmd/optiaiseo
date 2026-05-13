import { logger } from "@/lib/logger";
import { MentionResult, analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";

export async function checkClaudeMention(
    domain: string,
    coreServices?: string | null,
    keyword?: string | null
): Promise<MentionResult> {
    if (!process.env.ANTHROPIC_API_KEY) {
        return { model: "Claude", mentioned: false, confidence: 0, details: "No API key" };
    }

    const question = keyword
        ? `${keyword} — what are the leading platforms?`
        : coreServices
            ? `What are the leading platforms for ${coreServices}?`
            : `Tell me about ${domain} — what do they do?`;

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 500,
                // Add web_search tool so this matches claude.ai behaviour where
                // users have search enabled — not frozen training data only.
                tools: [{
                    type: "web_search_20250305",
                    name: "web_search",
                }],
                messages: [{ role: "user", content: question }],
            }),
            signal: AbortSignal.timeout(TIMEOUTS.AI_CLAUDE_MS),
        });

        if (!res.ok) {
            throw new Error(`Anthropic API error: ${res.status}`);
        }

        const data = await res.json();
        // When web_search tool is active, data.content is an array of blocks
        // that may include tool_use and tool_result blocks alongside text.
        // Extract only the text blocks and join them.
        const content: string = Array.isArray(data.content)
            ? data.content
                .filter((b: { type: string }) => b.type === "text")
                .map((b: { text: string }) => b.text)
                .join(" ")
            : (data.content?.[0]?.text ?? "");
        const mentioned = content.toLowerCase().includes(domain.toLowerCase());

        // Apply the same quality analysis as Perplexity for comparable scores
        const quality = analyzeCitationQuality(content, domain);

        return {
            model: "Claude",
            mentioned,
            confidence: mentioned ? quality.positionScore : 15,
            snippet: content.substring(0, 300),
            details: mentioned
                ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}, authoritative: ${quality.isAuthoritative}`
                : "Not mentioned by Claude",
            quality: mentioned ? quality : undefined,
        };
     
     
    } catch (error: unknown) {
        logger.error("[Multi-Model] Claude check failed:", { error: (error as Error)?.message || String(error) });
        return { model: "Claude", mentioned: false, confidence: 0, details: "Check failed" };
    }
}