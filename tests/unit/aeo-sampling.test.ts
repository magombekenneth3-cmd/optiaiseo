import { describe, it, expect } from "vitest";
import {
  generatePromptVariants,
  computeEngineStats,
  aggregateMultiEngineSampling,
  AEO_PROMPT_SET_VERSION,
} from "@/lib/aeo/sampling";
import type { MentionResult } from "@/lib/aeo/multi-model";

describe("AEO Sampling Rigor & Confidence Bands Unit Tests", () => {
  it("generates N >= 3 versioned prompt variations", () => {
    const variants = generatePromptVariants({
      domain: "optiaiseo.online",
      keyword: "ai search optimization",
    });
    expect(variants.length).toBeGreaterThanOrEqual(3);
    expect(variants[0]).toContain("best ai search optimization tools");
    expect(variants[1]).toContain("ai search optimization");
    expect(AEO_PROMPT_SET_VERSION).toBe("2026.1");
  });

  it("computes truthful statistics and confidence bands for an engine's repeated samples", () => {
    const samples: MentionResult[] = [
      { model: "ChatGPT", mentioned: true, confidence: 90, providerStatus: "SUCCESS" },
      { model: "ChatGPT", mentioned: true, confidence: 85, providerStatus: "SUCCESS" },
      { model: "ChatGPT", mentioned: false, confidence: 0, providerStatus: "SUCCESS" },
    ];

    const stats = computeEngineStats("ChatGPT", samples);
    expect(stats.sampleCount).toBe(3);
    expect(stats.successfulSamples).toBe(3);
    expect(stats.mentionRate).toBeCloseTo(0.67, 2);
    expect(stats.meanConfidence).toBe(58); // (90 + 85 + 0) / 3 = 58.33 -> 58
    expect(stats.marginOfError).toBeGreaterThan(0);
    expect(stats.confidenceBand[0]).toBeLessThanOrEqual(stats.meanConfidence);
    expect(stats.confidenceBand[1]).toBeGreaterThanOrEqual(stats.meanConfidence);
  });

  it("aggregates multi-engine sampling with per-engine split and composite confidence interval", () => {
    const engineResults: Record<string, MentionResult[]> = {
      ChatGPT: [
        { model: "ChatGPT", mentioned: true, confidence: 90, providerStatus: "SUCCESS" },
        { model: "ChatGPT", mentioned: true, confidence: 80, providerStatus: "SUCCESS" },
        { model: "ChatGPT", mentioned: true, confidence: 85, providerStatus: "SUCCESS" },
      ],
      Perplexity: [
        { model: "Perplexity", mentioned: true, confidence: 95, providerStatus: "SUCCESS" },
        { model: "Perplexity", mentioned: true, confidence: 90, providerStatus: "SUCCESS" },
        { model: "Perplexity", mentioned: true, confidence: 92, providerStatus: "SUCCESS" },
      ],
      Claude: [
        { model: "Claude", mentioned: false, confidence: null, providerStatus: "PROVIDER_ERROR" },
        { model: "Claude", mentioned: false, confidence: null, providerStatus: "PROVIDER_ERROR" },
        { model: "Claude", mentioned: false, confidence: null, providerStatus: "PROVIDER_ERROR" },
      ],
    };

    const summary = aggregateMultiEngineSampling(engineResults);
    expect(summary.promptSetVersion).toBe("2026.1");
    expect(summary.totalEngines).toBe(3);
    expect(summary.totalSamples).toBe(9);
    expect(summary.overallScore).toBe(89); // avg of ChatGPT (85) and Perplexity (92)
    expect(summary.engineBreakdown.ChatGPT.mentionRate).toBe(1.0);
    expect(summary.engineBreakdown.Perplexity.mentionRate).toBe(1.0);
    expect(summary.engineBreakdown.Claude.successfulSamples).toBe(0);
  });
});
