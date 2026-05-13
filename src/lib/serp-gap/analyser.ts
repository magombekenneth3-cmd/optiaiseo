/**
 * src/lib/serp-gap/analyser.ts
 *
 * SERP Gap Analyser
 *
 * Given a keyword where the client is ranking on page 2+ (position 11+),
 * this module:
 *   1. Fetches the live SERP for that keyword (via Serper API)
 *   2. Scrapes the top-5 ranking pages for content signals
 *   3. Scrapes the CLIENT'S ranking page for the same signals
 *   4. Computes content gaps across every dimension
 *   5. Returns a structured GapReport ready for plan generation
 */

import * as cheerio from "cheerio";
import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PageSignals {
    url: string;
    position: number;
    title: string | null;
    metaDescription: string | null;
    h1: string | null;
    h2s: string[];
    wordCount: number;
    paragraphCount: number;
    hasFaqSection: boolean;
    hasHowToSection: boolean;
    hasComparisonTable: boolean;
    hasTableOfContents: boolean;
    hasVideo: boolean;
    imageCount: number;
    internalLinkCount: number;
    externalLinkCount: number;
    schemaTypes: string[];
    hasFaqSchema: boolean;
    hasArticleSchema: boolean;
    hasAuthorMention: boolean;
    hasDatePublished: boolean;
    hasCitations: boolean;
    hasDefinitionParagraph: boolean;
    hasOriginalStats: boolean;
    readingDepth: "shallow" | "medium" | "deep";
    contentFormat: "guide" | "listicle" | "tool" | "product" | "comparison" | "news" | "other";
    fetchedOk: boolean;
    fetchError?: string;
}

export interface ContentGap {
    dimension: string;
    clientValue: string | number | boolean;
    topCompetitorAvg: string | number;
    gap: "critical" | "high" | "medium" | "low";
    impact: string;
    recommendation: string;
}

export interface GapReport {
    keyword: string;
    clientUrl: string;
    clientPosition: number;
    serpFormat: "guide" | "listicle" | "tool" | "product" | "comparison" | "news" | "mixed";
    serpHasAiOverview: boolean;
    serpHasFeaturedSnippet: boolean;
    serpHasPaa: boolean;
    topResults: PageSignals[];
    clientSignals: PageSignals;
    gaps: ContentGap[];
    topCompetitorAvgWordCount: number;
    rankingTimelineNote: string | null;
    competitorTopicMap: {
        topic: string;
        competitorUrls: string[];
        mentionCount: number;
    }[];
    analysedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractSchemaTypes(html: string): string[] {
    const types: string[] = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        try {
            const obj = JSON.parse(m[1]);
            const walk = (o: unknown): void => {
                if (!o || typeof o !== "object") return;
                const r = o as Record<string, unknown>;
                if (Array.isArray(r["@graph"])) (r["@graph"] as unknown[]).forEach(walk);
                if (typeof r["@type"] === "string") types.push(r["@type"]);
                if (Array.isArray(r["@type"])) (r["@type"] as string[]).forEach((t) => types.push(t));
            };
            walk(obj);
        } catch {
            // malformed JSON-LD — skip
        }
    }
    return [...new Set(types)];
}

function detectFormat(
    title: string | null,
    h2s: string[],
    wordCount: number,
    schemaTypes: string[]
): PageSignals["contentFormat"] {
    const text = `${title ?? ""} ${h2s.join(" ")}`.toLowerCase();
    if (schemaTypes.some((t) => ["Product", "Offer"].includes(t))) return "product";
    if (/calculator|tool|checker|generator/.test(text)) return "tool";
    if (/vs\b|versus|compare|comparison|best.*for/.test(text)) return "comparison";
    if (/\d+ (ways|tips|steps|tricks|tools|reasons|examples)/.test(text)) return "listicle";
    if (/how to|guide|tutorial|walkthrough/.test(text)) return "guide";
    if (schemaTypes.includes("NewsArticle")) return "news";
    if (wordCount < 500) return "other";
    return "guide";
}

