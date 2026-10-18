import { logger } from "@/lib/logger";
import * as cheerio from "cheerio";
import { safeFetchPublicUrl, type SafeFetchResult, type SafeFetchError } from "@/lib/security/safe-fetch";


import { computeContentGapsFromOpportunities, type SeoOpportunityAnalysis } from "./seo-opportunity";
export type { SeoOpportunityAnalysis };

export type SerpScrapeStatus = "ANALYZED" | "SNIPPET_ONLY" | "UNSCRAPPABLE" | "FAILED";

export interface SerpResult {
  title: string;
  link: string;
  snippet: string;
  rank?: number;
  scrapeStatus?: SerpScrapeStatus;
  scrapeFailureReason?: string;
  scrapedContent?: string;
  scrapedHeadings?: string[];
  scrapedSchemaTypes?: string[];
  scrapedPublishedDate?: string | null;
  wordCount?: number;
}

export interface PeopleAlsoAsk {
  question: string;
  answer?: string;
}

export interface SerpContext {
  keyword: string;
  results: SerpResult[];
  peopleAlsoAsk: PeopleAlsoAsk[];
  featuredSnippet: string | null;
  relatedSearches: string[];
  formattedContext: string;
  opportunityAnalysis: SeoOpportunityAnalysis;
}


/** Hard character limits per section to prevent silent context overflows. */
const BUDGET = {
  scrapedContentPerResult: 25_000, // ~3,800 words — enough to see full article structure
  snippetPerResult: 400,
  featuredSnippet: 600,
  paaTotal: 2_000,                 // raised to include PAA answers
  relatedSearches: 300,
} as const;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}


const UNSCRAPPABLE_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com", // JS-rendered, almost always empty
  "linkedin.com",
];

/**
 * Matches the URL's hostname (or any subdomain of it) against the exclusion list.
 * A substring match would wrongly exclude e.g. netflix.com (contains "x.com").
 */
function isUnscrappable(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false; // invalid URLs are rejected by the safe fetcher with a clear reason
  }
  return UNSCRAPPABLE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}


async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  delayMs = 1000
): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries === 0) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    return fetchWithRetry(url, options, retries - 1, delayMs * 2);
  }
}

/** Upper bound on a scraped page body; larger responses are abandoned mid-stream. */
const SCRAPE_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const SCRAPE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * SSRF-safe page fetch for third-party SERP result URLs. Each redirect hop is
 * re-validated (scheme, hostname, resolved IPs) and the body is size-limited.
 * Retries only transient network failures/timeouts, as fetchWithRetry did;
 * policy blocks ("Blocked: …") and DNS failures are returned immediately.
 */
async function safeScrapeFetch(
  url: string,
  retries = 2,
  delayMs = 1000
): Promise<SafeFetchResult | SafeFetchError> {
  const result = await safeFetchPublicUrl(url, {
    maxRedirects: 3,
    maxResponseBytes: SCRAPE_MAX_RESPONSE_BYTES,
    timeoutMs: 8_000,
    fetchInit: { headers: SCRAPE_HEADERS },
  });
  const transient = !result.ok && (result.error.startsWith("Fetch failed") || result.error.startsWith("Timeout"));
  if (result.ok || !transient || retries === 0) return result;
  await new Promise((r) => setTimeout(r, delayMs));
  return safeScrapeFetch(url, retries - 1, delayMs * 2);
}

/**
 * Searches Google via Serper.dev and returns organic results plus SERP
 * features (PAA, featured snippet, related searches).
 */
