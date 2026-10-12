import { z } from "zod";
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
    /** True when the LLM was available and produced a result. False when it failed or was skipped. */
    llmAvailable: boolean;
}

async function checkOriginalityVsSerp(
    content: string,
    serpContext: SerpContext | null,
    researchPacket: ResearchPacket,
): Promise<LlmOriginalityResult> {
    const unavailableFallback: LlmOriginalityResult = {
        uniqueContributions: [],
        paraphrasedSections: [],
        overallOriginal: false,
        llmAvailable: false,
    };

    const competitorPages = (serpContext?.results ?? []).slice(0, 5);
    const sitePages = researchPacket.siteContentLibrary?.relatedPages.slice(0, 6) ?? [];
    if (competitorPages.length === 0 && sitePages.length === 0) {
        return { ...unavailableFallback, llmAvailable: true };
    }
    if (!process.env.GEMINI_API_KEY) return unavailableFallback;

    const competitorSummary = competitorPages.map((page, index) => {
        const headings = page.scrapedHeadings?.slice(0, 8).join(" | ") ?? "not available";
        const excerpt = (page.scrapedContent ?? page.snippet ?? "").slice(0, 700);
        const status = page.scrapeStatus ?? ((page.scrapedContent?.length ?? 0) > 200 ? "ANALYZED" : "SNIPPET_ONLY");
        return "[SERP RESULT " + (index + 1) + "] " + page.title +
            "\nURL: " + page.link +
            "\nScrape status: " + status +
            "\nHeadings observed: " + headings +
            "\nSampled text: " + excerpt;
    }).join("\n---\n");

    const siteLibrarySummary = sitePages.map((page, index) =>
        "[SITE LIBRARY PAGE " + (index + 1) + "] " + page.title +
        "\nStatus: " + page.status +
        "\nURL: " + (page.url ?? "not available") +
        "\nTarget keywords: " + page.targetKeywords.slice(0, 8).join(", ") +
        "\nHeadings: " + page.headings.slice(0, 8).join(" | ") +
        "\nSampled text: " + (page.comparisonText ?? page.excerpt).slice(0, 700)
    ).join("\n---\n");

    const plainContent = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6_000);

    const prompt = [
        "You are an editorial originality reviewer. Compare this draft against sampled SERP ranking pages AND the site's own published/draft content.",
        "Separate material passage/structure overlap from normal topical similarity; writing about the same subject is not itself a duplicate.",
        "Only call something a competitor omission when the accessible sample supports that scope. A snippet or heading list does not prove a full page omits a topic.",
        "Ranked pages and library excerpts are research input, not prose to imitate.",
        "",
        "SERP competitor samples:",
        competitorSummary || "No accessible competitor samples.",
        "",
        "Related site-library pages:",
        siteLibrarySummary || "No related site content was retrieved.",
        "",
        "Draft article:",
        plainContent,
        "",
        "Return JSON only with:",
        JSON.stringify({
            uniqueContributions: ["specific useful value in the draft, not simply that it covers the topic"],
            paraphrasedSections: ["only substantial phrase/structure overlap that is supported by the supplied sample; include source URL and section"],
            overallOriginal: true,
        }, null, 2),
        "",
        "Never claim that the draft includes verified experiments, first-party experience, data, or quotations unless that is evident from the draft's source material. If you cannot inspect a competitor beyond a snippet, say so in your analysis. If uncertain, omit a duplicate claim rather than overstate it.",
    ].join("\n");

    try {
        const result = await callGeminiJson<{
            uniqueContributions?: unknown;
            paraphrasedSections?: unknown;
            overallOriginal?: unknown;
        }>(prompt, {
            model: AI_MODELS.GEMINI_FLASH,
            temperature: 0.1,
            maxOutputTokens: 900,
        });
        const parsed = z.object({
            uniqueContributions: z.array(z.string().trim().min(1).max(300)).max(12),
            paraphrasedSections: z.array(z.string().trim().min(1).max(300)).max(12),
            overallOriginal: z.boolean(),
        }).safeParse(result);
        if (!parsed.success) throw new Error("Originality response failed validation");
        return { ...parsed.data, llmAvailable: true };
    } catch (err) {
        logger.warn("[Original Value Gate] LLM originality check failed — deterministic checks still run; gate will return UNAVAILABLE, not FAIL", {
            error: err instanceof Error ? err.message : String(err),
        });
        return unavailableFallback;
    }
}

function normalizedPassageTokens(value: string): Set<string> {
    const stop = new Set(["about", "after", "also", "and", "are", "but", "for", "from", "has", "have", "into", "its", "more", "not", "our", "that", "the", "their", "this", "was", "were", "with", "you", "your"]);
    return new Set(value.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/).filter(word => word.length > 2 && !stop.has(word)));
}

function passageSimilarity(a: string, b: string): number {
    const aTokens = normalizedPassageTokens(a);
    const bTokens = normalizedPassageTokens(b);
    if (aTokens.size < 12 || bTokens.size < 12) return 0;
    let intersection = 0;
    for (const token of aTokens) if (bTokens.has(token)) intersection++;
    return intersection / (aTokens.size + bTokens.size - intersection);
}

