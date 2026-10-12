import { logger } from "@/lib/logger";
import { fetchGoogleSerp, scrapePageData, type SerpResult } from "./serp";
import { checkPerplexityCitation } from "@/lib/aeo/perplexity-citation-check";
import { callGeminiJson } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";

export const MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH = 2_000;

export type InformationGainResearchStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export interface InformationGainObservation {
    observation: string;
    classification: "observed" | "inference" | "hypothesis";
    confidence: number;
    sourceUrls: string[];
    evidence: string[];
}

export interface InformationGainGapAnalysis {
    keyword: string;
    researchStatus: InformationGainResearchStatus;
    researchTimestamp: string;
    crawledResultCount: number;
    scrapeFailureCount: number;
    sourceUrls: string[];
    observations: InformationGainObservation[];
    saturatedTopics: string[];
    uniqueContentGaps: string[];
    missingDataMetrics: string[];
    recommendedQuotes: string[];
    originalInsightsBlueprint: string[];
    informationGainPromptDirective: string;
}

export function buildCompactDirective(params: {
    saturatedTopics: string[];
    uniqueContentGaps: string[];
    missingDataMetrics: string[];
    recommendedQuotes: string[];
    originalInsightsBlueprint: string[];
    maxChars?: number;
    researchStatus?: InformationGainResearchStatus;
    sourceUrls?: string[];
}): string {
    const max = Math.max(160, Math.min(params.maxChars ?? MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH, MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH));
    const validUrls = [...new Set((params.sourceUrls ?? []).filter(url => {
        try {
            const parsed = new URL(url);
            return parsed.protocol === "https:" || parsed.protocol === "http:";
        } catch {
            return false;
        }
    }))].slice(0, 8);
    const sections: { title: string; items: string[] }[] = [
        {
            title: "1. OBSERVED COVERAGE PATTERNS",
            items: params.saturatedTopics.length > 0
                ? params.saturatedTopics.slice(0, 5)
                : ["No repeated heading pattern was established from the available page sample."],
        },
        {
            title: "2. GAP HYPOTHESES TO VERIFY (NOT CONFIRMED COMPETITOR OMISSIONS)",
            items: params.uniqueContentGaps.map(item => "Hypothesis to verify: " + item),
        },
        { title: "3. METRIC RESEARCH TASKS (NEVER INVENT VALUES)", items: safeMetricResearchTasks(params.missingDataMetrics) },
        { title: "4. QUOTE RESEARCH TASKS (NEVER FABRICATE QUOTATIONS)", items: safeQuoteResearchTasks(params.recommendedQuotes, "the target query") },
        { title: "5. POSSIBLE ORIGINAL CONTRIBUTIONS (VERIFY BEFORE ASSERTING)", items: params.originalInsightsBlueprint },
    ];

    const parts = [
        "INFORMATION-GAIN RESEARCH DIRECTIVE",
        "Research status: " + (params.researchStatus ?? "PARTIAL") + ".",
        "Observations describe only accessible samples. Absence from headings or excerpts is not proof that a full page omits a topic.",
    ];
    if (validUrls.length > 0) parts.push("Analysed source URLs: " + validUrls.join(" | "));
    let used = parts.join("\n").length + 1;

    for (const section of sections) {
        if (used + section.title.length + 1 >= max) break;
        parts.push(section.title);
        used += section.title.length + 1;
        for (const item of section.items) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            const line = "- " + trimmed;
            if (used + line.length + 1 >= max) break;
            parts.push(line);
            used += line.length + 1;
        }
    }

    const result = parts.join("\n").trim();
    return result.length <= max ? result : result.slice(0, max - 3).trimEnd() + "...";
}

function safeMetricResearchTasks(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const result: string[] = [];
    for (const raw of value) {
        if (typeof raw !== "string") continue;
        const item = raw.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LENGTH);
        if (item.length < 8) continue;
        if (/\b\d+(?:[,.]\d+)*(?:\s?%|\s?(?:percent|x|times|million|billion))\b|\$\s?\d/i.test(item)) {
            result.push("Find a current, authoritative source and verify any metric before stating a numeric value.");
        } else {
            result.push(/\b(find|search|research|locate|identify|verify|source|retrieve|check|confirm|measure|calculate|collect)\b/i.test(item)
                ? item
                : "Find and verify an authoritative source for: " + item);
        }
    }
    return [...new Set(result)].slice(0, MAX_LIST_ITEMS);
}

