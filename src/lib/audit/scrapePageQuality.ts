import * as cheerio from "cheerio";

export interface PageQualityResult {
  url: string;

  // CONTENT DEPTH
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2s: string[];
  h3s: string[];
  wordCount: number;
  paragraphCount: number;
  hasIntroductionParagraph: boolean;

  // CONTENT STRUCTURE SIGNALS
  hasFAQSection: boolean;
  hasHowToSection: boolean;
  hasTableOfContents: boolean;
  hasComparisonTable: boolean;
  hasImages: boolean;
  imageCount: number;
  videoEmbedPresent: boolean;
  hasCallToAction: boolean;

  // E-E-A-T SIGNALS
  hasAuthorMention: boolean;
  hasDatePublished: boolean;
  datePublished: string | null;
  hasCitations: boolean;
  externalLinkCount: number;
  internalLinkCount: number;
  hasAboutOrBioLink: boolean;

  // SCHEMA QUALITY
  schemaTypes: string[];
  hasFAQSchema: boolean;
  hasHowToSchema: boolean;
  hasArticleSchema: boolean;
  hasReviewSchema: boolean;
  hasProductSchema: boolean;
  schemaBreadth: number;

  // TECHNICAL QUALITY
  hasCanonical: boolean;
  canonicalUrl: string | null;
  hasMetaRobots: boolean;
  robotsContent: string | null;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  pageSizeKb: number;

  // CONTENT FRESHNESS
  lastModifiedHeader: string | null;

  // READABILITY PROXY
  avgWordsPerParagraph: number;
  longestParagraphWords: number;
}

