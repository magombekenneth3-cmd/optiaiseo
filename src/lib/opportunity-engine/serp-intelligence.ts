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

interface KeywordGroup {
  keyword: string;
  opportunities: ConsolidatedOpportunity[];
  maxImpressions: number;
}

async function loadInBatches(
  keywords: Array<{ key: string; keyword: string }>,
  loader: SerpContextLoader,
  concurrency: number,
): Promise<Map<string, SerpContext | null>> {
  const contexts = new Map<string, SerpContext | null>();

  for (let start = 0; start < keywords.length; start += concurrency) {
    const batch = keywords.slice(start, start + concurrency);
    const results = await Promise.allSettled(
      batch.map(async ({ key, keyword }) => ({
        key,
        context: await loader(keyword),
      })),
    );

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const key = batch[index].key;
      contexts.set(
        key,
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
  const configuredLimit = options.maxLookups ?? DEFAULT_MAX_LOOKUPS;
  const maxLookups = Number.isFinite(configuredLimit)
    ? Math.min(DEFAULT_MAX_LOOKUPS, Math.max(0, Math.floor(configuredLimit)))
    : DEFAULT_MAX_LOOKUPS;
  const serpConfigured =
    options.serpConfigured ?? Boolean(process.env.SERPER_API_KEY);
  const loader =
    options.loadSerpContext ??
    ((keyword: string) => getSerpContextForKeyword(keyword, false));

  const keywordGroups = new Map<string, KeywordGroup>();
  for (const opportunity of opportunities) {
    const keyword = opportunity.keyword.trim();
    if (!keyword) continue;

    const key = keyword.toLocaleLowerCase();
    const current = keywordGroups.get(key);
    if (!current) {
      keywordGroups.set(key, {
        keyword,
        opportunities: [opportunity],
        maxImpressions: opportunity.impressions,
      });
      continue;
    }

    current.opportunities.push(opportunity);
    current.maxImpressions = Math.max(current.maxImpressions, opportunity.impressions);
  }

  const prioritizedKeywords = [...keywordGroups.entries()]
    .sort(([, a], [, b]) => b.maxImpressions - a.maxImpressions)
    .map(([key, group]) => ({ key, keyword: group.keyword }));
  const requestedKeywords =
    serpConfigured && maxLookups > 0
      ? prioritizedKeywords.slice(0, maxLookups)
      : [];
  const requestedSet = new Set(requestedKeywords.map(({ key }) => key));

  const contexts = requestedKeywords.length > 0
    ? await loadInBatches(requestedKeywords, loader, LOOKUP_CONCURRENCY)
    : new Map<string, SerpContext | null>();

  const groupIntelligence = new Map<string, OpportunityIntelligence>();
  for (const [key, group] of keywordGroups.entries()) {
    const context = contexts.get(key) ?? null;
    const hasSerpEvidence = Boolean(context?.results?.length);
    let status: SerpEvidenceStatus;

    if (hasSerpEvidence) {
      status = "AVAILABLE";
    } else if (!serpConfigured || requestedSet.has(key)) {
      status = "UNAVAILABLE";
    } else {
      status = "NOT_REQUESTED";
    }

    groupIntelligence.set(
      key,
      analyzeSerpConsensus(group.keyword, context, status),
    );
  }

  const intelligence = new Map<string, OpportunityIntelligence>();
  for (const opportunity of opportunities) {
    const keyword = opportunity.keyword.trim();
    const intel = groupIntelligence.get(keyword.toLocaleLowerCase());
    if (intel) {
      intelligence.set(opportunity.keyword, {
        ...intel,
        keyword: opportunity.keyword,
      });
    }
  }

  return intelligence;
}