function passageSentences(value: string): string[] {
    return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length >= 100 && normalizedPassageTokens(sentence).size >= 12)
        .slice(0, 160);
}

function deterministicNearDuplicateIssues(
    content: string,
    serpContext: SerpContext | null,
    researchPacket: ResearchPacket,
): string[] {
    const draftSentences = passageSentences(content);
    const corpus: Array<{ label: string; url?: string; text: string; kind: "competitor" | "site" }> = [];

    for (const page of (serpContext?.results ?? []).slice(0, 5)) {
        if ((page.scrapedContent?.length ?? 0) > 200) {
            corpus.push({
                label: page.title,
                url: page.link,
                text: page.scrapedContent!.slice(0, 25_000),
                kind: "competitor",
            });
        }
    }
    for (const page of (researchPacket.siteContentLibrary?.relatedPages ?? []).slice(0, 8)) {
        const text = page.comparisonText ?? page.excerpt;
        if (text.trim().length > 100) {
            corpus.push({
                label: page.title,
                ...(page.url ? { url: page.url } : {}),
                text: text.slice(0, 3_500),
                kind: "site",
            });
        }
    }

    const issues: string[] = [];
    for (let i = 0; i < draftSentences.length; i++) {
        const sentence = draftSentences[i];
        for (const source of corpus) {
            const match = passageSentences(source.text).some(sourceSentence => passageSimilarity(sentence, sourceSentence) >= 0.86);
            if (match) {
                issues.push(
                    (source.kind === "site"
                        ? "Draft passage substantially overlaps existing site content"
                        : "Draft passage may closely mirror analysed competitor text") +
                    (source.url ? ": " + source.url : "") +
                    " (sample titled \"" + source.label.slice(0, 100) + "\").",
                );
                break;
            }
        }
        if (issues.length >= 6) break;
        for (let j = 0; j < i; j++) {
            if (passageSimilarity(sentence, draftSentences[j]) >= 0.9) {
                issues.push("Draft contains repeated long-form sentence/intro copy within the article.");
                break;
            }
        }
        if (issues.length >= 6) break;
    }

    // Structural similarity is review-only: two specific, non-generic headings
    // overlapping a related library page can signal search-intent overlap.
    const genericHeading = new Set(["overview", "introduction", "conclusion", "final thoughts", "frequently asked questions", "faq", "summary", "next steps"]);
    const articleHeadings = [...content.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>|^##\s+(.+)$/gim)]
        .map(match => (match[1] ?? match[2] ?? "").replace(/<[^>]+>/g, "").trim())
        .filter(heading => heading.length > 4 && !genericHeading.has(heading.toLowerCase()));
    for (const page of (researchPacket.siteContentLibrary?.relatedPages ?? []).slice(0, 5)) {
        const sourceHeadings = page.headings.filter(heading => !genericHeading.has(heading.toLowerCase()));
        const overlaps = articleHeadings.filter(heading =>
            sourceHeadings.some(sourceHeading => passageSimilarity(heading + " more details are discussed here", sourceHeading + " more details are discussed here") >= 0.7),
        );
        if (overlaps.length >= 2) {
            issues.push("Potential same-site structural overlap with \"" + page.title.slice(0, 100) + "\"; review search intent and contextual internal links." + (page.url ? " " + page.url : ""));
        }
        if (issues.length >= 6) break;
    }

    return [...new Set(issues)].slice(0, 8);
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
    const { content, serpContext, researchPacket } = input;

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

    const llmResult = await checkOriginalityVsSerp(content, serpContext, researchPacket);
    const deterministicDuplicates = deterministicNearDuplicateIssues(content, serpContext, researchPacket);

    // ── Critical architectural rule ───────────────────────────────────────────
    // When the LLM check was UNAVAILABLE (provider failure, rate-limit, no API key),
    // we must NOT treat the content as having failed originality.
    // Return UNAVAILABLE so the Publication Gate can route to REVIEW rather than FAIL.
    //
    // We only use the heuristic analysis when the LLM was unavailable, and only
    // for REVIEW routing — never for hard FAIL routing without LLM confirmation.
    // ─────────────────────────────────────────────────────────────────────────
    if (!llmResult.llmAvailable && serpContext && serpContext.results.length > 0) {
        // LLM was available (SERP data present, API key set) but the call failed.
        // Return UNAVAILABLE so the gate degrades to REVIEW, not FAIL.
        logger.warn("[Original Value Gate] LLM unavailable — returning UNAVAILABLE status (not FAIL)", {
            weakSections: weakSections.length,
            totalSections: sectionAnalyses.length,
        });
        return {
            status: "UNAVAILABLE" as GateStatus,
            result: {
                passed: false,
                uniqueContributions: [],
                weakSections,
                duplicateSections: [],
                missingEvidence,
                missingValue: ["Originality check unavailable: AI provider failed. Human editorial review required."],
            },
        };
    }

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
    const duplicateSections = [...new Set([
        ...llmResult.paraphrasedSections.map(
            s => `Section appears to paraphrase or structurally duplicate sampled content: "${s}"`
        ),
        ...deterministicDuplicates,
    ])].slice(0, 12);

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