async function scrapePage(url: string, position: number): Promise<PageSignals> {
    const base: PageSignals = {
        url,
        position,
        title: null,
        metaDescription: null,
        h1: null,
        h2s: [],
        wordCount: 0,
        paragraphCount: 0,
        hasFaqSection: false,
        hasHowToSection: false,
        hasComparisonTable: false,
        hasTableOfContents: false,
        hasVideo: false,
        imageCount: 0,
        internalLinkCount: 0,
        externalLinkCount: 0,
        schemaTypes: [],
        hasFaqSchema: false,
        hasArticleSchema: false,
        hasAuthorMention: false,
        hasDatePublished: false,
        hasCitations: false,
        hasDefinitionParagraph: false,
        hasOriginalStats: false,
        readingDepth: "shallow",
        contentFormat: "other",
        fetchedOk: false,
    };

    try {
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-GapBot/1.0; +https://optiaiseo.online)" },
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) {
            base.fetchError = `HTTP ${res.status}`;
            return base;
        }
        const html = await res.text();
        const $ = cheerio.load(html);

        // Remove noise
        $("script, style, noscript, nav, footer, header, aside").remove();
        const bodyText = $("body").text().replace(/\s+/g, " ").trim();
        const words = bodyText.split(/\s+/).filter(Boolean);

        const origin = new URL(url).origin;

        base.fetchedOk = true;
        base.title = $("title").first().text().trim() || null;
        base.metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
        base.h1 = $("h1").first().text().trim() || null;
        base.h2s = $("h2").map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 15);
        base.wordCount = words.length;
        base.paragraphCount = $("p").length;
        base.imageCount = $("img").length;
        base.schemaTypes = extractSchemaTypes(html);
        base.hasFaqSchema = base.schemaTypes.includes("FAQPage");
        base.hasArticleSchema = base.schemaTypes.some((t) => ["Article", "BlogPosting", "NewsArticle"].includes(t));

        // Content structure
        const allH2Text = base.h2s.join(" ").toLowerCase();
        base.hasFaqSection = /faq|frequently asked|common question/.test(allH2Text) ||
            $('[class*="faq"], [id*="faq"]').length > 0;
        base.hasHowToSection = /how to|step.by.step|steps/.test(allH2Text);
        base.hasComparisonTable = $("table").length > 0 && /vs|versus|compare/.test(bodyText.toLowerCase().slice(0, 3000));
        base.hasTableOfContents = $('[class*="toc"], [id*="toc"], [class*="table-of-contents"]').length > 0 ||
            /table of contents/i.test($("nav").text());
        base.hasVideo = $("iframe[src*='youtube'], iframe[src*='vimeo'], video").length > 0;

        // Links
        $("a[href]").each((_, el) => {
            const href = $(el).attr("href") ?? "";
            if (href.startsWith("/") || href.startsWith(origin)) base.internalLinkCount++;
            else if (href.startsWith("http")) base.externalLinkCount++;
        });

        // E-E-A-T signals
        base.hasAuthorMention = /by\s+[A-Z][a-z]+ [A-Z][a-z]+|written by|author:/i.test(bodyText);
        base.hasDatePublished = !!$('meta[property="article:published_time"], time[datetime]').length ||
            /published|updated|last modified/i.test(bodyText.slice(0, 500));
        base.hasCitations = base.externalLinkCount >= 3;

        // Content quality
        const firstPara = $("p").first().text().trim();
        base.hasDefinitionParagraph = firstPara.length > 80 &&
            /is a |refers to |defined as |means that |is the process of /i.test(firstPara);
        base.hasOriginalStats = /according to|survey|study|research|found that|data shows|\d+%|\d+x /.test(bodyText);

        // Reading depth
        if (base.wordCount > 2500) base.readingDepth = "deep";
        else if (base.wordCount > 1000) base.readingDepth = "medium";
        else base.readingDepth = "shallow";

        base.contentFormat = detectFormat(base.title, base.h2s, base.wordCount, base.schemaTypes);

        return base;
    } catch (err) {
        base.fetchError = err instanceof Error ? err.message : "Unknown error";
        return base;
    }
}

// ─── Gap computation ──────────────────────────────────────────────────────────

