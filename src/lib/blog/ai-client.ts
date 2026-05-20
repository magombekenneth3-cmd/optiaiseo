import { AI_MODELS } from "@/lib/constants/ai-models";
import { callGemini, callGeminiJson } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";

type Provider = "gemini" | "openai" | "anthropic" | "openrouter";

interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  preferredProvider?: Provider;
}

export async function generateWithFallback(opts: GenerateOptions): Promise<string> {
  const preferred = opts.preferredProvider || (process.env.PRIMARY_AI_PROVIDER as Provider) || "openai";

  const providers: Array<{ name: Provider; fn: () => Promise<string> }> = [
    {
      name: "gemini",
      fn: async () => callGemini(opts.prompt, {
        model: opts.model ?? AI_MODELS.GEMINI_FLASH,
        temperature: opts.temperature,
      }),
    },
    {
      name: "openai",
      fn: async () => {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const res = await client.chat.completions.create({
          model: AI_MODELS.OPENAI_PRIMARY, // gpt-4o
          messages: [
            ...(opts.systemPrompt
              ? [{ role: "system" as const, content: opts.systemPrompt }]
              : []),
            { role: "user", content: opts.prompt },
          ],
          max_tokens: opts.maxTokens ?? 4096,
          ...(opts.temperature !== undefined && { temperature: opts.temperature }),
        });
        return res.choices[0]?.message?.content ?? "";
      },
    },
    {
      name: "anthropic",
      fn: async () => {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: AI_MODELS.ANTHROPIC_SONNET,
            max_tokens: opts.maxTokens ?? 4096,
            ...(opts.temperature !== undefined && { temperature: opts.temperature }),
            ...(opts.systemPrompt && {
              system: opts.systemPrompt,
            }),
            messages: [{ role: "user", content: opts.prompt }],
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Anthropic error: ${res.statusText} ${errText}`);
        }
        const data = await res.json();
        return data.content?.[0]?.text ?? "";
      },
    },
    {
      name: "openrouter",
      fn: async () => {
        if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://optiaiseo.online",
            "X-Title": "OptiAISEO",
          },
          body: JSON.stringify({
            model: "meta-llama/llama-3.1-405b-instruct",
            messages: [
              ...(opts.systemPrompt
                ? [{ role: "system", content: opts.systemPrompt }]
                : []),
              { role: "user", content: opts.prompt },
            ],
            max_tokens: opts.maxTokens ?? 4096,
            ...(opts.temperature !== undefined && { temperature: opts.temperature }),
          }),
        });
        if (!res.ok) throw new Error(`OpenRouter error: ${res.statusText}`);
        const data = await res.json();
        return data.choices[0]?.message?.content ?? "";
      },
    },
  ];

  // Reorder providers so that the preferred provider is tried first.
  const sortedProviders = [...providers].sort((a, b) => {
    if (a.name === preferred) return -1;
    if (b.name === preferred) return 1;
    return 0;
  });

  let lastError: Error | null = null;

  for (const provider of sortedProviders) {
    try {
      const result = await provider.fn();
      if (provider.name !== preferred) {
        logger.warn(`[AI] Primary provider "${preferred}" failed, fell back to ${provider.name}`);
      }
      return result;
    } catch (err) {
      lastError = err as Error;
      logger.warn(`[AI] Provider "${provider.name}" failed`, {
        error: lastError.message,
      });
    }
  }

  throw new Error(`All AI providers failed. Last error: ${lastError?.message}`);
}

export async function generateWithFallbackJson<T>(
  opts: GenerateOptions & { validate?: (data: unknown) => T }
): Promise<T> {
  const preferred = opts.preferredProvider || (process.env.PRIMARY_AI_PROVIDER as Provider) || "openai";
  const jsonPrompt = opts.prompt + "\n\nRespond ONLY with valid JSON. No markdown fences, no wrapping.";

  const providers: Array<{ name: Provider; fn: () => Promise<T> }> = [
    {
      name: "gemini",
      fn: async () => callGeminiJson<T>(opts.prompt, {
        model: opts.model ?? AI_MODELS.GEMINI_FLASH,
        validate: opts.validate,
      }),
    },
    {
      name: "openai",
      fn: async () => {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const res = await client.chat.completions.create({
          model: AI_MODELS.OPENAI_PRIMARY,
          messages: [
            ...(opts.systemPrompt
              ? [{ role: "system" as const, content: opts.systemPrompt }]
              : []),
            { role: "user", content: jsonPrompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: opts.maxTokens ?? 4096,
        });
        const text = res.choices[0]?.message?.content ?? "";
        const parsed = JSON.parse(text);
        return opts.validate ? opts.validate(parsed) : (parsed as T);
      },
    },
    {
      name: "anthropic",
      fn: async () => {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: AI_MODELS.ANTHROPIC_SONNET,
            max_tokens: opts.maxTokens ?? 4096,
            system: (opts.systemPrompt ?? "") + "\n\nRespond ONLY with valid JSON.",
            messages: [{ role: "user", content: jsonPrompt }],
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Anthropic error: ${res.statusText} ${errText}`);
        }
        const data = await res.json();
        const text = data.content?.[0]?.text ?? "";
        const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();
        const parsed = JSON.parse(clean);
        return opts.validate ? opts.validate(parsed) : (parsed as T);
      },
    },
    {
      name: "openrouter",
      fn: async () => {
        if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://optiaiseo.online",
            "X-Title": "OptiAISEO",
          },
          body: JSON.stringify({
            model: "meta-llama/llama-3.1-405b-instruct",
            messages: [
              ...(opts.systemPrompt
                ? [{ role: "system", content: opts.systemPrompt }]
                : []),
              { role: "user", content: jsonPrompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: opts.maxTokens ?? 4096,
          }),
        });
        if (!res.ok) throw new Error(`OpenRouter error: ${res.statusText}`);
        const data = await res.json();
        const text = data.choices[0]?.message?.content ?? "";
        const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();
        const parsed = JSON.parse(clean);
        return opts.validate ? opts.validate(parsed) : (parsed as T);
      },
    },
  ];

  // Reorder providers so that the preferred provider is tried first.
  const sortedProviders = [...providers].sort((a, b) => {
    if (a.name === preferred) return -1;
    if (b.name === preferred) return 1;
    return 0;
  });

  let lastError: Error | null = null;

  for (const provider of sortedProviders) {
    try {
      const result = await provider.fn();
      if (provider.name !== preferred) {
        logger.warn(`[AI] JSON provider "${preferred}" failed, fell back to ${provider.name}`);
      }
      return result;
    } catch (err) {
      lastError = err as Error;
      logger.warn(`[AI] JSON Provider "${provider.name}" failed`, {
        error: lastError.message,
      });
    }
  }

  throw new Error(`All AI JSON providers failed. Last error: ${lastError?.message}`);
}
