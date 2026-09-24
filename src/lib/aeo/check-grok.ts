import { logger } from "@/lib/logger";
import type { MentionResult } from "./multi-model";
import { analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";
import { type ProviderStatus, type ProviderTelemetry, classifyError } from "./provider-result";
import { buildAeoQuestion } from "./aeo-prompt";

export async function checkGrokMention(
  brand: string,
  services?: string | null,
  keyword?: string | null
): Promise<MentionResult> {
  if (!process.env.XAI_API_KEY) {
    return { model: "Grok", mentioned: null, confidence: null, details: "xAI API key missing", providerStatus: "NO_API_KEY" };
  }
  const question = buildAeoQuestion({ domain: brand, keyword, coreServices: services });

  const startMs = Date.now();
  let httpStatus: number | undefined;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-3",
        search_parameters: { mode: "auto" },
        messages: [{ role: "user", content: question }],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(TIMEOUTS.AI_DEFAULT_MS),
    });

    httpStatus = res.status;

    if (!res.ok) {
      const durationMs = Date.now() - startMs;
      const telemetry: ProviderTelemetry = { provider: "xai", operation: "aeo_mention_check", status: "PROVIDER_ERROR", httpStatus, durationMs };
      logger.error("[Multi-Model] Grok API error:", telemetry);
      return { model: "Grok", mentioned: null, confidence: null, details: `xAI API error: ${res.status}`, providerStatus: "PROVIDER_ERROR" };
    }

    const data = await res.json();
    const durationMs = Date.now() - startMs;
    const content: string = data.choices?.[0]?.message?.content ?? "";

    if (!content) {
      logger.info("[Multi-Model] Grok returned empty response:", { provider: "xai", operation: "aeo_mention_check", status: "NO_RESULT", durationMs });
      return { model: "Grok", mentioned: false, confidence: 0, details: "Grok returned no content", providerStatus: "NO_RESULT" };
    }

    const mentioned = content.toLowerCase().includes(brand.toLowerCase());
    const quality = analyzeCitationQuality(content, brand);

    const telemetry: ProviderTelemetry = { provider: "xai", operation: "aeo_mention_check", status: "SUCCESS", httpStatus: 200, durationMs };
    logger.info("[Multi-Model] Grok check completed:", telemetry);

    return {
      model: "Grok",
      mentioned,
      confidence: mentioned ? quality.positionScore : 0,
      snippet: content.substring(0, 300),
      details: mentioned
        ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}`
        : "Not mentioned by Grok",
      quality: mentioned ? quality : undefined,
      providerStatus: "SUCCESS",
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startMs;
    const providerStatus: ProviderStatus = classifyError(error);
    const telemetry: ProviderTelemetry = { provider: "xai", operation: "aeo_mention_check", status: providerStatus, httpStatus, durationMs, error: (error as Error)?.message || String(error) };
    logger.error("[Multi-Model] Grok check failed:", telemetry);
    return { model: "Grok", mentioned: null, confidence: null, details: `Check failed: ${providerStatus}`, providerStatus };
  }
}

export async function checkGrokVisibility(brand: string, query: string): Promise<number> {
  if (!process.env.XAI_API_KEY) return 0;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "grok-3", messages: [{ role: "user", content: query }], max_tokens: 500 }),
      signal: AbortSignal.timeout(TIMEOUTS.AI_CLAUDE_MS),
    });
    if (!res.ok) throw new Error(`xAI API error: ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    return text.toLowerCase().includes(brand.toLowerCase()) ? 100 : 0;
  } catch (error: unknown) {
    logger.warn("[AEO/Grok] Check failed:", { error: (error as Error)?.message || String(error) });
    return 0;
  }
}