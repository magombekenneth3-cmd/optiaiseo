import { logger } from "@/lib/logger";
import { MentionResult, analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";
import { type ProviderStatus, type ProviderTelemetry, classifyError } from "./provider-result";
import { buildAeoQuestion } from "./aeo-prompt";

export async function checkDeepSeekMention(
    domain: string,
    coreServices?: string | null,
    keyword?: string | null
): Promise<MentionResult> {
    if (!process.env.DEEPSEEK_API_KEY) {
        return { model: "DeepSeek", mentioned: false, confidence: 0, details: "No API key", providerStatus: "NO_API_KEY" };
    }

    const question = buildAeoQuestion({ domain, keyword, coreServices });

    const startMs = Date.now();
    let httpStatus: number | undefined;

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

        httpStatus = res.status;

        if (!res.ok) {
            const durationMs = Date.now() - startMs;
            const telemetry: ProviderTelemetry = { provider: "deepseek", operation: "aeo_mention_check", status: "PROVIDER_ERROR", httpStatus, durationMs };
            logger.error("[Multi-Model] DeepSeek API error:", telemetry);
            return { model: "DeepSeek", mentioned: false, confidence: 0, details: `DeepSeek API error: ${res.status}`, providerStatus: "PROVIDER_ERROR" };
        }

        const data = await res.json();
        const durationMs = Date.now() - startMs;
        const content: string = data.choices?.[0]?.message?.content ?? "";

        if (!content) {
            logger.info("[Multi-Model] DeepSeek returned empty response:", { provider: "deepseek", operation: "aeo_mention_check", status: "NO_RESULT", durationMs });
            return { model: "DeepSeek", mentioned: false, confidence: 0, details: "DeepSeek returned no content", providerStatus: "NO_RESULT" };
        }

        const mentioned = content.toLowerCase().includes(domain.toLowerCase());
        const quality = analyzeCitationQuality(content, domain);

        const urlMatches = content.match(/https?:\/\/[^\s\)\>\]]+/g) ?? [];
        const linkedSourceUrls = [...new Set(urlMatches)];

        const telemetry: ProviderTelemetry = { provider: "deepseek", operation: "aeo_mention_check", status: "SUCCESS", httpStatus: 200, durationMs };
        logger.info("[Multi-Model] DeepSeek check completed:", telemetry);

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
            providerStatus: "SUCCESS",
        };
    } catch (error: unknown) {
        const durationMs = Date.now() - startMs;
        const providerStatus: ProviderStatus = classifyError(error);
        const telemetry: ProviderTelemetry = { provider: "deepseek", operation: "aeo_mention_check", status: providerStatus, httpStatus, durationMs, error: (error as Error)?.message || String(error) };
        logger.error("[Multi-Model] DeepSeek check failed:", telemetry);
        return { model: "DeepSeek", mentioned: false, confidence: 0, details: `Check failed: ${providerStatus}`, providerStatus };
    }
}
