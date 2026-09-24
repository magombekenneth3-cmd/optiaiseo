import { logger } from "@/lib/logger";
import type { MentionResult } from "./multi-model";
import { analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";
import { type ProviderStatus, type ProviderTelemetry, classifyError } from "./provider-result";
import { buildAeoQuestion } from "./aeo-prompt";

export async function checkCopilotMention(
  brand: string,
  services?: string | null,
  keyword?: string | null
): Promise<MentionResult> {
  if (!process.env.AZURE_OAI_ENDPOINT || !process.env.AZURE_OAI_KEY) {
    return { model: "Copilot", mentioned: null, confidence: null, details: "Azure OAI credentials missing", providerStatus: "NO_API_KEY" };
  }
  const question = buildAeoQuestion({ domain: brand, keyword, coreServices: services });

  const startMs = Date.now();
  let httpStatus: number | undefined;

  try {
    const endpointUrl = `${process.env.AZURE_OAI_ENDPOINT}/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-15-preview`;
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: question }],
    };
    if (process.env.BING_SEARCH_KEY) {
      body.data_sources = [{ type: "bing_search", parameters: { key: process.env.BING_SEARCH_KEY } }];
    }
    const res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "api-key": process.env.AZURE_OAI_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.AI_COPILOT_MS),
    });

    httpStatus = res.status;

    if (!res.ok) {
      const durationMs = Date.now() - startMs;
      const telemetry: ProviderTelemetry = { provider: "azure_oai", operation: "aeo_mention_check", status: "PROVIDER_ERROR", httpStatus, durationMs };
      logger.error("[Multi-Model] Copilot API error:", telemetry);
      return { model: "Copilot", mentioned: null, confidence: null, details: `Azure OAI error: ${res.status}`, providerStatus: "PROVIDER_ERROR" };
    }

    const data = await res.json();
    const durationMs = Date.now() - startMs;
    const content: string = data.choices?.[0]?.message?.content ?? "";

    if (!content) {
      logger.info("[Multi-Model] Copilot returned empty response:", { provider: "azure_oai", operation: "aeo_mention_check", status: "NO_RESULT", durationMs });
      return { model: "Copilot", mentioned: false, confidence: 0, details: "Copilot returned no content", providerStatus: "NO_RESULT" };
    }

    const mentioned = content.toLowerCase().includes(brand.toLowerCase());
    const quality = analyzeCitationQuality(content, brand);

    const telemetry: ProviderTelemetry = { provider: "azure_oai", operation: "aeo_mention_check", status: "SUCCESS", httpStatus: 200, durationMs };
    logger.info("[Multi-Model] Copilot check completed:", telemetry);

    return {
      model: "Copilot",
      mentioned,
      confidence: mentioned ? quality.positionScore : 0,
      snippet: content.substring(0, 300),
      details: mentioned
        ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}`
        : "Not mentioned by Copilot",
      quality: mentioned ? quality : undefined,
      providerStatus: "SUCCESS",
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startMs;
    const providerStatus: ProviderStatus = classifyError(error);
    const telemetry: ProviderTelemetry = { provider: "azure_oai", operation: "aeo_mention_check", status: providerStatus, httpStatus, durationMs, error: (error as Error)?.message || String(error) };
    logger.error("[Multi-Model] Copilot check failed:", telemetry);
    return { model: "Copilot", mentioned: null, confidence: null, details: `Check failed: ${providerStatus}`, providerStatus };
  }
}

export async function checkCopilotVisibility(brand: string, query: string): Promise<number> {
  if (!process.env.AZURE_OAI_ENDPOINT || !process.env.AZURE_OAI_KEY) return 0;
  try {
    const url = `${process.env.AZURE_OAI_ENDPOINT}/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-15-preview`;
    const body: Record<string, unknown> = { messages: [{ role: "user", content: query }] };
    if (process.env.BING_SEARCH_KEY) {
      body.data_sources = [{ type: "bing_search", parameters: { key: process.env.BING_SEARCH_KEY } }];
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "api-key": process.env.AZURE_OAI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.AI_COPILOT_MS),
    });
    if (!res.ok) throw new Error(`Azure OAI error: ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    return text.toLowerCase().includes(brand.toLowerCase()) ? 100 : 0;
  } catch (error: unknown) {
    logger.warn("[AEO/Copilot] Check failed:", { error: (error as Error)?.message || String(error) });
    return 0;
  }
}
