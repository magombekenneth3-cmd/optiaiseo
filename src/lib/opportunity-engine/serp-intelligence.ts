import { getSerpContextForKeyword, type SerpContext } from "@/lib/blog/serp";
import type {
  ConsolidatedOpportunity,
  OpportunityIntelligence,
  SerpEvidenceStatus,
} from "./types";
import { analyzeSerpConsensus } from "@/lib/intelligence/intent-profiler";

const DEFAULT_MAX_LOOKUPS = 5;
const LOOKUP_CONCURRENCY = 2;

export type SerpContextLoader = (keyword: string) => Promise<SerpContext | null>;

export interface OpportunityIntelligenceOptions {
  loadSerpContext?: SerpContextLoader;
  serpConfigured?: boolean;
  maxLookups?: number;
}

async function loadInBatches(
  keywords: string[],
  loader: SerpContextLoader,
  concurrency: number,
): Promise<Map<string, SerpContext | null>> {
  const contexts = new Map<string, SerpContext | null>();

  for (let start = 0; start < keywords.length; start += concurrency) {
    const batch = keywords.slice(start, start + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (keyword) => ({
        keyword,
        context: await loader(keyword),
      })),
    );

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const keyword = batch[index];
      contexts.set(
        keyword,
        result.status === "fulfilled" ? result.value.context : null,
      );
    }
  }

  return contexts;
}

export async function buildOpportunityIntelligence(
  opportunities: ConsolidatedOpportunity[],
  options: OpportunityIntelligenceOptions = {},
): Promise<Map<string, OpportunityIntelligence>> {
  const maxLookups = Math.max(
    0,
    Math.floor(options.maxLookups ?? DEFAULT_MAX_LOOKUPS),
  );
  const serpConfigured =
    options.serpConfigured ?? Boolean(process.env.SERPER_API_KEY);
  const loader =
    options.loadSerpContext ??
    ((keyword: string) => getSerpContextForKeyword(keyword, false));

  const bestOpportunityByKeyword = new Map<string, ConsolidatedOpportunity>();
  for (const opportunity of opportunities) {
    const keyword = opportunity.keyword.trim();
    if (!keyword) continue;

    const current = bestOpportunityByKeyword.get(keyword);
    if (!current || opportunity.impressions > current.impressions) {
      bestOpportunityByKeyword.set(keyword, opportunity);
    }
  }

  const prioritizedKeywords = [...bestOpportunityByKeyword.entries()]
    .sort(([, a], [, b]) => b.impressions - a.impressions)
    .map(([keyword]) => keyword);
  const requestedKeywords =
    serpConfigured && maxLookups > 0
      ? prioritizedKeywords.slice(0, maxLookups)
      : [];
  const requestedSet = new Set(requestedKeywords);

  const contexts = requestedKeywords.length > 0
    ? await loadInBatches(requestedKeywords, loader, LOOKUP_CONCURRENCY)
    : new Map<string, SerpContext | null>();

  const intelligence = new Map<string, OpportunityIntelligence>();
  for (const keyword of bestOpportunityByKeyword.keys()) {
    const context = contexts.get(keyword) ?? null;
    const hasSerpEvidence = Boolean(context?.results?.length);
    let status: SerpEvidenceStatus;

    if (hasSerpEvidence) {
      status = "AVAILABLE";
    } else if (!serpConfigured || requestedSet.has(keyword)) {
      status = "UNAVAILABLE";
    } else {
      status = "NOT_REQUESTED";
    }

    intelligence.set(
      keyword,
      analyzeSerpConsensus(keyword, context, status),
    );
  }

  return intelligence;
}