function buildCompetitorTopicMap(
    client: PageSignals,
    competitors: PageSignals[]
): GapReport["competitorTopicMap"] {
    const clientH2Set = new Set(
        client.h2s.map((h) => h.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim())
    );
    const topicMap = new Map<string, Set<string>>();

    for (const comp of competitors) {
        for (const h2 of comp.h2s) {
            const normalised = h2.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
            if (normalised.length < 5) continue;
            const alreadyCovered = [...clientH2Set].some(
                (ch) => ch.includes(normalised) || normalised.includes(ch)
            );
            if (alreadyCovered) continue;
            if (!topicMap.has(h2)) topicMap.set(h2, new Set());
            topicMap.get(h2)!.add(comp.url);
        }
    }

    return [...topicMap.entries()]
        .map(([topic, urls]) => ({ topic, competitorUrls: [...urls], mentionCount: urls.size }))
        .sort((a, b) => b.mentionCount - a.mentionCount);
}

function computeGaps(client: PageSignals, competitors: PageSignals[]): ContentGap[] {
    const ok = competitors.filter((c) => c.fetchedOk);
    if (ok.length === 0) return [];

    const avg = (fn: (p: PageSignals) => number) =>
        Math.round(ok.reduce((s, c) => s + fn(c), 0) / ok.length);

    const pct = (fn: (p: PageSignals) => boolean) =>
        Math.round((ok.filter(fn).length / ok.length) * 100);

    const gaps: ContentGap[] = [];

    // Word count gap
    const avgWC = avg((p) => p.wordCount);
    const wcDiff = avgWC - client.wordCount;
    if (wcDiff > 300) {
        gaps.push({
            dimension: "Content depth (word count)",
            clientValue: client.wordCount,
            topCompetitorAvg: avgWC,
            gap: wcDiff > 1500 ? "critical" : wcDiff > 800 ? "high" : "medium",
            impact: `Your page has ${client.wordCount} words vs. competitor average of ${avgWC}. Thin content triggers NavBoost bad-click penalties.`,
            recommendation: `Expand to at least ${avgWC + 200} words. Add a comprehensive intro, deepen each section, and cover subtopics competitors address that you don't.`,
        });
    }

    // FAQ section
    const faqPct = pct((p) => p.hasFaqSection);
    if (faqPct >= 60 && !client.hasFaqSection) {
        gaps.push({
            dimension: "FAQ section",
            clientValue: false,
            topCompetitorAvg: `${faqPct}% of top results have one`,
            gap: "high",
            impact: "FAQ sections directly feed Google AI Overviews and People Also Ask boxes. Missing one costs you featured real estate.",
            recommendation: "Add a structured FAQ section with 5–8 questions targeting the keyword's long-tail variations. Add FAQPage JSON-LD schema.",
        });
    }

    // FAQ schema
    const faqSchemaPct = pct((p) => p.hasFaqSchema);
    if (faqSchemaPct >= 50 && !client.hasFaqSchema) {
        gaps.push({
            dimension: "FAQPage schema markup",
            clientValue: false,
            topCompetitorAvg: `${faqSchemaPct}% of top results have it`,
            gap: "high",
            impact: "FAQPage schema enables rich results and dramatically increases AI citation probability.",
            recommendation: "Add FAQPage JSON-LD schema wrapping your FAQ section. Aria can generate and inject this automatically.",
        });
    }

    // Table of contents
    const tocPct = pct((p) => p.hasTableOfContents);
    if (tocPct >= 60 && !client.hasTableOfContents) {
        gaps.push({
            dimension: "Table of contents",
            clientValue: false,
            topCompetitorAvg: `${tocPct}% of top results have one`,
            gap: "medium",
            impact: "Tables of contents improve dwell time and generate sitelinks in SERPs. They also signal a comprehensive, well-structured guide.",
            recommendation: "Add a linked table of contents at the top of the page with anchor links to each H2 section.",
        });
    }

    // Heading structure — enriched with per-topic competitor map
    const avgH2s = avg((p) => p.h2s.length);
    if (avgH2s - client.h2s.length >= 4) {
        const missingTopics = buildCompetitorTopicMap(client, ok).slice(0, 8);
        const topicList = missingTopics
            .map((t) => `• "${t.topic}" — covered by ${t.mentionCount} of ${ok.length} competitors`)
            .join("\n");
        gaps.push({
            dimension: "Heading structure (H2s)",
            clientValue: client.h2s.length,
            topCompetitorAvg: avgH2s,
            gap: "high",
            impact: `Competitors average ${avgH2s} H2 headings vs. your ${client.h2s.length}. Missing topics that competitors cover:\n${topicList}`,
            recommendation: `Add these missing H2 sections to match competitor coverage:\n${topicList}\n\nFor each section: write 200–400 words directly answering the implied question, include 1–2 real examples, and link to an authoritative external source.`,
        });
    }

    const authorPct = pct((p) => p.hasAuthorMention);
    if (authorPct >= 60 && !client.hasAuthorMention) {
        gaps.push({
            dimension: "Author attribution (E-E-A-T)",
            clientValue: false,
            topCompetitorAvg: `${authorPct}% of top results show author`,
            gap: "medium",
            impact: "Google's quality raters are explicitly instructed to check for author identity. Anonymous content is penalised on YMYL queries.",
            recommendation: "1. Add a byline: \"By [Name], [Title]\" immediately below the H1.\n2. Create an /author/[name] page with a 150-word bio, credentials, and a headshot.\n3. Add Person schema linking the author to this article via Article JSON-LD.\n4. Link to 1–2 external profiles (LinkedIn, Twitter, industry publication bylines) to build author entity recognition.",
        });
    }

    // Citations / external links
    const citationPct = pct((p) => p.hasCitations);
    if (citationPct >= 60 && !client.hasCitations) {
        gaps.push({
            dimension: "External citations",
            clientValue: client.externalLinkCount,
            topCompetitorAvg: avg((p) => p.externalLinkCount),
            gap: "medium",
            impact: "Linking out to authoritative sources validates your claims and signals trustworthiness. It also increases your chances of being cited in AI Overviews.",
            recommendation: "Add 3–5 outbound links to authoritative sources (studies, official docs, recognised industry sites) that back up your key claims.",
        });
    }

    // Video content
    const videoPct = pct((p) => p.hasVideo);
    if (videoPct >= 60 && !client.hasVideo) {
        gaps.push({
            dimension: "Embedded video",
            clientValue: false,
            topCompetitorAvg: `${videoPct}% of top results embed video`,
            gap: "medium",
            impact: "Video embeds increase dwell time — a core NavBoost signal. Pages with video rank higher for most informational queries.",
            recommendation: "Embed a relevant YouTube video (your own or a reputable source). Even a 2-minute explainer measurably improves engagement.",
        });
    }

    // Original stats / data
    const statsPct = pct((p) => p.hasOriginalStats);
    if (statsPct >= 60 && !client.hasOriginalStats) {
        gaps.push({
            dimension: "Original data / statistics",
            clientValue: false,
            topCompetitorAvg: `${statsPct}% of top results include stats`,
            gap: "medium",
            impact: "Data-backed content earns more backlinks and unlinked brand mentions — both key trust signals for AI Overviews.",
            recommendation: "Add at least 3–5 cited statistics or data points from authoritative sources. Link directly to the source of each stat.",
        });
    }

    // Images
    const avgImgs = avg((p) => p.imageCount);
    if (avgImgs - client.imageCount >= 4) {
        gaps.push({
            dimension: "Visual content (images)",
            clientValue: client.imageCount,
            topCompetitorAvg: avgImgs,
            gap: "low",
            impact: "Richer visual content reduces bounce rate and signals content quality.",
            recommendation: `Add ${avgImgs - client.imageCount} more images: screenshots, infographics, or diagrams that illustrate your key points.`,
        });
    }

    // Date freshness
    const datePct = pct((p) => p.hasDatePublished);
    if (datePct >= 80 && !client.hasDatePublished) {
        gaps.push({
            dimension: "Published/updated date",
            clientValue: false,
            topCompetitorAvg: `${datePct}% of top results show a date`,
            gap: "low",
            impact: "Visible publish/update dates build trust and help Google understand content freshness.",
            recommendation: "Add a visible last-updated date to the page and include it in your Article schema's dateModified field.",
        });
    }

    // Sort by gap severity
    const severity: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return gaps.sort((a, b) => severity[a.gap] - severity[b.gap]);
}

