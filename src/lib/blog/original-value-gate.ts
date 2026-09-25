import { logger } from "@/lib/logger";
import { callGeminiJson } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";
import type { OriginalValueResult, ResearchPacket } from "./contracts";
import type { SerpContext } from "./serp";
import type { GateStatus } from "./publication-gate";

export interface OriginalValueInput {
    content: string;
    title: string;
    researchPacket: ResearchPacket;
    serpContext: SerpContext | null;
    targetKeywords: string[];
}

interface SectionAnalysis {
    heading: string;
    hasNewInformation: boolean;
    hasEvidence: boolean;
    hasExample: boolean;
    hasAnalysis: boolean;
    hasComparison: boolean;
    hasProcedure: boolean;
    hasData: boolean;
    hasPracticalRec: boolean;
}

export interface OriginalityGateResult {
    status: GateStatus;
    result: OriginalValueResult;
}

function analyzeSection(sectionHtml: string): SectionAnalysis {
    const text = sectionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const heading = sectionHtml.match(/^([^<]*)</)?.[1]?.trim().slice(0, 100) ?? "Unknown";

    return {
        heading,
        hasNewInformation: text.length > 100,
        hasEvidence: /(?:according to|source:|study|research|survey|report|data from|published by|found that)/i.test(text),
        hasExample: /(?:for example|for instance|such as|e\.g\.|consider|take the case|one example)/i.test(text),
        hasAnalysis: /(?:this means|the reason|because|this suggests|the implication|as a result|therefore|consequently)/i.test(text),
        hasComparison: /(?:compared to|versus|vs\.?|unlike|whereas|better than|worse than|differs from|in contrast)/i.test(text),
        hasProcedure: /(?:step \d|first,|second,|third,|next,|then,|finally,|how to|start by|begin with)/i.test(text),
        hasData: /\d+(?:\.\d+)?%|\$\d|<table[\s>]|<ol[\s>]/i.test(text),
        hasPracticalRec: /(?:tip:|note:|warning:|important:|recommend|should|try|avoid|make sure|best practice)/i.test(text),
    };
}

function countSubstanceSignals(analysis: SectionAnalysis): number {
    let count = 0;
    if (analysis.hasEvidence) count++;
    if (analysis.hasExample) count++;
    if (analysis.hasAnalysis) count++;
    if (analysis.hasComparison) count++;
    if (analysis.hasProcedure) count++;
    if (analysis.hasData) count++;
    if (analysis.hasPracticalRec) count++;
    return count;
}

interface LlmOriginalityResult {
    uniqueContributions: string[];
    paraphrasedSections: string[];
    overallOriginal: boolean;
}

async function checkOriginalityVsSerp(
    content: string,
    serpContext: SerpContext | null,
): Promise<LlmOriginalityResult> {
    const fallback: LlmOriginalityResult = {
        uniqueContributions: [],
        paraphrasedSections: [],
        overallOriginal: false,
    };

    if (!serpContext || serpContext.results.length === 0) return fallback;
    if (!process.env.GEMINI_API_KEY) return fallback;

    const competitorSummary = serpContext.results.slice(0, 3)
        .map(r => {
            const headings = r.scrapedHeadings?.slice(0, 5).join(" | ") ?? "";
            const snippet = r.snippet?.slice(0, 200) ?? "";
            return `[${r.title}]\nHeadings: ${headings}\nSnippet: ${snippet}`;
        })
        .join("\n---\n");

    const plainContent = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6000);

    const prompt = `You are an editorial originality reviewer. Compare this article against the top SERP competitors and identify:
1. What unique contributions does this article make? (things not covered by competitors)
2. Which sections merely paraphrase what competitors already say?
3. Overall: does this article provide meaningful original value?

COMPETITOR CONTENT (top 3 results):
${competitorSummary}

ARTICLE CONTENT:
${plainContent}

Respond with JSON only:
{
  "uniqueContributions": ["specific unique thing 1", "specific unique thing 2"],
  "paraphrasedSections": ["heading or topic that is just rewritten from competitors"],
  "overallOriginal": true/false
}`;

    try {
        return await callGeminiJson<LlmOriginalityResult>(prompt, {
            model: AI_MODELS.GEMINI_FLASH,
            temperature: 0.1,
            maxOutputTokens: 800,
        });
    } catch (err) {
        logger.warn("[Original Value Gate] LLM originality check failed — using heuristics only", {
            error: (err as Error)?.message,
        });
        return fallback;
    }
}

