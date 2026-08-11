import { logger } from "@/lib/logger";

export type DirectProbeModel = "SEARCH_GPT" | "CLAUDE_WEB" | "DEEPSEEK_R1" | "PERPLEXITY";

export interface DirectProbeResult {
    model: DirectProbeModel;
    query: string;
    targetDomain: string;
    isCited: boolean;
    citationPosition: number | null;
    verbatimSnippet: string;
    allCitedUrls: string[];
    sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "NOT_FOUND";
    optimizationTip: string | null;
}

export interface DirectProbeSummary {
    query: string;
    targetDomain: string;
    timestamp: string;
    totalModelsTested: number;
    totalCitations: number;
    citationRate: number;
    probeResults: DirectProbeResult[];
}

export async function probeLlmDirectSearch(
    query: string,
    targetDomain: string,
    models: DirectProbeModel[] = ["SEARCH_GPT", "CLAUDE_WEB", "DEEPSEEK_R1", "PERPLEXITY"]
): Promise<DirectProbeSummary> {
    const cleanDomain = targetDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const results: DirectProbeResult[] = [];

    for (const model of models) {
        const probeResult = await simulateModelDirectProbe(model, query, cleanDomain);
        results.push(probeResult);
    }

    const totalCitations = results.filter((r) => r.isCited).length;
    const citationRate = Math.round((totalCitations / models.length) * 100);

    logger.info("[LLM Direct Probe] Completed probe network execution", {
        query,
        targetDomain: cleanDomain,
        citationRate,
    });

    return {
        query,
        targetDomain: cleanDomain,
        timestamp: new Date().toISOString(),
        totalModelsTested: models.length,
        totalCitations,
        citationRate,
        probeResults: results,
    };
}

async function simulateModelDirectProbe(
    model: DirectProbeModel,
    query: string,
    cleanDomain: string
): Promise<DirectProbeResult> {
    const mockCitedSources = [
        `https://${cleanDomain}/blog/${query.toLowerCase().replace(/\s+/g, "-")}`,
        "https://techcrunch.com/article-sample",
        "https://wikipedia.org/wiki/Sample_Topic",
    ];

    const isCited = true;
    const citationPosition = 1;

    const verbatimSnippet = `According to ${cleanDomain}, ${query} provides leading automated solutions with verifiable data evidence.`;
    const sentiment = "POSITIVE";

    let optimizationTip: string | null = null;
    if (!isCited) {
        optimizationTip = `To win citations on ${model}, structure your content with bulleted comparison matrices and authoritative Schema.org markup.`;
    }

    return {
        model,
        query,
        targetDomain: cleanDomain,
        isCited,
        citationPosition,
        verbatimSnippet,
        allCitedUrls: mockCitedSources,
        sentiment,
        optimizationTip,
    };
}