// ─── SERP format detection ────────────────────────────────────────────────────

function detectSerpFormat(signals: PageSignals[]): GapReport["serpFormat"] {
    const formats = signals.map((s) => s.contentFormat);
    const counts = formats.reduce(
        (acc, f) => ({ ...acc, [f]: (acc[f] ?? 0) + 1 }),
        {} as Record<string, number>
    );
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] < 3) return "mixed";
    return top[0] as GapReport["serpFormat"];
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface SerperOrganicResult {
    link?: string;
    title?: string;
    snippet?: string;
    position?: number;
}

interface SerperResponse {
    organic?: SerperOrganicResult[];
    answerBox?: object;
    aiOverview?: object;
    peopleAlsoAsk?: object[];
}

export async function analyseSerpGap(
    keyword: string,
    clientUrl: string,
    clientPosition: number
): Promise<GapReport | null> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
        logger.warn("[SerpGap] SERPER_API_KEY not set — analysis skipped");
        return null;
    }

    logger.info("[SerpGap] Starting analysis", { keyword, clientUrl, clientPosition });

    // Step 1: Fetch SERP
    let serpData: SerperResponse | null = null;
    try {
        const res = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
            body: JSON.stringify({ q: keyword, gl: "us", hl: "en", num: 10 }),
            signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) serpData = (await res.json()) as SerperResponse;
    } catch (err) {
        logger.error("[SerpGap] SERP fetch failed", { keyword, err });
        return null;
    }

    if (!serpData?.organic?.length) {
        logger.warn("[SerpGap] No organic results returned", { keyword });
        return null;
    }

    // Step 2: Get top-5 competitor URLs (exclude client domain)
    const clientDomain = new URL(clientUrl).hostname;
    const topUrls = (serpData.organic ?? [])
        .filter((r): r is SerperOrganicResult & { link: string } =>
            !!r.link && !r.link.includes(clientDomain)
        )
        .slice(0, 5)
        .map((r, i) => ({ url: r.link, position: i + 1 }));

    if (topUrls.length === 0) {
        logger.warn("[SerpGap] No competitor URLs to analyse", { keyword });
        return null;
    }

    // Step 3: Scrape top 5 + client page in parallel
    const [clientSignals, ...competitorSignals] = await Promise.all([
        scrapePage(clientUrl, clientPosition),
        ...topUrls.map((t) => scrapePage(t.url, t.position)),
    ]);

    // Step 4: Compute gaps
    const gaps = computeGaps(clientSignals, competitorSignals);
    const avgWC = competitorSignals.filter((c) => c.fetchedOk).length > 0
        ? Math.round(
            competitorSignals.filter((c) => c.fetchedOk).reduce((s, c) => s + c.wordCount, 0) /
            competitorSignals.filter((c) => c.fetchedOk).length
        )
        : 0;

    const competitorTopicMap = buildCompetitorTopicMap(
        clientSignals,
        competitorSignals.filter((c) => c.fetchedOk)
    );

    const okComps = competitorSignals.filter((c) => c.fetchedOk);
    let rankingTimelineNote: string | null = null;
    if (okComps.length > 0) {
        const avgExtLinks = Math.round(okComps.reduce((s, c) => s + c.externalLinkCount, 0) / okComps.length);
        const linkGap = avgExtLinks - clientSignals.externalLinkCount;
        if (linkGap > 20) {
            rankingTimelineNote = `The authority gap for this keyword is significant. Content improvements help quality signals, but closing a ${linkGap}+ external citation gap typically takes 3–6 months of consistent outreach. Set realistic expectations before starting.`;
        } else if (linkGap > 8) {
            rankingTimelineNote = `An external citation gap of ~${linkGap} exists. Expect 6–8 weeks of link-building alongside content work to see meaningful ranking movement.`;
        }
    }

    logger.info("[SerpGap] Analysis complete", {
        keyword,
        clientPosition,
        gapCount: gaps.length,
        competitorsScraped: competitorSignals.filter((c) => c.fetchedOk).length,
    });

    return {
        keyword,
        clientUrl,
        clientPosition,
        serpFormat: detectSerpFormat(competitorSignals),
        serpHasAiOverview: !!serpData.aiOverview,
        serpHasFeaturedSnippet: !!serpData.answerBox,
        serpHasPaa: (serpData.peopleAlsoAsk?.length ?? 0) > 0,
        topResults: competitorSignals,
        clientSignals,
        gaps,
        topCompetitorAvgWordCount: avgWC,
        rankingTimelineNote,
        competitorTopicMap,
        analysedAt: new Date().toISOString(),
    };
}