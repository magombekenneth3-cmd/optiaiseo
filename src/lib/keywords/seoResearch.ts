import prisma from "@/lib/prisma";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { callGeminiJson } from "@/lib/gemini/client";
import { logger, formatError } from "@/lib/logger";

export type KeywordIntent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

export type TrendStatus =
  | "🔥 Exploding"
  | "📈 Rising"
  | "➡️ Steady"
  | "📉 Declining";

export type ContentType =
  | "Blog Post"
  | "Landing Page"
  | "Product Page"
  | "FAQ"
  | "Video"
  | "Comparison Page"
  | "Pillar Page";

export type KeywordType =
  | "Short-tail"
  | "Long-tail"
  | "Competitive"
  | "Informational"
  | "Trending"
  | "Question"
  | "Local/Regional"
  | "Semantic/LSI";

export type RoadmapBucket = "Week 1" | "Month 1" | "Month 2-3";

export interface BusinessAnalysis {
  pillars: string[];
  valueProposition: string;
  funnelMap: {
    awareness: string[];
    consideration: string[];
    decision: string[];
  };
}

export interface CompetitorGapRow {
  keyword: string;
  difficulty: string;
  competitorRanking: string;
  gapOpportunity: string;
  priority: "High" | "Medium" | "Low";
}

export interface KeywordRow {
  rank: number;
  keyword: string;
  type: KeywordType;
  volume: string;
  difficulty: number;
  intent: KeywordIntent;
  relevance: number;
  quickWin: boolean;
  contentType: ContentType;
  cannibalisationRisk?: string;
  trendStatus?: TrendStatus;
  serpFeasibility?: number;
  parentTopic?: string;
  communitySource?: string;
}

export interface TrendRow {
  topic: string;
  status: TrendStatus;
  keywordVariations: string[];
  recommendedContent: string;
  urgency: string;
}

export interface ContentCalendarItem {
  week: RoadmapBucket;
  title: string;
  targetKeywords: string[];
  pillar: boolean;
  internalLinks?: string[];
  priorityScore: number;
}

export interface TopicalCluster {
  parentTopic: string;
  keywords: string[];
  topicalAuthorityScore: number;
  contentPlan: string;
}

export interface SeoResearchReport {
  generatedAt: string;
  domain: string;
  businessAnalysis: BusinessAnalysis & { communityPainPoints?: string[] };
  competitorGap: CompetitorGapRow[];
  keywords: KeywordRow[];
  trends: TrendRow[];
  contentCalendar: ContentCalendarItem[];
  masterList: (KeywordRow & { roadmap: RoadmapBucket; serpFeasibility: number; parentTopic: string })[];
  topicalClusters?: TopicalCluster[];
}

interface ParsedSeoResearch {
  businessAnalysis?: BusinessAnalysis & { communityPainPoints?: string[] };
  competitorGap?: CompetitorGapRow[];
  keywords?: KeywordRow[];
  trends?: TrendRow[];
  contentCalendar?: ContentCalendarItem[];
  masterList?: (KeywordRow & { roadmap: RoadmapBucket; serpFeasibility: number; parentTopic: string })[];
  topicalClusters?: TopicalCluster[];
}

