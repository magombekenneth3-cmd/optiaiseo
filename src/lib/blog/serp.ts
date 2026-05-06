import { logger } from "@/lib/logger";
import * as cheerio from "cheerio";

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface SerpResult {
  title: string;
  link: string;
  snippet: string;
  scrapedContent?: string;
  /** H2/H3 headings extracted directly from the page's HTML DOM */
  scrapedHeadings?: string[];
  /** JSON-LD / microdata schema types found on the page */
  scrapedSchemaTypes?: string[];
  /** Published or modified date extracted from structured data / meta tags */
  scrapedPublishedDate?: string | null;
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
}

// ── TOKEN / CHARACTER BUDGET ───────────────────────────────────────────────────

/** Hard character limits per section to prevent silent context overflows. */
const BUDGET = {
  scrapedContentPerResult: 2000,
  snippetPerResult: 400,
  featuredSnippet: 600,
  paaTotal: 800,
  relatedSearches: 300,
} as const;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

// ── DOMAINS TO SKIP SCRAPING ───────────────────────────────────────────────────

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

function isUnscrappable(url: string): boolean {
  return UNSCRAPPABLE_DOMAINS.some((d) => url.includes(d));
}

// ── SERP FETCH ─────────────────────────────────────────────────────────────────

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

    // Organic results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const organic: SerpResult[] = (data.organic ?? [])
      .slice(0, numResults)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => ({
        title: item.title ?? "",
        link: item.link ?? "",
        snippet: item.snippet ?? "",
      }))
      .filter((r: SerpResult) => r.snippet.length > 30); // drop low-signal stubs

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

// ── SCRAPING ───────────────────────────────────────────────────────────────────

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
}

// ── SCHEMA & FRESHNESS HELPERS ────────────────────────────────────────────────

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
  const empty: ScrapedPage = { text: "", headings: [], schemaTypes: [], publishedDate: null };
  if (isUnscrappable(url)) return empty;

  try {
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(8_000),
      }
    );

    if (!res.ok) return empty;

    const lastModifiedHeader = res.headers.get("last-modified");
    const html = await res.text();
    const $ = cheerio.load(html);

    // ── Extract headings from DOM BEFORE stripping any elements ──────────────
    const headings: string[] = [];
    $("h2, h3").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text.length > 4 && text.length < 150) headings.push(text);
    });

    // ── Extract schema types & published date BEFORE stripping ───────────────
    const schemaTypes = extractJsonLdSchemaTypes($);
    const publishedDate = extractPublishedDate($, lastModifiedHeader);

    // ── Strip noise elements ──────────────────────────────────────────────────
    $(
      "script, style, noscript, header, footer, nav, aside, " +
        "iframe, svg, img, form, [aria-hidden='true'], " +
        ".cookie-banner, .cookie-notice, .ad, .advertisement, " +
        "#cookie-consent, .popup, .modal"
    ).remove();

    // ── Prefer semantic content containers; fall back to body ─────────────────
    const semanticText = $(
      "article, main, [role='main'], .content, #content, " +
        ".post-content, .entry-content, .article-body, .post-body"
    )
      .map((_, el) => $(el).text())
      .get()
      .join(" ");

    const raw = semanticText.trim() || $("body").text();
    return {
      text: truncate(raw.replace(/\s+/g, " ").trim(), maxChars),
      headings: headings.slice(0, 12),
      schemaTypes,
      publishedDate,
    };
  } catch {
    return empty;
  }
}

/** Backwards-compat thin wrapper — returns only the text string. */
export async function scrapePageContent(
  url: string,
  maxChars: number = BUDGET.scrapedContentPerResult
): Promise<string> {
  return (await scrapePageData(url, maxChars)).text;
}

// ── CONTENT GAP EXTRACTION ────────────────────────────────────────────────────

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

// ── MAIN PIPELINE ──────────────────────────────────────────────────────────────

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
    await fetchGoogleSerp(keyword, 3);

  if (organic.length === 0) return null;

  // Scrape sequentially with a small concurrency limit to avoid rate-limiting.
  // Two concurrent requests is safe for most hosts; bump to 3 if speed matters.
  if (scrapeTopPages) {
    const queue = organic.filter((r) => !isUnscrappable(r.link));
    const CONCURRENCY = 2;

    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const batch = queue.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (result) => {
          const page = await scrapePageData(result.link);
          result.scrapedContent = page.text;
          result.scrapedHeadings = page.headings;
          result.scrapedSchemaTypes = page.schemaTypes;
          result.scrapedPublishedDate = page.publishedDate;
        })
      );
    }
  }

  const gaps = computeContentGaps(organic);

  // ── Build LLM context string with explicit token budgets ──────────────────

  let ctx = `LIVE SEARCH CONTEXT FOR "${keyword}"\n`;
  ctx += "=".repeat(60) + "\n\n";

  // Featured snippet (highest-signal SERP feature)
  if (featuredSnippet) {
    ctx += "FEATURED SNIPPET (what Google currently shows as the direct answer):\n";
    ctx += truncate(featuredSnippet, BUDGET.featuredSnippet) + "\n\n";
  }

  // People Also Ask
  if (peopleAlsoAsk.length > 0) {
    ctx += "PEOPLE ALSO ASK (questions your post must answer):\n";
    let paaChars = 0;
    for (const paa of peopleAlsoAsk) {
      const line = `- ${paa.question}${paa.answer ? ` → ${paa.answer}` : ""}\n`;
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
  };
}