function extractSchemaTypes(html: string): string[] {
  const types: string[] = [];
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      const extract = (obj: unknown): void => {
        if (!obj || typeof obj !== "object") return;
        const record = obj as Record<string, unknown>;
        if (Array.isArray(record["@graph"])) {
          (record["@graph"] as unknown[]).forEach(extract);
        }
        if (typeof record["@type"] === "string") types.push(record["@type"]);
        if (Array.isArray(record["@type"])) {
          (record["@type"] as string[]).forEach((t) => types.push(t));
        }
      };
      extract(parsed);
    } catch {
      // ignore malformed blocks
    }
  }
  return [...new Set(types)];
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function scrapePageQuality(url: string): Promise<PageQualityResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let html = "";
  let lastModifiedHeader: string | null = null;
  let pageSizeKb = 0;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO/1.0; +https://optiaiseo.online)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) return null;

    lastModifiedHeader = res.headers.get("last-modified");
    const buf = await res.arrayBuffer();
    pageSizeKb = Math.round(buf.byteLength / 1024);
    html = new TextDecoder().decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  try {
    const $ = cheerio.load(html);

    // Remove noise elements
    $("nav, header, footer, aside, script, style, noscript").remove();

    // ── META ────────────────────────────────────────────────────────────────
    const title = $("title").first().text().trim() || null;
    const metaDescription =
      $("meta[name='description']").attr("content")?.trim() ||
      $("meta[name='Description']").attr("content")?.trim() ||
      null;
    const h1 = $("h1").first().text().trim() || null;

    const h2s = $("h2")
      .map((_, el) => $(el).text().trim().slice(0, 80))
      .get()
      .filter(Boolean)
      .slice(0, 15);

    const h3s = $("h3")
      .map((_, el) => $(el).text().trim().slice(0, 60))
      .get()
      .filter(Boolean)
      .slice(0, 10);

    // ── WORD COUNT (main/article or body) ──────────────────────────────────
    const mainEl = $("main, article").first();
    const textSource = mainEl.length ? mainEl : $("body");
    const bodyText = textSource.text().replace(/\s+/g, " ").trim();
    const wordCount = countWords(bodyText);

    // ── PARAGRAPHS ─────────────────────────────────────────────────────────
    const paragraphs = $("p")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => countWords(t) > 20);

    const paragraphCount = paragraphs.length;
    const hasIntroductionParagraph = paragraphs.length > 0 && countWords(paragraphs[0]) > 50;

    const wordCounts = paragraphs.map(countWords);
    const avgWordsPerParagraph =
      wordCounts.length > 0
        ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
        : 0;
    const longestParagraphWords =
      wordCounts.length > 0 ? Math.max(...wordCounts) : 0;

    // ── STRUCTURE SIGNALS ──────────────────────────────────────────────────
    const allHeadings = [...h2s, ...h3s].join(" ").toLowerCase();
    const hasFAQSection =
      /faq|frequently asked/i.test(allHeadings) ||
      html.toLowerCase().includes('"faqpage"') ||
      html.toLowerCase().includes('"faq"');

    const orderedLists = $("ol").filter((_, el) => $(el).find("li").length >= 3).length;
    const hasHowToSection =
      orderedLists > 0 ||
      html.toLowerCase().includes('"howto"');

    const navWithAnchors =
      $("nav a[href^='#']").length >= 4 ||
      $("ul a[href^='#']").length >= 4;
    const hasTableOfContents =
      navWithAnchors || /table of contents|toc/i.test(html.slice(0, 5000));

    const hasComparisonTable =
      $("table")
        .filter(
          (_, el) =>
            $(el).find("tr").length > 3 && $(el).find("th, td").length > 4,
        )
        .length > 0;

    const hasImages = $("img[alt]:not([alt=''])").length > 0;
    const imageCount = $("img").length;

    const videoEmbedPresent =
      $("iframe")
        .filter((_, el) => /youtube|vimeo|wistia/i.test($(el).attr("src") ?? ""))
        .length > 0;

    const ctaPattern = /\b(try|start|get|sign up|signup|free|demo|download|access)\b/i;
    const hasCallToAction =
      $("button, a")
        .filter((_, el) => ctaPattern.test($(el).text()))
        .length > 0;

    // ── E-E-A-T ────────────────────────────────────────────────────────────
    const fullText = $("body").text();
    const hasAuthorMention = /\b(author|written by|by [A-Z][a-z]+)\b/i.test(fullText);

    const timeEl = $("time[datetime]").first();
    const datePublished =
      timeEl.attr("datetime") ??
      fullText.match(
        /(?:published|updated|last modified)[:\s]+([A-Z][a-z]+ \d{1,2},?\s*\d{4}|\d{4}-\d{2}-\d{2})/i,
      )?.[1] ??
      null;
    const hasDatePublished = !!datePublished;

    let externalLinkCount = 0;
    let internalLinkCount = 0;
    let hasAboutOrBioLink = false;

    let hostname = "";
    try { hostname = new URL(url).hostname; } catch { /* ignore */ }

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (href.startsWith("http") && !href.includes(hostname)) {
        externalLinkCount++;
      } else if (href.startsWith("/") || href.includes(hostname)) {
        internalLinkCount++;
        if (/\/(about|team|author|bio)/i.test(href)) hasAboutOrBioLink = true;
      }
    });

    const authoritativeDomains = /\.gov|\.edu|wikipedia\.org|pubmed\.ncbi/;
    const hasCitations =
      externalLinkCount >= 3 ||
      $("a[href]")
        .filter((_, el) =>
          authoritativeDomains.test($(el).attr("href") ?? ""),
        )
        .length > 0;

    // ── SCHEMA ─────────────────────────────────────────────────────────────
    const schemaTypes = extractSchemaTypes(html);
    const schemaLower = schemaTypes.map((t) => t.toLowerCase());
    const hasFAQSchema = schemaLower.some((t) => t.includes("faq"));
    const hasHowToSchema = schemaLower.some((t) => t.includes("howto"));
    const hasArticleSchema = schemaLower.some(
      (t) => t === "article" || t === "newsarticle" || t === "blogposting",
    );
    const hasReviewSchema = schemaLower.some(
      (t) => t === "review" || t === "aggregaterating",
    );
    const hasProductSchema = schemaLower.some((t) => t === "product");
    const schemaBreadth = schemaTypes.length;

    // ── TECHNICAL ──────────────────────────────────────────────────────────
    // Re-load without removing elements for meta tags
    const $full = cheerio.load(html);
    const canonicalEl = $full("link[rel='canonical']");
    const hasCanonical = canonicalEl.length > 0;
    const canonicalUrl = canonicalEl.attr("href") ?? null;

    const robotsMeta = $full("meta[name='robots']");
    const hasMetaRobots = robotsMeta.length > 0;
    const robotsContent = robotsMeta.attr("content") ?? null;

    const hasOpenGraph = $full("meta[property^='og:']").length > 0;
    const hasTwitterCard = $full("meta[name^='twitter:']").length > 0;

    return {
      url,
      title,
      metaDescription,
      h1,
      h2s,
      h3s,
      wordCount,
      paragraphCount,
      hasIntroductionParagraph,
      hasFAQSection,
      hasHowToSection,
      hasTableOfContents,
      hasComparisonTable,
      hasImages,
      imageCount,
      videoEmbedPresent,
      hasCallToAction,
      hasAuthorMention,
      hasDatePublished,
      datePublished,
      hasCitations,
      externalLinkCount,
      internalLinkCount,
      hasAboutOrBioLink,
      schemaTypes,
      hasFAQSchema,
      hasHowToSchema,
      hasArticleSchema,
      hasReviewSchema,
      hasProductSchema,
      schemaBreadth,
      hasCanonical,
      canonicalUrl,
      hasMetaRobots,
      robotsContent,
      hasOpenGraph,
      hasTwitterCard,
      pageSizeKb,
      lastModifiedHeader,
      avgWordsPerParagraph,
      longestParagraphWords,
    };
  } catch {
    return null;
  }
}
