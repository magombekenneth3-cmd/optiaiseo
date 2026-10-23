import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { callGemini, callGeminiJson } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";
import {
  AIProviderError,
  classifyProviderError,
  getProviderRequestId,
  logProviderFallback,
  providerHttpError,
  withProviderRetries,
  type AIProviderName,
} from "@/lib/ai/provider-reliability";

const PROVIDER_TIMEOUT_MS = 60_000;

export const getAiClient = () => {
  if (!process.env.GEMINI_API_KEY) return null;
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 120000 } });
};

export function hasConfiguredAiProvider(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENROUTER_API_KEY
  );
}

interface ProviderTextResult {
  text: string;
  provider: AIProviderName;
  modelId: string;
  requestId: string;
  providerRequestId?: string;
}

interface ChatRequest {
  provider: Exclude<AIProviderName, "gemini">;
  modelId: string;
  url: string;
  apiKey: string | undefined;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

function missingKey(provider: AIProviderName, modelId: string): AIProviderError {
  return new AIProviderError(provider, modelId, "configuration", crypto.randomUUID());
}

async function postChatCompletion(request: ChatRequest): Promise<ProviderTextResult> {
  const requestId = crypto.randomUUID();
  const apiKey = request.apiKey;
  if (!apiKey) throw missingKey(request.provider, request.modelId);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(request.provider === "openai" || request.provider === "openrouter"
      ? { Authorization: `Bearer ${apiKey}` }
      : { "x-api-key": apiKey }),
    ...(request.provider === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
    ...(request.headers ?? {}),
  };

  const response = await withProviderRetries({
    provider: request.provider,
    modelId: request.modelId,
    requestId,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    maxAttempts: 2,
    call: async () => {
      const response = await fetch(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw await providerHttpError(response, request.provider, request.modelId, requestId);
      }
      return response;
    },
  });

  const providerRequestId = getProviderRequestId(response.headers);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AIProviderError(request.provider, request.modelId, "invalid_output", requestId, providerRequestId, response.status);
  }

  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  let text = "";
  if (request.provider === "anthropic") {
    const content = Array.isArray(root.content) ? root.content : [];
    text = content
      .filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
      .map((part) => typeof part.text === "string" ? part.text : "")
      .join("");
  } else {
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const firstChoice = choices[0] && typeof choices[0] === "object"
      ? choices[0] as Record<string, unknown>
      : {};
    const message = firstChoice.message && typeof firstChoice.message === "object"
      ? firstChoice.message as Record<string, unknown>
      : {};
    text = typeof message.content === "string" ? message.content : "";
  }
  if (!text.trim()) {
    throw new AIProviderError(request.provider, request.modelId, "invalid_output", requestId, providerRequestId, response.status);
  }

  logger.info("[AI] Provider request succeeded", {
    provider: request.provider,
    modelId: request.modelId,
    requestId,
    providerRequestId,
    timeoutMs: PROVIDER_TIMEOUT_MS,
  });
  return { text, provider: request.provider, modelId: request.modelId, requestId, providerRequestId };
}

async function callOpenAi(params: {
  prompt: string;
  systemPrompt?: string;
  maxTokens: number;
  temperature?: number;
  json?: boolean;
}): Promise<ProviderTextResult> {
  return postChatCompletion({
    provider: "openai",
    modelId: AI_MODELS.OPENAI_PRIMARY,
    url: "https://api.openai.com/v1/chat/completions",
    apiKey: process.env.OPENAI_API_KEY,
    body: {
      model: AI_MODELS.OPENAI_PRIMARY,
      messages: [
        ...(params.systemPrompt ? [{ role: "system", content: params.systemPrompt }] : []),
        { role: "user", content: params.prompt },
      ],
      ...(params.json ? { response_format: { type: "json_object" } } : {}),
      max_tokens: params.maxTokens,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    },
  });
}

type GenerateOptions = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  preferredProvider?: AIProviderName;
};

type ProviderAttempt<T> = {
  name: AIProviderName;
  modelId: string;
  call: () => Promise<T>;
  callDetailed?: () => Promise<ProviderTextResult>;
};

function getPreferredProvider(value?: string): AIProviderName {
  const preferred = value || process.env.PRIMARY_AI_PROVIDER || "openai";
  if (["gemini", "openai", "anthropic", "openrouter"].includes(preferred)) {
    return preferred as AIProviderName;
  }
  logger.warn("[AI] Invalid preferred provider configured; using OpenAI", {
    provider: "configuration",
    category: "configuration",
  });
  return "openai";
}