// ── SERP FORMAT CLASSIFICATION ─────────────────────────────────────────────────

export type SerpFormat =
  | "tool"
  | "listicle"
  | "comparison"
  | "guide"
  | "product"
  | "video"
  | "general";

export interface SerpFormatSignal {
  format: SerpFormat;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

/**
 * Classifies the dominant SERP content format using position-weighted scoring
 * across title text, snippet text, and URL slugs.
 *
 * Rank 1 is weighted 3×, rank 2 is 2×, rank 3 is 1× — matching the real-world
 * signal strength of each position.
 */
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

// ── PROMPT HINT GENERATION ─────────────────────────────────────────────────────

/**
 * Converts a SERP format signal into a concrete prompt instruction block
 * to inject into the blog generation prompt.
 */
export function formatToPromptHint(signal: SerpFormatSignal, keyword: string): string {
  const map: Record<SerpFormat, string> = {
    tool: `FORMAT STRATEGY: The SERP for "${keyword}" is dominated by INTERACTIVE TOOLS.
A long-form article will likely underperform. Generate a "Tool Companion Guide":
- Open with the direct answer a tool would give for the most common input
- Structure H2s around the input variables a tool would accept
- Close with a step-by-step that substitutes for the tool's output
- Include a clear CTA toward an interactive tool or calculator`,

    listicle: `FORMAT STRATEGY: The SERP for "${keyword}" is dominated by LISTICLES.
Structure as a numbered list:
- Use a specific number in the H1 (e.g. "11 Best…", "7 Proven…")
- Each H2 = one item with a bold takeaway + 2–3 sentences + one actionable tip
- Add a comparison table summarising all items near the end
- Open with a 60-word executive summary naming the top pick`,

    comparison: `FORMAT STRATEGY: The SERP for "${keyword}" is dominated by COMPARISON content.
Structure as a side-by-side comparison:
- Open with a direct verdict: "X is better for Y if… Z is better for W if…"
- Use comparison tables with consistent criteria rows
- Declare a winner for at least 3 distinct buyer profiles
- Avoid fence-sitting — state clear winners per use case`,

    guide: `FORMAT STRATEGY: The SERP for "${keyword}" is dominated by HOW-TO GUIDES.
Structure as a step-by-step guide:
- H1 must start with "How to…"
- Numbered H2s for each step (Step 1:, Step 2:, …)
- Prerequisites section before step 1
- Troubleshooting FAQ at the end
- Each step: what + why + how`,

    product: `FORMAT STRATEGY: The SERP for "${keyword}" shows strong COMMERCIAL / PRODUCT intent.
Structure as a buying guide:
- Open with "who should buy this" summary
- Feature a comparison table with real specs / pricing
- Add a pricing breakdown section
- End with a clear recommendation segmented by use case and budget`,

    video: `FORMAT STRATEGY: The SERP for "${keyword}" is VIDEO-dominated.
Generate a written companion that complements video content:
- Short, scannable sections (under 150 words each)
- "Key takeaways" summary box at the top
- Timestamp-style headings if applicable (## 0:00 – Introduction)
- Optimise for featured-snippet capture — Google often pulls text results
  alongside video SERPs`,

    general: `FORMAT STRATEGY: No dominant format detected for "${keyword}". Use a comprehensive guide:
- Direct answer in the first paragraph
- Skimmable H2 structure
- Comparison table for any tools or options mentioned
- FAQ section at the end`,
  };

  return map[signal.format];
}

// ── COMPETITOR STRUCTURE EXTRACTION ───────────────────────────────────────────

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
}

/**
 * Builds a profile for each scraped competitor page — used to drive the
 * beat strategy prompt section.
 */
export function buildCompetitorProfiles(results: SerpResult[]): CompetitorProfile[] {
  return results
    .filter(r => r.scrapedContent && r.scrapedContent.length > 200)
    .map((r, i) => ({
      url: r.link,
      title: r.title,
      // Prefer real DOM-extracted headings; fall back to markdown regex on text
      headings: (r.scrapedHeadings && r.scrapedHeadings.length > 0)
        ? r.scrapedHeadings
        : extractCompetitorHeadings(r.scrapedContent ?? ""),
      estimatedWords: estimateWordCount(r.scrapedContent ?? ""),
      rank: i + 1,
      schemaTypes: r.scrapedSchemaTypes ?? [],
      publishedDate: r.scrapedPublishedDate ?? null,
    }));
}

