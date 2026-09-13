import { logger } from "@/lib/logger";
import { MentionResult, analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";
import { type ProviderStatus, type ProviderTelemetry, classifyError } from "./provider-result";

/**
 * P0.2 — Claude AEO mention check using web_search_20250305 tool.
 *
 * Model: claude-haiku-4-5-20251001 (active, cost-efficient for search + classify).
 * max_uses: 1 — limits web search invocations per request to control cost.
 *
 * Previous implementation was missing max_uses and returned { mentioned: false }
 * on failure, which was indistinguishable from "not mentioned."
 */

/** Explicit cost constraint: one web search per AEO check */
const MAX_WEB_SEARCH_USES = 1;

export async function checkClaudeMention(
    domain: string,
    coreServices?: string | null,
    keyword?: string | null
): Promise<MentionResult> {
    if (!process.env.ANTHROPIC_API_KEY) {
        return {
            model: "Claude",
            mentioned: false,
            confidence: 0,
            details: "Anthropic API key not configured",
            providerStatus: "NO_API_KEY",
        };
    }

    const question = keyword
        ? `${keyword} — what are the leading platforms?`
        : coreServices
            ? `What are the leading platforms for ${coreServices}?`
            : `Tell me about ${domain} — what do they do?`;

    const startMs = Date.now();
    let httpStatus: number | undefined;

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
                tools: [{
                    type: "web_search_20250305",
                    name: "web_search",
                    max_uses: MAX_WEB_SEARCH_USES,
                }],
                messages: [{ role: "user", content: question }],
            }),
            signal: AbortSignal.timeout(TIMEOUTS.AI_CLAUDE_MS),
        });

        httpStatus = res.status;

        if (!res.ok) {
            const durationMs = Date.now() - startMs;
            const telemetry: ProviderTelemetry = {
                provider: "anthropic",
                operation: "aeo_mention_check",
                status: "PROVIDER_ERROR",
                httpStatus,
                durationMs,
            };
            logger.error("[Multi-Model] Claude API error:", telemetry);
            return {
                model: "Claude",
                mentioned: false,
                confidence: 0,
                details: `Anthropic API error: ${res.status}`,
                providerStatus: "PROVIDER_ERROR",
            };
        }

        const data = await res.json();
        const durationMs = Date.now() - startMs;

        // When web_search tool is active, data.content is an array of blocks
        // that may include tool_use and tool_result blocks alongside text.
        // Extract only the text blocks and join them.
        const content: string = Array.isArray(data.content)
            ? data.content
                .filter((b: { type: string }) => b.type === "text")
                .map((b: { text: string }) => b.text)
                .join(" ")
            : (data.content?.[0]?.text ?? "");

        if (!content) {
            const telemetry: ProviderTelemetry = {
                provider: "anthropic",
                operation: "aeo_mention_check",
                status: "NO_RESULT",
                httpStatus: 200,
                durationMs,
            };
            logger.info("[Multi-Model] Claude returned empty response:", telemetry);
            return {
                model: "Claude",
                mentioned: false,
                confidence: 0,
                details: "Claude returned no text content",
                providerStatus: "NO_RESULT",
            };
        }

        const mentioned = content.toLowerCase().includes(domain.toLowerCase());
        const quality = analyzeCitationQuality(content, domain);

        const telemetry: ProviderTelemetry = {
            provider: "anthropic",
            operation: "aeo_mention_check",
            status: "SUCCESS",
            httpStatus: 200,
            durationMs,
        };
        logger.info("[Multi-Model] Claude check completed:", telemetry);

        return {
            model: "Claude",
            mentioned,
            confidence: mentioned ? quality.positionScore : 15,
            snippet: content.substring(0, 300),
            details: mentioned
                ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}, authoritative: ${quality.isAuthoritative}`
                : "Not mentioned by Claude",
            quality: mentioned ? quality : undefined,
            providerStatus: "SUCCESS",
        };
    } catch (error: unknown) {
        const durationMs = Date.now() - startMs;
        const providerStatus: ProviderStatus = classifyError(error);
        const telemetry: ProviderTelemetry = {
            provider: "anthropic",
            operation: "aeo_mention_check",
            status: providerStatus,
            httpStatus,
            durationMs,
            error: (error as Error)?.message || String(error),
        };
        logger.error("[Multi-Model] Claude check failed:", telemetry);
        return {
            model: "Claude",
            mentioned: false,
            confidence: 0,
            details: `Check failed: ${providerStatus}`,
            providerStatus,
        };
    }
}