import { prisma } from "@/lib/prisma";
import {
    SerpCompetitiveBriefSchema,
    SiteContentLibrarySchema,
    type ContentAction,
    type PageExistenceResult,
    type SerpCompetitiveBrief,
    type SerpCompetitiveObservation,
    type SerpFormatType,
    type SerpPageType,
    type SiteContentLibrary,
    type SiteContentLibraryEntry,
} from "./contracts";
import { classifySerpFormat, type SerpContext, type SerpResult } from "./serp";

const LIBRARY_SCAN_LIMIT = 100;
const LIBRARY_RESULTS_LIMIT = 10;
const LIBRARY_EXCERPT_CHARS = 900;
const BRIEF_MAX_RESULTS = 10;
const STOP_WORDS = new Set([
    "about", "after", "also", "and", "are", "best", "can", "for", "from", "how",
    "into", "its", "more", "near", "not", "our", "that", "the", "their", "this",
    "through", "tool", "tools", "using", "what", "when", "where", "which", "with",
    "you", "your",
]);

function safeUrl(raw?: string | null): string | undefined {
    if (!raw) return undefined;
    try {
        const url = new URL(raw);
        if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
        url.hash = "";
        return url.toString();
    } catch {
        return undefined;
    }
}

function normalizedText(value: string): string {
    return value.toLowerCase().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokens(value: string): string[] {
    return [...new Set(normalizedText(value).split(" ").filter(word => word.length > 2 && !STOP_WORDS.has(word)))];
}

function overlapRatio(query: string, candidate: string): number {
    const queryTokens = tokens(query);
    if (queryTokens.length === 0) return 0;
    const candidateTokens = new Set(tokens(candidate));
    return queryTokens.filter(token => candidateTokens.has(token)).length / queryTokens.length;
}

function readableExcerpt(value: string, max = LIBRARY_EXCERPT_CHARS): string {
    return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function headingsFromBlog(content: string): string[] {
    const htmlHeadings = [...content.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)]
        .map(match => readableExcerpt(match[1], 200))
        .filter(Boolean);
    const markdownHeadings = [...content.matchAll(/^#{2,3}\s+(.+)$/gm)]
        .map(match => match[1].trim().slice(0, 200));
    return [...new Set([...htmlHeadings, ...markdownHeadings])].slice(0, 12);
}

function normalizeLibraryStatus(status: string): SiteContentLibraryEntry["status"] {
    const known: SiteContentLibraryEntry["status"][] = [
        "PUBLISHED", "DRAFT", "NEEDS_REVIEW", "EVIDENCE_REVIEW", "REVIEW",
        "REJECTED", "FAILED", "GENERATING",
    ];
    return known.includes(status as SiteContentLibraryEntry["status"])
        ? status as SiteContentLibraryEntry["status"]
        : "REVIEW";
}

export async function loadRelevantSiteContentLibrary(params: {
    siteId: string;
    keyword: string;
    domain?: string | null;
}): Promise<SiteContentLibrary> {
    const capturedAt = new Date().toISOString();
    try {
        const rows = await prisma.blog.findMany({
            where: {
                siteId: params.siteId,
                deletedAt: null,
                status: {
                    in: ["PUBLISHED", "DRAFT", "NEEDS_REVIEW", "EVIDENCE_REVIEW", "REVIEW", "REJECTED", "FAILED", "GENERATING"],
                },
            },
            orderBy: [{ updatedAt: "desc" }],
            take: LIBRARY_SCAN_LIMIT,
            select: {
                id: true,
                title: true,
                slug: true,
                content: true,
                status: true,
                targetKeywords: true,
                metaDescription: true,
                publishedAt: true,
                updatedAt: true,
            },
        });

        const candidates = rows.map(row => {
            const heading = headingsFromBlog(row.content ?? "");
            const matchedTerms = [...new Set([
                ...tokens(params.keyword).filter(token =>
                    tokens(`${row.title} ${(row.targetKeywords ?? []).join(" ")} ${heading.join(" ")}`).includes(token)
                ),
            ])].slice(0, 20);
            const topicMatch = overlapRatio(
                params.keyword,
                `${row.title} ${(row.targetKeywords ?? []).join(" ")} ${heading.join(" ")}`,
            );
            const titleMatch = overlapRatio(params.keyword, row.title);
            const exactKeyword = (row.targetKeywords ?? []).some(
                candidate => normalizedText(candidate) === normalizedText(params.keyword),
            );
            const relevance = Math.max(0, Math.min(1,
                (topicMatch * 0.55) + (titleMatch * 0.2) + (exactKeyword ? 0.4 : 0),
            ));
            const url = params.domain
                ? safeUrl(`https://${params.domain.replace(/^https?:\/\//i, "").replace(/\/$/, "")}/blog/${row.slug}`)
                : undefined;

            return {
                id: row.id,
                title: row.title,
                slug: row.slug,
                ...(url ? { url } : {}),
                status: normalizeLibraryStatus(row.status),
                targetKeywords: (row.targetKeywords ?? []).slice(0, 20),
                ...(row.metaDescription ? { metaDescription: row.metaDescription.slice(0, 200) } : {}),
                publishedAt: row.publishedAt?.toISOString() ?? null,
                updatedAt: row.updatedAt.toISOString(),
                headings: heading,
                excerpt: readableExcerpt(row.content ?? ""),
                relevance,
                matchedTerms,
                exactKeyword,
            };
        });

        const related = candidates
            .filter(candidate => candidate.relevance >= 0.12 || candidate.exactKeyword)
            .sort((a, b) => b.relevance - a.relevance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, LIBRARY_RESULTS_LIMIT)
            .map(({ exactKeyword: _exactKeyword, ...entry }) => SiteContentLibrarySchema.shape.relatedPages.element.parse(entry));

        return SiteContentLibrarySchema.parse({
            retrievalStatus: rows.length === 0 ? "EMPTY" : "AVAILABLE",
            capturedAt,
            consideredCount: rows.length,
            relatedPages: related,
            warnings: rows.length >= LIBRARY_SCAN_LIMIT
                ? [`Library scan was capped at ${LIBRARY_SCAN_LIMIT} records; older content may not be represented.`]
                : [],
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return SiteContentLibrarySchema.parse({
            retrievalStatus: "UNAVAILABLE",
            capturedAt,
            consideredCount: 0,
            relatedPages: [],
            warnings: [`Site content library retrieval failed: ${message.slice(0, 300)}`],
        });
    }
}

function pageTypeForResult(result: SerpResult): SerpPageType {
    const url = (result.link ?? "").toLowerCase();
    const title = result.title.toLowerCase();
    const snippet = result.snippet.toLowerCase();
    if (/youtube\.com|youtu\.be|vimeo\.com/.test(url)) return "video";
    if (/reddit\.com|quora\.com|stackoverflow\.com/.test(url)) return "forum";
    if (/news|press release|announces|breaking/.test(`${title} ${snippet}`) && /news|press/.test(url)) return "news";
    if (/\/pricing|\/product|\/features|\/platform/.test(url)) return "product_page";
    if (/calculator|generator|checker|audit|tool/.test(`${title} ${url}`)) return "interactive_tool";
    if (/\b(vs\.?|versus|alternative|comparison|compare)\b/.test(`${title} ${snippet}`)) return "comparison";
    if (/\b(top \d+|best \d+|\d+ best|\blist\b|alternatives)\b/.test(title)) return "listicle";
    if (/\b(how to|step by step|tutorial|guide)\b/.test(`${title} ${snippet}`)) return "tutorial";
    return "article";
}

function formatForPageType(pageType: SerpPageType): SerpFormatType {
    switch (pageType) {
        case "interactive_tool": return "tool";
        case "comparison": return "comparison";
        case "listicle": return "listicle";
        case "tutorial": return "guide";
        case "product_page": return "product";
        case "video": return "video";
        default: return "general";
    }
}

function normalizeIntent(value: string): "informational" | "commercial" | "transactional" | "navigational" | "local" | "mixed" | "unknown" {
    const normalized = value.toLowerCase();
    if (normalized.includes("transaction")) return "transactional";
    if (normalized.includes("commercial") || normalized.includes("comparison")) return "commercial";
    if (normalized.includes("navigat")) return "navigational";
    if (normalized.includes("local")) return "local";
    if (normalized.includes("inform")) return "informational";
    return "unknown";
}

function inferIntent(keyword: string, context: SerpContext | null, priorIntent?: string) {
    const lower = normalizedText(keyword);
    const signals: string[] = [];
    let label: "informational" | "commercial" | "transactional" | "navigational" | "local" | "mixed" | "unknown" = "unknown";
    let confidence = 0.35;

    if (/\b(near me|nearby|in [a-z]+|local|in my area)\b/.test(lower)) {
        label = "local"; confidence = 0.78; signals.push("The query contains local-intent language.");
    } else if (/\b(buy|purchase|order|sign up|subscribe|book|hire|download)\b/.test(lower)) {
        label = "transactional"; confidence = 0.8; signals.push("The query contains an action-oriented modifier.");
    } else if (/\b(vs|versus|compare|comparison|alternative|alternatives|best|top|review|pricing|price|cost)\b/.test(lower)) {
        label = "commercial"; confidence = 0.76; signals.push("The query contains a comparison or evaluation modifier.");
    } else if (/\b(what is|how to|how do|why|when|where|guide|tutorial|examples|meaning|definition)\b/.test(lower)) {
        label = "informational"; confidence = 0.76; signals.push("The query contains an information-seeking modifier.");
    } else if (context?.results.some(result => /\b(login|official site|website)\b/i.test(result.title))) {
        label = "navigational"; confidence = 0.55; signals.push("Ranking result titles suggest a navigational task.");
    } else {
        const prior = normalizeIntent(priorIntent ?? "");
        const formats = context?.results.map(result => classifySerpFormat([result]).format) ?? [];
        const dominant = formats.length ? formats.filter(format => format === formats[0]).length / formats.length : 0;
        if (prior !== "unknown") {
            label = prior;
            confidence = Math.min(0.55, 0.3 + dominant * 0.25);
            signals.push("Used the pipeline intent as a low-confidence prior because the query itself was ambiguous.");
        } else if ((context?.results.length ?? 0) > 0) {
            label = "mixed";
            confidence = 0.42;
            signals.push("The query lacks explicit intent language; intent remains uncertain from available SERP signals.");
        } else {
            signals.push("No current organic SERP results were available to interpret intent.");
        }
    }

    const topResults = context?.results.slice(0, 5) ?? [];
    if (topResults.length > 0) signals.push(`${topResults.length} current organic result titles/snippets were available for interpretation.`);

    return {
        label,
        confidence: Math.max(0.1, Math.min(0.95, confidence)),
        rationale: signals.join(" ") || "Intent classification is uncertain.",
        signals,
    };
}

function sourceUrlsRelevantTo(query: string, pages: Array<{ url: string; title: string; snippet: string; headings: string[] }>, limit = 5): string[] {
    return pages
        .map(page => ({
            url: page.url,
            relevance: overlapRatio(query, `${page.title} ${page.snippet} ${page.headings.join(" ")}`),
        }))
        .filter(result => result.relevance >= 0.15)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, limit)
        .map(result => result.url);
}

function siteActionFor(
    library: SiteContentLibrary,
    existingSite: PageExistenceResult | null,
    dominantFormat: SerpFormatType,
    dominantShare: number,
): { recommendedAction: ContentAction; rationale: string; matchingPageUrl?: string; matchingPageTitle?: string; relatedPageUrls: string[]; humanReviewRequired: boolean } {
    const existingUrl = existingSite?.existingPage?.url ? safeUrl(existingSite.existingPage.url) : undefined;
    const related = library.relatedPages.slice(0, 5);
    const relatedUrls = related.map(page => page.url).filter((url): url is string => !!url);
    const resolverAction = existingSite?.recommendedAction?.toUpperCase() ?? "";

    if (dominantFormat === "tool" && dominantShare >= 0.4) {
        return {
            recommendedAction: "REQUEST_REVIEW",
            rationale: "The current SERP has a substantial interactive-tool format share. A conventional article may not satisfy the main user task; review whether a tool or hybrid page is needed.",
            ...(existingUrl ? { matchingPageUrl: existingUrl, matchingPageTitle: related.find(page => page.url === existingUrl)?.title } : {}),
            relatedPageUrls,
            humanReviewRequired: true,
        };
    }

    if (existingSite?.verdict === "NEEDS_REVIEW" || existingSite?.verdict === "EXISTING_HEALTHY") {
        return {
            recommendedAction: "REQUEST_REVIEW",
            rationale: existingSite.verdict === "EXISTING_HEALTHY"
                ? "The resolver identified a healthy existing page. Review it before creating a competing URL; a high score alone is not a reason to create a duplicate."
                : "Existing-page resolution is inconclusive. Review the candidate pages before choosing between refresh and new content.",
            ...(existingUrl ? { matchingPageUrl: existingUrl } : {}),
            relatedPageUrls,
            humanReviewRequired: true,
        };
    }

    if (existingSite?.verdict === "EXISTING_NEEDS_FIX" || existingSite?.verdict === "EXISTING_CANNIBALIZED" ||
        /^(UPDATE|REFRESH|FIX|MERGE|CONSOLIDATE)/.test(resolverAction)) {
        return {
            recommendedAction: "UPDATE_EXISTING",
            rationale: existingSite.verdict === "EXISTING_CANNIBALIZED"
                ? "Existing-page evidence indicates cannibalization; resolve the competing pages before creating another URL."
                : "An existing page matches the topic and needs improvement. Plan a refresh rather than creating a duplicate URL.",
            ...(existingUrl ? { matchingPageUrl: existingUrl } : {}),
            ...(related.find(page => page.url === existingUrl)?.title ? { matchingPageTitle: related.find(page => page.url === existingUrl)?.title } : {}),
            relatedPageUrls,
            humanReviewRequired: false,
        };
    }

    if (existingSite?.verdict === "MISSING" && related.length > 0) {
        return {
            recommendedAction: "SUPPORTING_ARTICLE",
            rationale: "No page was matched to the exact query, but related content exists. Create a distinct supporting article and link it contextually to relevant library pages.",
            relatedPageUrls,
            humanReviewRequired: false,
        };
    }

    if (existingSite?.verdict === "MISSING" && library.retrievalStatus === "AVAILABLE" && related.length === 0) {
        return {
            recommendedAction: "CREATE_PILLAR",
            rationale: "The resolver found no matching page and the scanned published/draft library contains no strongly related page. A new pillar may be appropriate after the SERP and evidence requirements are satisfied.",
            relatedPageUrls,
            humanReviewRequired: false,
        };
    }

    return {
        recommendedAction: "REQUEST_REVIEW",
        rationale: "The existing-page resolver or site library did not provide enough evidence to safely choose between refresh, supporting content, and a new pillar.",
        ...(existingUrl ? { matchingPageUrl: existingUrl } : {}),
        relatedPageUrls,
        humanReviewRequired: true,
    };
}

export function buildSerpCompetitiveBrief(params: {
    keyword: string;
    serpContext: SerpContext | null;
    priorIntent?: string;
    siteContentLibrary?: SiteContentLibrary;
    existingSite?: PageExistenceResult | null;
}): SerpCompetitiveBrief {
    const { keyword, serpContext, priorIntent, existingSite } = params;
    const researchedAt = new Date().toISOString();
    const library = params.siteContentLibrary ?? SiteContentLibrarySchema.parse({
        retrievalStatus: "UNAVAILABLE",
        capturedAt: researchedAt,
        consideredCount: 0,
        relatedPages: [],
        warnings: ["Site content library was not retrieved."],
    });

    const dedupedResults = new Map<string, SerpResult>();
    for (const result of (serpContext?.results ?? []).slice(0, 50)) {
        const url = safeUrl(result.link);
        if (!url || !result.title.trim()) continue;
        const key = url.toLowerCase().replace(/\/$/, "");
        if (!dedupedResults.has(key)) dedupedResults.set(key, { ...result, link: url });
    }
    const organic = [...dedupedResults.values()].slice(0, BRIEF_MAX_RESULTS);
    const intent = inferIntent(keyword, serpContext, priorIntent);

    const pages = organic.map((result, index) => {
        const pageType = pageTypeForResult(result);
        const scrapeStatus = result.scrapeStatus
            ?? ((result.scrapedContent?.length ?? 0) > 200 ? "ANALYZED" : "SNIPPET_ONLY");
        return {
            rank: result.rank ?? index + 1,
            title: result.title.slice(0, 500),
            url: result.link,
            snippet: result.snippet.slice(0, 1_000),
            pageType,
            dominantFormat: formatForPageType(pageType),
            headings: [...new Set((result.scrapedHeadings ?? []).map(h => h.trim()).filter(Boolean))].slice(0, 12),
            ...(result.scrapedPublishedDate ? { publishedAt: result.scrapedPublishedDate.slice(0, 100) } : {}),
            schemaTypes: [...new Set(result.scrapedSchemaTypes ?? [])].slice(0, 12),
            ...(typeof result.wordCount === "number" ? { wordCount: result.wordCount } : {}),
            scrapeStatus,
            ...((result.scrapedContent?.length ?? 0) > 200 ? { contentExcerpt: result.scrapedContent!.slice(0, LIBRARY_EXCERPT_CHARS) } : {}),
        };
    });

    const analyzedPages = pages.filter(page => page.scrapeStatus === "ANALYZED");
    const analyzedPageUrls = analyzedPages.map(page => page.url);

    const formatCounts = new Map<SerpFormatType, number>();
    for (const page of pages) formatCounts.set(page.dominantFormat, (formatCounts.get(page.dominantFormat) ?? 0) + 1);
    const dominantFormats = [...formatCounts.entries()]
        .map(([format, count]) => ({ format, count, share: pages.length ? count / pages.length : 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 7);
    const mostCommonFormat = dominantFormats[0]?.format ?? "general";
    const dominantShare = dominantFormats[0]?.share ?? 0;

    const headingFrequency = new Map<string, { topic: string; urls: string[] }>();
    for (const page of analyzedPages) {
        for (const heading of page.headings) {
            const key = normalizedText(heading);
            if (!key || key.length < 4) continue;
            const entry = headingFrequency.get(key) ?? { topic: heading, urls: [] };
            if (!entry.urls.includes(page.url)) entry.urls.push(page.url);
            headingFrequency.set(key, entry);
        }
    }
    const requiredCoverage = [...headingFrequency.values()]
        .filter(entry => analyzedPages.length >= 3 && entry.urls.length / analyzedPages.length >= 0.4)
        .sort((a, b) => b.urls.length - a.urls.length)
        .slice(0, 15)
        .map(entry => ({
            topic: entry.topic.slice(0, 500),
            reason: `This heading/topic was observed on ${entry.urls.length} of ${analyzedPages.length} successfully analysed pages; treat it as a candidate coverage requirement, not a template.`,
            observedOn: entry.urls,
            supportCount: entry.urls.length,
            totalAnalyzed: analyzedPages.length,
            classification: "observed_pattern" as const,
            confidence: Math.min(0.9, 0.45 + entry.urls.length / analyzedPages.length * 0.45),
        }));

    const pagesForMatching = pages.map(page => ({
        url: page.url, title: page.title, snippet: page.snippet, headings: page.headings,
    }));
    const readerNeeds: Array<{
        question: string; source: "people_also_ask" | "related_search" | "query_decomposition";
        answerSnippetObserved?: string; relatedUrls: string[]; confidence: number;
    }> = [];
    const seenNeeds = new Set<string>();
    for (const item of (serpContext?.peopleAlsoAsk ?? []).slice(0, 12)) {
        const question = item.question.trim();
        const normalized = normalizedText(question);
        if (!question || seenNeeds.has(normalized)) continue;
        seenNeeds.add(normalized);
        readerNeeds.push({
            question: question.slice(0, 500),
            source: "people_also_ask",
            ...(item.answer ? { answerSnippetObserved: item.answer.slice(0, 800) } : {}),
            relatedUrls: sourceUrlsRelevantTo(question, pagesForMatching, 5),
            confidence: 0.9,
        });
    }
    for (const query of (serpContext?.relatedSearches ?? []).slice(0, 10)) {
        const normalized = normalizedText(query);
        if (!query.trim() || seenNeeds.has(normalized)) continue;
        seenNeeds.add(normalized);
        readerNeeds.push({
            question: query.trim().slice(0, 500),
            source: "related_search",
            relatedUrls: sourceUrlsRelevantTo(query, pagesForMatching, 5),
            confidence: 0.65,
        });
    }

    const decisionTerms = [
        "pricing", "price", "cost", "integrations", "integration", "accuracy", "features",
        "setup", "security", "support", "ease of use", "limitations", "workflow", "performance",
        "compatibility", "implementation", "maintenance", "scalability",
    ];
    const decisionCriteria = decisionTerms
        .map(criterion => ({
            criterion,
            pages: analyzedPages.filter(page => normalizedText(`${page.title} ${page.snippet} ${page.headings.join(" ")} ${page.contentExcerpt ?? ""}`).includes(criterion)),
        }))
        .filter(item => item.pages.length > 0)
        .slice(0, 12)
        .map(item => ({
            criterion: item.criterion,
            reason: `Observed in the title, snippet, headings, or sampled content of ${item.pages.length} analysed result(s); relevance to the reader's task should still be judged.`,
            sourceUrls: item.pages.slice(0, 10).map(page => page.url),
            classification: "observed" as const,
        }));

    const opportunities: Array<{
        id: string; description: string; type: "reader_need" | "coverage_requirement" | "inferred_coverage_gap" | "freshness_check" | "decision_criteria" | "research_task";
        verificationStatus: "observed" | "inferred" | "requires_research"; confidence: number;
        sourceUrls: string[]; supportingObservations: SerpCompetitiveObservation[]; additionalValue: string;
    }> = [];

    for (const need of readerNeeds.slice(0, 8)) {
        opportunities.push({
            id: `reader-${opportunities.length + 1}`,
            description: `Answer the surfaced reader query: “${need.question}”`,
            type: "reader_need",
            verificationStatus: "observed",
            confidence: need.confidence,
            sourceUrls: need.relatedUrls.slice(0, 10),
            supportingObservations: [{
                observation: need.source === "people_also_ask"
                    ? "This question was returned in the People Also Ask feature for the target query."
                    : "This related query was returned by the live SERP provider for the target query.",
                classification: "observed",
                confidence: need.confidence,
                sourceUrls: need.relatedUrls.slice(0, 10),
                evidence: [`Observed SERP query: ${need.question}`],
            }],
            additionalValue: "Give a direct, evidence-supported answer, explain caveats, and avoid implying the ranking pages failed to answer unless accessible page text supports that claim.",
        });
    }

    if (analyzedPages.length >= 3) {
        for (const need of readerNeeds) {
            const matchedContent = analyzedPages.some(page =>
                overlapRatio(need.question, `${page.title} ${page.snippet} ${page.headings.join(" ")} ${page.contentExcerpt ?? ""}`) >= 0.6
            );
            if (matchedContent) continue;
            const relevant = analyzedPageUrls.slice(0, 10);
            opportunities.push({
                id: `sampled-gap-${opportunities.length + 1}`,
                description: `Potential coverage gap in the sampled page excerpts for: “${need.question}”`,
                type: "inferred_coverage_gap",
                verificationStatus: "inferred",
                confidence: Math.min(0.55, analyzedPages.length / BRIEF_MAX_RESULTS * 0.55),
                sourceUrls: relevant,
                supportingObservations: [{
                    observation: "The surfaced reader query did not share enough terms with the sampled titles, snippets, headings, or excerpts. This does not prove the full competitor pages omit the answer.",
                    classification: "inference",
                    confidence: Math.min(0.55, analyzedPages.length / BRIEF_MAX_RESULTS * 0.55),
                    sourceUrls: relevant,
                    evidence: [`${analyzedPages.length} accessible page sample(s) were checked against the query; absence from sampled text is not proof of absence from the full page.`],
                }],
                additionalValue: "Research the underlying question and answer it clearly. Treat this as a hypothesis until full-page evidence or independent research confirms the need.",
            });
        }
    }

    for (const criterion of decisionCriteria.slice(0, 5)) {
        opportunities.push({
            id: `criterion-${opportunities.length + 1}`,
            description: `Explain how readers should evaluate ${criterion.criterion}.`,
            type: "decision_criteria",
            verificationStatus: "observed",
            confidence: Math.min(0.85, 0.45 + criterion.sourceUrls.length / Math.max(1, analyzedPages.length) * 0.4),
            sourceUrls: criterion.sourceUrls,
            supportingObservations: [{
                observation: `The concept "${criterion.criterion}" appeared in sampled ranking-page content.`,
                classification: "observed",
                confidence: 0.75,
                sourceUrls: criterion.sourceUrls,
                evidence: [`Found in ${criterion.sourceUrls.length} analysed page sample(s).`],
            }],
            additionalValue: "Translate the concept into practical criteria, checks, trade-offs, and exceptions rather than repeating competitor wording.",
        });
    }

    const evidenceRequirements: string[] = [];
    if (readerNeeds.length > 0) evidenceRequirements.push("Answer relevant PAA and related queries using current, cited sources where claims need verification.");
    if (decisionCriteria.length > 0) evidenceRequirements.push("Support material comparison criteria with current primary sources, product documentation, or transparent methods.");
    if (keywordNeedsFreshness(keyword, readerNeeds, decisionCriteria)) evidenceRequirements.push("Verify freshness-sensitive prices, policies, limits, and dated product claims against a current source before publication.");
    if (dominantFormats.some(item => item.format === "comparison" && item.share >= 0.3)) evidenceRequirements.push("For factual comparisons, document the dimensions evaluated and the sources or methodology used for each entry.");
    if (evidenceRequirements.length === 0) evidenceRequirements.push("Collect sources relevant to the final outline; do not add statistics or quotations unless the source text supports them.");

    const notes: string[] = [];
    if (!serpContext) notes.push("SERP retrieval returned no context. No competitor gaps can be verified.");
    if (pages.length < 5) notes.push(`Only ${pages.length} unique organic result(s) were available; confidence is limited by sample size.`);
    if (analyzedPages.length < 3) notes.push("Fewer than three pages exposed readable content. Gap detection is disabled or hypothesis-only.");
    const failures = pages
        .filter(page => page.scrapeStatus === "FAILED" || page.scrapeStatus === "UNSCRAPPABLE" || page.scrapeStatus === "SNIPPET_ONLY")
        .slice(0, 10)
        .map(page => ({
            url: page.url,
            reason: organic.find(result => result.link === page.url)?.scrapeFailureReason
                ?? (page.scrapeStatus === "SNIPPET_ONLY" ? "Only SERP snippet or insufficient readable article text was available." : "Page content could not be analysed."),
        }));
    const coverageRatio = pages.length ? analyzedPages.length / pages.length : 0;
    const retrievalConfidence = analyzedPages.length >= 5 && coverageRatio >= 0.65
        ? "high"
        : analyzedPages.length >= 3 && coverageRatio >= 0.4
            ? "medium"
            : "low";
    const retrievalStatus = pages.length === 0
        ? "UNAVAILABLE"
        : failures.length > 0 || analyzedPages.length < pages.length
            ? "PARTIAL"
            : "AVAILABLE";

    const toolFormatShare = dominantFormats.find(item => item.format === "tool")?.share ?? 0;
    const siteFit = siteActionFor(library, existingSite ?? null, mostCommonFormat, Math.max(toolFormatShare, mostCommonFormat === "tool" ? dominantShare : 0));

    return SerpCompetitiveBriefSchema.parse({
        version: 1,
        keyword: keyword.slice(0, 500),
        researchedAt,
        intent,
        dominantFormats,
        pages,
        requiredCoverage,
        readerNeeds: readerNeeds.slice(0, 20),
        decisionCriteria,
        opportunities: opportunities.slice(0, 15),
        recommendedFormat: mostCommonFormat,
        outlineGuidance: [
            `Satisfy the identified ${intent.label} intent before adding secondary topics.`,
            ...requiredCoverage.slice(0, 5).map(item => `Evaluate the observed topic "${item.topic}" for inclusion because it appears on ${item.supportCount}/${item.totalAnalyzed} analysed pages.`),
            ...(readerNeeds.length > 0 ? ["Answer relevant surfaced reader needs directly; do not force every question into a separate heading."] : []),
            ...(mostCommonFormat === "tool" && dominantShare >= 0.4 ? ["The SERP has a substantial interactive-tool share; ask for review before generating a conventional article."] : []),
        ].slice(0, 12),
        differentiationPlan: [
            "Make each section complete a named reader task with direct answers, practical steps, and material caveats.",
            "Use primary/current evidence for freshness-sensitive facts and disclose methods for original comparisons.",
            ...(siteFit.recommendedAction === "SUPPORTING_ARTICLE" ? ["Address a distinct subtask from the related library pages and add contextual internal links."] : []),
            ...(siteFit.recommendedAction === "UPDATE_EXISTING" ? ["Improve the matched page or route this draft through an explicit refresh workflow; avoid creating a competing URL."] : []),
            ...(siteFit.humanReviewRequired ? ["Human review is required before this article is treated as the chosen content action."] : []),
        ].slice(0, 10),
        evidenceRequirements: evidenceRequirements.slice(0, 15),
        retrieval: {
            status: retrievalStatus,
            organicResultsReceived: serpContext?.results.length ?? 0,
            uniqueResults: pages.length,
            scrapeAttempts: pages.filter(page => page.scrapeStatus !== "UNSCRAPPABLE").length,
            analyzedPages: analyzedPages.length,
            scrapeFailures: failures,
            coverageRatio,
            confidence: retrievalConfidence,
            notes: notes.slice(0, 10),
        },
        siteFit: {
            recommendedAction: siteFit.recommendedAction,
            rationale: siteFit.rationale,
            ...(siteFit.matchingPageUrl ? { matchingPageUrl: siteFit.matchingPageUrl } : {}),
            ...(siteFit.matchingPageTitle ? { matchingPageTitle: siteFit.matchingPageTitle } : {}),
            relatedLibraryPageUrls: siteFit.relatedPageUrls.slice(0, 10),
            humanReviewRequired: siteFit.humanReviewRequired || retrievalConfidence === "low",
        },
    });
}

function keywordNeedsFreshness(keyword: string, needs: Array<{ question: string }>, criteria: Array<{ criterion: string }>): boolean {
    const combined = normalizedText(`${keyword} ${needs.map(item => item.question).join(" ")} ${criteria.map(item => item.criterion).join(" ")}`);
    return /pricing|price|cost|current|2026|latest|updated|release|policy|limit|plan|version|integration|availability/.test(combined);
}
