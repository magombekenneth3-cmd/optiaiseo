import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AIProviderError,
    providerHttpError,
    withProviderRetries,
} from "@/lib/ai/provider-reliability";

describe("AI provider reliability", () => {
    const originalEnv = {
        openai: process.env.OPENAI_API_KEY,
        anthropic: process.env.ANTHROPIC_API_KEY,
        gemini: process.env.GEMINI_API_KEY,
        preferred: process.env.PRIMARY_AI_PROVIDER,
    };

    beforeEach(() => {
        vi.useFakeTimers();
        process.env.OPENAI_API_KEY = "test-openai-key";
        process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
        delete process.env.GEMINI_API_KEY;
        process.env.PRIMARY_AI_PROVIDER = "openai";
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (originalEnv.openai === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = originalEnv.openai;
        if (originalEnv.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = originalEnv.anthropic;
        if (originalEnv.gemini === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalEnv.gemini;
        if (originalEnv.preferred === undefined) delete process.env.PRIMARY_AI_PROVIDER;
        else process.env.PRIMARY_AI_PROVIDER = originalEnv.preferred;
    });

    it("captures sanitized HTTP metadata and never exposes provider response bodies", async () => {
        const response = new Response(JSON.stringify({ error: { message: "secret prompt and key" } }), {
            status: 503,
            headers: { "x-request-id": "provider-req-9", "retry-after": "2" },
        });
        const error = await providerHttpError(response, "openai", "gpt-4o", "local-req-4");

        expect(error).toMatchObject({
            provider: "openai",
            modelId: "gpt-4o",
            category: "provider_unavailable",
            status: 503,
            requestId: "local-req-4",
            providerRequestId: "provider-req-9",
            retryAfterMs: 2_000,
            retryable: true,
        });
        expect(error.message).not.toContain("secret prompt");
    });

    it("retries transient failures only up to the configured bound", async () => {
        let calls = 0;
        const work = withProviderRetries({
            provider: "openai",
            modelId: "gpt-4o",
            requestId: "local-req",
            timeoutMs: 100,
            maxAttempts: 2,
            call: async () => {
                calls++;
                throw new AIProviderError("openai", "gpt-4o", "provider_unavailable", "local-req", undefined, 503, true);
            },
        });
        const rejection = expect(work).rejects.toMatchObject({ category: "provider_unavailable", status: 503 });
        await vi.runAllTimersAsync();
        await rejection;
        expect(calls).toBe(2);
    });

    it("does not retry permanent authentication failures", async () => {
        let calls = 0;
        await expect(withProviderRetries({
            provider: "openai",
            modelId: "gpt-4o",
            requestId: "local-req",
            timeoutMs: 100,
            maxAttempts: 3,
            call: async () => {
                calls++;
                throw new AIProviderError("openai", "gpt-4o", "authentication", "local-req", undefined, 401, false);
            },
        })).rejects.toMatchObject({ category: "authentication", status: 401 });
        expect(calls).toBe(1);
    });

    it("keeps the blog pipeline available when OpenAI is configured without Gemini", async () => {
        const { hasConfiguredAiProvider } = await import("@/lib/blog/ai-client");
        expect(process.env.GEMINI_API_KEY).toBeUndefined();
        expect(hasConfiguredAiProvider()).toBe(true);
    });

    it("uses a working Anthropic JSON fallback after OpenAI 503 retries", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes("api.openai.com")) {
                return new Response(JSON.stringify({ error: { message: "private provider body" } }), {
                    status: 503,
                    headers: { "retry-after": "0.001", "x-request-id": "openai-req" },
                });
            }
            if (url.includes("api.anthropic.com")) {
                return new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }] }), {
                    status: 200,
                    headers: { "request-id": "anthropic-req" },
                });
            }
            throw new Error("Unexpected provider URL");
        });

        const { generateWithFallbackJson } = await import("@/lib/blog/ai-client");
        const work = generateWithFallbackJson<{ ok: boolean }>({ prompt: "return {ok:true}" });
        await vi.runAllTimersAsync();
        await expect(work).resolves.toEqual({ ok: true });
        expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("api.openai.com"))).toHaveLength(2);
        expect(fetchMock.mock.calls.some(([input]) => String(input).includes("api.anthropic.com"))).toBe(true);
    });

    it("treats invalid provider JSON as a fallback decision and parses Anthropic response shape", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes("api.openai.com")) {
                return new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
                    status: 200,
                    headers: { "x-request-id": "openai-invalid-json" },
                });
            }
            if (url.includes("api.anthropic.com")) {
                return new Response(JSON.stringify({ content: [{ type: "text", text: '{"answer":42}' }] }), {
                    status: 200,
                    headers: { "request-id": "anthropic-json" },
                });
            }
            throw new Error("Unexpected provider URL");
        });

        const { generateWithFallbackJson } = await import("@/lib/blog/ai-client");
        await expect(generateWithFallbackJson<{ answer: number }>({ prompt: "return JSON" }))
            .resolves.toEqual({ answer: 42 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
