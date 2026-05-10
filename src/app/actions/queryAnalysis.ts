"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit/monthly";
import { scrapePageQuality, type PageQualityResult } from "@/lib/audit/scrapePageQuality";
import { getDomainOverview } from "@/lib/keywords/dataforseo";


export interface SerpResult {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  isUserUrl: boolean;
}

interface CompetitorAdvantage {
  domain: string;
  position: number;
  whyTheyRankHigher: string;
  contentQualityEdge: string;
}

interface ActionItem {
  priority: number;
  action: string;
  why: string;
  effort: string;
  impact: string;
}

interface AnalysisResult {
  positionDiagnosis: string;
  competitorAdvantages: CompetitorAdvantage[];
  contentGap: string;
  ctrAssessment: string;
  actions: ActionItem[];
  honestVerdict: string;
}

export interface QueryAnalysisData {
  serpResults: SerpResult[];
  analysis: AnalysisResult;
  competitorDetails: {
    domain: string;
    position: number;
    title: string | null;
    wordCount: number | null;
    schemaTypes: string[];
  }[];
  meta: {
    keyword: string;
    userPosition: number;
    userUrl: string;
    fetchedAt: string;
  };
}

type AnalyzeResult =
  | { success: true; data: QueryAnalysisData }
  | { success: false; error?: string; rateLimited?: boolean; resetsAt?: Date };


async function fetchSerpDataForSEO(keyword: string): Promise<SerpResult[] | null> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;

  try {
    const auth = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([{
        keyword,
        location_code: 2840,
        language_code: "en",
        device: "desktop",
        depth: 10,
      }]),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const items: Array<{
      type: string;
      url?: string;
      title?: string;
      description?: string;
      domain?: string;
      rank_absolute?: number;
    }> = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const organics = items.filter((i) => i.type === "organic" && i.url);
    return organics.slice(0, 10).map((item, idx) => ({
      position: item.rank_absolute ?? idx + 1,
      title: item.title ?? "",
      url: item.url ?? "",
      domain: item.domain ?? extractDomain(item.url ?? ""),
      snippet: (item.description ?? "").slice(0, 200),
      isUserUrl: false,
    }));
  } catch {
    return null;
  }
}

async function fetchSerpSerper(keyword: string): Promise<SerpResult[] | null> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, num: 10 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const organics: Array<{
      link?: string;
      title?: string;
      snippet?: string;
      position?: number;
    }> = data?.organic ?? [];

    return organics.slice(0, 10).map((item, idx) => ({
      position: item.position ?? idx + 1,
      title: item.title ?? "",
      url: item.link ?? "",
      domain: extractDomain(item.link ?? ""),
      snippet: (item.snippet ?? "").slice(0, 200),
      isUserUrl: false,
    }));
  } catch {
    return null;
  }
}

async function fetchSerpGoogle(keyword: string): Promise<SerpResult[] | null> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) return null;

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(keyword)}&num=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json();
    const items: Array<{ link?: string; title?: string; snippet?: string }> =
      data?.items ?? [];

    return items.slice(0, 10).map((item, idx) => ({
      position: idx + 1,
      title: item.title ?? "",
      url: item.link ?? "",
      domain: extractDomain(item.link ?? ""),
      snippet: (item.snippet ?? "").slice(0, 200),
      isUserUrl: false,
    }));
  } catch {
    return null;
  }
}

async function fetchSerp(keyword: string): Promise<SerpResult[]> {
  const results =
    (await fetchSerpDataForSEO(keyword)) ??
    (await fetchSerpSerper(keyword)) ??
    (await fetchSerpGoogle(keyword));

  if (!results) {
    throw new Error("SERP data unavailable — check API keys");
  }

  return results;
}


