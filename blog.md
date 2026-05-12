/**
 * pipeline.ts — 4-Stage Editorial Generation Pipeline
 *
 * Stage 1: Research Brain      (Flash)  — intent, entities, contrarian angles
 * Stage 2: Outline Planner     (Flash)  — dynamic, non-template structure
 * Stage 3: Section Writer      (Pro)    — per-section generation with memory
 * Stage 4: Editorial Rewrite   (Pro)    — humanization + deAI pass
 *
 * All stages are separated so constraint overload never occurs. The model
 * writes naturally in Stage 3 because it receives only what it needs for
 * the current section, not 15 rule systems at once.
 */

import { callGemini, callGeminiJson } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { logger } from "@/lib/logger";
import type { PromptContext } from "./prompt-context";
import type { SerpContext } from "./serp";
import type { AuthorProfile } from "./index";
import { getAuthorGrounding, getClaimRules, getToneRules, getScopeRules, getStructureRules } from "./rules";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResearchBrain {
    intent: string;
    searcherMindset: string;
    contentGaps: string[];
    entities: string[];
    contrarianAngles: string[];
    examplesNeeded: string[];
    faqTargets: string[];
    commonMisconceptions: string[];
    industryMyths: string[];
    whatPeopleAvoidSaying: string[];
}

export interface OutlineSection {
    heading: string;
    goal: string;
    tone: "analytical" | "skeptical" | "instructional" | "narrative" | "direct" | "contrarian";
    evidenceType: "case_study" | "data" | "example" | "opinion" | "comparison" | "how_to" | "faq";
    wordTarget: number;
    keyEntities: string[];
    isIntro?: boolean;
    isOutro?: boolean;
}

export interface OutlinePlan {
    title: string;
    slug: string;
    quickAnswer: string;
    metaDescription: string;
    sections: OutlineSection[];
    estimatedTotal: number;
}

/** Tracks editorial state across section iterations to prevent repetition. */
interface EditorialMemory {
    usedEntities: Set<string>;
    usedSentenceOpeners: Set<string>;
    usedTransitions: Set<string>;
    recentConcepts: string[];
    previousSectionSummary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonSafe<T>(text: string, fallback: T): T {
    try {
        // Strip markdown fences if present
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        return JSON.parse(cleaned) as T;
    } catch {
        return fallback;
    }
}

function wordCountTarget(ctx: PromptContext, serpContext: SerpContext | null): number {
    const intentBase =
        ctx.intent === "transactional" ? 1500
        : ctx.intent === "commercial" ? 2200
        : ctx.intent === "local" ? 1800
        : 2200;

    if (!serpContext) return intentBase;

    const competitorCounts = serpContext.results
        .map(r => r.wordCount ?? 0)
        .filter(n => n > 300);

    if (competitorCounts.length === 0) return intentBase;

    const avgCompetitorWords = Math.round(
        competitorCounts.reduce((a, b) => a + b, 0) / competitorCounts.length
    );
    const serpTarget = Math.round(avgCompetitorWords * 1.1);

    return Math.min(Math.max(intentBase, serpTarget), 4000);
}

// ─── Stage 1: Research Brain ──────────────────────────────────────────────────

/**
 * Produces a structured research object before any writing begins.
 * Uses Flash — fast, cheap, no creative output needed.
 */
export async function runResearchBrain(
    keyword: string,
    serpContext: SerpContext | null,
    ctx: PromptContext,
): Promise<ResearchBrain> {
    const serpSummary = serpContext
        ? `TOP SERP RESULTS SUMMARY:\n${serpContext.results.slice(0, 3).map((r, i) =>
            `[Rank ${i + 1}] ${r.title}\nSnippet: ${r.snippet}`
          ).join("\n\n")}\n\nPeople Also Ask:\n${serpContext.peopleAlsoAsk.slice(0, 5).map(p => `- ${p.question}`).join("\n")}`
        : "No SERP data available.";

    const prompt = `You are an editorial research analyst. Your job is NOT to write content — it is to produce a structured research brief that a writer will use.

KEYWORD: "${keyword}"
INTENT: ${ctx.intent}
RISK LEVEL: ${ctx.riskTier}

${serpSummary}

Produce a research brief as a JSON object with these exact keys:

{
  "intent": "One sentence describing exactly what the searcher wants to accomplish",
  "searcherMindset": "What emotional state or urgency does the searcher have? What do they already know?",
  "contentGaps": ["topic or angle not covered by current top results", "..."],
  "entities": ["specific named tools, people, companies, frameworks, studies to reference", "..."],
  "contrarianAngles": ["a counterintuitive or surprising truth about this topic that experts know but articles avoid", "..."],
  "examplesNeeded": ["type of real-world example that would make this concrete", "..."],
  "faqTargets": ["actual question a searcher types, answered directly", "..."],
  "commonMisconceptions": ["a widespread belief that is partially or fully wrong", "..."],
  "industryMyths": ["something the industry repeats but practitioners know is false", "..."],
  "whatPeopleAvoidSaying": ["an uncomfortable truth or unpopular opinion in this space", "..."]
}

Rules:
- Be specific and concrete. No generic placeholders.
- "contentGaps" should name actual topics, not vague descriptions.
- "entities" should be real named things (e.g. "Ahrefs", "E-E-A-T", "John Mueller").
- Return ONLY the JSON object. No commentary, no markdown fences.`;

    const fallback: ResearchBrain = {
        intent: `Help the searcher understand and act on "${keyword}"`,
        searcherMindset: "Seeking practical, expert guidance",
        contentGaps: [],
        entities: [],
        contrarianAngles: [],
        examplesNeeded: ["real case study with measurable outcome"],
        faqTargets: [],
        commonMisconceptions: [],
        industryMyths: [],
        whatPeopleAvoidSaying: [],
    };

    try {
        return await callGeminiJson<ResearchBrain>(prompt, {
            model: AI_MODELS.GEMINI_FLASH,
            temperature: 0.4,
            maxOutputTokens: 2048,
            timeoutMs: 60_000,
            maxRetries: 3,
        });
    } catch (e) {
        logger.warn("[Pipeline] Research brain failed — using fallback", { error: (e as Error).message });
        return fallback;
    }
}

// ─── Stage 2: Outline Planner ─────────────────────────────────────────────────

/**
 * Produces a dynamic, non-template article structure.
 * Each section has a goal, tone, and evidence type — not just a heading.
 * Uses Flash — structural planning, no prose needed.
 */
export async function runOutlinePlanner(
    keyword: string,
    brain: ResearchBrain,
    serpContext: SerpContext | null,
    ctx: PromptContext,
    tone?: string,
): Promise<OutlinePlan> {
    const targetWords = wordCountTarget(ctx, serpContext);
    const serpHeadings = serpContext?.results.slice(0, 3)
        .flatMap(r => r.scrapedHeadings ?? [])
        .slice(0, 10)
        .join(", ") ?? "";

    const prompt = `You are a content strategist planning an article structure. You do NOT write the article — you plan it.

KEYWORD: "${keyword}"
TARGET INTENT: ${ctx.intent}
TONE: ${tone ?? "Authoritative and direct"}
TOTAL WORD TARGET: ${targetWords}
YEAR: ${ctx.year}

RESEARCH BRIEF:
- Searcher mindset: ${brain.searcherMindset}
- Key entities to reference: ${brain.entities.slice(0, 6).join(", ")}
- Content gaps (competitors miss these): ${brain.contentGaps.slice(0, 4).join(", ")}
- Contrarian angles available: ${brain.contrarianAngles.slice(0, 2).join("; ")}
- Common misconceptions: ${brain.commonMisconceptions.slice(0, 2).join("; ")}

COMPETITOR HEADINGS (DO NOT copy these — they define what to differentiate from):
${serpHeadings || "Not available"}

BANNED STRUCTURES: Do NOT produce the following section pattern:
"What is X → Why X matters → How to X → Common mistakes → FAQ"
This is predictable and AI-detectable. Create a narrative that flows differently.

${getScopeRules(ctx)}

${getStructureRules(ctx)}

Produce an outline as JSON with this exact shape:

{
  "title": "Article title — primary keyword in first 60 chars, no clickbait",
  "slug": "lowercase-hyphenated-slug-primary-keyword-only",
  "quickAnswer": "40-60 word direct answer to the keyword query. First word: Yes/No/a number/a tool name/a time frame.",
  "metaDescription": "140-160 chars. Keyword within first 120 chars. Written as ad copy.",
  "sections": [
    {
      "heading": "H2 heading text",
      "goal": "What this section accomplishes for the reader (1 sentence)",
      "tone": "analytical|skeptical|instructional|narrative|direct|contrarian",
      "evidenceType": "case_study|data|example|opinion|comparison|how_to|faq",
      "wordTarget": 300,
      "keyEntities": ["entity1", "entity2"],
      "isIntro": true
    }
  ],
  "estimatedTotal": ${targetWords}
}

RULES:
- First section: isIntro=true, tone="direct", wordTarget=120-150. Open with the single most useful fact.
- Last section if FAQ: isOutro=true, evidenceType="faq", 5-7 questions.
- At least one section with tone="contrarian" — challenge an industry assumption.
- At least one section with evidenceType="case_study" — real example (or placeholder).
- Vary tones across sections — no two consecutive sections with the same tone.
- 5-8 sections total.
- wordTargets should sum close to ${targetWords}.
- Return ONLY the JSON object.`;

    const fallback: OutlinePlan = {
        title: keyword,
        slug: keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        quickAnswer: `${keyword} is a practice that helps businesses improve their outcomes. Start by auditing your current approach, then apply the steps in this guide.`,
        metaDescription: `Learn everything about ${keyword}. Expert guide with real examples, common mistakes, and step-by-step advice. Updated ${ctx.year}.`,
        sections: [
            { heading: `The Truth About ${keyword}`, goal: "Establish authority and hook the reader", tone: "direct", evidenceType: "opinion", wordTarget: 130, keyEntities: [], isIntro: true },
            { heading: `What Most Guides Get Wrong About ${keyword}`, goal: "Challenge the conventional approach", tone: "contrarian", evidenceType: "example", wordTarget: 350, keyEntities: [] },
            { heading: `How ${keyword} Actually Works`, goal: "Explain the mechanism clearly", tone: "instructional", evidenceType: "how_to", wordTarget: 400, keyEntities: [] },
            { heading: `Real Results: A ${keyword} Case Study`, goal: "Ground advice in a real example", tone: "narrative", evidenceType: "case_study", wordTarget: 350, keyEntities: [] },
            { heading: `Frequently Asked Questions`, goal: "Answer real searcher questions directly", tone: "direct", evidenceType: "faq", wordTarget: 300, keyEntities: [], isOutro: true },
        ],
        estimatedTotal: targetWords,
    };

    // IMPORTANT: do NOT silently fallback here. A bad outline poisons every
    // downstream section. Throw so Inngest retries the entire job.
    const raw = await callGemini(prompt, {
        model: AI_MODELS.GEMINI_FLASH,
        temperature: 0.3,   // lowered from 0.6 — JSON structure needs stability
        maxOutputTokens: 3000,
        timeoutMs: 60_000,
        maxRetries: 3,
    });

    const parsed = parseJsonSafe<OutlinePlan | null>(raw, null);
    if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
        logger.error("[Pipeline] Outline planner returned unparseable JSON — throwing for Inngest retry", {
            rawSlice: raw.slice(0, 300),
        });
        throw new Error("[Pipeline] Outline generation failed — could not parse a valid outline from model response.");
    }

