import { describe, it, expect, vi } from "vitest";
import { withProviderFallbackChain, AIProviderError } from "@/lib/ai/provider-reliability";

describe("AI Multi-Provider Fallback Chain Tests", () => {
  it("uses primary provider when successful on first attempt", async () => {
    const chain = await withProviderFallbackChain({
      requestId: "req-1",
      timeoutMs: 5000,
      steps: [
        {
          provider: "gemini",
          modelId: "gemini-3.8-flash",
          call: async () => "Hello from Gemini",
        },
        {
          provider: "openai",
          modelId: "gpt-4o-mini",
          call: async () => "Hello from OpenAI",
        },
      ],
    });

    expect(chain.result).toBe("Hello from Gemini");
    expect(chain.providerUsed).toBe("gemini");
    expect(chain.fallbackOccurred).toBe(false);
  });

  it("automatically falls back to secondary provider when primary fails", async () => {
    let geminiAttempts = 0;
    const chain = await withProviderFallbackChain({
      requestId: "req-2",
      timeoutMs: 5000,
      steps: [
        {
          provider: "gemini",
          modelId: "gemini-3.8-flash",
          call: async () => {
            geminiAttempts++;
            throw new AIProviderError("gemini", "gemini-3.8-flash", "rate_limited", "req-2", undefined, 429, false);
          },
        },
        {
          provider: "openai",
          modelId: "gpt-4o-mini",
          call: async () => "Fallback response from OpenAI",
        },
      ],
    });

    expect(geminiAttempts).toBe(1);
    expect(chain.result).toBe("Fallback response from OpenAI");
    expect(chain.providerUsed).toBe("openai");
    expect(chain.modelUsed).toBe("gpt-4o-mini");
    expect(chain.fallbackOccurred).toBe(true);
  });

  it("propagates error when all providers in the chain fail", async () => {
    await expect(
      withProviderFallbackChain({
        requestId: "req-3",
        timeoutMs: 5000,
        steps: [
          {
            provider: "gemini",
            modelId: "gemini-3.8-flash",
            call: async () => {
              throw new AIProviderError("gemini", "gemini-3.8-flash", "rate_limited", "req-3", undefined, 429, false);
            },
          },
          {
            provider: "openai",
            modelId: "gpt-4o-mini",
            call: async () => {
              throw new AIProviderError("openai", "gpt-4o-mini", "provider_unavailable", "req-3", undefined, 503, false);
            },
          },
        ],
      })
    ).rejects.toThrow("openai provider_unavailable (HTTP 503)");
  });
});
