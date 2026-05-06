import { logger } from "@/lib/logger";
import type { MentionResult } from "./multi-model";
import { analyzeCitationQuality } from "./multi-model";
import { TIMEOUTS } from "@/lib/constants/timeouts";

export async function checkGrokMention(
  brand: string,
  services?: string | null
): Promise<MentionResult> {
  if (!process.env.XAI_API_KEY) {
    return { model: "Grok", mentioned: false, confidence: 0, details: "xAI API key missing" };
  }
  const question = services
    ? `What are the top platforms for ${services}?`
    : `What do you know about ${brand}?`;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-3",
        // search_parameters enables live web search, matching grok.x.ai behaviour
        search_parameters: { mode: "auto" },
        messages: [{ role: "user", content: question }],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(TIMEOUTS.AI_DEFAULT_MS),
    });
    if (!res.ok) throw new Error(`xAI API error: ${res.status}`);
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const mentioned = content.toLowerCase().includes(brand.toLowerCase());
    const quality = analyzeCitationQuality(content, brand);
    return {
      model: "Grok",
      mentioned,
      confidence: mentioned ? quality.positionScore : 0,
      snippet: content.substring(0, 300),
      details: mentioned
        ? `Mentioned ${quality.mentionCount}x, position score: ${quality.positionScore}`
        : "Not mentioned by Grok",
      quality: mentioned ? quality : undefined,
    };
  } catch (error: unknown) {
    logger.error("[Multi-Model] Grok check failed:", { error: (error as Error)?.message || String(error) });
    return { model: "Grok", mentioned: false, confidence: 0, details: "Check failed" };
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