/**
 * Synthesises competitor profiles into a concrete beat strategy string for
 * injection into LLM prompts. Tells the model:
 *  - minimum word count to outrank
 *  - table-stakes H2s every competitor covers (must include)
 *  - underserved angles only one competitor covers (differentiate here)
 *  - editorial stance requirements
 */
export function buildCompetitorBeatStrategy(
  profiles: CompetitorProfile[],
  keyword: string
): string {
  if (profiles.length === 0) return "";

  const avgWords = Math.round(
    profiles.reduce((sum, p) => sum + p.estimatedWords, 0) / profiles.length
  );
  const targetWords = Math.min(Math.max(avgWords + 400, 2000), 4000);

  const allHeadings = profiles.flatMap(p => p.headings.map(h => h.toLowerCase()));
  const headingFreq = new Map<string, number>();
  for (const h of allHeadings) {
    headingFreq.set(h, (headingFreq.get(h) ?? 0) + 1);
  }

  const totalProfiles = profiles.length;
  const tableStakeHeadings = [...headingFreq.entries()]
    .filter(([, count]) => count >= Math.ceil(totalProfiles * 0.6))
    .map(([h]) => h)
    .slice(0, 5);

  const rareHeadings = [...headingFreq.entries()]
    .filter(([, count]) => count === 1)
    .map(([h]) => h)
    .slice(0, 5);

  // ── Schema analysis: which types appear & which are missing ───────────────
  const allSchemas = profiles.flatMap(p => p.schemaTypes);
  const schemaFreq = new Map<string, number>();
  for (const s of allSchemas) {
    schemaFreq.set(s, (schemaFreq.get(s) ?? 0) + 1);
  }
  const commonSchemas = [...schemaFreq.entries()]
    .filter(([, c]) => c >= Math.ceil(totalProfiles * 0.5))
    .map(([s]) => s);
  // High-value schema types that differentiate content in AI results
  const VALUABLE_SCHEMAS = ["FAQPage", "HowTo", "Article", "NewsArticle",
    "BlogPosting", "Review", "Product", "BreadcrumbList"];
  const missingSchemas = VALUABLE_SCHEMAS.filter(
    s => !commonSchemas.includes(s) && !allSchemas.includes(s)
  ).slice(0, 3);

  // ── Freshness analysis ────────────────────────────────────────────────────
  const dates = profiles
    .map(p => p.publishedDate)
    .filter((d): d is string => !!d)
    .map(d => { try { return new Date(d); } catch { return null; } })
    .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
  const oldestDate = dates.length > 0
    ? new Date(Math.min(...dates.map(d => d.getTime())))
    : null;
  const newestDate = dates.length > 0
    ? new Date(Math.max(...dates.map(d => d.getTime())))
    : null;

  let strategy = `COMPETITOR BEAT STRATEGY FOR "${keyword}":\n`;
  strategy += `- Top ${profiles.length} pages average ~${avgWords} words → write at least ${targetWords} words to outrank\n`;

  if (profiles.length > 0) {
    strategy += `- Rank #1 "${profiles[0].title}" covers: ${profiles[0].headings.slice(0, 4).join(" | ") || "unknown structure"}\n`;
  }
  if (tableStakeHeadings.length > 0) {
    strategy += `- Table-stakes sections (every competitor covers these — you must too): ${tableStakeHeadings.join(", ")}\n`;
  }
  if (rareHeadings.length > 0) {
    strategy += `- Underserved angles (only 1 competitor covers — differentiate here): ${rareHeadings.join(", ")}\n`;
  }

  // Schema signals
  if (commonSchemas.length > 0) {
    strategy += `- Competitors use these schema types: ${commonSchemas.join(", ")} — your post must include them\n`;
  }
  if (missingSchemas.length > 0) {
    strategy += `- Schema gap opportunity: none of the top pages use ${missingSchemas.join(", ")} — adding these gives you a structured data advantage\n`;
  }

  // Freshness signals
  if (newestDate) {
    const monthsOld = Math.round((Date.now() - newestDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
    if (monthsOld > 6) {
      strategy += `- Content freshness gap: the newest competitor page is ~${monthsOld} months old — explicitly date your content and cover any developments since ${newestDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}\n`;
    } else {
      strategy += `- Freshness: top competitor updated ${monthsOld <= 1 ? "recently" : `~${monthsOld} months ago`} (${newestDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}) — match or beat this with a clear "Updated [current date]" and recent examples\n`;
    }
  }
  if (oldestDate && newestDate && oldestDate.getTime() !== newestDate.getTime()) {
    const spreadMonths = Math.round((newestDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
    if (spreadMonths > 12) {
      strategy += `- Freshness spread: competitors range from ${oldestDate.getFullYear()} to ${newestDate.getFullYear()} — older pages are vulnerable to freshness displacement\n`;
    }
  }

  strategy += `- Take at least one clear editorial position the top pages avoid\n`;
  strategy += `- Include one "Honest take:" paragraph with a frank professional opinion\n`;

  return strategy;
}