function buildFullResearchPrompt(opts: {
  domain: string;
  coreServices: string | null;
  blogTone: string | null;
  techStack: string | null;
  competitors: string[];
  siteTitle?: string;
  siteDescription?: string;
  todayDate: string;
}): string {
  const { domain, coreServices, blogTone, techStack, competitors, siteTitle, siteDescription, todayDate } = opts;
  const competitorList = competitors.length > 0 ? competitors.join(", ") : "Not specified";

  return `You are a Senior SEO Strategist and Keyword Research Specialist with 10+ years of experience.
Today's date is ${todayDate}. You must factor in current trends as of today.

BUSINESS CONTEXT:
- Domain: ${domain}
- Site Title: ${siteTitle || domain}
- Site Description: ${siteDescription || "Not available"}
- Core Services/Products: ${coreServices || "Infer from domain"}
- Tech Stack: ${techStack || "Not specified"}
- Blog Tone: ${blogTone || "Professional"}
- Main Competitors: ${competitorList}

Perform ALL 10 phases of senior-level keyword research. Think like a $500/hr SEO consultant who has just watched every user pain-point forum, Reddit thread, and academic article on this niche.

## PHASE INSTRUCTIONS

### Phase A — Community Pain-Point Mining
Simulate Reddit, Quora, and niche forum research. For every product pillar, identify the raw, unfiltered language real users type when they are frustrated. Generate pain-point keywords like:
- "how to [solve problem] without [expensive solution]"
- "[product category] problems for small [user type]"
- "[task] without [skill/tool they lack]"
- "is [tool] worth it for [user type]"
Mark these with communitySource: "Reddit", "Quora", or "Forum".

### Phase B — Question & Hidden Keyword Expansion
For every pillar, generate question variants using: how, why, what is, what are, when should, can I, do I need, is it possible, best way to, how much does, vs, alternative to, without.
Also discover "hidden book keywords" — niche terminology used in professional handbooks, academic papers, or trade publications that non-experts would not think of.

### Phase C — SERP Feasibility Scoring
For each keyword in the masterList, score serpFeasibility (1-10):
- 10 = top 5 results are weak (forums, thin pages) — new sites can outrank easily
- 7-9 = moderate competition — quality content can compete within 6 months
- 4-6 = moderate authority sites dominate — needs strong backlinks + time
- 1-3 = top 5 are major brands / Wikipedia — near impossible without massive DA
Also check: can the business naturally mention its product/service throughout this content? If yes, add 2 points.

### Phase D — Topical Cluster Mapping
Group all keywords under parentTopics. A parentTopic is the 1 search query Google treats as the umbrella that covers many sub-queries. Example:
- parentTopic: "property management software" covers: "best property management apps", "how to track rent online", "tenant screening tools"
For each cluster: calculate topicalAuthorityScore (1-10) — how much publishing ALL keywords in this cluster would signal domain authority to Google.

Return ONLY a single valid JSON object matching this EXACT schema:

{
  "businessAnalysis": {
    "pillars": ["string", "..."],
    "valueProposition": "string",
    "communityPainPoints": ["raw pain-point keyword 1", "raw pain-point keyword 2"],
    "funnelMap": {
      "awareness": ["keyword1", "keyword2"],
      "consideration": ["keyword1", "keyword2"],
      "decision": ["keyword1", "keyword2"]
    }
  },
  "competitorGap": [
    {
      "keyword": "string",
      "difficulty": "string",
      "competitorRanking": "string",
      "gapOpportunity": "string",
      "priority": "High|Medium|Low"
    }
  ],
  "keywords": [
    {
      "rank": 1,
      "keyword": "string",
      "type": "Short-tail|Long-tail|Competitive|Informational|Trending|Question|Local/Regional|Semantic/LSI",
      "volume": "Low|Medium|High|Very High",
      "difficulty": 35,
      "intent": "informational|commercial|transactional|navigational",
      "relevance": 9,
      "quickWin": true,
      "contentType": "Blog Post|Landing Page|Product Page|FAQ|Video|Comparison Page|Pillar Page",
      "cannibalisationRisk": "string or null",
      "trendStatus": "🔥 Exploding|📈 Rising|➡️ Steady|📉 Declining or null",
      "serpFeasibility": 8,
      "parentTopic": "string",
      "communitySource": "Reddit|Quora|Forum|null"
    }
  ],
  "trends": [
    {
      "topic": "string",
      "status": "🔥 Exploding|📈 Rising|➡️ Steady|📉 Declining",
      "keywordVariations": ["string", "string", "string"],
      "recommendedContent": "string",
      "urgency": "string"
    }
  ],
  "contentCalendar": [
    {
      "week": "Week 1|Month 1|Month 2-3",
      "title": "string",
      "targetKeywords": ["string"],
      "pillar": true,
      "internalLinks": ["string"],
      "priorityScore": 95
    }
  ],
  "masterList": [
    {
      "rank": 1,
      "keyword": "string",
      "type": "Short-tail|Long-tail|Competitive|Informational|Trending|Question|Local/Regional|Semantic/LSI",
      "volume": "Low|Medium|High|Very High",
      "difficulty": 35,
      "intent": "informational|commercial|transactional|navigational",
      "relevance": 9,
      "quickWin": true,
      "contentType": "Blog Post|Landing Page|Product Page|FAQ|Video|Comparison Page|Pillar Page",
      "roadmap": "Week 1|Month 1|Month 2-3",
      "serpFeasibility": 8,
      "parentTopic": "string"
    }
  ],
  "topicalClusters": [
    {
      "parentTopic": "string",
      "keywords": ["string", "string"],
      "topicalAuthorityScore": 8,
      "contentPlan": "string describing pillar page + 5-8 supporting posts"
    }
  ]
}

REQUIREMENTS:
- "keywords" array: exactly 12 items covering all 8 types. At least 3 must be community pain-point keywords (with communitySource set).
- "competitorGap": exactly 4 rows
- "trends": exactly 4 trending topics, each with exactly 2 keyword variations
- "contentCalendar": exactly 4 items across the 3 roadmap buckets
- "masterList": exactly 12 keywords sorted by priority. Every row MUST include serpFeasibility and parentTopic.
- "topicalClusters": exactly 3 clusters. contentPlan must be one sentence only, maximum 80 characters.
- "businessAnalysis.communityPainPoints": exactly 3 phrases
- Keep ALL string values under 80 characters
- Prioritise buyer-intent and commercial keywords for revenue pages
- Never suggest keywords irrelevant to the business
- Mark trending keywords (status) for those gaining momentum RIGHT NOW as of ${todayDate}

CRITICAL: Start your response with { and end with }. No markdown fences. No text before or after the JSON.`;
}

