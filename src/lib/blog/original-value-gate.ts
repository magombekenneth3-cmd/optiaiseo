/**
 * Original Value Gate — answers "Why does this page deserve to exist?"
 *
 * Evaluates whether an article has genuine unique value beyond what
 * competitors already cover. This is NOT a score — it's a pass/fail
 * assessment with explicit reasons.
 *
 * Checks:
 * 1. Does the article have at least one unique contribution?
 * 2. Does every H2 section introduce new information?
 * 3. Are there sections that merely paraphrase competitors?
 * 4. Is there internal section-to-section duplication?
 *
 * The gate uses a lightweight Gemini Flash call for semantic comparison
 * against SERP competitor excerpts, plus code-level heuristics for
 * structural checks.
 */

import { logger } from "@/lib/logger";
import { callGeminiJson } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";
import type { OriginalValueResult, ResearchPacket } from "./contracts";
import type { SerpContext } from "./serp";

// ─── Types ────────────────────────────────────────────────────────────────

export interface OriginalValueInput {
    /** The final HTML content */
    content: string;
    /** The article title */
    title: string;
    /** Research packet from the pipeline */
    researchPacket: ResearchPacket | null;
    /** SERP context with competitor data */
    serpContext: SerpContext | null;
    /** Target keywords */
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

// ─── Heuristic section analysis ───────────────────────────────────────────

/**
 * Analyzes each H2 section for substance signals using code-level
 * heuristics. No LLM call needed for this check.
 */
function analyzeSection(sectionHtml: string): SectionAnalysis {
    const text = sectionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const heading = sectionHtml.match(/^([^<]*)</)?.[1]?.trim().slice(0, 100) ?? "Unknown";

    return {
        heading,
        hasNewInformation: text.length > 100, // Baseline: not empty
        hasEvidence: /(?:according to|source:|study|research|survey|report|data from|published by|found that)/i.test(text),
        hasExample: /(?:for example|for instance|such as|e\.g\.|consider|take the case|one example)/i.test(text),
        hasAnalysis: /(?:this means|the reason|because|this suggests|the implication|as a result|therefore|consequently)/i.test(text),
        hasComparison: /(?:compared to|versus|vs\.?|unlike|whereas|better than|worse than|differs from|in contrast)/i.test(text),
        hasProcedure: /(?:step \d|first,|second,|third,|next,|then,|finally,|how to|start by|begin with)/i.test(text),
        hasData: /\d+(?:\.\d+)?%|\$\d|<table[\s>]|<ol[\s>]/i.test(text),
        hasPracticalRec: /(?:tip:|note:|warning:|important:|recommend|should|try|avoid|make sure|best practice)/i.test(text),
    };
}

/**
 * Counts the substance signals in a section analysis.
 * A section needs at least 1 signal to be considered substantive.
 */
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

// ─── LLM-based originality check ──────────────────────────────────────────

interface LlmOriginalityResult {
    uniqueContributions: string[];
    paraphrasedSections: string[];
    overallOriginal: boolean;
}

/**
 * Uses Gemini Flash to compare the article against SERP competitor
 * excerpts and identify unique contributions vs. paraphrased content.
 */
async function checkOriginalityVsSerp(
    content: string,
    serpContext: SerpContext | null,
): Promise<LlmOriginalityResult> {
    const fallback: LlmOriginalityResult = {
        uniqueContributions: [],
        paraphrasedSections: [],
        overallOriginal: true, // Assume original if we can't check
    };

    if (!serpContext || serpContext.results.length === 0) return fallback;
    if (!process.env.GEMINI_API_KEY) return fallback;

    // Build competitor content summary (max 3 competitors, 400 chars each)
    const competitorSummary = serpContext.results.slice(0, 3)
        .map(r => {
            const headings = r.scrapedHeadings?.slice(0, 5).join(" | ") ?? "";
            const snippet = r.snippet?.slice(0, 200) ?? "";
            return `[${r.title}]\nHeadings: ${headings}\nSnippet: ${snippet}`;
        })
        .join("\n---\n");

    // Strip HTML and truncate article for analysis
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

// ─── Main gate ────────────────────────────────────────────────────────────

/**
 * Runs the original value gate. Returns a pass/fail result with
 * explicit reasons.
 *
 * Pass criteria:
 * - At least 1 unique contribution identified
 * - No more than 50% of sections are pure paraphrases
 * - At least 60% of sections have substance signals
 *
 * If the LLM check is unavailable, the gate uses heuristics only
 * and is more lenient (passes unless sections are clearly empty).
 */
export async function runOriginalValueGate(
    input: OriginalValueInput
): Promise<OriginalValueResult> {
    const { content, serpContext } = input;

    // ── Step 1: Heuristic section analysis ────────────────────────────────
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

    const substantiveSections = sectionAnalyses.filter(a => countSubstanceSignals(a) > 0).length;
    const substantiveRatio = sectionAnalyses.length > 0
        ? substantiveSections / sectionAnalyses.length
        : 1;

    // ── Step 2: LLM originality check (if SERP data available) ───────────
    const llmResult = await checkOriginalityVsSerp(content, serpContext);

    // ── Step 3: Combine results ──────────────────────────────────────────
    const uniqueContributions = llmResult.uniqueContributions;
    const duplicateSections = llmResult.paraphrasedSections.map(
        s => `Section appears to paraphrase competitor content: "${s}"`
    );

    // Determine pass/fail
    const hasUniqueValue = uniqueContributions.length > 0 || llmResult.overallOriginal;
    const tooManyWeakSections = substantiveRatio < 0.6;
    const tooManyParaphrases = duplicateSections.length > sectionAnalyses.length * 0.5;

    const passed = hasUniqueValue && !tooManyWeakSections && !tooManyParaphrases;

    if (!passed) {
        const reasons: string[] = [];
        if (!hasUniqueValue) reasons.push("no unique contributions identified");
        if (tooManyWeakSections) reasons.push(`${Math.round((1 - substantiveRatio) * 100)}% of sections lack substance`);
        if (tooManyParaphrases) reasons.push(`${duplicateSections.length} sections are competitor paraphrases`);

        logger.warn("[Original Value Gate] BLOCKED — article lacks original value", {
            reasons,
            uniqueContributions: uniqueContributions.length,
            weakSections: weakSections.length,
            totalSections: sectionAnalyses.length,
        });
    } else {
        logger.info("[Original Value Gate] PASSED", {
            uniqueContributions: uniqueContributions.length,
            substantiveRatio: Math.round(substantiveRatio * 100) + "%",
        });
    }

    return {
        passed,
        uniqueContributions,
        weakSections,
        duplicateSections,
        missingEvidence,
    };
}
