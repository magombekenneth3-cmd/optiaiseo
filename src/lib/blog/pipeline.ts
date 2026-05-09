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

import { GoogleGenAI } from "@google/genai";
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

function getClient(): GoogleGenAI {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    return new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 120_000 } });
}

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
    const ai = getClient();

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
        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_FLASH,
            contents: prompt,
            config: { temperature: 0.4, maxOutputTokens: 2048 },
        });
        return parseJsonSafe<ResearchBrain>(response.text ?? "", fallback);
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
    const ai = getClient();

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

    try {
        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_FLASH,
            contents: prompt,
            config: { temperature: 0.6, maxOutputTokens: 3000 },
        });
        return parseJsonSafe<OutlinePlan>(response.text ?? "", fallback);
    } catch (e) {
        logger.warn("[Pipeline] Outline planner failed — using fallback", { error: (e as Error).message });
        return fallback;
    }
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
    const ai = getClient();
    const memory: EditorialMemory = {
        usedEntities: new Set(),
        usedSentenceOpeners: new Set(),
        usedTransitions: new Set(),
        recentConcepts: [],
        previousSectionSummary: "",
    };

    const sections: string[] = [];

    for (const section of outline.sections) {
        const sectionText = await writeSingleSection(ai, section, outline, brain, author, ctx, memory);
        const finalText = section.evidenceType === "faq"
            ? enforceFaqOpeners(sectionText)
            : sectionText;
        sections.push(finalText);

        // Update editorial memory
        memory.previousSectionSummary = sectionText.slice(0, 300) + "…";

        // Extract concepts from this section (naive but effective)
        const words = sectionText.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
        const topConcepts = [...new Set(words)].slice(0, 5);
        memory.recentConcepts = [...memory.recentConcepts, ...topConcepts].slice(-15);

        // Track opener words
        const openerMatch = sectionText.match(/^([A-Z][a-z]+)/m);
        if (openerMatch) memory.usedSentenceOpeners.add(openerMatch[1].toLowerCase());
    }

    // Assemble final Markdown
    return `# ${outline.title}\n\n${sections.join("\n\n")}`;
}

async function writeSingleSection(
    ai: GoogleGenAI,
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
        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_PRO,
            contents: prompt,
            config: { temperature: 0.75, maxOutputTokens: 2048 },
        });

        const text = response.text?.trim() ?? "";
        if (text.length < 80) return fallbackText;

        // Update entity memory from generated text
        for (const entity of section.keyEntities) {
            if (text.toLowerCase().includes(entity.toLowerCase())) {
                memory.usedEntities.add(entity);
            }
        }

        return text;
    } catch (e) {
        logger.warn("[Pipeline] Section writer failed", {
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
    const ai = getClient();
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
            const response = await ai.models.generateContent({
                model: AI_MODELS.GEMINI_PRO,
                contents: prompt,
                config: { temperature: 0.8, maxOutputTokens: 8192 },
            });
            const rewritten = response.text?.trim() ?? "";
            if (!rewritten || rewritten.length < chunk.length * 0.4) {
                logger.warn("[Pipeline] Editorial rewrite chunk returned too-short output — keeping original", { chunk: i });
                rewrittenChunks.push(chunk);
            } else {
                const cleaned = rewritten
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
}