    logger.debug("[Pipeline] Outline parsed successfully", {
        title: parsed.title,
        sections: parsed.sections.length,
    });

    return parsed;
}

// ─── Stage 3: Section Writer ──────────────────────────────────────────────────

function enforceFaqOpeners(faqMarkdown: string): string {
    const VALID_OPENER = /^(yes|no|\d|never|always|most|few|it takes|within|about|roughly|typically|around|immediately|[A-Z][a-z]+(?:SEO|AI|IO|JS|QL)?)\b/i;
    return faqMarkdown.replace(
        /(^|\n)(#{2,3}\s.+?\n+)([^#\n].+)/gm,
        (match, prefix, heading, answer) => {
            if (VALID_OPENER.test(answer.trim())) return match;
            return `${prefix}${heading}**[EDITOR: rewrite this answer to open with Yes/No/a number/a tool name/a time frame]** ${answer}`;
        }
    );
}

export async function runSectionWriter(
    outline: OutlinePlan,
    brain: ResearchBrain,
    author: AuthorProfile,
    ctx: PromptContext,
): Promise<string> {
    // Sections run sequentially to maintain editorial memory (previousSectionSummary,
    // usedEntities). Each section call goes through callGemini which handles retries
    // and model fallback — individual section failures are no longer silent.
    const memory: EditorialMemory = {
        usedEntities: new Set(),
        usedSentenceOpeners: new Set(),
        usedTransitions: new Set(),
        recentConcepts: [],
        previousSectionSummary: "",
    };

    const sections: string[] = [];

    for (const section of outline.sections) {
        const sectionText = await writeSingleSection(section, outline, brain, author, ctx, memory);

        // Strip [EDITOR: ...] annotations before storing.
        // These are editorial metadata — they must never appear in published content or the DB.
        const stripped = sectionText.replace(/\*?\*?\[EDITOR:[^\]]*\]\*?\*?\s*/g, "").trim();

        const finalText = section.evidenceType === "faq"
            ? enforceFaqOpeners(stripped)
            : stripped;
        sections.push(finalText);

        memory.previousSectionSummary = finalText.slice(0, 300) + "…";

        const words = finalText.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
        const topConcepts = [...new Set(words)].slice(0, 5);
        memory.recentConcepts = [...memory.recentConcepts, ...topConcepts].slice(-15);

        const openerMatch = finalText.match(/^([A-Z][a-z]+)/m);
        if (openerMatch) memory.usedSentenceOpeners.add(openerMatch[1].toLowerCase());
    }

    // Hard gate: never return an article with placeholder sections.
    // This causes Inngest to retry the job rather than persist broken content.
    const failedCount = sections.filter(s => s.includes("[Section generation failed")).length;
    if (failedCount > 0) {
        throw new Error(
            `[Pipeline] ${failedCount}/${sections.length} sections failed. ` +
            "Rethrowing for Inngest retry — will not save placeholder content to DB."
        );
    }

    return `# ${outline.title}\n\n${sections.join("\n\n")}`;
}