function buildTrendsOnlyPrompt(opts: {
  domain: string;
  coreServices: string | null;
  todayDate: string;
}): string {
  const { domain, coreServices, todayDate } = opts;

  return `You are a Senior SEO Strategist. Today is ${todayDate}.

Simulate a fresh Google Trends analysis for this business:
- Domain: ${domain}
- Core Services: ${coreServices || "Infer from domain"}

Identify 10 trending search topics RIGHT NOW related to this business niche.

Return ONLY a JSON object:
{
  "trends": [
    {
      "topic": "string",
      "status": "🔥 Exploding|📈 Rising|➡️ Steady|📉 Declining",
      "keywordVariations": ["string", "string", "string"],
      "recommendedContent": "string describing content to publish within 48h",
      "urgency": "string"
    }
  ]
}

Return ONLY the JSON, no markdown, no explanations.`;
}

async function fetchSiteContext(domain: string): Promise<{ title: string; description: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" },
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn("[seo-research] fetchSiteContext response not ok", { domain, status: res.status });
      return { title: "", description: "" };
    }

    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
    const description =
      html.match(/name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
    return { title, description };
  } catch (err: unknown) {
    logger.warn("[seo-research] fetchSiteContext failed", { domain, error: formatError(err) });
    return { title: "", description: "" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runFullSeoResearch(siteId: string): Promise<SeoResearchReport> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { competitors: true },
  });
  if (!site) throw new Error("Site not found.");

  const competitors = site.competitors.map((c) => c.domain);
  const { title: siteTitle, description: siteDescription } = await fetchSiteContext(site.domain);
  const todayDate = new Date().toISOString().split("T")[0];

  const prompt = buildFullResearchPrompt({
    domain: site.domain,
    coreServices: site.coreServices,
    blogTone: site.blogTone,
    techStack: site.techStack,
    competitors,
    siteTitle,
    siteDescription,
    todayDate,
  });

  // maxOutputTokens MUST be set explicitly — the default of 2048 truncates the
  // large structured JSON response mid-object, causing a JSON parse failure.
  // The full response (12 kw + 12 masterList + gaps + trends + calendar) is ~8–10k tokens.
  const parsed = await callGeminiJson<ParsedSeoResearch>(prompt, {
    timeoutMs: 55000,   // stay inside the 60 s Next.js Server Action hard limit
    maxOutputTokens: 8192,
  });

  return {
    generatedAt: new Date().toISOString(),
    domain: site.domain,
    businessAnalysis: parsed.businessAnalysis ?? {
      pillars: [],
      valueProposition: "",
      funnelMap: { awareness: [], consideration: [], decision: [] },
    },
    competitorGap: parsed.competitorGap ?? [],
    keywords: parsed.keywords ?? [],
    trends: parsed.trends ?? [],
    contentCalendar: parsed.contentCalendar ?? [],
    masterList: parsed.masterList ?? [],
    topicalClusters: parsed.topicalClusters ?? [],
  };
}

export async function runTrendSimulation(siteId: string): Promise<TrendRow[]> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new Error("Site not found.");

  const todayDate = new Date().toISOString().split("T")[0];
  const prompt = buildTrendsOnlyPrompt({
    domain: site.domain,
    coreServices: site.coreServices,
    todayDate,
  });

  const parsed = await callGeminiJson<{ trends: TrendRow[] }>(prompt, {
    timeoutMs: 25000,
    maxOutputTokens: 2048,
  });
  return parsed.trends ?? [];
}