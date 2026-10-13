import { getSerpContextForKeyword, type SerpContext } from "@/lib/blog/serp";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { resolveLocationCode, getSerpData } from "@/lib/keywords/dataforseo";
import type {
  ConsolidatedOpportunity,
  OpportunityIntelligence,
  SerpEvidenceStatus,
} from "./types";
import { analyzeSerpConsensus } from "@/lib/intelligence/intent-profiler";

const DEFAULT_MAX_LIVE_LOOKUPS = 5;
const MAX_CACHED_KEYWORDS = 500;
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKUP_CONCURRENCY = 3;
const LIVE_LOOKUP_TIMEOUT_MS = 12_000;

type SerpEvidenceSource = "CACHED_KEYWORD_SNAPSHOT" | "LIVE_SERP";

interface LoadedSerpEvidence {
  context: SerpContext;
  source: SerpEvidenceSource;
  observedAt: string;
}

export type SerpContextLoader = (keyword: string) => Promise<SerpContext | null>;

export interface OpportunityIntelligenceOptions {
  loadSerpContext?: SerpContextLoader;
  serpConfigured?: boolean;
  maxLookups?: number;
}

interface KeywordGroup {
  keyword: string;
  maxImpressions: number;
}

interface CachedContextResult {
  contexts: Map<string, LoadedSerpEvidence>;
  locationCode: number;
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function contextFromSnapshot(keyword: string, value: unknown): SerpContext | null {
  if (!Array.isArray(value)) return null;

  const results = value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const link =
      typeof row.url === "string" ? row.url :
      typeof row.link === "string" ? row.link : "";
    if (!link) return [];

    return [{
      title: typeof row.title === "string" ? row.title : "",
      link,
      snippet: typeof row.snippet === "string" ? row.snippet : "",
      rank: typeof row.rank === "number" ? row.rank : index + 1,
    }];
  });

  if (results.length === 0) return null;

  return {
    keyword,
    results,
    peopleAlsoAsk: [],
    featuredSnippet: null,
    relatedSearches: [],
    formattedContext: "",
    opportunityAnalysis: {
      tableStakes: [],
      opportunities: [],
      unansweredQuestions: [],
    },
  };
}

async function loadFreshSnapshotContexts(
  siteId: string,
  keywordGroups: Map<string, KeywordGroup>,
): Promise<CachedContextResult> {
  const contexts = new Map<string, LoadedSerpEvidence>();
  let locationCode = 2840;

  try {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { location: true, localContext: true },
    });
    if (!site) return { contexts, locationCode };

    locationCode = resolveLocationCode(site.location?.trim() || site.localContext);
    const cacheCandidates = [...keywordGroups.entries()]
      .sort(([, a], [, b]) => b.maxImpressions - a.maxImpressions)
      .slice(0, MAX_CACHED_KEYWORDS)
      .map(([key]) => key);

    if (cacheCandidates.length === 0) return { contexts, locationCode };

    const since = new Date(Date.now() - SNAPSHOT_MAX_AGE_MS);
    const snapshots = await prisma.keywordSerpSnapshot.findMany({
      where: {
        keyword: { in: cacheCandidates },
        observedAt: { gte: since },
        run: {
          is: {
            siteId,
            locationCode,
            languageCode: "en",
            status: { in: ["COMPLETED", "PARTIAL"] },
          },
        },
      },
      orderBy: { observedAt: "desc" },
      take: Math.min(3000, Math.max(100, cacheCandidates.length * 5)),
      select: {
        keyword: true,
        results: true,
        observedAt: true,
      },
    });

    for (const snapshot of snapshots) {
      const key = normalizeKeyword(snapshot.keyword);
      if (contexts.has(key)) continue;
      const context = contextFromSnapshot(snapshot.keyword, snapshot.results);
      if (!context) continue;
      contexts.set(key, {
        context,
        source: "CACHED_KEYWORD_SNAPSHOT",
        observedAt: snapshot.observedAt.toISOString(),
      });
    }
  } catch (error: unknown) {
    logger.warn("[DecisionPipeline] Could not reuse fresh SERP snapshots", {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { contexts, locationCode };
}

function canFetchLiveSerp(): boolean {
  return Boolean(
    process.env.SERPER_API_KEY ||
    (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
  );
}

async function fetchLiveSerpContext(
  keyword: string,
  locationCode: number,
): Promise<SerpContext | null> {
  if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
    const result = await getSerpData(keyword, locationCode);
    const organic = result.features.organicResults;
    if (organic.length > 0) {
      return {
        keyword,
        results: organic.map((item) => ({
          title: item.title,
          link: item.url,
          snippet: "",
          rank: item.rank,
        })),
        peopleAlsoAsk: [],
        featuredSnippet: null,
        relatedSearches: [],
        formattedContext: "",
        opportunityAnalysis: {
          tableStakes: [],
          opportunities: [],
          unansweredQuestions: [],
        },
      };
    }
  }

  if (process.env.SERPER_API_KEY) {
    return getSerpContextForKeyword(keyword, false);
  }

  return null;
}

async function loadContextWithTimeout(
  loader: SerpContextLoader,
  keyword: string,
): Promise<SerpContext | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loader(keyword),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), LIVE_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function loadInBatches(
  keywords: Array<{ key: string; keyword: string }>,
  loader: SerpContextLoader,
  concurrency: number,
): Promise<Map<string, LoadedSerpEvidence>> {
  const contexts = new Map<string, LoadedSerpEvidence>();

  for (let start = 0; start < keywords.length; start += concurrency) {
    const batch = keywords.slice(start, start + concurrency);
    const results = await Promise.allSettled(
      batch.map(async ({ key, keyword }) => ({
        key,
        context: await loadContextWithTimeout(loader, keyword),
      })),
    );

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result.status !== "fulfilled" || !result.value.context?.results?.length) {
        continue;
      }
      contexts.set(result.value.key, {
        context: result.value.context,
        source: "LIVE_SERP",
        observedAt: new Date().toISOString(),
      });
    }
  }

  return contexts;
}