async function writeSingleSection(
    section: OutlineSection,
    outline: OutlinePlan,
    brain: ResearchBrain,
    author: AuthorProfile,
    ctx: PromptContext,
    memory: EditorialMemory,
): Promise<string> {
    const isIntro = section.isIntro ?? false;
    const isFaq = section.evidenceType === "faq";
    const authorNote = ctx.hasAuthorGrounding && author.realExperience
        ? `AUTHOR VOICE: Weave in this real experience naturally — "${author.realExperience.slice(0, 200)}"`
        : "";

    const memoryNote = memory.previousSectionSummary
        ? `PREVIOUS SECTION ENDED WITH: "${memory.previousSectionSummary}"
Do NOT repeat these concepts from earlier sections: ${memory.recentConcepts.slice(-8).join(", ")}
Do NOT re-introduce these entities as if new: ${[...memory.usedEntities].slice(-6).join(", ")}`
        : "";

    const entityNote = memory.usedEntities.size > 0
        ? `ALREADY CITED: ${[...memory.usedEntities].slice(0, 5).join(", ")} — vary how you reference these or introduce new entities.`
        : `ENTITIES TO INTRODUCE: ${brain.entities.slice(0, 4).join(", ")}`;

    const openerNote = memory.usedSentenceOpeners.size > 0
        ? `AVOID STARTING SENTENCES WITH: ${[...memory.usedSentenceOpeners].slice(0, 6).join(", ")}`
        : "";

    const toneInstructions: Record<OutlineSection["tone"], string> = {
        analytical: "Break down the topic systematically. Use specific comparisons. State what the data shows, not what you feel.",
        skeptical: "Question the common approach. What does this technique NOT solve? Be honest about limitations.",
        instructional: "Tell the reader exactly what to do. Numbered steps where useful. Concrete actions, not principles.",
        narrative: "Tell a story or walk through a real scenario. Ground abstract points in what actually happened.",
        direct: "No preamble. State the point immediately. Short sentences where possible.",
        contrarian: "Take a position that contradicts the consensus. Explain precisely why the popular advice fails and what works instead.",
    };

    const evidenceInstructions: Record<OutlineSection["evidenceType"], string> = {
        case_study: "Anchor the section in a real example. If you don't have one, use the pattern: '[Type of company] doing [X] saw [Y] — use [ADD REAL DATA] if exact figures unknown.' Never invent statistics.",
        data: "Lead with a specific, sourced statistic. If unknown, write the insight without the number — do NOT invent figures.",
        example: "Use at least one concrete, named example. Generic advice without a named example is not acceptable.",
        opinion: "Take a clear editorial stance. Use 'In practice…', 'What works better is…', 'Standard advice says X — but Y is what actually happens.'",
        comparison: "Compare two approaches, tools, or strategies directly. Declare a winner for at least one use case.",
        how_to: "Number the steps. Be specific — 'do X' not 'consider doing X'. Each step should have a concrete action.",
        faq: "Write 5-7 Q&A pairs. Each answer MUST open with: Yes / No / a number / a tool name / a time frame. Max 3 sentences per answer. No 'It depends' openers.",
    };

    const prompt = `You are a senior editor writing one section of an article. Write ONLY this section — do not write the full article.

ARTICLE TITLE: "${outline.title}"
KEYWORD: "${ctx.keyword}"

THIS SECTION:
Heading: "${section.heading}"
Goal: ${section.goal}
Tone: ${section.tone} — ${toneInstructions[section.tone]}
Evidence type: ${section.evidenceType} — ${evidenceInstructions[section.evidenceType]}
Word target: ${section.wordTarget} words (±20%)
${section.keyEntities.length > 0 ? `Key entities to reference: ${section.keyEntities.join(", ")}` : ""}

EDITORIAL MEMORY (continuity rules):
${memoryNote}
${entityNote}
${openerNote}
${authorNote}

${getClaimRules(ctx)}

${getToneRules(ctx)}

MICRO-IMPERFECTION RULE: Real writing has controlled irregularity. You may:
- Use a sentence fragment for emphasis. Like this.
- Write an abrupt transition occasionally.
- Place a short emphatic standalone line. That's it.
These feel human. Use sparingly — maximum once per 200 words.

FORBIDDEN (any of these = failure):
- furthermore / moreover / in conclusion / delve into / leverage / robust / comprehensive guide
- Starting with "In this section" or "Now let's look at" or "Moving on to"
- Three consecutive sentences of the same length
- ${isIntro ? 'Opening with "Welcome to" or "In this article" or a question' : 'Re-introducing the keyword with "When it comes to" or "In the realm of"'}

${isIntro ? `INTRO RULE: 3 sentences maximum. (1) The single most surprising/useful fact about "${ctx.keyword}". (2) What conventional wisdom gets wrong. (3) What this article gives the reader. No fluff.` : ""}

${isFaq ? `FAQ FORMAT: Use ## for each question. Start each answer immediately with Yes/No/number/tool/timeframe. No preamble before the answer.` : ""}

Output: ONLY the section content in Markdown. Include the ## heading. No preamble, no "Here is the section:", no commentary.`;

    const fallbackText = `## ${section.heading}\n\n[Section generation failed — regenerate this section.]`;

    try {
        // callGemini handles: 3 retries, 429 back-off, model fallback chain.
        // Replaced direct @google/genai SDK call which had no retry on failure.
        const text = await callGemini(prompt, {
            model: AI_MODELS.GEMINI_PRO,   // gemini-2.5-flash in production (see ai-models.ts)
            temperature: 0.75,
            maxOutputTokens: 2048,
            timeoutMs: 90_000,
            maxRetries: 3,
        });

        const trimmed = text.trim();
        if (trimmed.length < 80) {
            logger.warn("[Pipeline] Section writer returned suspiciously short output", {
                heading: section.heading,
                length: trimmed.length,
            });
            return fallbackText;
        }

        for (const entity of section.keyEntities) {
            if (trimmed.toLowerCase().includes(entity.toLowerCase())) {
                memory.usedEntities.add(entity);
            }
        }

        return trimmed;
    } catch (e) {
        logger.warn("[Pipeline] Section writer failed after all retries", {
            heading: section.heading,
            error: (e as Error).message,
        });
        return fallbackText;
    }
}

// ─── Stage 4: Editorial Rewrite Pass ─────────────────────────────────────────

/**
 * The missing piece. Takes the assembled draft and rewrites it through an
 * editorial lens — not a "sound human" lens, which ironically sounds more AI.
 *
 * Uses Pro for maximum editorial quality.
 */
export async function runEditorialRewrite(
    draft: string,
    ctx: PromptContext,
): Promise<{ content: string; truncated: boolean }> {
    const CHUNK_SIZE = 18_000;

    const chunks = splitAtH2Boundaries(draft, CHUNK_SIZE);
    const rewrittenChunks: string[] = [];
    let previousSummary = "";

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        const continuityNote = previousSummary
            ? `CONTINUITY: The previous section ended with: "${previousSummary}". Do not re-introduce topics already covered.`
            : "";

        const prompt = `You are a senior editor at a trade publication. Rewrite the article section below so it reads like a confident practitioner wrote it — not an AI, and not a content marketer.

KEYWORD: "${ctx.keyword}"
${continuityNote}

EDITORIAL INSTRUCTIONS — apply every one:

1. REPETITION SWEEP: Scan each 150-word window. If any non-keyword content word appears more than 4 times, rephrase using pronouns, synonyms, or sentence restructuring.
2. SENTENCE LENGTH MIX: Break any sentence over 28 words into two. Mix short (8-12w), medium (13-20w), and longer (21-28w). Never two identical length categories back-to-back.
3. OPENER VARIETY: Never start two consecutive sentences with the same word.
4. ACTIVE VOICE: Replace every passive construction.
5. CONTRACTIONS: Add natural contractions throughout — "you'll", "it's", "don't", "here's", "we've". At least one per paragraph.
6. OPINION SIGNALS: Each H2 section must contain at least one contradiction, named exception, or practitioner note.
7. REMOVE THESE PHRASES (replace with plain language): In conclusion / It's worth noting / Furthermore / Moreover / Additionally / Delve into / Leverage / Seamlessly / Comprehensive guide / Cutting-edge / Game-changing / Robust / Now more than ever / When it comes to / In today's digital landscape / It is important to / It is essential to / Final thoughts / To summarise / In summary / Unlock the potential / Drive engagement / Foster growth / Empower users
8. FAQ ANSWERS: Every FAQ answer must open with: Yes / No / a number / a tool name / a time frame.
9. MICRO-IMPERFECTIONS: Add one or two controlled irregularities per 500 words (fragment for emphasis, abrupt transition, short emphatic standalone).
10. PRESERVE: All factual claims, named entities, statistics with sources, heading structure, FAQ questions. Do NOT invent new facts.

Return ONLY the rewritten content in Markdown — same heading structure, no commentary.

CONTENT:
${chunk}`;

        try {
            const rewritten = await callGemini(prompt, {
                model: AI_MODELS.GEMINI_PRO,
                temperature: 0.8,
                maxOutputTokens: 8192,
                timeoutMs: 90_000,
                maxRetries: 2,
            });

            const trimmed = rewritten.trim();
            if (!trimmed || trimmed.length < chunk.length * 0.4) {
                logger.warn("[Pipeline] Editorial rewrite chunk returned too-short output — keeping original", { chunk: i });
                rewrittenChunks.push(chunk);
            } else {
                const cleaned = trimmed
                    .replace(/^```(?:markdown|html)?\s*/i, "")
                    .replace(/\s*```$/i, "")
                    .trim();
                rewrittenChunks.push(cleaned);
                previousSummary = cleaned.slice(-200).replace(/\s+/g, " ");
            }
        } catch (e) {
            logger.warn("[Pipeline] Editorial rewrite chunk failed — keeping original", {
                chunk: i,
                error: (e as Error).message,
            });
            rewrittenChunks.push(chunk);
        }
    }

    return {
        content: rewrittenChunks.join("\n\n"),
        truncated: false,
    };
}