export async function runOriginalValueGate(
    input: OriginalValueInput
): Promise<OriginalValueResult> {
    const { result } = await evaluateOriginality(input);
    return result;
}

export async function evaluateOriginality(
    input: OriginalValueInput
): Promise<OriginalityGateResult> {
    const { content, serpContext } = input;

    const sections = content.split(/<h2[\s>]/i).slice(1);
    const sectionAnalyses = sections.map(s => analyzeSection(s));

    const weakSections: string[] = [];
    const missingEvidence: string[] = [];

    for (const analysis of sectionAnalyses) {
        const signals = countSubstanceSignals(analysis);
        if (signals === 0) {
            weakSections.push(
                `"${analysis.heading}" has no substance signals (no evidence, examples, data, comparisons, or procedures).`
            );
        }
        if (!analysis.hasEvidence && !analysis.hasData) {
            missingEvidence.push(
                `"${analysis.heading}" has no evidence or data references.`
            );
        }
    }

    const llmResult = await checkOriginalityVsSerp(content, serpContext);

    const uniqueContributions = [...llmResult.uniqueContributions];
    const authorEvidence = input.researchPacket.authorEvidence;
    if (authorEvidence.experience || authorEvidence.realNumbers) {
        uniqueContributions.push("Uses documented first-party author evidence.");
    }
    for (const analysis of sectionAnalyses) {
        if (analysis.hasComparison && analysis.hasAnalysis) {
            uniqueContributions.push(`Original comparison and analysis in "${analysis.heading}".`);
        } else if (analysis.hasProcedure && analysis.hasPracticalRec) {
            uniqueContributions.push(`Actionable original method in "${analysis.heading}".`);
        }
    }
    const dedupedContributions = [...new Set(uniqueContributions)].slice(0, 20);
    const duplicateSections = llmResult.paraphrasedSections.map(
        s => `Section appears to paraphrase competitor content: "${s}"`
    );

    const hasUniqueValue = dedupedContributions.length > 0 || llmResult.overallOriginal;
    const hasWeakSection = weakSections.length > 0;
    const hasParaphrasedSection = duplicateSections.length > 0;
    const passed = hasUniqueValue && !hasWeakSection && !hasParaphrasedSection;
    const missingValue = [
        ...(!hasUniqueValue
            ? ["No original comparison, methodology, or first-party evidence was identified."]
            : []),
        ...(hasWeakSection
            ? ["One or more sections have no evidence, examples, analysis, comparison, procedure, data, or practical recommendation."]
            : []),
        ...(hasParaphrasedSection
            ? ["One or more sections paraphrase competitor content."]
            : []),
    ];

    let status: GateStatus;
    if (!hasUniqueValue && hasParaphrasedSection) {
        status = "FAIL";
    } else if (!passed) {
        status = "REVIEW";
    } else {
        status = "PASS";
    }

    if (!passed) {
        logger.warn("[Original Value Gate] BLOCKED", {
            status,
            reasons: missingValue,
            uniqueContributions: dedupedContributions.length,
            weakSections: weakSections.length,
            totalSections: sectionAnalyses.length,
        });
    } else {
        logger.info("[Original Value Gate] PASSED", {
            uniqueContributions: dedupedContributions.length,
        });
    }

    const result: OriginalValueResult = {
        passed,
        uniqueContributions: dedupedContributions,
        weakSections,
        duplicateSections,
        missingEvidence,
        missingValue,
    };

    return { status, result };
}
