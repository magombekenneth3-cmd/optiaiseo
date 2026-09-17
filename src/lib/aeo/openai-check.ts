import { logger } from "@/lib/logger";
import { MentionResult, analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";
import { type ProviderStatus, type ProviderTelemetry, classifyError } from "./provider-result";
import { buildAeoQuestion } from "./aeo-prompt";

/**
 * P0.1 — ChatGPT AEO mention check using the OpenAI Responses API.
 *
 * Uses `/v1/responses` with the `web_search` tool so that the model can
 * browse the live web — matching how real users experience chatgpt.com.
 *
 * Previous implementation used `/v1/chat/completions` with `web_search_preview`
 * which produced HTTP 400 errors because that tool type is Responses-API-only.
 */
export async function checkChatGptMention(
    domain: string,
    coreServices?: string | null,
    keyword?: string | null,
    question?: string | null,
): Promise<MentionResult> {
    if (!process.env.OPENAI_API_KEY) {
        return {
            model: "ChatGPT",
            mentioned: false,
            confidence: 0,
            details: "OpenAI API key not configured",
            providerStatus: "NO_API_KEY",
        };
    }

    const prompt = buildAeoQuestion({ domain, question, keyword, coreServices });

    const startMs = Date.now();
    let httpStatus: number | undefined;

    try {
        const res = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o",
                tools: [{ type: "web_search" }],
                input: prompt,
            }),
            signal: AbortSignal.timeout(TIMEOUTS.AI_CLAUDE_MS),
        });

        httpStatus = res.status;

        if (!res.ok) {
            const durationMs = Date.now() - startMs;
            const telemetry: ProviderTelemetry = {
                provider: "openai",
                operation: "aeo_mention_check",
                status: "PROVIDER_ERROR",
                httpStatus,
                durationMs,
            };
            logger.error("[Multi-Model] ChatGPT API error:", telemetry);
            return {
                model: "ChatGPT",
                mentioned: false,
                confidence: 0,
                details: `OpenAI API error: ${res.status}`,
                providerStatus: "PROVIDER_ERROR",
            };
        }

        const data = await res.json();
        const durationMs = Date.now() - startMs;

        // Responses API returns output_text for the final generated text.
        // Also extract web search source URLs from output items for future citation detection.
        const content: string = data.output_text ?? "";
        const sourceUrls: string[] = [];

        if (Array.isArray(data.output)) {
            for (const item of data.output) {
                // web_search_call results contain source URLs
                if (item.type === "web_search_call" && Array.isArray(item.results)) {
                    for (const result of item.results) {
                        if (result.url) sourceUrls.push(result.url);
                    }
                }
            }
        }

        if (!content) {
            const telemetry: ProviderTelemetry = {
                provider: "openai",
                operation: "aeo_mention_check",
                status: "NO_RESULT",
                httpStatus: 200,
                durationMs,
            };
            logger.info("[Multi-Model] ChatGPT returned empty response:", telemetry);
            return {
                model: "ChatGPT",
                mentioned: false,
                confidence: 0,
                details: "ChatGPT returned no content",
                providerStatus: "NO_RESULT",
            };
        }

        const mentioned = content.toLowerCase().includes(domain.toLowerCase());
        const quality = analyzeCitationQuality(content, domain);

        const telemetry: ProviderTelemetry = {
            provider: "openai",
            operation: "aeo_mention_check",
            status: "SUCCESS",
            httpStatus: 200,
            durationMs,
        };
        logger.info("[Multi-Model] ChatGPT check completed:", telemetry);

        return {
            model: "ChatGPT",
            mentioned,
            confidence: mentioned ? quality.positionScore : 15,
            snippet: content.substring(0, 300),
            details: mentioned
                ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}, authoritative: ${quality.isAuthoritative}`
                : "Not found in ChatGPT response",
            quality: mentioned ? quality : undefined,
            linkedSourceUrls: sourceUrls.length > 0 ? sourceUrls : undefined,
            providerStatus: "SUCCESS",
        };
    } catch (error: unknown) {
        const durationMs = Date.now() - startMs;
        const providerStatus: ProviderStatus = classifyError(error);
        const telemetry: ProviderTelemetry = {
            provider: "openai",
            operation: "aeo_mention_check",
            status: providerStatus,
            httpStatus,
            durationMs,
            error: (error as Error)?.message || String(error),
        };
        logger.error("[Multi-Model] ChatGPT check failed:", telemetry);
        return {
            model: "ChatGPT",
            mentioned: false,
            confidence: 0,
            details: `Check failed: ${providerStatus}`,
            providerStatus,
        };
    }
}
