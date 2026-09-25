import { z } from "zod";
import type { SourceEvidence, ResearchPacket } from "./contracts";
import type { AuthorProfile } from "./index";
import type { SiteContext } from "./context";
import type { SerpContext, SerpResult } from "./serp";
import type { GscOpportunityEvidence } from "@/lib/gsc/gsc-evidence";
import {
  EvidenceSourceTypeSchema,
  type EvidenceSourceType,
} from "./evidence-foundation";

export interface EvidenceProvenance {
  capturedAt: string;
  sourceType: EvidenceSourceType;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourcePublisher: string | null;
  sourcePublishedAt: string | null;
  retrievalMethod: string;
  confidence: number;
  authorityScore: number | null;
}

export interface LedgerEvidenceItem {
  id: string;
  category: string;
  content: string;
  excerpt: string | null;
  provenance: EvidenceProvenance;
  metadata: Record<string, unknown>;
}

export interface SerpObservation {
  rank: number;
  url: string;
  title: string;
  snippet: string;
  headings: string[];
  wordCount: number | null;
  sourceType: EvidenceSourceType;
}

export interface CompetitorObservation {
  domain: string;
  url: string;
  title: string;
  headings: string[];
  wordCount: number | null;
  snippet: string;
}

export interface GscObservation {
  query: string;
  url: string | null;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  opportunityType: string;
  opportunityScore: number;
  reason: string;
  dateRange: { startDate: string; endDate: string };
  property: string;
}

export interface FirstPartyContext {
  authorName: string;
  authorRole: string | null;
  authorBio: string | null;
  realExperience: string | null;
  realNumbers: string | null;
  localContext: string | null;
  siteTitle: string | null;
  siteDescription: string | null;
  siteHeadings: string[];
  siteKeywords: string[];
  brandFacts: Array<{ factType: string; value: string }>;
}

export interface ResearchEvidenceLedger {
  id: string;
  blogId: string | null;
  topic: string;
  searchIntent: string;
  collectedAt: string;
  serpObservations: SerpObservation[];
  competitorObservations: CompetitorObservation[];
  gscObservations: GscObservation[];
  firstPartyContext: FirstPartyContext;
  evidenceItems: LedgerEvidenceItem[];
  researchPacketRef: string | null;
}

function generateId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function sourceProvenance(
  source: SourceEvidence,
  retrievalMethod: string,
): EvidenceProvenance {
  return {
    capturedAt: source.retrievedAt,
    sourceType: mapSourceType(source.sourceType, source.url),
    sourceUrl: source.url,
    sourceTitle: source.title,
    sourcePublisher: source.publisher ?? null,
    sourcePublishedAt: source.publishedAt ?? null,
    retrievalMethod,
    confidence: source.confidence,
    authorityScore: source.authorityScore ?? null,
  };
}

function mapSourceType(legacyType: string, url?: string): EvidenceSourceType {
  if (url && /search\.google|serper\.dev/i.test(url)) return "SERP_OBSERVATION";
  const map: Record<string, EvidenceSourceType> = {
    official: "EXTERNAL_SOURCE",
    research: "EXTERNAL_SOURCE",
    government: "EXTERNAL_SOURCE",
    company: "EXTERNAL_SOURCE",
    news: "EXTERNAL_SOURCE",
    expert: "EXTERNAL_SOURCE",
    other: "EXTERNAL_SOURCE",
  };
  return map[legacyType] ?? "EXTERNAL_SOURCE";
}

function evidenceFromSource(
  source: SourceEvidence,
  category: string,
  retrievalMethod: string,
): LedgerEvidenceItem {
  return {
    id: generateId(),
    category,
    content: source.evidence,
    excerpt: truncate(source.claim, 500),
    provenance: sourceProvenance(source, retrievalMethod),
    metadata: {
      sourceId: source.id,
      sourceType: source.sourceType,
    },
  };
}

export function collectSerpObservations(
  serpContext: SerpContext | null,
): SerpObservation[] {
  if (!serpContext?.results) return [];
  return serpContext.results
    .filter((r: SerpResult) => r.link && r.title)
    .slice(0, 10)
    .map((r: SerpResult, i: number) => ({
      rank: i + 1,
      url: r.link,
      title: truncate(r.title, 500),
      snippet: truncate(r.snippet || "", 2000),
      headings: (r.scrapedHeadings ?? []).slice(0, 30),
      wordCount: typeof r.wordCount === "number" ? r.wordCount : null,
      sourceType: "SERP_OBSERVATION" as EvidenceSourceType,
    }));
}

