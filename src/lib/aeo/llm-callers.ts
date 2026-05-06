import { callGemini } from "@/lib/gemini/client";

// OpenAI configuration
export async function callGpt4o(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.statusText}`);
  const data = await res.json();
  return data.choices[0].message.content || "";
}

// ── Perplexity plain-text helper (backwards-compatible) ──────────────────────
export async function callPerplexity(prompt: string): Promise<string> {
  const { text } = await callPerplexityWithCitations(prompt);
  return text;
}

/**
 * Perplexity sonar-pro with structured citations.
 * Returns the response text AND the full citations array so callers can
 * determine which URLs were actually retrieved, not just mentioned.
 *
 * Use this for AEO citation checks. Use callPerplexity() for simple queries.
 */
export interface PerplexityResponse {
  text: string;
  citations: Array<{ url: string; title?: string }>;
}

export async function callPerplexityWithCitations(
  prompt: string,
  options: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<PerplexityResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("Missing PERPLEXITY_API_KEY");

  const { maxTokens = 1024, timeoutMs = 25000 } = options;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: maxTokens,
      return_citations: true,       // ← key flag: returns actual retrieved URLs
      return_related_questions: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`Perplexity error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";

  // sonar-pro returns citations as objects { url, title }; fall back to strings
  const rawCitations: unknown[] = data.citations ?? [];
  const citations: Array<{ url: string; title?: string }> = rawCitations.map((c) => {
    if (typeof c === "string") return { url: c };
    const obj = c as Record<string, unknown>;
    return { url: String(obj.url ?? ""), title: obj.title ? String(obj.title) : undefined };
  });

  return { text, citations };
}