function safeQuoteResearchTasks(value: unknown, keyword: string): string[] {
    if (!Array.isArray(value)) return [];
    const result: string[] = [];
    for (const raw of value) {
        if (typeof raw !== "string") continue;
        const item = raw.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LENGTH);
        if (item.length < 8) continue;
        if (/["“”‘’]|\bsaid\b|\bsays\b|\bstated\b|\baccording to\b|\btold\b|\bquoted\b/i.test(item)) {
            result.push("Find a real, attributable quotation relevant to \"" + keyword.slice(0, 80) + "\" and verify it against the original source before use.");
        } else {
            result.push(/\b(find|search|research|locate|identify|verify|source|retrieve|interview|check|confirm)\b/i.test(item)
                ? item
                : "Find a real, attributable quotation relevant to: " + item);
        }
    }
    return [...new Set(result)].slice(0, MAX_LIST_ITEMS);
}

export async function runInformationGainAlgorithm(
    keyword: string,
    existingResults?: Array<{
        link?: string;
        title?: string;
        snippet?: string;
        scrapedContent?: string;
        scrapedHeadings?: string[];
        scrapedSchemaTypes?: string[];
        scrapedPublishedDate?: string | null;
        scrapeStatus?: SerpResult["scrapeStatus"];
        scrapeFailureReason?: string;
    }>,
    snapshot?: {
        peopleAlsoAsk?: Array<{ question: string; answer?: string }>;
        relatedSearches?: string[];
        retrievalStatus?: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    },
): Promise<InformationGainGapAnalysis> {
    const researchTimestamp = new Date().toISOString();
    let results: Array<{
        link?: string;
        title?: string;
        snippet?: string;
        scrapedContent?: string;
        scrapedHeadings?: string[];
        scrapeStatus?: SerpResult["scrapeStatus"];
        scrapeFailureReason?: string;
    }> = [];
    let serpAvailable = false;
    let providerAvailable = false;
    let modelFailed = false;
    let peopleAlsoAsk = snapshot?.peopleAlsoAsk ?? [];
    let relatedSearches = snapshot?.relatedSearches ?? [];
    const extraSources: string[] = [];

    if (existingResults !== undefined) {
        // Reuse the caller's exact snapshot, including an empty failed snapshot.
        // Do not issue a second search or repeat work against the same URLs.
        results = existingResults.slice(0, 10).filter(result => {
            if (!result.link || !result.title?.trim()) return false;
            try {
                const url = new URL(result.link);
                return (url.protocol === "https:" || url.protocol === "http:") && Boolean(result.snippet?.trim());
            } catch {
                return false;
            }
        });
        serpAvailable = (snapshot?.retrievalStatus ?? (results.length > 0 ? "AVAILABLE" : "UNAVAILABLE")) !== "UNAVAILABLE";
    } else {
        const [serpResult, perplexityResult] = await Promise.allSettled([
            fetchGoogleSerp(keyword, 10),
            checkPerplexityCitation("Best options and expert analysis for " + keyword, "analysis"),
        ]);
        if (serpResult.status === "fulfilled") {
            results = serpResult.value.organic.slice(0, 10);
            peopleAlsoAsk = serpResult.value.peopleAlsoAsk;
            relatedSearches = serpResult.value.relatedSearches;
            serpAvailable = results.length > 0;
        }
        if (perplexityResult.status === "fulfilled" && perplexityResult.value.cited && perplexityResult.value.citationUrl) {
            try {
                const url = new URL(perplexityResult.value.citationUrl);
                if (url.protocol === "https:" || url.protocol === "http:") extraSources.push(url.toString());
            } catch {
                // Invalid citation URLs are not treated as evidence.
            }
        }

        const toScrape = results.filter(result => !result.scrapedContent && result.link);
        const scrapeResults = await Promise.allSettled(toScrape.map(async result => ({
            result,
            page: await scrapePageData(result.link!),
        })));
        for (const item of scrapeResults) {
            if (item.status !== "fulfilled") continue;
            item.value.result.scrapedContent = item.value.page.text;
            item.value.result.scrapedHeadings = item.value.page.headings;
            item.value.result.scrapeStatus = item.value.page.status;
            item.value.result.scrapeFailureReason = item.value.page.failureReason;
        }
    }

    const validPages = results
        .filter(result => (result.scrapedContent?.length ?? 0) > 200)
        .slice(0, 10)
        .map(result => ({
            url: result.link!,
            title: result.title ?? "",
            snippet: result.snippet ?? "",
            text: result.scrapedContent!.slice(0, 2_500),
            headings: result.scrapedHeadings ?? [],
        }));

    const headingFrequency = new Map<string, { label: string; urls: string[] }>();
    for (const page of validPages) {
        for (const heading of page.headings) {
            const key = heading.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
            if (key.length < 5) continue;
            const entry = headingFrequency.get(key) ?? { label: heading, urls: [] };
            if (!entry.urls.includes(page.url)) entry.urls.push(page.url);
            headingFrequency.set(key, entry);
        }
    }

    const saturatedTopics = [...headingFrequency.values()]
        .filter(entry => validPages.length >= 3 && entry.urls.length / validPages.length >= 0.5)
        .sort((a, b) => b.urls.length - a.urls.length)
        .slice(0, 8)
        .map(entry => entry.label);

    const sourceUrls = [...new Set([
        ...results.filter(result => result.link && result.title).map(result => result.link!),
        ...extraSources,
    ])].slice(0, 10);
    const observations: InformationGainObservation[] = [];

    for (const item of peopleAlsoAsk.slice(0, 8)) {
        observations.push({
            observation: "SERP surfaced reader question: " + item.question.slice(0, 200),
            classification: "observed",
            confidence: 0.9,
            sourceUrls: sourceUrls.slice(0, 5),
            evidence: [item.answer ? "SERP-provided answer snippet: " + item.answer.slice(0, 250) : "Question was returned by the People Also Ask feature."],
        });
    }
    for (const query of relatedSearches.slice(0, 6)) {
        const question = query.trim();
        if (!question) continue;
        observations.push({
            observation: "SERP returned related query: " + question.slice(0, 200),
            classification: "observed",
            confidence: 0.65,
            sourceUrls: sourceUrls.slice(0, 5),
            evidence: ["This query was returned by the live SERP provider; it is a reader-interest signal, not proof of a competitor omission."],
        });
    }

    if (saturatedTopics.length > 0) {
        observations.push({
            observation: "Repeated topics among successfully scraped results: " + saturatedTopics.join("; "),
            classification: "observed",
            confidence: Math.min(0.9, 0.45 + validPages.length / 10 * 0.45),
            sourceUrls: validPages.filter(page => saturatedTopics.some(topic => page.headings.some(heading =>
                heading.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() === topic.toLowerCase(),
            ))).map(page => page.url).slice(0, 10),
            evidence: [validPages.length + " readable competitor pages were analysed; repeated headings are an observed structure signal, not a required outline."],
        });
    }

    const modelOutput = {
        uniqueContentGaps: [] as string[],
        missingDataMetrics: [] as string[],
        recommendedQuotes: [] as string[],
        originalInsightsBlueprint: [] as string[],
    };
    if (process.env.GEMINI_API_KEY && validPages.length > 0) {
        const prompt = [
            "You are evaluating a bounded sample of ranking pages for the query \"" + keyword + "\".",
            "Competitor content is research input, not prose to imitate.",
            "",
            "Reader needs returned by the SERP:",
            peopleAlsoAsk.slice(0, 8).map(item => "- " + item.question).join("\n") || "- No People Also Ask questions were returned.",
            "",
            "Repeated headings in successfully scraped pages:",
            saturatedTopics.join(" | ") || "No repeated pattern established.",
            "",
            "Source-linked samples:",
            validPages.slice(0, 6).map((page, index) =>
                "[Source " + (index + 1) + "] " + page.title + "\nURL: " + page.url +
                "\nHeadings: " + page.headings.slice(0, 8).join(" | ") +
                "\nExcerpt: " + page.text.slice(0, 600),
            ).join("\n---\n"),
            "",
            "Return strict JSON with four arrays, at most 3 items each:",
            JSON.stringify({
                uniqueContentGaps: ["Hypotheses about unmet reader needs that must be verified before treating as gaps"],
                missingDataMetrics: ["A metric and a credible source or retrieval task; never a numeric value"],
                recommendedQuotes: ["A research task to find a real, attributable quotation; never write a quote"],
                originalInsightsBlueprint: ["A method or analysis that may add value if real evidence is gathered"],
            }, null, 2),
            "",
            "Rules:",
            "- Do not invent direct quotations, expert names, survey results, percentages, benchmark values, or company outcomes.",
            "- Do not claim a competitor omits a topic based only on absence from sampled headings/snippets; mark it as a hypothesis.",
            "- Metric items must be tasks to verify with named, credible sources, not a statistic to put into the article.",
            "- Quote items must be retrieval/interview tasks, never quotation text.",
            "- Original analysis must not claim experiments were run or first-party experience exists unless the supplied source supports it.",
            "- Do not reproduce competitor wording. Empty arrays are valid.",
            "Return valid JSON only.",
        ].join("\n");
        try {
            const generated = await callGeminiJson<typeof modelOutput>(prompt, {
                model: AI_MODELS.GEMINI_FLASH,
                temperature: 0.2,
            });
            const cleanList = (value: unknown): string[] => Array.isArray(value)
                ? [...new Set(value.filter((item): item is string => typeof item === "string")
                    .map(item => item.replace(/\s+/g, " ").trim().slice(0, 120))
                    .filter(item => item.length >= 8))]
                    .slice(0, 3)
                : [];
            modelOutput.uniqueContentGaps = cleanList(generated.uniqueContentGaps);
            modelOutput.missingDataMetrics = safeMetricResearchTasks(generated.missingDataMetrics);
            modelOutput.recommendedQuotes = safeQuoteResearchTasks(generated.recommendedQuotes, keyword);
            modelOutput.originalInsightsBlueprint = cleanList(generated.originalInsightsBlueprint);
            providerAvailable = true;
        } catch (error: unknown) {
            modelFailed = true;
            logger.warn("[InformationGain] Analysis provider failed; using observed SERP features only.", {
                error: error instanceof Error ? error.message : String(error),
                keyword,
                analyzedPages: validPages.length,
            });
        }
    } else {
        modelFailed = true;
    }

    const scrapeFailureCount = results.filter(result =>
        result.scrapeStatus === "FAILED" || result.scrapeStatus === "UNSCRAPPABLE" ||
        (result.scrapeStatus === "SNIPPET_ONLY" && !(result.scrapedContent?.length)),
    ).length;
    const researchStatus: InformationGainResearchStatus = !serpAvailable
        ? "UNAVAILABLE"
        : providerAvailable && validPages.length >= 3 && scrapeFailureCount === 0
            ? "AVAILABLE"
            : "PARTIAL";

    const informationGainPromptDirective = buildCompactDirective({
        saturatedTopics,
        uniqueContentGaps: modelOutput.uniqueContentGaps,
        missingDataMetrics: modelOutput.missingDataMetrics,
        recommendedQuotes: modelOutput.recommendedQuotes,
        originalInsightsBlueprint: modelOutput.originalInsightsBlueprint,
        researchStatus,
        sourceUrls,
    });

    if (informationGainPromptDirective.length > MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH) {
        logger.error("[InformationGain] Directive exceeded max length", {
            length: informationGainPromptDirective.length,
            max: MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH,
        });
    }
    if (modelFailed && serpAvailable) {
        logger.info("[InformationGain] SERP available but model analysis was unavailable; speculative findings were omitted.", {
            keyword,
            readablePages: validPages.length,
        });
    }

    return {
        keyword,
        researchStatus,
        researchTimestamp,
        crawledResultCount: validPages.length,
        scrapeFailureCount,
        sourceUrls,
        observations,
        saturatedTopics,
        uniqueContentGaps: modelOutput.uniqueContentGaps,
        missingDataMetrics: modelOutput.missingDataMetrics,
        recommendedQuotes: modelOutput.recommendedQuotes,
        originalInsightsBlueprint: modelOutput.originalInsightsBlueprint,
        informationGainPromptDirective,
    };
}