export function collectCompetitorObservations(
  serpContext: SerpContext | null,
): CompetitorObservation[] {
  if (!serpContext?.results) return [];
  return serpContext.results
    .filter((r: SerpResult) => r.link && r.title)
    .slice(0, 8)
    .map((r: SerpResult) => ({
      domain: extractDomain(r.link),
      url: r.link,
      title: truncate(r.title, 500),
      headings: (r.scrapedHeadings ?? []).slice(0, 50),
      wordCount: typeof r.wordCount === "number" ? r.wordCount : null,
      snippet: truncate(r.snippet || "", 2000),
    }));
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function collectGscObservations(
  gscEvidence: GscOpportunityEvidence | null,
  opportunities: Array<{
    keyword: string;
    avgPosition: number;
    impressions: number;
    clicks: number;
    ctr: number;
    opportunityScore: number;
    opportunityType: string;
    reason: string;
    urls?: Array<{ url: string }>;
  }>,
  gscProperty?: string,
): GscObservation[] {
  const observations: GscObservation[] = [];

  if (gscEvidence) {
    observations.push({
      query: gscEvidence.query,
      url: gscEvidence.url ?? null,
      position: gscEvidence.position,
      impressions: gscEvidence.impressions,
      clicks: gscEvidence.clicks,
      ctr: gscEvidence.ctr,
      opportunityType: gscEvidence.opportunityType,
      opportunityScore: gscEvidence.opportunityScore,
      reason: gscEvidence.reason,
      dateRange: gscEvidence.dateRange,
      property: gscEvidence.property,
    });
  }

  const seenQueries = new Set(observations.map(o => o.query.toLowerCase()));
  const now = new Date();
  const defaultDateRange = {
    startDate: new Date(now.getTime() - 93 * 86_400_000).toISOString().split("T")[0],
    endDate: new Date(now.getTime() - 3 * 86_400_000).toISOString().split("T")[0],
  };

  for (const opp of opportunities.slice(0, 10)) {
    if (seenQueries.has(opp.keyword.toLowerCase())) continue;
    seenQueries.add(opp.keyword.toLowerCase());
    observations.push({
      query: opp.keyword,
      url: opp.urls?.[0]?.url ?? null,
      position: opp.avgPosition,
      impressions: opp.impressions,
      clicks: opp.clicks,
      ctr: opp.ctr,
      opportunityType: opp.opportunityType,
      opportunityScore: opp.opportunityScore,
      reason: opp.reason,
      dateRange: defaultDateRange,
      property: gscProperty ?? "",
    });
  }

  return observations;
}

export function collectFirstPartyContext(
  author: AuthorProfile,
  siteContext: SiteContext | null,
  brandFacts: Array<{ factType: string; value: string }>,
): FirstPartyContext {
  return {
    authorName: author.name,
    authorRole: author.role ?? null,
    authorBio: author.bio ?? null,
    realExperience: author.realExperience ?? null,
    realNumbers: author.realNumbers ?? null,
    localContext: author.localContext ?? null,
    siteTitle: siteContext?.title ?? null,
    siteDescription: siteContext?.description ?? null,
    siteHeadings: siteContext?.headings ?? [],
    siteKeywords: siteContext?.keywords ?? [],
    brandFacts,
  };
}

function firstPartyEvidenceItems(
  firstParty: FirstPartyContext,
  capturedAt: string,
): LedgerEvidenceItem[] {
  const items: LedgerEvidenceItem[] = [];

  if (firstParty.realExperience) {
    items.push({
      id: generateId(),
      category: "author_experience",
      content: firstParty.realExperience,
      excerpt: truncate(firstParty.realExperience, 500),
      provenance: {
        capturedAt,
        sourceType: "FIRST_PARTY_EXPERIENCE",
        sourceUrl: null,
        sourceTitle: null,
        sourcePublisher: null,
        sourcePublishedAt: null,
        retrievalMethod: "author_profile",
        confidence: 0.95,
        authorityScore: null,
      },
      metadata: { authorName: firstParty.authorName },
    });
  }

  if (firstParty.realNumbers) {
    items.push({
      id: generateId(),
      category: "author_data",
      content: firstParty.realNumbers,
      excerpt: truncate(firstParty.realNumbers, 500),
      provenance: {
        capturedAt,
        sourceType: "FIRST_PARTY_DATA",
        sourceUrl: null,
        sourceTitle: null,
        sourcePublisher: null,
        sourcePublishedAt: null,
        retrievalMethod: "author_profile",
        confidence: 0.9,
        authorityScore: null,
      },
      metadata: { authorName: firstParty.authorName },
    });
  }

  if (firstParty.localContext) {
    items.push({
      id: generateId(),
      category: "local_context",
      content: firstParty.localContext,
      excerpt: truncate(firstParty.localContext, 500),
      provenance: {
        capturedAt,
        sourceType: "FIRST_PARTY_EXPERIENCE",
        sourceUrl: null,
        sourceTitle: null,
        sourcePublisher: null,
        sourcePublishedAt: null,
        retrievalMethod: "author_profile",
        confidence: 0.85,
        authorityScore: null,
      },
      metadata: { authorName: firstParty.authorName },
    });
  }

  for (const fact of firstParty.brandFacts) {
    items.push({
      id: generateId(),
      category: "brand_fact",
      content: `${fact.factType}: ${fact.value}`,
      excerpt: truncate(fact.value, 500),
      provenance: {
        capturedAt,
        sourceType: "FIRST_PARTY_DATA",
        sourceUrl: null,
        sourceTitle: null,
        sourcePublisher: null,
        sourcePublishedAt: null,
        retrievalMethod: "brand_facts_db",
        confidence: 1.0,
        authorityScore: null,
      },
      metadata: { factType: fact.factType },
    });
  }

  return items;
}

function gscEvidenceItems(
  gscObservations: GscObservation[],
  capturedAt: string,
): LedgerEvidenceItem[] {
  return gscObservations.map(obs => ({
    id: generateId(),
    category: "gsc_opportunity",
    content: `Query "${obs.query}" at position ${obs.position} with ${obs.impressions} impressions, ${obs.clicks} clicks, ${obs.ctr}% CTR. ${obs.reason}`,
    excerpt: truncate(obs.reason, 500),
    provenance: {
      capturedAt,
      sourceType: "GSC_DATA" as EvidenceSourceType,
      sourceUrl: obs.url,
      sourceTitle: obs.query,
      sourcePublisher: "Google Search Console",
      sourcePublishedAt: null,
      retrievalMethod: "gsc_api",
      confidence: 1.0,
      authorityScore: 1.0,
    },
    metadata: {
      position: obs.position,
      impressions: obs.impressions,
      clicks: obs.clicks,
      ctr: obs.ctr,
      opportunityType: obs.opportunityType,
      opportunityScore: obs.opportunityScore,
      dateRange: obs.dateRange,
      property: obs.property,
    },
  }));
}

function serpEvidenceItems(
  serpObservations: SerpObservation[],
  capturedAt: string,
): LedgerEvidenceItem[] {
  return serpObservations.map(obs => ({
    id: generateId(),
    category: "serp_observation",
    content: `Rank #${obs.rank}: "${obs.title}" — ${obs.snippet}`,
    excerpt: truncate(obs.snippet, 500),
    provenance: {
      capturedAt,
      sourceType: "SERP_OBSERVATION" as EvidenceSourceType,
      sourceUrl: obs.url,
      sourceTitle: obs.title,
      sourcePublisher: extractDomain(obs.url),
      sourcePublishedAt: null,
      retrievalMethod: "serp_api",
      confidence: 0.7,
      authorityScore: null,
    },
    metadata: {
      rank: obs.rank,
      headingCount: obs.headings.length,
      wordCount: obs.wordCount,
    },
  }));
}

function sourceEvidenceItems(
  researchPacket: ResearchPacket,
  capturedAt: string,
): LedgerEvidenceItem[] {
  return researchPacket.sources.map(source =>
    evidenceFromSource(source, "research_source", "serp_scrape")
  );
}

export function buildResearchEvidenceLedger(params: {
  topic: string;
  searchIntent: string;
  blogId: string | null;
  researchPacket: ResearchPacket;
  serpContext: SerpContext | null;
  gscEvidence: GscOpportunityEvidence | null;
  gscOpportunities: Array<{
    keyword: string;
    avgPosition: number;
    impressions: number;
    clicks: number;
    ctr: number;
    opportunityScore: number;
    opportunityType: string;
    reason: string;
    urls?: Array<{ url: string }>;
  }>;
  gscProperty?: string;
  author: AuthorProfile;
  siteContext: SiteContext | null;
  brandFacts: Array<{ factType: string; value: string }>;
}): ResearchEvidenceLedger {
  const capturedAt = params.researchPacket.collectedAt;
  const serpObservations = collectSerpObservations(params.serpContext);
  const competitorObservations = collectCompetitorObservations(params.serpContext);
  const gscObservations = collectGscObservations(
    params.gscEvidence,
    params.gscOpportunities,
    params.gscProperty,
  );
  const firstPartyContext = collectFirstPartyContext(
    params.author,
    params.siteContext,
    params.brandFacts,
  );

  const evidenceItems: LedgerEvidenceItem[] = [
    ...sourceEvidenceItems(params.researchPacket, capturedAt),
    ...firstPartyEvidenceItems(firstPartyContext, capturedAt),
    ...gscEvidenceItems(gscObservations, capturedAt),
    ...serpEvidenceItems(serpObservations, capturedAt),
  ];

  return {
    id: generateId(),
    blogId: params.blogId,
    topic: params.topic,
    searchIntent: params.searchIntent,
    collectedAt: capturedAt,
    serpObservations,
    competitorObservations,
    gscObservations,
    firstPartyContext,
    evidenceItems,
    researchPacketRef: capturedAt,
  };
}

export const LedgerEvidenceItemSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
  excerpt: z.string().nullable(),
  provenance: z.object({
    capturedAt: z.string().min(1),
    sourceType: EvidenceSourceTypeSchema,
    sourceUrl: z.string().nullable(),
    sourceTitle: z.string().nullable(),
    sourcePublisher: z.string().nullable(),
    sourcePublishedAt: z.string().nullable(),
    retrievalMethod: z.string().min(1),
    confidence: z.number().min(0).max(1),
    authorityScore: z.number().min(0).max(1).nullable(),
  }),
  metadata: z.record(z.string(), z.unknown()),
});

