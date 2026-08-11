import { logger } from "@/lib/logger";
import { MentionResult, analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";

export async function checkDeepSeekMention(
    domain: string,
    coreServices?: string | null,
    keyword?: string | null
): Promise<MentionResult> {
    if (!process.env.DEEPSEEK_API_KEY) {
        return { model: "DeepSeek", mentioned: false, confidence: 0, details: "No API key" };
    }

    const question = keyword
        ? `${keyword} — what are the best options?`
        : coreServices
            ? `What are the best tools for ${coreServices}? List top options with descriptions.`
            : `What is ${domain} and what do they offer?`;

    try {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [{ role: "user", content: question }],
            }),
            signal: AbortSignal.timeout(TIMEOUTS.AI_CLAUDE_MS),
        });

        if (!res.ok) {
            throw new Error(`DeepSeek API error: ${res.status}`);
        }

        const data = await res.json();
        const content: string = data.choices?.[0]?.message?.content ?? "";
        const mentioned = content.toLowerCase().includes(domain.toLowerCase());
        const quality = analyzeCitationQuality(content, domain);

        const urlMatches = content.match(/https?:\/\/[^\s\)\>\]]+/g) ?? [];
        const linkedSourceUrls = [...new Set(urlMatches)];

        return {
            model: "DeepSeek",
            mentioned,
            confidence: mentioned ? quality.positionScore : 0,
            snippet: content.substring(0, 300),
            details: mentioned
                ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}`
                : "Not found in DeepSeek response",
            positionInResponse: quality.positionInResponse !== -1 ? quality.positionInResponse : undefined,
            sentiment: quality.sentiment,
            linkedSourceUrls,
            quality: mentioned ? quality : undefined,
        };
    } catch (error: unknown) {
        logger.error("[Multi-Model] DeepSeek check failed:", { error: (error as Error)?.message || String(error) });
        return { model: "DeepSeek", mentioned: false, confidence: 0, details: "Check failed" };
    }
}