export async function fetchGoogleSerp(
  keyword: string,
  numResults: number = 3
): Promise<{
  organic: SerpResult[];
  peopleAlsoAsk: PeopleAlsoAsk[];
  featuredSnippet: string | null;
  relatedSearches: string[];
}> {
  const empty = {
    organic: [],
    peopleAlsoAsk: [],
    featuredSnippet: null,
    relatedSearches: [],
  };

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    logger.warn("[SERP] SERPER_API_KEY not set. Skipping SERP fetch.");
    return empty;
  }

  try {
    const res = await fetchWithRetry(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: keyword, num: numResults }),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) {
      logger.error(`[SERP] Serper.dev error ${res.status}: ${res.statusText}`);
      return empty;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();

    // Keep the original rank while deduplicating URLs so repeated SERP variants
    // never inflate coverage or dominate the competitive brief.
    const seenUrls = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const organic: SerpResult[] = (data.organic ?? [])
      .slice(0, numResults)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any, index: number) => ({
        title: item.title ?? "",
        link: item.link ?? "",
        snippet: item.snippet ?? "",
        rank: index + 1,
      }))
      .filter((result: SerpResult) => {
        if (!result.link || result.snippet.length <= 30) return false;
        try {
          const url = new URL(result.link);
          if (url.protocol !== "https:" && url.protocol !== "http:") return false;
          url.hash = "";
          for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|gclid$|fbclid$|ref$)/i.test(key)) url.searchParams.delete(key);
          }
          const normalized = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}${url.search}`;
          if (seenUrls.has(normalized)) return false;
          seenUrls.add(normalized);
          return true;
        } catch {
          return false;
        }
      });

    // People Also Ask
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peopleAlsoAsk: PeopleAlsoAsk[] = (data.peopleAlsoAsk ?? []).map((q: any) => ({
      question: q.question ?? "",
      answer: q.snippet ?? q.answer ?? undefined,
    }));

    // Featured snippet / answer box
    const answerBox = data.answerBox ?? null;
    const featuredSnippet: string | null =
      answerBox?.answer ?? answerBox?.snippet ?? null;

    // Related searches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const relatedSearches: string[] = (data.relatedSearches ?? []).map((r: any) => r.query ?? "").filter(Boolean);

    return { organic, peopleAlsoAsk, featuredSnippet, relatedSearches };
  } catch (error: unknown) {
    logger.error("[SERP] Failed to fetch SERP data:", {
      error: (error as Error)?.message ?? String(error),
    });
    return empty;
  }
}


/**
 * Scrapes visible body text from a URL, preferring semantic content containers
 * over raw body dumps. Strips nav, footer, cookie banners, scripts, etc.
 */
export interface ScrapedPage {
  text: string;
  headings: string[];
  /** @type names from JSON-LD and microdata (e.g. Article, FAQPage, HowTo) */
  schemaTypes: string[];
  /** ISO date string from datePublished / dateModified / meta tags, or null */
  publishedDate: string | null;
  status?: SerpScrapeStatus;
  failureReason?: string;
}


/**
 * Extracts @type values from all JSON-LD blocks on the page.
 * Flattens arrays and nested @graph structures.
 */
function extractJsonLdSchemaTypes($: ReturnType<typeof cheerio.load>): string[] {
  const types = new Set<string>();
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: any = JSON.parse($(el).html() ?? "");
      const nodes = Array.isArray(parsed)
        ? parsed
        : parsed["@graph"]
          ? parsed["@graph"]
          : [parsed];
      for (const node of nodes) {
        if (!node) continue;
        const t = node["@type"];
        if (typeof t === "string") types.add(t);
        else if (Array.isArray(t)) t.forEach((v: string) => types.add(v));
      }
    } catch { /* malformed JSON-LD — skip */ }
  });
  // Also pick up microdata itemtype attributes
  $("[itemtype]").each((_, el) => {
    const itemtype = $(el).attr("itemtype") ?? "";
    const match = itemtype.match(/schema\.org\/([A-Za-z]+)/);
    if (match) types.add(match[1]);
  });
  return [...types];
}

/**
 * Extracts the most reliable published/modified date from:
 *   1. JSON-LD datePublished / dateModified
 *   2. Open Graph / article meta tags
 *   3. <time datetime> elements
 *   4. HTTP Last-Modified header (passed in)
 */
function extractPublishedDate(
  $: ReturnType<typeof cheerio.load>,
  lastModifiedHeader: string | null
): string | null {
  // 1. JSON-LD
  const ldDates: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: any = JSON.parse($(el).html() ?? "");
      const nodes = Array.isArray(parsed)
        ? parsed
        : parsed["@graph"]
          ? parsed["@graph"]
          : [parsed];
      for (const node of nodes) {
        if (!node) continue;
        const d = node.dateModified ?? node.datePublished;
        if (typeof d === "string" && d.length >= 10) ldDates.push(d);
      }
    } catch { /* skip */ }
  });
  if (ldDates.length > 0) return ldDates.sort().pop()!; // take most recent

  // 2. Open Graph / article meta tags
  const ogDate =
    $("meta[property='article:modified_time']").attr("content") ??
    $("meta[property='article:published_time']").attr("content") ??
    $("meta[name='date']").attr("content") ??
    $("meta[name='last-modified']").attr("content") ??
    null;
  if (ogDate) return ogDate;

  // 3. <time datetime>
  const timeEl = $("time[datetime]").first().attr("datetime");
  if (timeEl && timeEl.length >= 10) return timeEl;

  // 4. HTTP Last-Modified header
  if (lastModifiedHeader) {
    try {
      return new Date(lastModifiedHeader).toISOString();
    } catch { /* unparseable */ }
  }

  return null;
}

/**
 * Scrapes a page and returns the body text, H2/H3 headings, schema types,
 * and published date — all extracted from the HTML DOM before tags are stripped.
 */
export async function scrapePageData(
  url: string,
  maxChars: number = BUDGET.scrapedContentPerResult
): Promise<ScrapedPage> {
  const empty: ScrapedPage = { text: "", headings: [], schemaTypes: [], publishedDate: null, status: "FAILED" };
  if (isUnscrappable(url)) return { ...empty, status: "UNSCRAPPABLE", failureReason: "This domain is excluded from page scraping." };

  try {
    const fetched = await safeScrapeFetch(url);
    if (!fetched.ok) {
      // SSRF/size policy blocks will not succeed on retry: report them as unscrappable.
      return {
        ...empty,
        ...(fetched.error.startsWith("Blocked") ? { status: "UNSCRAPPABLE" as const } : {}),
        failureReason: fetched.error.slice(0, 250),
      };
    }

    const res = fetched.response;
    if (!res.ok) return { ...empty, failureReason: `HTTP ${res.status} ${res.statusText}`.slice(0, 250) };

    const lastModifiedHeader = res.headers.get("last-modified");
    const html = fetched.body;
    const $ = cheerio.load(html);

    const headings: string[] = [];
    $("h2, h3").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text.length > 4 && text.length < 150) headings.push(text);
    });

    const schemaTypes = extractJsonLdSchemaTypes($);
    const publishedDate = extractPublishedDate($, lastModifiedHeader);

    $(
      "script, style, noscript, header, footer, nav, aside, " +
      "iframe, svg, img, form, [aria-hidden='true'], " +
      ".cookie-banner, .cookie-notice, .ad, .advertisement, " +
      "#cookie-consent, .popup, .modal"
    ).remove();

    const semanticText = $(
      "article, main, [role='main'], .content, #content, " +
      ".post-content, .entry-content, .article-body, .post-body"
    )
      .map((_, el) => $(el).text())
      .get()
      .join(" ");

    const raw = semanticText.trim() || $("body").text();
    const text = truncate(raw.replace(/\s+/g, " ").trim(), maxChars);
    return {
      text,
      headings: headings.slice(0, 12),
      schemaTypes,
      publishedDate,
      status: text.length > 200 ? "ANALYZED" : "SNIPPET_ONLY",
      ...(text.length <= 200 ? { failureReason: "Fetched page did not expose enough readable article text." } : {}),
    };
  } catch (error: unknown) {
    return {
      ...empty,
      failureReason: (error instanceof Error ? error.message : String(error)).slice(0, 250),
    };
  }
}

/** Backwards-compat thin wrapper — returns only the text string. */
export async function scrapePageContent(
  url: string,
  maxChars: number = BUDGET.scrapedContentPerResult
): Promise<string> {
  return (await scrapePageData(url, maxChars)).text;
}


/**
 * Extracts meaningful term frequency from scraped text (crude but effective
 * without a full NLP library). Filters stopwords and short tokens.
 */
const STOPWORDS = new Set([
  "that", "this", "with", "from", "have", "will", "your", "they",
  "been", "more", "also", "into", "than", "then", "when", "what",
  "some", "which", "there", "their", "about", "would", "other",
  "were", "these", "those", "just", "like", "such", "even",
]);

function extractTermFrequency(text: string, topN = 60): Map<string, number> {
  const freq = new Map<string, number>();
  const tokens = text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  // Return only top-N by frequency to avoid noise
  return new Map(
    [...freq.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, topN)
  );
}

export interface ContentGapAnalysis {
  /** Topics present in ALL top-ranking pages (well-covered ground). */
  commonTopics: string[];
  /** Topics present in SOME but not all pages (differentiation opportunities). */
  gapTopics: string[];
}

/**
 * Computes content gaps across scraped competitor pages.
 * commonTopics = intersection (every page covers these — table stakes).
 * gapTopics = union minus intersection (underserved angles).
 */
export function computeContentGaps(results: SerpResult[]): ContentGapAnalysis {
  const pagesWithContent = results.filter((r) => (r.scrapedContent ?? "").length > 100);

  if (pagesWithContent.length < 2) {
    return { commonTopics: [], gapTopics: [] };
  }

  const termSets = pagesWithContent.map((r) =>
    new Set(extractTermFrequency(r.scrapedContent ?? "").keys())
  );

  const union = new Set<string>();
  for (const set of termSets) set.forEach((t) => union.add(t));

  const intersection = [...union].filter((term) =>
    termSets.every((set) => set.has(term))
  );

  const gapTopics = [...union].filter((t) => !intersection.includes(t));

  return {
    commonTopics: intersection.slice(0, 20),
    gapTopics: gapTopics.slice(0, 20),
  };
}


/**
 * Full SERP pipeline: fetch → scrape → gap analysis → format context.
 * Returns a structured context object ready to inject into an LLM prompt.
 */
export async function getSerpContextForKeyword(
  keyword: string,
  scrapeTopPages = true
): Promise<SerpContext | null> {
  logger.debug(`[SERP] Fetching context for: "${keyword}"…`);

  const { organic, peopleAlsoAsk, featuredSnippet, relatedSearches } =
    await fetchGoogleSerp(keyword, 10);

  if (organic.length === 0) return null;

  // Scrape up to ten useful organic results, preserving rank and documenting
  // which pages were inaccessible instead of silently dropping them.
  if (scrapeTopPages) {
    const queue = organic.filter((result) => {
      if (isUnscrappable(result.link)) {
        result.scrapeStatus = "UNSCRAPPABLE";
        result.scrapeFailureReason = "This domain is excluded from page scraping.";
        return false;
      }
      return true;
    });
    const CONCURRENCY = 3;

    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const batch = queue.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (result) => {
          try {
            const page = await scrapePageData(result.link);
            result.scrapedContent = page.text;
            result.scrapedHeadings = page.headings;
            result.scrapedSchemaTypes = page.schemaTypes;
            result.scrapedPublishedDate = page.publishedDate;
            result.wordCount = page.text ? page.text.split(/\s+/).filter(Boolean).length : 0;
            result.scrapeStatus = page.status ?? (page.text.length > 200 ? "ANALYZED" : "SNIPPET_ONLY");
            if (page.failureReason) result.scrapeFailureReason = page.failureReason;
          } catch (error: unknown) {
            result.scrapeStatus = "FAILED";
            result.scrapeFailureReason = (error instanceof Error ? error.message : String(error)).slice(0, 250);
          }
        })
      );
    }

    const analyzed = organic.filter(r => r.scrapeStatus === "ANALYZED");
    logger.info(`[SERP] Analysed ${analyzed.length}/${organic.length} organic pages for "${keyword}"`, {
      statuses: organic.reduce<Record<string, number>>((counts, result) => {
        const status = result.scrapeStatus ?? "SNIPPET_ONLY";
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      }, {}),
    });
  } else {
    for (const result of organic) result.scrapeStatus = "SNIPPET_ONLY";
  }

  const gapAnalysis = computeContentGapsFromOpportunities(keyword, organic, peopleAlsoAsk);
  const gaps = { commonTopics: gapAnalysis.commonTopics, gapTopics: gapAnalysis.gapTopics };


  let ctx = `LIVE SEARCH CONTEXT FOR "${keyword}"\n`;
  ctx += "=".repeat(60) + "\n\n";

  // Featured snippet (highest-signal SERP feature)
  if (featuredSnippet) {
    ctx += "FEATURED SNIPPET (what Google currently shows as the direct answer):\n";
    ctx += truncate(featuredSnippet, BUDGET.featuredSnippet) + "\n\n";
  }

  // People Also Ask — include answers so the model knows what to beat
  if (peopleAlsoAsk.length > 0) {
    ctx += "PEOPLE ALSO ASK (questions your post must answer — beat these answers):\n";
    let paaChars = 0;
    for (const paa of peopleAlsoAsk) {
      const line = `- ${paa.question}${paa.answer
        ? `\n  Current Google answer: ${paa.answer}`
        : ""}\n`;
      if (paaChars + line.length > BUDGET.paaTotal) break;
      ctx += line;
      paaChars += line.length;
    }
    ctx += "\n";
  }

  // Organic results
  ctx += "TOP-RANKING PAGES:\n\n";
  organic.forEach((result, i) => {
    ctx += `[RANK ${i + 1}] ${result.title}\n`;
    ctx += `URL: ${result.link}\n`;
    ctx += `Snippet: ${truncate(result.snippet, BUDGET.snippetPerResult)}\n`;
    if (result.scrapedContent) {
      ctx += `Content excerpt:\n${truncate(result.scrapedContent, BUDGET.scrapedContentPerResult)}\n`;
    }
    ctx += "\n";
  });

  // Structured opportunity intelligence
  if (gapAnalysis.analysis.opportunities.length > 0) {
    ctx += "PRIORITIZED SEO OPPORTUNITIES:\n";
    for (const opportunity of gapAnalysis.analysis.opportunities.slice(0, 12)) {
      ctx += `- [${opportunity.score}/100] ${opportunity.topic} — ${opportunity.reason}\n`;
    }
    ctx += "\n";
  }

  // Content gap analysis
  if (gaps.commonTopics.length > 0 || gaps.gapTopics.length > 0) {
    ctx += "CONTENT GAP ANALYSIS:\n";
    if (gaps.commonTopics.length > 0) {
      ctx += `Common topics (table stakes — every competitor covers these): ${gaps.commonTopics.join(", ")}\n`;
    }
    if (gaps.gapTopics.length > 0) {
      ctx += `Gap topics (underserved angles — differentiate here): ${gaps.gapTopics.join(", ")}\n`;
    }
    ctx += "\n";
  }

  // Related searches
  if (relatedSearches.length > 0) {
    ctx += "RELATED SEARCHES (secondary keywords to incorporate):\n";
    ctx += truncate(relatedSearches.join(", "), BUDGET.relatedSearches) + "\n\n";
  }

  ctx += "-".repeat(60) + "\n";
  ctx +=
    "INSTRUCTION: Your content must cover all table-stakes topics, go deeper " +
    "on gap topics, directly answer every PAA question, and beat the featured " +
    "snippet with a clearer, more authoritative direct answer.\n";

  return {
    keyword,
    results: organic,
    peopleAlsoAsk,
    featuredSnippet,
    relatedSearches,
    formattedContext: ctx,
    opportunityAnalysis: gapAnalysis.analysis,
  };
}


export type SerpFormat =
  | "tool"
  | "listicle"
  | "comparison"
  | "guide"
  | "product"
  | "video"
  | "general";

export type SerpConfidence = "high" | "medium" | "low";

export interface SerpFormatSignal {
  format: SerpFormat;
  confidence: SerpConfidence;
  reasoning: string;
}


export function classifySerpFormat(results: SerpResult[]): SerpFormatSignal {
  if (results.length === 0) {
    return { format: "general", confidence: "low", reasoning: "No results to classify" };
  }

  const scores: Record<SerpFormat, number> = {
    tool: 0,
    listicle: 0,
    comparison: 0,
    guide: 0,
    product: 0,
    video: 0,
    general: 0,
  };

  results.forEach((r, i) => {
    const weight = i === 0 ? 3 : i === 1 ? 2 : 1;
    const title = r.title.toLowerCase();
    const snippet = r.snippet.toLowerCase();
    const slug = r.link.toLowerCase();
    const combined = `${title} ${snippet}`;

    // Tool signals
    if (/\b(calculator|generator|checker|interactive)\b/.test(combined)) scores.tool += 2 * weight;
    if (/\b(try it|enter your|use this tool)\b/.test(combined)) scores.tool += 1 * weight;
    if (/calculator|generator|checker/.test(slug)) scores.tool += 2 * weight;

    // Listicle signals
    if (/\b(best \d+|top \d+|\d+ (ways|tips|tools|strategies|examples|ideas))\b/.test(combined)) scores.listicle += 3 * weight;
    if (/^(best-|top-|\d+-)/.test(slug.split("/").pop() ?? "")) scores.listicle += 2 * weight;

    // Comparison signals — note: "or" removed; was matching everything
    if (/\bvs\.?\b|\bversus\b|\bcompar(e|ison)\b|\balternatives?\b|\bwhich is better\b/.test(combined)) scores.comparison += 2 * weight;
    if (/\bvs-|versus|alternatives/.test(slug)) scores.comparison += 2 * weight;

    // Guide signals
    if (/\bhow to\b|\bstep.by.step\b|\b(ultimate|complete|beginner.s) guide\b|\btutorial\b/.test(combined)) scores.guide += 2 * weight;
    if (/how-to|guide|tutorial/.test(slug)) scores.guide += 1 * weight;

    // Product / commercial signals
    if (/\b(buy|price|shop|purchase|discount|review|rating|amazon)\b/.test(combined)) scores.product += 2 * weight;

    // Video signals
    if (r.link.includes("youtube.com") || r.link.includes("vimeo.com")) scores.video += 3 * weight;
    if (/\b(watch|video tutorial)\b/.test(combined)) scores.video += 1 * weight;
  });

  const sorted = (Object.entries(scores) as [SerpFormat, number][]).sort(
    ([, a], [, b]) => b - a
  );

  const [topFormat, topScore] = sorted[0];
  const [, secondScore] = sorted[1];

  const format: SerpFormat = topScore > 0 ? topFormat : "general";
  const confidence: "high" | "medium" | "low" =
    topScore >= 6 ? "high" : topScore >= 3 ? "medium" : "low";

  return {
    format,
    confidence,
    reasoning: `Format: ${format} (weighted score: ${topScore}, gap over #2: ${topScore - secondScore}). Top title: "${results[0]?.title}"`,
  };
}


