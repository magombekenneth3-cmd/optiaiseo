import { logger } from "@/lib/logger";
import { fetchGoogleSerp, scrapePageData, SerpResult } from "./serp";
import { checkPerplexityCitation } from "@/lib/aeo/perplexity-citation-check";
import { callGeminiJson } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";

export const MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH = 2_000;

export interface InformationGainGapAnalysis {
    keyword: string;
    crawledResultCount: number;
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
}): string {
    const max = params.maxChars ?? MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH;

    const sections: { title: string; items: string[] }[] = [
        { title: "1. SATURATED ANGLES TO AVOID", items: params.saturatedTopics.length > 0 ? [params.saturatedTopics.join(", ")] : ["generic overviews"] },
        { title: "2. MANDATORY CONTENT GAPS", items: params.uniqueContentGaps },
        { title: "3. HIGH-GAIN METRICS", items: params.missingDataMetrics },
        { title: "4. EXPERT QUOTES", items: params.recommendedQuotes },
        { title: "5. NOVEL FRAMEWORKS", items: params.originalInsightsBlueprint },
    ];

    const header = "INFORMATION-GAIN MANDATE:";
    const parts: string[] = [header];
    let used = header.length + 1;

    for (const section of sections) {
        const titleLine = section.title;
        const titleCost = titleLine.length + 1;

        if (used + titleCost >= max) break;

        parts.push(titleLine);
        used += titleCost;

        for (const item of section.items) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            const line = `- ${trimmed}`;
            const lineCost = line.length + 1;

            if (used + lineCost >= max) break;

            parts.push(line);
            used += lineCost;
        }
    }

    const result = parts.join("\n").trim();

    if (result.length > max) {
        return result.slice(0, max - 3).trimEnd() + "...";
    }

    return result;
}

export async function runInformationGainAlgorithm(
    keyword: string
): Promise<InformationGainGapAnalysis> {
    const [serpData, perplexityResult] = await Promise.allSettled([
        fetchGoogleSerp(keyword, 10),
        checkPerplexityCitation(`Best options and expert analysis for ${keyword}`, "analysis"),
    ]);

    const organic = serpData.status === "fulfilled" ? serpData.value.organic : [];
    const perplexityCitations = perplexityResult.status === "fulfilled" && perplexityResult.value.cited
        ? [perplexityResult.value.citationUrl].filter((u): u is string => !!u)
        : [];

    const urlsToScrape = [...new Set([...organic.map(r => r.link), ...perplexityCitations])].slice(0, 10);

    const scrapedResults = await Promise.all(
        urlsToScrape.map(async (url) => {
            const pageData = await scrapePageData(url);
            return {
                url,
                text: pageData.text,
                headings: pageData.headings,
                schemaTypes: pageData.schemaTypes,
            };
        })
    );

    const validPages = scrapedResults.filter(p => p.text.length > 200);

    const headingFreq = new Map<string, number>();
    for (const page of validPages) {
        for (const h of page.headings) {
            const clean = h.toLowerCase().trim();
            headingFreq.set(clean, (headingFreq.get(clean) ?? 0) + 1);
        }
    }

    const totalScraped = Math.max(1, validPages.length);
    const saturatedTopics = [...headingFreq.entries()]
        .filter(([, count]) => count / totalScraped >= 0.5)
        .map(([h]) => h)
        .slice(0, 5);

    const prompt = `You are a Search Engine Information-Gain Analyst.
Analyzed Keyword: "${keyword}"
Scraped Top-10 Results Count: ${validPages.length}

Saturated Competitor Headings:
${saturatedTopics.join(" | ") || "Standard overview, benefits, how to use"}

Top Competitor Content Excerpts:
${validPages.slice(0, 3).map(p => p.text.slice(0, 400)).join("\n---\n")}

Perform an Information-Gain gap analysis. Identify missing perspectives that NO competitor is covering.

OUTPUT CONSTRAINTS:
- Each array item must be one concise sentence (max 120 characters).
- Do not repeat the SERP results or competitor headings verbatim.
- Do not include preamble, commentary, or markdown fences.
- 3 items max per array.

Respond in strict JSON:
{
  "uniqueContentGaps": ["gap 1", "gap 2", "gap 3"],
  "missingDataMetrics": ["specific 2026 percentage metric or data point to include", "benchmark metric 2"],
  "recommendedQuotes": ["expert practitioner quote perspective 1", "quote perspective 2"],
  "originalInsightsBlueprint": ["counter-intuitive insight 1 that disproves competitor fluff", "novel framework 2"]
}`;

    const fallbackAnalysis = {
        uniqueContentGaps: [`Implementation edge-cases for ${keyword} that competitors don't cover`, `Practical workflow comparison for ${keyword} tools`],
        missingDataMetrics: [`Benchmark comparison across leading ${keyword} approaches`, `Real-world performance observations from practitioners`],
        recommendedQuotes: [`"Most teams fail at ${keyword} because they optimize for volume instead of entity clarity."`],
        originalInsightsBlueprint: [`Why standard approaches to ${keyword} fail in modern LLM search engines.`],
    };

    let aiOutput = fallbackAnalysis;
    try {
        if (process.env.GEMINI_API_KEY) {
            aiOutput = await callGeminiJson<typeof fallbackAnalysis>(prompt, {
                model: AI_MODELS.GEMINI_FLASH,
                temperature: 0.3,
            });
        }
    } catch (err: unknown) {
        logger.warn("[InformationGain] AI analysis fallback used:", { error: (err as Error)?.message });
    }

    const informationGainPromptDirective = buildCompactDirective({
        saturatedTopics,
        uniqueContentGaps: aiOutput.uniqueContentGaps,
        missingDataMetrics: aiOutput.missingDataMetrics,
        recommendedQuotes: aiOutput.recommendedQuotes,
        originalInsightsBlueprint: aiOutput.originalInsightsBlueprint,
    });

    if (informationGainPromptDirective.length > MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH) {
        logger.error("[InformationGain] Directive exceeded max after buildCompactDirective — this should never happen", {
            length: informationGainPromptDirective.length,
            max: MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH,
        });
    }

    return {
        keyword,
        crawledResultCount: validPages.length,
        saturatedTopics,
        uniqueContentGaps: aiOutput.uniqueContentGaps,
        missingDataMetrics: aiOutput.missingDataMetrics,
        recommendedQuotes: aiOutput.recommendedQuotes,
        originalInsightsBlueprint: aiOutput.originalInsightsBlueprint,
        informationGainPromptDirective,
    };
}