function buildProviderAttempts(opts: GenerateOptions, json: boolean): ProviderAttempt<string>[] {
  const jsonPrompt = json
    ? `${opts.prompt}\n\nRespond ONLY with valid JSON. No markdown fences, no wrapping.`
    : opts.prompt;

  const openAiCall = () => callOpenAi({
    prompt: jsonPrompt,
    systemPrompt: opts.systemPrompt,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
    json,
  });
  const anthropicCall = () => postChatCompletion({
    provider: "anthropic",
    modelId: AI_MODELS.ANTHROPIC_SONNET,
    url: "https://api.anthropic.com/v1/messages",
    apiKey: process.env.ANTHROPIC_API_KEY,
    body: {
      model: AI_MODELS.ANTHROPIC_SONNET,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      messages: [{ role: "user", content: jsonPrompt }],
    },
  });
  const openRouterCall = () => postChatCompletion({
    provider: "openrouter",
    modelId: "meta-llama/llama-3.1-405b-instruct",
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: {
      "HTTP-Referer": "https://optiaiseo.online",
      "X-Title": "OptiAISEO",
    },
    body: {
      model: "meta-llama/llama-3.1-405b-instruct",
      messages: [
        ...(opts.systemPrompt ? [{ role: "system", content: opts.systemPrompt }] : []),
        { role: "user", content: jsonPrompt },
      ],
      ...(json ? { response_format: { type: "json_object" } } : {}),
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
  });

  return [
    {
      name: "gemini",
      modelId: opts.model ?? AI_MODELS.GEMINI_FLASH,
      call: () => callGemini(jsonPrompt, {
        model: opts.model ?? AI_MODELS.GEMINI_FLASH,
        temperature: opts.temperature,
        responseFormat: json ? "json" : "text",
      }),
    },
    {
      name: "openai",
      modelId: AI_MODELS.OPENAI_PRIMARY,
      call: async () => (await openAiCall()).text,
      callDetailed: openAiCall,
    },
    {
      name: "anthropic",
      modelId: AI_MODELS.ANTHROPIC_SONNET,
      call: async () => (await anthropicCall()).text,
      callDetailed: anthropicCall,
    },
    {
      name: "openrouter",
      modelId: "meta-llama/llama-3.1-405b-instruct",
      call: async () => (await openRouterCall()).text,
      callDetailed: openRouterCall,
    },
  ];
}

async function routeProviders<T>(
  attempts: ProviderAttempt<T>[],
  preferred: AIProviderName,
  label: "text" | "json",
): Promise<{ value: T; provider: AIProviderName; modelId: string }> {
  const ordered = [
    ...attempts.filter((attempt) => attempt.name === preferred),
    ...attempts.filter((attempt) => attempt.name !== preferred),
  ];
  let lastError: AIProviderError | undefined;

  for (let index = 0; index < ordered.length; index++) {
    const attempt = ordered[index];
    try {
      const value = await attempt.call();
      if (attempt.name !== preferred) {
        logger.warn(`[AI] ${label} generation used fallback provider`, {
          preferredProvider: preferred,
          provider: attempt.name,
          modelId: attempt.modelId,
        });
      }
      return { value, provider: attempt.name, modelId: attempt.modelId };
    } catch (error: unknown) {
      const classified = classifyProviderError(error, attempt.name, attempt.modelId, crypto.randomUUID());
      lastError = classified;
      const next = ordered[index + 1];
      if (next) logProviderFallback(classified, next.name);
      else {
        logger.error(`[AI] No ${label} providers remain`, {
          provider: classified.provider,
          modelId: classified.modelId,
          category: classified.category,
          status: classified.status,
          requestId: classified.requestId,
          providerRequestId: classified.providerRequestId,
        });
      }
    }
  }

  throw lastError ?? new AIProviderError(preferred, "unknown", "unknown", crypto.randomUUID());
}

export async function generateWithFallback(opts: GenerateOptions): Promise<string> {
  const preferred = getPreferredProvider(opts.preferredProvider);
  const result = await routeProviders(buildProviderAttempts(opts, false), preferred, "text");
  return result.value;
}

export async function generateWithFallbackJson<T>(
  opts: GenerateOptions & { validate?: (data: unknown) => T }
): Promise<T> {
  const preferred = getPreferredProvider(opts.preferredProvider);
  const attempts: ProviderAttempt<T>[] = buildProviderAttempts(opts, true).map((attempt) => ({
    name: attempt.name,
    modelId: attempt.modelId,
    call: async () => {
      if (attempt.name === "gemini") {
        return callGeminiJson<T>(opts.prompt, {
          model: opts.model ?? AI_MODELS.GEMINI_FLASH,
          validate: opts.validate,
        });
      }

      const result = await attempt.callDetailed!();
      const clean = result.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/m, "")
        .replace(/```\s*$/m, "")
        .trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(clean);
      } catch {
        logger.warn("[AI] Provider returned invalid JSON", {
          provider: attempt.name,
          modelId: attempt.modelId,
          category: "invalid_json",
          status: 200,
          requestId: result.requestId,
          providerRequestId: result.providerRequestId,
        });
        throw new AIProviderError(attempt.name, attempt.modelId, "invalid_json", result.requestId, result.providerRequestId, 200);
      }
      try {
        return opts.validate ? opts.validate(parsed) : parsed as T;
      } catch {
        logger.warn("[AI] Provider JSON failed output validation", {
          provider: attempt.name,
          modelId: attempt.modelId,
          category: "invalid_output",
          status: 200,
          requestId: result.requestId,
          providerRequestId: result.providerRequestId,
        });
        throw new AIProviderError(attempt.name, attempt.modelId, "invalid_output", result.requestId, result.providerRequestId, 200);
      }
    },
  }));

  const result = await routeProviders(attempts, preferred, "json");
  return result.value;
}