/**
 * Converts a SERP format signal into a concrete prompt instruction block
 * to inject into the blog generation prompt.
 */
export function formatToPromptHint(signal: SerpFormatSignal, keyword: string): string {
  const label = signal.format.toUpperCase();
  const confidence = signal.confidence.toUpperCase();
  const base = [
    `OBSERVED SERP FORMAT SIGNAL for "${keyword}": ${label} (${confidence} confidence).`,
    "Treat this as a planning signal, not an instruction to copy competitors or imitate the SERP blindly.",
    "Prioritize the searcher's actual task, current primary evidence, useful steps, trade-offs, limitations, and original analysis.",
    "Choose headings, tables, FAQs, and examples only when they help the reader; do not pad an article to match competitors.",
  ];

  switch (signal.format) {
    case "tool":
      base.push("Interactive tools appear important in the sampled results. If the user needs an actual calculation, audit, or generated output, flag the format gap and consider a real tool or clearly scoped companion guide; never claim prose is a substitute for a working tool.");
      break;
    case "listicle":
      base.push("A list format may fit the query. Use a numbered list only if the options are independently useful and can be compared fairly; don't invent a fixed number of items or a winner without evidence.");
      break;
    case "comparison":
      base.push("A comparison format may fit the query. Define consistent, relevant criteria, cite current product facts, explain methodology and caveats, and avoid ungrounded winners or pricing.");
      break;
    case "guide":
      base.push("A procedural guide may fit the query. Organize steps in the order the reader must perform them, include prerequisites and troubleshooting when useful, and verify operational details against current sources.");
      break;
    case "product":
      base.push("Commercial/product pages appear in the sample. Clarify decision criteria, audience fit, trade-offs, and current verifiable facts; do not invent pricing, specifications, or first-party product experience.");
      break;
    case "video":
      base.push("Video results appear in the sample. A written companion should offer accessible steps, checklists, references, transcripts, or additional detail. Do not imply an article fully replaces the video format.");
      break;
    default:
      base.push("No dominant format has been established. Select the lightest format that completes the user's task rather than forcing a comparison table, FAQ, or long-form guide.");
      break;
  }

  return base.join("\n");
}


