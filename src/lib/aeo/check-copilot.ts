import { logger } from "@/lib/logger";
import type { MentionResult } from "./multi-model";
import { analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";

export async function checkCopilotMention(
  brand: string,
  services?: string | null
): Promise<MentionResult> {
  if (!process.env.AZURE_OAI_ENDPOINT || !process.env.AZURE_OAI_KEY) {
    return { model: "Copilot", mentioned: false, confidence: 0, details: "Azure OAI credentials missing" };
  }
  const question = services
    ? `What are the best tools for ${services}?`
    : `Tell me about ${brand}.`;
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
    if (!res.ok) throw new Error(`Azure OAI error: ${res.status}`);
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const mentioned = content.toLowerCase().includes(brand.toLowerCase());
    const quality = analyzeCitationQuality(content, brand);
    return {
      model: "Copilot",
      mentioned,
      confidence: mentioned ? quality.positionScore : 0,
      snippet: content.substring(0, 300),
      details: mentioned
        ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}`
        : "Not mentioned by Copilot",
      quality: mentioned ? quality : undefined,
    };
  } catch (error: unknown) {
    logger.error("[Multi-Model] Copilot check failed:", { error: (error as Error)?.message || String(error) });
    return { model: "Copilot", mentioned: false, confidence: 0, details: "Check failed" };
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