export async function buildOpportunityIntelligence(
  siteId: string,
  opportunities: ConsolidatedOpportunity[],
  options: OpportunityIntelligenceOptions = {},
): Promise<Map<string, OpportunityIntelligence>> {
  const configuredLimit = options.maxLookups ?? DEFAULT_MAX_LIVE_LOOKUPS;
  const maxLookups = Number.isFinite(configuredLimit)
    ? Math.min(DEFAULT_MAX_LIVE_LOOKUPS, Math.max(0, Math.floor(configuredLimit)))
    : DEFAULT_MAX_LIVE_LOOKUPS;
  const serpConfigured = options.serpConfigured ?? canFetchLiveSerp();

  const keywordGroups = new Map<string, KeywordGroup>();
  for (const opportunity of opportunities) {
    const keyword = opportunity.keyword.trim();
    if (!keyword) continue;

    const key = normalizeKeyword(keyword);
    const current = keywordGroups.get(key);
    if (!current) {
      keywordGroups.set(key, { keyword, maxImpressions: opportunity.impressions });
      continue;
    }
    current.maxImpressions = Math.max(current.maxImpressions, opportunity.impressions);
  }

  const cacheResult = await loadFreshSnapshotContexts(siteId, keywordGroups);
  const contexts = new Map(cacheResult.contexts);
  const loader = options.loadSerpContext ??
    ((keyword: string) => fetchLiveSerpContext(keyword, cacheResult.locationCode));
  const prioritizedKeywords = [...keywordGroups.entries()]
    .sort(([, a], [, b]) => b.maxImpressions - a.maxImpressions)
    .map(([key, group]) => ({ key, keyword: group.keyword }));
  const requestedKeywords = serpConfigured
    ? prioritizedKeywords
        .filter(({ key }) => !contexts.has(key))
        .slice(0, maxLookups)
    : [];
  const requestedSet = new Set(requestedKeywords.map(({ key }) => key));

  if (requestedKeywords.length > 0) {
    const liveContexts = await loadInBatches(requestedKeywords, loader, LOOKUP_CONCURRENCY);
    for (const [key, value] of liveContexts) contexts.set(key, value);
  }

  const groupIntelligence = new Map<string, OpportunityIntelligence>();
  for (const [key, group] of keywordGroups.entries()) {
    const loaded = contexts.get(key) ?? null;
    let status: SerpEvidenceStatus;

    if (loaded) {
      status = "AVAILABLE";
    } else if (!serpConfigured || requestedSet.has(key)) {
      status = "UNAVAILABLE";
    } else {
      status = "NOT_REQUESTED";
    }

    const profile = analyzeSerpConsensus(group.keyword, loaded?.context ?? null, status);
    groupIntelligence.set(key, {
      ...profile,
      ...(loaded
        ? {
            serpSource: loaded.source,
            serpObservedAt: loaded.observedAt,
          }
        : {}),
    });
  }

  const intelligence = new Map<string, OpportunityIntelligence>();
  for (const opportunity of opportunities) {
    const key = normalizeKeyword(opportunity.keyword);
    const intel = groupIntelligence.get(key);
    if (intel) {
      intelligence.set(opportunity.keyword, {
        ...intel,
        keyword: opportunity.keyword,
      });
    }
  }

  return intelligence;
}