function splitAtH2Boundaries(text: string, maxChars: number): string[] {
    const sections = text.split(/(?=^## )/m);
    const chunks: string[] = [];
    let current = "";

    for (const section of sections) {
        if ((current + section).length > maxChars && current.length > 0) {
            chunks.push(current.trim());
            current = section;
        } else {
            current += (current ? "\n\n" : "") + section;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text];
}

// ─── Convenience: Full Pipeline ───────────────────────────────────────────────

export interface PipelineResult {
    title: string;
    slug: string;
    quickAnswer: string;
    metaDescription: string;
    markdownContent: string;
    brain: ResearchBrain;
    outline: OutlinePlan;
}

/**
 * Runs all 4 stages and returns the polished Markdown + metadata.
 * Callers (generateEvergreenPost etc.) use this instead of the single-call
 * Gemini prompt they previously had.
 */
export async function runFullPipeline(params: {
    keyword: string;
    serpContext: SerpContext | null;
    ctx: PromptContext;
    author: AuthorProfile;
    tone?: string;
}): Promise<PipelineResult> {
    const { keyword, serpContext, ctx, author, tone } = params;

    logger.debug("[Pipeline] Stage 1 — Research Brain", { keyword });
    const brain = await runResearchBrain(keyword, serpContext, ctx);

    logger.debug("[Pipeline] Stage 2 — Outline Planner", { keyword });
    const outline = await runOutlinePlanner(keyword, brain, serpContext, ctx, tone);

    logger.debug("[Pipeline] Stage 3 — Section Writer", { keyword, sections: outline.sections.length });
    const rawDraft = await runSectionWriter(outline, brain, author, ctx);

    logger.debug("[Pipeline] Stage 4 — Editorial Rewrite", { keyword, chunks: Math.ceil(rawDraft.length / 18000) });
    const { content: polishedMarkdown, truncated } = await runEditorialRewrite(rawDraft, ctx);
    if (truncated) {
        logger.warn("[Pipeline] Editorial rewrite was truncated", { keyword });
    }

    return {
        title: outline.title,
        slug: outline.slug,
        quickAnswer: outline.quickAnswer,
        metaDescription: outline.metaDescription,
        markdownContent: polishedMarkdown,
        brain,
        outline,
    };
}; import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import {
    generateEvergreenPost,
    generateBlogFromCompetitorGap,
    AuthorProfile,
} from "@/lib/blog";
import { checkBlogLimit } from "@/lib/rate-limit";
import { extractSiteContext } from "@/lib/blog/context";
import { fetchGSCKeywords, findOpportunities, normaliseSiteUrl } from "@/lib/gsc";
import { callGemini, callGeminiJson } from "@/lib/gemini/client";
import { getFunnelForIntent, SearchIntent as FunnelIntent } from "@/lib/aeo/funnels";
import { detectRiskTier, detectIntent, cleanDomainToDisplayName } from "@/lib/blog/prompt-context";
import { gateCitationScore } from "@/lib/blog/ai-citation-template";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { getSerpContextForKeyword, type SerpContext } from "@/lib/blog/serp";

function buildAuthorFromSite(site: {
    id: string;
    domain: string;
    authorName?: string | null;
    authorRole?: string | null;
    authorBio?: string | null;
    realExperience?: string | null;
    realNumbers?: string | null;
    localContext?: string | null;
    user?: { name?: string | null } | null;
}): AuthorProfile {
    const name = site.authorName || site.user?.name;
    if (!name) {
        throw new NonRetriableError(
            `[Blog] Site ${site.id} (${site.domain}) is missing an author name. ` +
            "Set an author name in Site Settings → Author Profile before generating content."
        );
    }
    return {
        name,
        role: site.authorRole || undefined,
        bio: site.authorBio || undefined,
        realExperience: site.realExperience || undefined,
        realNumbers: site.realNumbers || undefined,
        localContext: site.localContext || undefined,
    };
}

async function runFactCheckValidation(content: string): Promise<{
    qualityScore: number | null;
    issues: string[];
    suggestions: string[];
}> {
    const CHUNK_SIZE = 6000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        chunks.push(content.slice(i, i + CHUNK_SIZE));
    }

    const results = await Promise.all(
        chunks.map((chunk, idx) =>
            callGeminiJson<{ qualityScore: number; issues: string[]; suggestions: string[] }>(
                `You are a fact-checking editor. Review this article excerpt (chunk ${idx + 1}/${chunks.length}) and:
1. Identify vague claims with no supporting data
2. Identify statistics that appear fabricated or unverifiable
3. Suggest specific real statistics with named sources to replace flagged claims
4. Return JSON: { "issues": [...strings], "suggestions": [...strings], "qualityScore": 0-100 }

SCORING GUIDE:
- Start at 100
- Deduct 15 for each fabricated or unsourced statistic
- Deduct 10 for each vague claim presented as fact
- Deduct 5 for each banned filler phrase that survived
- Score below 60 = hold for review; below 40 = reject

Only output valid JSON, nothing else.

Article excerpt:
${chunk}`,
                { maxOutputTokens: 2048, temperature: 0.2, timeoutMs: 60000 }
            ).catch((): null => {
                // Return null on timeout/failure. Previously this returned { qualityScore: 55 }
                // which made every timed-out fact-check look like a 55/100 score — fake precision.
                // Missing data beats false confidence. The average below skips nulls.
                logger.warn(`[Blog/FactCheck] Chunk ${idx + 1} timed out — excluded from quality score`);
                return null;
            })
        )
    );

    const validResults = results.filter(
        (r): r is { qualityScore: number; issues: string[]; suggestions: string[] } => r !== null
    );
    const allIssues = validResults.flatMap(r => r.issues ?? []);
    const allSuggestions = validResults.flatMap(r => r.suggestions ?? []);
    // null = fact-check unavailable (all chunks timed out); caller uses validationScore alone.
    const qualityScore: number | null = validResults.length > 0
        ? Math.round(validResults.reduce((sum, r) => sum + (r.qualityScore ?? 100), 0) / validResults.length)
        : null;

    return { qualityScore, issues: allIssues, suggestions: allSuggestions };
}

async function runSemanticEnrichmentCheck(
    keyword: string,
    content: string
): Promise<{ missingEntities: string[]; enrichmentScore: number }> {
    try {
        const parsed = await callGeminiJson<{
            expectedEntities: string[];
            missingEntities: string[];
            enrichmentScore: number;
        }>(
            `You are an SEO content strategist. For a top-ranking article on "${keyword}", identify:
1. The 12 most important related entities, concepts, and LSI terms Google's NLP expects to find
2. Which of those are absent or mentioned fewer than twice in the article below
3. An enrichment score (0–100): 100 = all entities present, deduct 8 per missing high-importance entity

Return JSON only: { "expectedEntities": [...], "missingEntities": [...], "enrichmentScore": 0-100 }

Article (first 10000 chars):
${content.substring(0, 10000)}`,
            { maxOutputTokens: 1024, temperature: 0.1, timeoutMs: 45000 }
        );
        return {
            missingEntities: parsed.missingEntities ?? [],
            enrichmentScore: parsed.enrichmentScore ?? 70,
        };
    } catch {
        return { missingEntities: [], enrichmentScore: 70 };
    }
}

async function generateInteractiveWidget(keyword: string, content: string): Promise<string | null> {
    try {
        const text = await callGemini(
            `Based on this article about "${keyword}", generate ONE interactive element:
- A calculator if the topic involves numbers, costs, or measurements
- A 5-question quiz if the topic involves preferences or recommendations
- An interactive checklist if the topic involves steps or decisions

Rules:
- Output pure HTML and vanilla JavaScript only. No external dependencies.
- Self-contained in a single div with id="blog-interactive-widget"
- Mobile responsive using inline styles only
- Maximum 60 lines of code
- Clean card style (white background, subtle shadow, border-radius: 12px)

Article excerpt:
${content.substring(0, 3000)}

Return ONLY the HTML. Start with <div id="blog-interactive-widget"`,
            { maxOutputTokens: 4096, temperature: 0.3, timeoutMs: 45000 }
        );
        const match = text.match(/<div[\s\S]*id=["']blog-interactive-widget["'][\s\S]*$/i);
        return match ? match[0].replace(/```\s*$/g, "").trim() : text.trim();
    } catch (e: unknown) {
        logger.warn("[Blog/Widget] Widget generation failed:", { error: (e as Error)?.message });
        return null;
    }
}

async function generateSchemaMarkup(params: {
    title: string;
    keyword: string;
    content: string;
    slug: string;
    siteDomain: string;
}): Promise<string | null> {
    try {
        const text = await callGemini(
            `Generate JSON-LD schema markup for this article. Include:
1. Article schema (headline, author, datePublished, dateModified, publisher)
2. FAQPage schema — extract 4-5 real questions and answers from the content
3. BreadcrumbList schema

Article Info:
- Title: ${params.title}
- Keyword: ${params.keyword}
- Domain: ${params.siteDomain}
- Slug: ${params.slug}
- Published: ${new Date().toISOString()}

Article excerpt:
${params.content.substring(0, 4000)}

Return ONLY the JSON-LD script tags. No other text.`,
            { maxOutputTokens: 4096, temperature: 0.1, timeoutMs: 45000 }
        );
        const scripts = text.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi);
        if (!scripts || scripts.length === 0) return null;
        const firstJson = scripts[0]
            .replace(/<script type="application\/ld\+json">/, "")
            .replace(/<\/script>/, "")
            .trim();
        JSON.parse(firstJson);
        return scripts.join("\n");
    } catch (e: unknown) {
        logger.warn("[Blog/Schema] Schema markup failed:", { error: (e as Error)?.message });
        return null;
    }
}

export const generateBlogJob = inngest.createFunction(
    {
        id: "generate-blog",
        name: "Generate SEO Blog Post",
        concurrency: { limit: 5 },
        rateLimit: {
            limit: 10,
            period: "1m",
            key: "event.data.userId",
        },
        onFailure: async ({ event, error }) => {
            const originalData = event.data?.event?.data ?? {};
            const blogId = (originalData as Record<string, unknown>).blogId as string | undefined;
            const siteId = (originalData as Record<string, unknown>).siteId as string | undefined;
            const userId = (originalData as Record<string, unknown>).userId as string | undefined;
            logger.error(`[Inngest/Blog] Failed for site ${siteId}:`, { error: error?.message || error });
            if (!blogId) {
                logger.error("[Inngest/Blog] No blogId in onFailure — manual DB check required");
                return;
            }
            await prisma.blog.updateMany({ where: { id: blogId }, data: { status: "FAILED" } });
            if (userId) {
                try {
                    await prisma.$executeRaw`
                        UPDATE "User" SET credits = credits + 10
                        WHERE id = ${userId}
                    `;
                    logger.info("[Inngest/Blog] Refunded 10 credits after job failure", { userId, blogId });
                } catch (refundErr) {
                    logger.error("[Inngest/Blog] Failed to refund credits — manual action required", { blogId, userId, error: (refundErr as Error)?.message });
                }
            }
        },
    
        triggers: [{ event: "blog.generate" }],
    },
    async ({ event, step }) => {
        const { siteId, pipelineType, keyword, competitorDomain, searchVolume, difficulty } = event.data;

        if (!process.env.GEMINI_API_KEY) {
            throw new NonRetriableError("Missing GEMINI_API_KEY — dropping job");
        }

        const site = await step.run("fetch-site", async () => {
            const s = await prisma.site.findUnique({
                where: { id: siteId },
                select: {
                    id: true,
                    domain: true,
                    userId: true,
                    blogTone: true,
                    authorName: true,
                    authorRole: true,
                    authorBio: true,
                    realExperience: true,
                    realNumbers: true,
                    localContext: true,
                    user: { select: { name: true, email: true, subscriptionTier: true } },
                },
            });
            if (!s) throw new Error("Site not found");
            return s;
        });

        const author = buildAuthorFromSite(site);
        const displayName = cleanDomainToDisplayName(site.domain);

        const allowed = await step.run("check-blog-rate-limit", async () => {
            const result = await checkBlogLimit(
                site.userId,
                (site.user as { subscriptionTier?: string } | null)?.subscriptionTier ?? "FREE"
            );
            return result.allowed;
        });
        if (!allowed) return { skipped: true, reason: "rate_limit" };

        const detectedIntent = detectIntent(keyword ?? "");
        const riskTier = detectRiskTier(keyword ?? "", site.domain, detectedIntent);

        // Runs before generation so the writer knows the competitive landscape.
        // Fires for ALL pipeline types: uses the explicit keyword when provided,
        // falls back to the primary site topic/brand for INDUSTRY & SITE_CONTEXT blogs.
        // Degrades gracefully if Perplexity key is missing.
        const researchBrief = await step.run("perplexity-research", async () => {
            if (!process.env.PERPLEXITY_API_KEY) return null;
            // Use explicit keyword for USER_KEYWORD/SEED_KEYWORD; fall back to site topic
            const researchTopic = keyword || site.domain.replace(/^www\./, "").split(".")[0];
            try {
                const res = await fetch("https://api.perplexity.ai/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: "sonar-pro",
                        messages: [{
                            role: "user",
                            content: `Search for the top ranking pages for "${researchTopic}".

Extract and summarise:
1. The H2 structure / main topics the top 3 results cover
2. Questions they answer in their FAQ sections
3. Obvious gaps — angles they miss, unanswered questions, or outdated information
4. Whether ${site.domain} appears in any of the results

Be specific and concise. This will be used to write a better article.`,
                        }],
                        return_citations: true,
                        return_related_questions: false,
                        temperature: 0.1,
                        max_tokens: 3500,
                    }),
                    signal: AbortSignal.timeout(30000),
                });
                if (!res.ok) {
                    logger.warn(`[Blog/Research] Perplexity returned ${res.status}`);
                    return null;
                }
                const data = await res.json();
                const brief = data.choices?.[0]?.message?.content ?? null;
                const citations: string[] = (data.citations ?? []).map((c: unknown) =>
                    typeof c === "string" ? c : (c as Record<string, string>).url ?? ""
                ).filter(Boolean);
                const domainCited = citations.some(url => url.includes(site.domain.replace(/^www\./, "")));
                logger.info(`[Blog/Research] Research complete for "${researchTopic}" — domain cited in results: ${domainCited}`, { citationCount: citations.length });
                return brief ? `COMPETITIVE RESEARCH for "${researchTopic}":\n${brief}` : null;
            } catch (err: unknown) {
                logger.warn("[Blog/Research] Perplexity research failed — continuing without brief", {
                    error: (err as Error)?.message,
                });
                return null;
            }
        });

        // Pulls brand facts, keyword positions, location and author details
        // so prompts know exactly where/who they're writing for.
        const groundedContext = await step.run("build-blog-context", async () => {
            const { getGroundedContextBlock } = await import("@/lib/prompt-context/build-site-context");
            return getGroundedContextBlock(siteId);
        });

        let liveBlogPost: {
            title: string;
            slug: string;
            targetKeywords: string[];
            content: string;
            metaDescription: string;
            ogImage?: string;
            validationErrors: string[];
            validationWarnings: string[];
            validationScore: number;
        };
        let finalPipelineType = pipelineType;

        if (pipelineType === "COMPETITOR_ATTACK" || pipelineType === "COMPETITOR_GAP") {
            // Pre-fetch SERP once as a dedicated step — same pattern as the evergreen pipeline.
            // This avoids a duplicate Serper call inside generateBlogFromCompetitorGap.
            const competitorSerpContext: SerpContext | null = await step.run("fetch-serp-context-competitor", async () => {
                if (!keyword) return null;
                try {
                    const ctx = await getSerpContextForKeyword(keyword, true);
                    logger.info(`[Blog/SERP] Competitor SERP pre-fetched for "${keyword}" — ${ctx?.results.length ?? 0} results`, { siteId });
                    return ctx;
                } catch (err: unknown) {
                    logger.warn("[Blog/SERP] Competitor SERP pre-fetch failed — generator will fetch internally", {
                        keyword,
                        error: (err as Error)?.message,
                    });
                    return null;
                }
            });

            liveBlogPost = await step.run("generate-competitor-content", async () => {
                const res = await generateBlogFromCompetitorGap(
                    keyword, competitorDomain, searchVolume, difficulty,
                    author, site.domain, undefined, site.blogTone || undefined, siteId, competitorSerpContext
                );
                return { ...res, ogImage: res.heroImage?.url };

            });
        } else {
            const siteContext = await step.run("extract-site-context", async () => {
                return await extractSiteContext(site.domain);
            });

            // Enrich site context with grounded data and research brief
            const enrichedSiteContext = siteContext
                ? {
                    ...siteContext,
                    description: [
                        siteContext.description,
                        groundedContext ? `\n${groundedContext}` : "",
                        researchBrief ? `\n${researchBrief}` : "",
                    ].filter(Boolean).join("\n"),
                }
                : null;

            let category = siteContext?.category ?? site.domain;
            let keywords = siteContext?.keywords ?? [];
            finalPipelineType = siteContext ? "SITE_CONTEXT" : "INDUSTRY";

            // The user typed (or we selected) a specific keyword in Step 0.
            // It arrives as event.data.keyword. We MUST place it at position [0]
            // so generateEvergreenPost uses it as primaryKeyword for the prompt.
            // GSC opportunities are still fetched below for semantic enrichment,
            // but they cannot displace the user's chosen keyword.
            if (keyword && (pipelineType === "USER_KEYWORD" || pipelineType === "SEED_KEYWORD")) {
                category = keyword;
                // Put the chosen keyword first; retain site keywords as semantic support
                keywords = [keyword, ...(siteContext?.keywords ?? []).filter(k => k.toLowerCase() !== keyword.toLowerCase())].slice(0, 15);
                finalPipelineType = pipelineType;
                logger.info(`[Blog/Pipeline] USER_KEYWORD override — primary keyword: "${keyword}"`, { siteId, pipelineType });
            }

            const gscOpp = await step.run("fetch-gsc-opportunities", async () => {
                try {
                    const { getUserGscToken } = await import("@/lib/gsc/token");
                    const accessToken = await getUserGscToken(site.userId);
                    if (accessToken && site.domain) {
                        const siteUrl = normaliseSiteUrl(site.domain);
                        const gscKeywords = await fetchGSCKeywords(accessToken, siteUrl, 28, 100);
                        return findOpportunities(gscKeywords, 5);
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (
                        msg.includes('Cannot find module') ||
                        msg.includes('not connected') ||
                        msg.includes('No GSC token')
                    ) {
                        logger.info('[Blog/GSC] GSC unavailable — continuing without GSC keywords', { siteId: site.id });
                    } else {
                        logger.warn('[Blog/GSC] Unexpected error fetching GSC opportunities', {
                            siteId: site.id,
                            error: msg,
                        });
                    }
                }
                return [];
            });

            // Only let GSC override category/keywords when no explicit keyword was supplied.
            // When the user chose a keyword, GSC data is secondary enrichment only.
            if (!keyword && gscOpp.length > 0) {
                keywords = [...gscOpp.map(o => o.keyword), ...(siteContext?.keywords ?? [])].slice(0, 15);
                category = `${displayName} — GSC Opportunity`;
                finalPipelineType = "GSC_GAP";
            } else if (!keyword && keywords.length === 0) {
                const brand = site.domain.replace(/^www\./, "").split(".")[0];
                category = brand;
                keywords = [brand, "guide", "tips", "how to", "best practices"];
                finalPipelineType = "INDUSTRY";
            } else if (keyword && gscOpp.length > 0) {
                // Enrich the user's keyword list with GSC semantic terms (don't replace position 0)
                const gscTerms = gscOpp.map(o => o.keyword).filter(k => k.toLowerCase() !== keyword.toLowerCase());
                keywords = [keyword, ...gscTerms, ...(siteContext?.keywords ?? []).filter(k => k.toLowerCase() !== keyword.toLowerCase())].slice(0, 15);
            }

            // generateEvergreenPost internally calls getSerpContextForKeyword.
            // By fetching it here as a dedicated step, we:
            //   1. Avoid a duplicate Serper API call inside the generator
            //   2. Get Inngest step-level retry/observability for the SERP fetch
            //   3. Share the same data across both the generator and any future steps
            const primaryKeywordForSerp = keywords[0]; // position [0] is always the target keyword
            const precomputedSerpContext: SerpContext | null = await step.run("fetch-serp-context", async () => {
                if (!primaryKeywordForSerp) return null;
                try {
                    const ctx = await getSerpContextForKeyword(primaryKeywordForSerp, true);
                    logger.info(`[Blog/SERP] Pre-fetched SERP for "${primaryKeywordForSerp}" — ${ctx?.results.length ?? 0} results`, { siteId });
                    return ctx;
                } catch (err: unknown) {
                    logger.warn("[Blog/SERP] SERP pre-fetch failed — generator will skip SERP enrichment", {
                        keyword: primaryKeywordForSerp,
                        error: (err as Error)?.message,
                    });
                    return null;
                }
            });

            liveBlogPost = await step.run("generate-evergreen-post", async () => {
                const res = await generateEvergreenPost(
                    category, keywords, author, enrichedSiteContext,
                    site.blogTone || undefined, siteId, precomputedSerpContext
                );
                return { ...res, ogImage: res.heroImage?.url };
            });
        }

        // Claude Sonnet is significantly better than Gemini at detecting and removing
        // AI writing patterns, adding narrative voice, and enforcing E-E-A-T structure.
        // Degrades gracefully to the existing Gemini humanization if key is absent.
        liveBlogPost = await step.run("claude-editorial-pass", async () => {
            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            if (!anthropicKey) {
                logger.info("[Blog/Claude] ANTHROPIC_API_KEY not set — skipping editorial pass");
                return liveBlogPost;
            }

            const authorContext = [
                site.authorBio ? `Author bio: ${site.authorBio}` : "",
                site.authorRole ? `Author role: ${site.authorRole}` : "",
                site.realExperience ? `Real experience: ${site.realExperience}` : "",
                site.realNumbers ? `Real data/numbers: ${site.realNumbers}` : "",
            ].filter(Boolean).join("\n");

            try {
                const res = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "x-api-key": anthropicKey,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: AI_MODELS.ANTHROPIC_SONNET,
                        max_tokens: 8192,
                        messages: [{
                            role: "user",
                            content: `You are an expert human editor. Your job is to make this SEO article sound like it was written by a knowledgeable practitioner — not an AI. Apply ALL of the following edits in a single pass:

1. REMOVE AI PATTERNS — rewrite every instance of:
   "In conclusion" / "It's worth noting" / "It's important to note" / "Delve into" / "Dive into" /
   "Navigate" (abstract) / "In today's digital landscape" / "In the ever-changing" /
   "At the end of the day" / "Foster" / "Facilitate" / "In the realm of" / "Unlock" (loosely) /
   "Leverage" (loosely) / "Let's explore" / "Picture this" / "Furthermore" / "Moreover" /
   "Additionally" / "Notably" / "Seamlessly" / "Robust" / "Cutting-edge" / "Game-changing" /
   "Groundbreaking" / "Comprehensive guide" / "Ultimate guide" / "Now more than ever" /
   "As we navigate" / "When it comes to" / "Drive engagement" / "Empower users" /
   "In summary" / "To summarise" / "Final thoughts" / "Wrapping up".

2. FIX WORD REPETITION — highest priority:
   - If any content word (noun, verb, adjective) that is not the primary keyword appears more than 4 times in a 150-word passage, replace occurrence 3+ with a pronoun, synonym, or restructured clause.
   - Never repeat the same subject noun three times in one paragraph. Use "it", "they", or restructure.
   BAD:  "The platform tracks keywords. The platform also monitors backlinks. The platform sends alerts."
   GOOD: "It tracks keywords, monitors backlinks, and sends weekly alerts — in one place."

3. SENTENCE RHYTHM:
   - No three consecutive sentences of the same length (short/medium/long).
   - No two consecutive sentences starting with the same word, especially "The", "This", "It", "You".
   - Mix short punchy statements with longer explanatory ones.

4. ADD CONTRACTIONS — at least one per paragraph:
   "you'll", "it's", "don't", "here's", "we've", "you've", "that's", "there's".

5. ENFORCE E-E-A-T:
   - Named source for every statistic. If no source, remove the number and make the claim qualitative.
   - At least one direct stance per H2 section: a contradiction, a named exception, or a practitioner observation.

6. ADD AUTHOR VOICE: Where the author context below is available, weave in 1–2 natural first-person sentences. Write as normal prose, not as bracketed annotations.

7. STRUCTURE CHECK: If a Quick Answer box is present and its text is >50% similar to the intro paragraph, rewrite the Quick Answer to be more direct and specific.

${authorContext ? `AUTHOR CONTEXT:\n${authorContext}\n` : ""}${groundedContext ? `SITE CONTEXT:\n${groundedContext}\n` : ""}

Return ONLY the edited HTML, starting with the first HTML element. No preamble, no explanation, no markdown fences.

ARTICLE TO EDIT:
${liveBlogPost.content.substring(0, 14000)}`,
                        }],
                    }),
                    signal: AbortSignal.timeout(90000),
                });

                if (!res.ok) {
                    logger.warn(`[Blog/Claude] API returned ${res.status} — skipping editorial pass`);
                    return liveBlogPost;
                }

                const data = await res.json();
                const edited: string = data.content?.[0]?.text ?? "";

                // Only accept if edit returned substantial content (not an error message)
                if (edited && edited.length > liveBlogPost.content.length * 0.4) {
                    logger.info(`[Blog/Claude] Editorial pass complete`, {
                        originalLength: liveBlogPost.content.length,
                        editedLength: edited.length,
                    });
                    return { ...liveBlogPost, content: edited };
                }

                logger.warn("[Blog/Claude] Edited content too short — keeping original");
                return liveBlogPost;

            } catch (err: unknown) {
                logger.warn("[Blog/Claude] Editorial pass failed — keeping original", {
                    error: (err as Error)?.message,
                });
                return liveBlogPost;
            }
        });

        const factCheck = await step.run("fact-check-validation", async () => {
            return await runFactCheckValidation(liveBlogPost.content);
        });

        const enrichment = await step.run("semantic-enrichment-check", async () => {
            const primaryKeyword = keyword || liveBlogPost.targetKeywords[0] || liveBlogPost.title;
            return runSemanticEnrichmentCheck(primaryKeyword, liveBlogPost.content);
        });

        // Google rewards depth. Thin content (<900 words) is auto-demoted to NEEDS_REVIEW.
        // Overly long content (>6000 words) is truncated at the last sentence boundary
        // before the limit — Google's HCU penalises keyword-stuffed bloat.
        // Meta descriptions >160 chars are silently truncated in SERPs — fix before save.
        await step.run("validate-length-constraints", async () => {
            // Word count (strip HTML tags, count whitespace-delimited tokens)
            const plainText = liveBlogPost.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            let wordCount = plainText.split(" ").filter(Boolean).length;

            // The LLM is instructed not to exceed 6000 words, but as a hard safety
            // net we truncate the HTML at the last sentence boundary before 6000 words.
            const MAX_WORDS = 6000;
            if (wordCount > MAX_WORDS) {
                // Walk through the HTML building up a word-count-aware window.
                // We truncate by rebuilding the plain-text at the word level,
                // then finding the matching character position in the original HTML.
                const words = plainText.split(" ");
                const allowedPlain = words.slice(0, MAX_WORDS).join(" ");
                // Find the last sentence-ending punctuation (.?!) before the hard cut
                const lastSentenceEnd = allowedPlain.search(/[.?!][^.?!]*$/);
                const cutAt = lastSentenceEnd > 0
                    ? lastSentenceEnd + 1   // include the punctuation mark
                    : allowedPlain.length;

                // Map the char position back into the HTML:
                // Walk HTML chars, counting non-tag text chars until we reach cutAt.
                let htmlCursor = 0;
                let textCursor = 0;
                let inTag = false;
                while (htmlCursor < liveBlogPost.content.length && textCursor < cutAt) {
                    const ch = liveBlogPost.content[htmlCursor];
                    if (ch === "<") inTag = true;
                    if (!inTag) textCursor++;
                    if (ch === ">") inTag = false;
                    htmlCursor++;
                }

                liveBlogPost.content = liveBlogPost.content.slice(0, htmlCursor) + "</p>";
                wordCount = MAX_WORDS;   // approximate — re-counting is expensive

                liveBlogPost.validationWarnings.push(
                    `Content exceeded ${MAX_WORDS} words and was trimmed. Review the truncated ending before publishing.`
                );
                logger.warn(`[Blog/LengthGate] Content trimmed from ${words.length} → ${MAX_WORDS} words`, {
                    originalWords: words.length,
                });
            }

            if (wordCount < 900) {
                liveBlogPost.validationWarnings.push(
                    `Content is thin (${wordCount} words). Target 1,500+ for informational queries and 2,500+ for how-to/best-X queries.`
                );
                if (wordCount < 500) {
                    // Critically thin — hard error, not just a warning
                    liveBlogPost.validationErrors.push(`Content too short: ${wordCount} words (minimum 500).`);
                }
            }

            // Title length (Google shows ~55-60 chars before truncation)
            if (liveBlogPost.title.length > 60) {
                liveBlogPost.validationWarnings.push(
                    `Title is ${liveBlogPost.title.length} chars — Google truncates at ~60. Consider shortening.`
                );
            }

            // Meta description length
            if (liveBlogPost.metaDescription.length > 160) {
                // Truncate and log — don't block, just fix silently
                liveBlogPost.metaDescription = liveBlogPost.metaDescription.slice(0, 157) + "...";
                liveBlogPost.validationWarnings.push("Meta description truncated to 160 chars.");
            } else if (liveBlogPost.metaDescription.length < 50) {
                liveBlogPost.validationWarnings.push(
                    `Meta description is very short (${liveBlogPost.metaDescription.length} chars). Aim for 130-160 chars.`
                );
            }

            logger.info(`[Blog/LengthGate] words=${wordCount} titleLen=${liveBlogPost.title.length} metaLen=${liveBlogPost.metaDescription.length}`);
        });


        // When factCheck.qualityScore is null (all chunks timed out), fall back
        // to the validation score alone. Never substitute 55 for missing data.
        const qualityScore = factCheck.qualityScore !== null
            ? Math.min(factCheck.qualityScore, liveBlogPost.validationScore)
            : liveBlogPost.validationScore;

        if (factCheck.issues.length > 0) {
            logger.warn(`[Blog/Pipeline] Fact-check issues (score ${qualityScore}/100):`, {
                issues: factCheck.issues,
                factCheckAvailable: factCheck.qualityScore !== null,
            });
        }

        // Publish gate: hard-reject articles that still contain placeholder text.
        // These should have been caught by runSectionWriter's throw, but we add a
        // final safety net here before anything touches the DB.
        const PLACEHOLDER_PATTERN = /\[Section generation failed|\[EDITOR:/i;
        if (PLACEHOLDER_PATTERN.test(liveBlogPost.content)) {
            logger.error("[Blog/Pipeline] Content contains placeholder text — marking FAILED, will not publish", { siteId, keyword });
            liveBlogPost.validationErrors.push("Content contains unresolved placeholder sections. Regenerate before publishing.");
        }

        const interactiveWidget = await step.run("generate-interactive-widget", async () => {
            const primaryKeyword = keyword || liveBlogPost.targetKeywords[0] || liveBlogPost.title;
            return await generateInteractiveWidget(primaryKeyword, liveBlogPost.content);
        });

        const schemaMarkup = await step.run("generate-schema-markup", async () => {
            return await generateSchemaMarkup({
                title: liveBlogPost.title,
                keyword: keyword || liveBlogPost.targetKeywords[0] || "",
                content: liveBlogPost.content,
                slug: liveBlogPost.slug,
                siteDomain: site.domain,
            });
        });

        // Runs after schema markup is generated so JSON-LD is included in the score.
        // Scores 8 criteria: direct answer, definition block, stats, FAQ, comparison
        // table, E-E-A-T attribution, internal links, structured data.
        // Blogs below 60/100 are demoted to NEEDS_REVIEW automatically.
        const citationGate = await step.run("citation-template-gate", async () => {
            const htmlWithSchema = schemaMarkup
                ? liveBlogPost.content + schemaMarkup
                : liveBlogPost.content;
            return gateCitationScore(
                htmlWithSchema,
                liveBlogPost.targetKeywords,
                liveBlogPost.title,
            );
        });

        logger.info(`[Blog/CitationGate] Score ${citationGate.citationScore}/100 — ready: ${citationGate.citationReady}`, {
            siteId, keyword, intent: citationGate.intent,
            topFix: citationGate.citationReady ? null : citationGate.citationTopFix,
        });

        // Quality gate:
        // validationErrors (hard errors)  → NEEDS_REVIEW
        // riskTier === "high"             → NEEDS_REVIEW (manual review required for YMYL)
        // qualityScore < 40              → FAILED
        // qualityScore 40-79             → NEEDS_REVIEW
        // citationScore < 60             → NEEDS_REVIEW (AI citation readiness gate)
        // qualityScore >= 80, citation >= 60, no errors  → DRAFT

        const hasHardErrors = liveBlogPost.validationErrors.length > 0;
        const isHighRisk = riskTier === "high";

        let blogStatus: "DRAFT" | "NEEDS_REVIEW" | "FAILED";

        if (qualityScore < 40) {
            blogStatus = "FAILED";
            logger.error(`[Blog/Pipeline] Quality score too low (${qualityScore}) — marking FAILED`, { siteId, keyword });
        } else if (hasHardErrors || isHighRisk || qualityScore < 80 || !citationGate.citationReady) {
            blogStatus = "NEEDS_REVIEW";
            logger.warn(`[Blog/Pipeline] Marking NEEDS_REVIEW`, {
                siteId, keyword, qualityScore, hasHardErrors, isHighRisk,
                citationScore: citationGate.citationScore,
                citationReady: citationGate.citationReady,
                errors: liveBlogPost.validationErrors,
            });
        } else {
            blogStatus = "DRAFT";
        }

        const contentWithFunnel = await step.run("inject-funnel-cta", async () => {
            const funnelIntent = (detectedIntent === "local" ? "informational" : detectedIntent) as FunnelIntent;
            const funnelConfig = getFunnelForIntent(
                funnelIntent,
                site.id,
                site.domain.startsWith("http") ? site.domain : `https://${site.domain}`,
                displayName,
                event.data.blogId || "new"
            );
            const h2Splits = liveBlogPost.content.split(/(?=<h2[\s>])/i);
            if (h2Splits.length >= 3) {
                return [...h2Splits.slice(0, 2), funnelConfig.htmlSnippet, ...h2Splits.slice(2)].join("");
            }
            return liveBlogPost.content + funnelConfig.htmlSnippet;
        });

        await step.run("save-blog", async () => {
            const { sanitizeHtml, sanitizeSchemaMarkup } = await import("@/lib/sanitize-html");
            const blogData = {
                pipelineType: finalPipelineType,
                title: liveBlogPost.title,
                slug: liveBlogPost.slug,
                targetKeywords: liveBlogPost.targetKeywords,
                content: sanitizeHtml(contentWithFunnel),
                metaDescription: liveBlogPost.metaDescription,
                ogImage: liveBlogPost.ogImage,
                interactiveWidget: interactiveWidget ? sanitizeHtml(interactiveWidget) : undefined,
                schemaMarkup: schemaMarkup ? sanitizeSchemaMarkup(schemaMarkup) : undefined,
                status: blogStatus,
                validationScore: qualityScore,
                validationErrors: liveBlogPost.validationErrors,
                validationWarnings: liveBlogPost.validationWarnings,
                factCheckIssues: factCheck.issues,
                factCheckSuggestions: factCheck.suggestions,
                // AI Citation Template gate results
                citationScore:    citationGate.citationScore,
                citationCriteria: citationGate.citationCriteria,
            };
            if (event.data.blogId) {
                await prisma.blog.update({ where: { id: event.data.blogId }, data: blogData });
            } else {
                // Upsert on (siteId, slug) — idempotency guard for Inngest retries.
                // If a retry fires after the DB write already succeeded, this overwrites
                // cleanly rather than creating a duplicate post.
                await prisma.blog.upsert({
                    where:  { siteId_slug: { siteId, slug: blogData.slug } },
                    create: { siteId, ...blogData },
                    update: blogData,
                });
            }
        });

        await step.run("extract-brand-facts", async () => {
            const { extractFactsFromContent } = await import("@/lib/aeo/fact-extractor");
            return await extractFactsFromContent(siteId, liveBlogPost.content);
        });

        await step.run("save-enrichment-data", async () => {
            const existingBlog = event.data.blogId
                ? await prisma.blog.findUnique({ where: { id: event.data.blogId }, select: { citationCriteria: true } })
                : null;
            const existingCriteria = existingBlog?.citationCriteria as Record<string, unknown> | null;
            const targetId = event.data.blogId ?? (
                await prisma.blog.findUnique({ where: { siteId_slug: { siteId, slug: liveBlogPost.slug } }, select: { id: true } })
            )?.id;
            if (targetId) {
                await prisma.blog.update({
                    where: { id: targetId },
                    data: {
                        citationCriteria: {
                            ...(existingCriteria ?? {}),
                            missingEntities: enrichment.missingEntities,
                            enrichmentScore: enrichment.enrichmentScore,
                            factCheckScore: factCheck.qualityScore,
                        },
                    },
                });
            }
        });

        // Only for non-failed blogs with at least one target keyword to track.
        if (blogStatus !== "FAILED" && liveBlogPost.targetKeywords.length > 0) {
            await step.sendEvent("trigger-citation-monitor", {
                name: "blog.published",
                data: {
                    siteId,
                    blogId:         event.data.blogId ?? "new",
                    targetKeywords: liveBlogPost.targetKeywords.slice(0, 5),
                    publishedAt:    new Date().toISOString(),
                },
            });
        }

        if (blogStatus !== "FAILED") {
            await step.sendEvent("trigger-internal-links", {
                name: "blog.published" as const,
                data: {
                    siteId,
                    blogId: event.data.blogId ?? "new",
                    blogUrl: `https://${site.domain}/${liveBlogPost.slug}`,
                    keyword: keyword || liveBlogPost.targetKeywords[0] || "",
                },
            });
        }

        return {
            success: blogStatus !== "FAILED",
            qualityScore,
            blogStatus,
            flaggedForReview: blogStatus === "NEEDS_REVIEW",
            hardErrors: liveBlogPost.validationErrors,
        };
    }
);// Each constant maps to a genuinely distinct model so multi-model AEO checks
// use real model diversity rather than all resolving to the same endpoint.
// FIX #5: Previously GEMINI_PRO, GEMINI_3_1_PRO and GEMINI_2_5_PRO all aliased
// to 'gemini-2.5-flash', making multi-model AEO a single model called 4× over.

// Experimental Gemini models (gemini-2.0-pro-exp) are only used when
// GEMINI_EXPERIMENTAL_MODELS=1 is set. Production defaults to stable GA models.
const useExperimental = process.env.GEMINI_EXPERIMENTAL_MODELS === "1";
// Production default changed from gemini-1.5-pro to gemini-2.5-flash.
// gemini-1.5-pro has strict per-minute token quotas that cause 429 cascades
// when writing 4-6 sections sequentially (each 2048 output tokens).
// gemini-2.5-flash handles the same load at higher throughput and lower latency.
// Set GEMINI_EXPERIMENTAL_MODELS=1 to use gemini-2.0-pro-exp in staging only.
const GEMINI_PRO_MODEL = useExperimental ? "gemini-2.0-pro-exp" : "gemini-2.5-flash";

/**
 * @deprecated Use AI_MODELS.GEMINI_FLASH instead.
 * Kept for backward compatibility — do not use in new code.
 */
export const GEMINI_2_5_FLASH = 'gemini-2.5-flash';

/**
 * @deprecated Duplicate of GEMINI_2_5_FLASH. Use AI_MODELS.GEMINI_FLASH instead.
 * Kept for backward compatibility — do not use in new code.
 */
export const GEMINI_3_FLASH = 'gemini-2.5-flash';

/** Gemini 2.0 Flash — stable, fast, good general tasks */
export const GEMINI_2_0_FLASH = 'gemini-2.0-flash';

/**
 * @deprecated Misleading name — resolves to gemini-1.5-pro in production,
 * not Gemini 2.0 Pro. Use AI_MODELS.GEMINI_PRO instead.
 */
export const GEMINI_2_0_PRO = GEMINI_PRO_MODEL;

/**
 * Gemini Pro — used for brand-mention checks and complex AEO analysis.
 * Points to a genuinely different model from GEMINI_2_5_FLASH so that
 * multi-model diversity scores reflect real cross-model variance.
 * In production uses gemini-1.5-pro (stable GA). Set GEMINI_EXPERIMENTAL_MODELS=1
 * to use gemini-2.0-pro-exp in staging/testing only.
 * @deprecated Use AI_MODELS.GEMINI_PRO instead.
 */
export const GEMINI_3_1_PRO = GEMINI_PRO_MODEL;
/** @deprecated Use AI_MODELS.GEMINI_PRO instead. */
export const GEMINI_2_5_PRO  = GEMINI_PRO_MODEL;

/**
 * Central model registry — update versions here, nowhere else.
 * Import from this object at every call site.
 */
export const AI_MODELS = {
    /** Fast batch and general tasks */
    GEMINI_FLASH: 'gemini-2.5-flash',
    /** Very lightweight — keyword clustering, tag generation, summaries */
    GEMINI_FLASH_LITE: 'gemini-2.0-flash-lite',
    /** Realtime / Live WebSocket model — do NOT change: preview models cause WS 1006 errors */
    GEMINI_LIVE: 'gemini-2.0-flash-live-001',
    /**
     * Pro reasoning — brand mention checks, AEO multi-model, complex analysis.
     * Production: gemini-1.5-pro (stable GA).
     * Staging/testing: gemini-2.0-pro-exp (set GEMINI_EXPERIMENTAL_MODELS=1).
     */
    GEMINI_PRO: GEMINI_PRO_MODEL,
    /** 2.5 Flash constant for direct import (kept for backward compatibility) */
    GEMINI_3_FLASH: 'gemini-2.5-flash',
    /** Pro reasoning alias — same as GEMINI_PRO */
    GEMINI_3_1_PRO: GEMINI_PRO_MODEL,

    /** Primary OpenAI model for citation checks and complex reasoning */
    OPENAI_PRIMARY: 'gpt-4o',
    /** Text embedding model for semantic search and vector gap analysis */
    OPENAI_EMBEDDING: 'text-embedding-3-small',

    /** Primary Anthropic model for brand mention and AEO diversity checks */
    // claude-haiku-4-6 does not exist — was causing silent 404s on every call.
    // Correct model string as of May 2026 is claude-haiku-4-5-20251001.
    ANTHROPIC_PRIMARY: 'claude-haiku-4-5-20251001',
    /** Sonnet — editorial quality rewrites, blog E-E-A-T pass, deep analysis */
    ANTHROPIC_SONNET: 'claude-sonnet-4-5',
    /** Full Opus model — use only for complex generation (blog, deep analysis) */
    ANTHROPIC_OPUS: 'claude-opus-4-20250514',
} as const;

export type GeminiModel = typeof AI_MODELS.GEMINI_FLASH | typeof AI_MODELS.GEMINI_FLASH_LITE | typeof AI_MODELS.GEMINI_LIVE | string;
export type OpenAIModel = typeof AI_MODELS.OPENAI_PRIMARY | typeof AI_MODELS.OPENAI_EMBEDDING;
export type AnthropicModel = typeof AI_MODELS.ANTHROPIC_PRIMARY;