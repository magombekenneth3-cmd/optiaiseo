import { logger } from "@/lib/logger";

export type AIProviderName = "gemini" | "openai" | "anthropic" | "openrouter";

export type AIProviderErrorCategory =
    | "configuration"
    | "authentication"
    | "rate_limited"
    | "timeout"
    | "provider_unavailable"
    | "invalid_request"
    | "model_unavailable"
    | "invalid_json"
    | "invalid_output"
    | "network_error"
    | "provider_rejected"
    | "unknown";

export class AIProviderError extends Error {
    readonly name = "AIProviderError";

    constructor(
        readonly provider: AIProviderName,
        readonly modelId: string,
        readonly category: AIProviderErrorCategory,
        readonly requestId: string,
        readonly providerRequestId?: string,
        readonly status?: number,
        readonly retryable = false,
        readonly retryAfterMs?: number,
    ) {
        super(`${provider} ${category}${status ? ` (HTTP ${status})` : ""}`);
    }
}

export function getProviderRequestId(headers: Headers): string | undefined {
    return headers.get("x-request-id")
        ?? headers.get("request-id")
        ?? headers.get("x-goog-request-id")
        ?? headers.get("anthropic-request-id")
        ?? undefined;
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    const delay = Number.isFinite(seconds)
        ? seconds * 1_000
        : Date.parse(value) - nowMs;
    if (!Number.isFinite(delay) || delay <= 0) return undefined;
    return Math.min(Math.ceil(delay), 15_000);
}

export async function providerHttpError(
    response: Response,
    provider: AIProviderName,
    modelId: string,
    requestId: string,
): Promise<AIProviderError> {
    const status = response.status;
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    const providerRequestId = getProviderRequestId(response.headers);
    // Read the body to allow connection reuse, but never retain or log its text:
    // provider error payloads can contain prompts or other sensitive material.
    const body = await response.text().catch(() => "");
    let providerCode = "";
    try {
        const parsed = JSON.parse(body) as { error?: { code?: unknown; type?: unknown; status?: unknown } };
        const rawCode = parsed?.error?.code ?? parsed?.error?.type ?? parsed?.error?.status;
        if (typeof rawCode === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(rawCode)) {
            providerCode = rawCode.toLowerCase();
        }
    } catch {
        // HTTP status remains sufficient to classify non-JSON error responses.
    }

    const category: AIProviderErrorCategory = status === 401 || status === 403
        ? "authentication"
        : status === 429
            ? "rate_limited"
            : status === 408 || status === 504
                ? "timeout"
                : status === 404 || /model_not_found|not_found/.test(providerCode)
                    ? "model_unavailable"
                    : status >= 500
                        ? "provider_unavailable"
                        : status >= 400
                            ? "invalid_request"
                            : "provider_rejected";
    const retryable = status === 408 || status === 425 || status === 429 || status >= 500;

    return new AIProviderError(
        provider,
        modelId,
        category,
        requestId,
        providerRequestId,
        status,
        retryable,
        retryAfterMs,
    );
}

export function classifyProviderError(
    error: unknown,
    provider: AIProviderName,
    modelId: string,
    requestId: string,
): AIProviderError {
    if (error instanceof AIProviderError) return error;
    const name = error instanceof Error ? error.name : "";
    const category: AIProviderErrorCategory = name === "AbortError" || name === "TimeoutError"
        ? "timeout"
        : error instanceof TypeError
            ? "network_error"
            : "unknown";
    return new AIProviderError(
        provider,
        modelId,
        category,
        requestId,
        undefined,
        undefined,
        category === "timeout" || category === "network_error",
    );
}

export async function withProviderRetries<T>(params: {
    provider: AIProviderName;
    modelId: string;
    requestId: string;
    timeoutMs: number;
    maxAttempts?: number;
    call: (attempt: number) => Promise<T>;
}): Promise<T> {
    const maxAttempts = Math.max(1, Math.min(params.maxAttempts ?? 2, 3));
    let lastError: AIProviderError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await params.call(attempt);
        } catch (error: unknown) {
            const classified = classifyProviderError(error, params.provider, params.modelId, params.requestId);
            lastError = classified;
            const shouldRetry = classified.retryable && attempt < maxAttempts;
            logger.warn("[AI] Provider attempt failed", {
                provider: params.provider,
                modelId: params.modelId,
                category: classified.category,
                status: classified.status,
                requestId: classified.requestId,
                providerRequestId: classified.providerRequestId,
                attempt,
                maxAttempts,
                timeoutMs: params.timeoutMs,
                retrying: shouldRetry,
                retryAfterMs: classified.retryAfterMs,
            });
            if (!shouldRetry) throw classified;

            const exponential = Math.min(300 * 2 ** (attempt - 1), 3_000);
            const jittered = Math.round(exponential * (0.8 + Math.random() * 0.4));
            const waitMs = classified.retryAfterMs ?? jittered;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }

    throw lastError ?? new AIProviderError(
        params.provider,
        params.modelId,
        "unknown",
        params.requestId,
    );
}

export function logProviderFallback(
    failed: AIProviderError,
    nextProvider: AIProviderName,
): void {
    logger.warn("[AI] Switching provider after failed attempt", {
        provider: failed.provider,
        nextProvider,
        modelId: failed.modelId,
        category: failed.category,
        status: failed.status,
        requestId: failed.requestId,
        providerRequestId: failed.providerRequestId,
    });
}

export interface FallbackProviderStep<T> {
    provider: AIProviderName;
    modelId: string;
    call: (attempt: number) => Promise<T>;
}

export async function withProviderFallbackChain<T>(params: {
    requestId: string;
    timeoutMs: number;
    steps: FallbackProviderStep<T>[];
}): Promise<{ result: T; providerUsed: AIProviderName; modelUsed: string; fallbackOccurred: boolean }> {
    if (!params.steps || params.steps.length === 0) {
        throw new Error("withProviderFallbackChain requires at least one provider step");
    }

    let lastError: unknown;
    for (let i = 0; i < params.steps.length; i++) {
        const step = params.steps[i];
        try {
            const result = await withProviderRetries({
                provider: step.provider,
                modelId: step.modelId,
                requestId: params.requestId,
                timeoutMs: params.timeoutMs,
                maxAttempts: 2,
                call: step.call,
            });
            return {
                result,
                providerUsed: step.provider,
                modelUsed: step.modelId,
                fallbackOccurred: i > 0,
            };
        } catch (error: unknown) {
            lastError = error;
            const nextStep = params.steps[i + 1];
            if (nextStep) {
                const classified = classifyProviderError(error, step.provider, step.modelId, params.requestId);
                logProviderFallback(classified, nextStep.provider);
            }
        }
    }

    throw lastError;
}