function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatPageForClaude(
  label: string,
  pq: PageQualityResult | null,
  serpResult: SerpResult,
): string {
  if (!pq) {
    return `${label} — ${serpResult.domain}
Content data unavailable (page blocked scraping).
SERP snippet: ${serpResult.snippet}`;
  }

  return `${label} — ${serpResult.url}
Position: ${serpResult.position} | Domain: ${serpResult.domain}

Content depth:
- Word count: ${pq.wordCount} words across ${pq.paragraphCount} paragraphs
- H1: ${pq.h1 ?? "missing"}
- H2 sections: ${pq.h2s.join(" | ") || "none"}
- H3 topics: ${pq.h3s.join(" | ") || "none"}
- Has FAQ section: ${pq.hasFAQSection}
- Has How-To structure: ${pq.hasHowToSection}
- Has comparison table: ${pq.hasComparisonTable}
- Has table of contents: ${pq.hasTableOfContents}
- Images: ${pq.imageCount}
- Video embed: ${pq.videoEmbedPresent}
- Call to action present: ${pq.hasCallToAction}

E-E-A-T signals:
- Author mentioned: ${pq.hasAuthorMention}
- Publication date visible: ${pq.hasDatePublished} (${pq.datePublished ?? "unknown"})
- External citations: ${pq.externalLinkCount} external links, authoritative citations: ${pq.hasCitations}
- Internal links: ${pq.internalLinkCount}
- About/bio page link: ${pq.hasAboutOrBioLink}

Schema: ${pq.schemaTypes.join(", ") || "none"}
Schema breadth score: ${pq.schemaBreadth}
FAQ schema: ${pq.hasFAQSchema} | HowTo schema: ${pq.hasHowToSchema} | Article schema: ${pq.hasArticleSchema}

Readability: avg ${pq.avgWordsPerParagraph} words per paragraph, longest paragraph ${pq.longestParagraphWords} words

Technical: canonical present: ${pq.hasCanonical}, OG tags: ${pq.hasOpenGraph}, Twitter card: ${pq.hasTwitterCard}
Page size: ${pq.pageSizeKb}kb${pq.pageSizeKb > 500 ? " ⚠ LARGE — may indicate JS-heavy content Google may not fully render" : ""}
Last modified: ${pq.lastModifiedHeader ?? "unknown"}`;
}