export const ResearchEvidenceLedgerSchema = z.object({
  id: z.string().min(1),
  blogId: z.string().nullable(),
  topic: z.string().min(1),
  searchIntent: z.string().min(1),
  collectedAt: z.string().min(1),
  serpObservations: z.array(z.object({
    rank: z.number().int().positive(),
    url: z.string().min(1),
    title: z.string().min(1),
    snippet: z.string(),
    headings: z.array(z.string()),
    wordCount: z.number().int().nonnegative().nullable(),
    sourceType: EvidenceSourceTypeSchema,
  })),
  competitorObservations: z.array(z.object({
    domain: z.string().min(1),
    url: z.string().min(1),
    title: z.string().min(1),
    headings: z.array(z.string()),
    wordCount: z.number().int().nonnegative().nullable(),
    snippet: z.string(),
  })),
  gscObservations: z.array(z.object({
    query: z.string().min(1),
    url: z.string().nullable(),
    position: z.number(),
    impressions: z.number().int().nonnegative(),
    clicks: z.number().int().nonnegative(),
    ctr: z.number().nonnegative(),
    opportunityType: z.string().min(1),
    opportunityScore: z.number(),
    reason: z.string().min(1),
    dateRange: z.object({
      startDate: z.string().min(1),
      endDate: z.string().min(1),
    }),
    property: z.string(),
  })),
  firstPartyContext: z.object({
    authorName: z.string().min(1),
    authorRole: z.string().nullable(),
    authorBio: z.string().nullable(),
    realExperience: z.string().nullable(),
    realNumbers: z.string().nullable(),
    localContext: z.string().nullable(),
    siteTitle: z.string().nullable(),
    siteDescription: z.string().nullable(),
    siteHeadings: z.array(z.string()),
    siteKeywords: z.array(z.string()),
    brandFacts: z.array(z.object({
      factType: z.string().min(1),
      value: z.string().min(1),
    })),
  }),
  evidenceItems: z.array(LedgerEvidenceItemSchema),
  researchPacketRef: z.string().nullable(),
});

export type ValidatedLedger = z.infer<typeof ResearchEvidenceLedgerSchema>;

export function validateLedger(
  ledger: ResearchEvidenceLedger,
): { success: true; data: ValidatedLedger } | { success: false; error: string } {
  const result = ResearchEvidenceLedgerSchema.safeParse(ledger);
  if (result.success) return { success: true, data: result.data };
  const issue = result.error.issues[0];
  return {
    success: false,
    error: `${issue?.path.join(".")}: ${issue?.message}`,
  };
}

export function ledgerEvidenceSummary(ledger: ResearchEvidenceLedger) {
  const byType: Record<string, number> = {};
  for (const item of ledger.evidenceItems) {
    const t = item.provenance.sourceType;
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return {
    totalItems: ledger.evidenceItems.length,
    serpObservations: ledger.serpObservations.length,
    competitorObservations: ledger.competitorObservations.length,
    gscObservations: ledger.gscObservations.length,
    hasFristPartyExperience: Boolean(ledger.firstPartyContext.realExperience),
    hasFirstPartyData: Boolean(ledger.firstPartyContext.realNumbers),
    brandFactCount: ledger.firstPartyContext.brandFacts.length,
    bySourceType: byType,
  };
}
