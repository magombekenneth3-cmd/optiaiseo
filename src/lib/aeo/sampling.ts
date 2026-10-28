import { buildAeoQuestion, type AeoPromptInput } from "./aeo-prompt";
import type { MentionResult } from "./multi-model";

export const AEO_PROMPT_SET_VERSION = "2026.1";

export interface EngineSampleStats {
  model: string;
  sampleCount: number;
  successfulSamples: number;
  mentionRate: number;
  meanConfidence: number;
  marginOfError: number;
  confidenceBand: [lower: number, upper: number];
}

export interface MultiEngineSamplingSummary {
  promptSetVersion: string;
  totalEngines: number;
  totalSamples: number;
  overallScore: number;
  overallMarginOfError: number;
  overallConfidenceBand: [lower: number, upper: number];
  engineBreakdown: Record<string, EngineSampleStats>;
}

export function generatePromptVariants(input: AeoPromptInput, sampleSize = 3): string[] {
  const base = buildAeoQuestion(input);
  const size = Math.max(3, sampleSize);

  if (input.question?.trim()) {
    return [
      input.question.trim(),
      `Regarding "${input.question.trim()}": what are the top verified recommendations and industry consensus?`,
      `Compare the leading solutions for "${input.question.trim()}". Which platforms stand out?`,
    ].slice(0, size);
  }

  const subject = input.keyword ?? input.coreServices ?? input.domain;

  return [
    base,
    `What are the most reputable and recommended solutions for ${subject}? Compare top choices with practical pros and cons.`,
    `Which companies or platforms lead the industry in ${subject}? Provide an objective breakdown of market leaders.`,
  ].slice(0, size);
}

export function computeEngineStats(model: string, samples: MentionResult[]): EngineSampleStats {
  const valid = samples.filter((s) => s.providerStatus === "SUCCESS" || s.providerStatus === "NO_RESULT");
  const sampleCount = samples.length;
  const successfulSamples = valid.length;

  if (successfulSamples === 0) {
    return {
      model,
      sampleCount,
      successfulSamples: 0,
      mentionRate: 0,
      meanConfidence: 0,
      marginOfError: 0,
      confidenceBand: [0, 0],
    };
  }

  const mentions = valid.filter((s) => s.mentioned === true);
  const mentionRate = Number((mentions.length / successfulSamples).toFixed(2));

  const confidences = valid.map((s) => (s.mentioned === true ? (s.confidence ?? 0) : 0));
  const mean = confidences.reduce((a, b) => a + b, 0) / successfulSamples;

  let variance = 0;
  if (successfulSamples > 1) {
    variance = confidences.reduce((sum, val) => sum + (val - mean) ** 2, 0) / (successfulSamples - 1);
  }
  const standardError = Math.sqrt(variance / successfulSamples);
  // 95% confidence critical value t ~ 2.0 for small samples
  const marginOfError = Number(Math.min(25, Math.max(5, 2.0 * standardError)).toFixed(1));

  const lower = Math.max(0, Math.round(mean - marginOfError));
  const upper = Math.min(100, Math.round(mean + marginOfError));

  return {
    model,
    sampleCount,
    successfulSamples,
    mentionRate,
    meanConfidence: Math.round(mean),
    marginOfError,
    confidenceBand: [lower, upper],
  };
}

export function aggregateMultiEngineSampling(
  engineResults: Record<string, MentionResult[]>
): MultiEngineSamplingSummary {
  const breakdown: Record<string, EngineSampleStats> = {};
  let totalSamples = 0;
  const means: number[] = [];
  const margins: number[] = [];

  for (const [engine, samples] of Object.entries(engineResults)) {
    const stats = computeEngineStats(engine, samples);
    breakdown[engine] = stats;
    totalSamples += stats.sampleCount;
    if (stats.successfulSamples > 0) {
      means.push(stats.meanConfidence);
      margins.push(stats.marginOfError);
    }
  }

  const overallScore = means.length > 0
    ? Math.round(means.reduce((a, b) => a + b, 0) / means.length)
    : 0;

  const overallMargin = margins.length > 0
    ? Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1))
    : 0;

  const lower = Math.max(0, Math.round(overallScore - overallMargin));
  const upper = Math.min(100, Math.round(overallScore + overallMargin));

  return {
    promptSetVersion: AEO_PROMPT_SET_VERSION,
    totalEngines: Object.keys(engineResults).length,
    totalSamples,
    overallScore,
    overallMarginOfError: overallMargin,
    overallConfidenceBand: [lower, upper],
    engineBreakdown: breakdown,
  };
}