export async function analyzeQueryRanking(input: {
  keyword: string;
  userUrl: string;
  userPosition: number;
  userClicks: number;
  userImpressions: number;
  userCtr: number;
  siteId: string;
  domain: string;
}): Promise<AnalyzeResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  const site = await prisma.site.findFirst({
    where: { id: input.siteId, userId },
    select: { id: true },
  });
  if (!site) return { success: false, error: "Site not found" };

  const dayResetAt = new Date();
  dayResetAt.setUTCHours(24, 0, 0, 0);
  const rl = await checkRateLimit(`query-analysis:${userId}`, 20, dayResetAt);
  if (!rl.allowed) {
    return { success: false, rateLimited: true, resetsAt: rl.resetAt };
  }

  let serpResults: SerpResult[];
  try {
    serpResults = await fetchSerp(input.keyword);
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }

  // Tag user's own URLs
  const userDomain = input.domain.replace(/^www\./, "");
  serpResults = serpResults.map((r) => ({
    ...r,
    isUserUrl: r.domain.replace(/^www\./, "") === userDomain || r.url.includes(userDomain),
  }));

  // Top 5 competitor URLs (exclude user's domain)
  const competitorUrls = serpResults
    .filter((r) => !r.isUserUrl)
    .slice(0, 5);
  const competitorDomains = [...new Set(competitorUrls.map((r) => r.domain))].slice(0, 5);

  // Parallel: user page quality + competitor quality + domain metrics
  const [userPageQuality, ...rest] = await Promise.all([
    scrapePageQuality(input.userUrl),
    Promise.allSettled(competitorUrls.map((r) => scrapePageQuality(r.url))),
    ...competitorDomains.map((d) => getDomainOverview(d).catch(() => null)),
  ]);

  const competitorQualitySettled = rest[0] as PromiseSettledResult<PageQualityResult | null>[];
  const domainOverviews = rest.slice(1) as (Awaited<ReturnType<typeof getDomainOverview>> | null)[];

  const competitorQualities = competitorQualitySettled.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  );

  const serpListText = serpResults
    .map(
      (r) =>
        `${r.position}. [${r.domain}] ${r.title}\n   ${r.snippet}`,
    )
    .join("\n");

  const userPageText = formatPageForClaude(
    `MY PAGE`,
    userPageQuality,
    {
      position: input.userPosition,
      title: userPageQuality?.title ?? "",
      url: input.userUrl,
      domain: userDomain,
      snippet: "",
      isUserUrl: true,
    },
  );

  const competitorTexts = competitorUrls.map((serpRow, i) => {
    const pq = competitorQualities[i] ?? null;
    return formatPageForClaude(`COMPETITOR #${serpRow.position}`, pq, serpRow);
  });

  const domainMetricLines = competitorDomains.map((domain, i) => {
    const ov = domainOverviews[i];
    if (!ov) return `${domain}: domain metrics unavailable`;
    return `${domain}: ~${ov.organicTraffic.toLocaleString()} organic traffic/mo, ${ov.organicKeywords.toLocaleString()} ranking keywords`;
  });

  const userMessage = `I am ranking at position ${input.userPosition} for the keyword "${input.keyword}".
My page: ${input.userUrl}
My data: ${input.userClicks} clicks, ${input.userImpressions} impressions, ${input.userCtr}% CTR over 90 days.

${userPageText}

The top 10 SERP results for this keyword:
${serpListText}

Top competitor page analyses:
${competitorTexts.join("\n\n---\n\n")}

Competitor domain metrics (where available):
${domainMetricLines.join("\n")}

Respond in this exact JSON structure and nothing else:
{
  "positionDiagnosis": "2-3 sentences. Why is the user at this position? Be specific and honest. Reference actual data from above.",
  "competitorAdvantages": [
    {
      "domain": "example.com",
      "position": 1,
      "whyTheyRankHigher": "One specific, honest sentence about what gives them the edge for this query.",
      "contentQualityEdge": "The specific content quality difference that gives them the ranking advantage — e.g. they have 12 FAQ schema entries covering every long-tail variant, their H2 structure covers 8 subtopics vs your 2. Be specific about which signals matter most for this particular query type."
    }
  ],
  "contentGap": "Is the user's content thinner, less comprehensive, missing schema, or structurally weaker than the top results? State what's missing specifically.",
  "ctrAssessment": "Is the CTR normal for position ${input.userPosition}? Industry average CTR for this position is roughly X%. If their CTR is lower, explain why (likely title/description issue).",
  "actions": [
    {
      "priority": 1,
      "action": "Specific thing to do — not generic advice",
      "why": "One sentence on why this will move the needle for this specific keyword",
      "effort": "low | medium | high",
      "impact": "low | medium | high"
    }
  ],
  "honestVerdict": "One paragraph. Bottom line — is this keyword winnable at the user's current domain/content quality level? What is the realistic path and timeline? Do not be encouraging for its own sake."
}`;

  const systemPrompt = `You are an expert SEO analyst. You give honest, direct assessments — you do not soften bad news or pad answers with caveats. When a site is ranking at position 40 because their content is thin, you say that clearly. Your job is to help the user understand exactly why they are where they are and precisely what to do about it.

When comparing content quality, pay attention to these specific signals in order of SEO importance:
1. Content depth and completeness — does the competitor cover significantly more subtopics (visible in their H2/H3 structure)?
2. Structural signals — FAQ schema, How-To structure, comparison tables, table of contents — these all correlate with featured snippet capture and higher CTR.
3. E-E-A-T — author presence, publication dates, external citations are increasingly direct quality signals.
4. Readability — walls of text (high avgWordsPerParagraph) hurt dwell time. Competitors with lower avgWordsPerParagraph and more paragraph breaks typically have better engagement metrics.
5. Schema breadth — a competitor with 4+ schema types has invested heavily in structured data. That investment compounds over time.

Do not interpret word count as a proxy for quality. A 3,000 word page with good H2 structure and FAQ schema beats a 5,000 word wall of text. Highlight this distinction explicitly when it applies.`;

  let analysis: AnalysisResult;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `AI analysis failed: ${res.status} — ${err.slice(0, 200)}` };
    }

    const aiData = await res.json();
    const rawText: string = aiData.content?.[0]?.text ?? "";
    const cleaned = rawText.replace(/```json\n?|```\n?/g, "").trim();
    analysis = JSON.parse(cleaned) as AnalysisResult;
  } catch (e: unknown) {
    return { success: false, error: `Analysis parsing failed: ${(e as Error).message}` };
  }

  const competitorDetails = competitorUrls.map((serpRow, i) => {
    const pq = competitorQualities[i];
    return {
      domain: serpRow.domain,
      position: serpRow.position,
      title: pq?.title ?? null,
      wordCount: pq?.wordCount ?? null,
      schemaTypes: pq?.schemaTypes ?? [],
      // Extra fields for comparison table
      h2Count: pq?.h2s.length ?? null,
      hasFAQSchema: pq?.hasFAQSchema ?? null,
      hasAuthorMention: pq?.hasAuthorMention ?? null,
      externalLinkCount: pq?.externalLinkCount ?? null,
      schemaBreadth: pq?.schemaBreadth ?? null,
      avgWordsPerParagraph: pq?.avgWordsPerParagraph ?? null,
      imageCount: pq?.imageCount ?? null,
    };
  });

  return {
    success: true,
    data: {
      serpResults,
      analysis,
      competitorDetails,
      userPageQuality: userPageQuality ?? undefined,
      meta: {
        keyword: input.keyword,
        userPosition: input.userPosition,
        userUrl: input.userUrl,
        fetchedAt: new Date().toISOString(),
      },
    } as QueryAnalysisData & { userPageQuality?: PageQualityResult },
  };
}
