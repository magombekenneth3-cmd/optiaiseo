import { AI_MODELS } from "@/lib/constants/ai-models";
import { callGemini, callGeminiJson } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";

type Provider = "gemini" | "openai" | "anthropic";

interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  preferredProvider?: Provider;
}

export async function generateWithFallback(opts: GenerateOptions): Promise<string> {
  const providers: Array<{ name: string; fn: () => Promise<string> }> = [
    {
      name: "gemini",
      fn: async () => callGemini(opts.prompt, {
        model: opts.model ?? AI_MODELS.GEMINI_FLASH,
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
        });
        return res.choices[0]?.message?.content ?? "";
      },
    },
    {
      name: "anthropic",
      fn: async () => {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const res = await client.messages.create({
          model: AI_MODELS.ANTHROPIC_SONNET, // claude-sonnet-4-5
          max_tokens: opts.maxTokens ?? 4096,
          ...(opts.systemPrompt && {
            system: opts.systemPrompt,
          }),
          messages: [{ role: "user", content: opts.prompt }],
        });
        return res.content[0]?.type === "text" ? res.content[0].text : "";
      },
    },
  ];

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const result = await provider.fn();
      if (provider.name !== "gemini") {
        logger.warn(`[AI] Gemini failed, used ${provider.name} fallback`);
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
  const jsonPrompt = opts.prompt + "\n\nRespond ONLY with valid JSON. No markdown fences, no wrapping.";

  const providers: Array<{ name: string; fn: () => Promise<T> }> = [
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
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const res = await client.messages.create({
          model: AI_MODELS.ANTHROPIC_SONNET,
          max_tokens: opts.maxTokens ?? 4096,
          system: (opts.systemPrompt ?? "") + "\n\nRespond ONLY with valid JSON.",
          messages: [{ role: "user", content: jsonPrompt }],
        });
        const text = res.content[0]?.type === "text" ? res.content[0].text : "";
        const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();
        const parsed = JSON.parse(clean);
        return opts.validate ? opts.validate(parsed) : (parsed as T);
      },
    },
  ];

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const result = await provider.fn();
      if (provider.name !== "gemini") {
        logger.warn(`[AI] Gemini JSON failed, used ${provider.name} fallback`);
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