/**
 * Extracts H2/H3 headings from scraped competitor text to understand how they
 * structure content. Used to find structural gaps and avoid mimicking them.
 */
export function extractCompetitorHeadings(scrapedContent: string): string[] {
  if (!scrapedContent) return [];
  // Try markdown-style headings first (e.g. when content is already cleaned)
  const mdHeadings = scrapedContent.match(/^#{2,3} .+$/gm) ?? [];
  if (mdHeadings.length > 0) {
    return mdHeadings
      .map(h => h.replace(/^#{2,3}\s+/, "").trim())
      .filter(h => h.length > 4 && h.length < 120)
      .slice(0, 12);
  }
  return [];
}

export function estimateWordCount(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).length;
}

export interface CompetitorProfile {
  url: string;
  title: string;
  headings: string[];
  estimatedWords: number;
  rank: number;
  schemaTypes: string[];
  publishedDate: string | null;
  pageType?: SerpFormat;
  scrapeStatus?: SerpScrapeStatus;
}

/**
 * Builds a profile for each scraped competitor page — used to drive the
 * beat strategy prompt section.
 */
export function buildCompetitorProfiles(results: SerpResult[]): CompetitorProfile[] {
  return results
    .filter(r => r.scrapeStatus === "ANALYZED" || (r.scrapedContent?.length ?? 0) > 200)
    .map((r, i) => ({
      url: r.link,
      title: r.title,
      headings: (r.scrapedHeadings && r.scrapedHeadings.length > 0)
        ? r.scrapedHeadings
        : extractCompetitorHeadings(r.scrapedContent ?? ""),
      estimatedWords: estimateWordCount(r.scrapedContent ?? ""),
      rank: r.rank ?? i + 1,
      schemaTypes: r.scrapedSchemaTypes ?? [],
      publishedDate: r.scrapedPublishedDate ?? null,
      pageType: classifySerpFormat([r]).format,
      scrapeStatus: r.scrapeStatus ?? "ANALYZED",
    }));
}

/**
 * Synthesises observed competitor coverage into an evidence-qualified strategy.
 * The result guides task completion, useful subtopics, source-backed differentiation,
 * freshness checks, and appropriate structured data. It never prescribes length padding
 * or treats inaccessible page content as evidence of a competitor omission.
 */
export function buildCompetitorBeatStrategy(
  profiles: CompetitorProfile[],
  keyword: string
): string {
  if (profiles.length === 0) {
    return `COMPETITIVE RESEARCH FOR "${keyword}": no competitor pages were successfully analysed. Do not claim specific competitor gaps. Use query intent and verified sources, and route for review if the SERP coverage remains low.\n`;
  }

  const analyzed = profiles.filter(p => p.scrapeStatus === "ANALYZED" || p.headings.length > 0);
  const headingFreq = new Map<string, { label: string; count: number; urls: string[] }>();
  for (const profile of analyzed) {
    for (const heading of profile.headings) {
      const key = heading.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (!key) continue;
      const entry = headingFreq.get(key) ?? { label: heading, count: 0, urls: [] };
      entry.count += 1;
      entry.urls.push(profile.url);
      headingFreq.set(key, entry);
    }
  }

  const recurringCoverage = [...headingFreq.values()]
    .filter(item => analyzed.length >= 3 && item.count / analyzed.length >= 0.4)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const pagesWithDates = analyzed
    .filter(p => p.publishedDate && Number.isFinite(Date.parse(p.publishedDate)))
    .map(p => ({ url: p.url, date: new Date(p.publishedDate!) }));
  const newestDate = pagesWithDates.length
    ? new Date(Math.max(...pagesWithDates.map(p => p.date.getTime())))
    : null;

  const strategy: string[] = [
    `COMPETITIVE CONTENT STRATEGY FOR "${keyword}":`,
    `- Successful page analyses: ${analyzed.length}/${profiles.length}. Use the retrieved pages as evidence, not as a script to imitate.`,
    "- Choose article depth from search intent, essential reader tasks, material subtopics, available evidence, and practical usefulness. Do not pad the article to exceed competitor word counts.",
    "- Compare only the observed headings, snippets, dates, content excerpts, and schema signals. An inaccessible page provides no evidence of its content or omissions.",
    "- A repeated heading is a candidate topic requirement, not an automatic section title. Include it only when it helps complete the reader's task.",
  ];

  if (recurringCoverage.length > 0) {
    strategy.push(`- Recurring observed coverage (${analyzed.length} pages were analysable): ${recurringCoverage.map(item => `${item.label} (${item.count}/${analyzed.length}; ${item.urls.slice(0, 2).join(", ")})`).join("; ")}.`);
  } else {
    strategy.push("- No sufficiently repeated headings were established; infer no mandatory heading list from this sample.");
  }

  if (newestDate) {
    strategy.push(`- Latest date exposed by analysed pages: ${newestDate.toISOString().slice(0, 10)}. Treat dates as page metadata, not proof that all claims are current or stale.`);
  } else {
    strategy.push("- Publication/update dates were unavailable for the analysed sample; verify freshness-sensitive claims independently.");
  }

  const schemaTypes = [...new Set(analyzed.flatMap(p => p.schemaTypes))];
  if (schemaTypes.length > 0) {
    strategy.push(`- Observed schema types: ${schemaTypes.slice(0, 10).join(", ")}. Do not copy schemas for competitive advantage; add structured data only when the page content meets the relevant search-engine guidelines.`);
  }

  strategy.push("- Differentiate by answering surfaced reader questions with relevant evidence, explaining methods and criteria, adding practical steps and limitations, and using first-party examples only when documented.");
  strategy.push("- State whether any proposed gap is observed, inferred from sampled headings/excerpts, or still requires research. Never claim a competitor is wrong, outdated, or omits a topic without supporting evidence.");
  return strategy.join("\n") + "\n";
}
