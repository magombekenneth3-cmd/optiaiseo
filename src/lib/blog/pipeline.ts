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
import { classifySerpFormat } from "./serp";
import type { AuthorProfile } from "./index";
import { getClaimRules, getToneRules, getScopeRules, getStructureRules } from "./rules";

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

    const avgWords = Math.round(competitorCounts.reduce((a, b) => a + b, 0) / competitorCounts.length);
    const maxWords = Math.max(...competitorCounts);

    // Beat the longest competitor, not just the average
    const serpTarget = Math.round(Math.max(avgWords * 1.2, maxWords + 300));

    return Math.min(Math.max(intentBase, serpTarget), 5500); // raised from 4000
}

/** Builds a full competitor depth benchmark string for the Outline Planner. */
function buildDepthBenchmark(serpContext: SerpContext | null): string {
    if (!serpContext) return "";
    const scraped = serpContext.results.filter(r => (r.wordCount ?? 0) > 500);
    if (scraped.length === 0) return "";

    const wordCounts = scraped.map(r => r.wordCount ?? 0);
    const avgWords = Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length);
    const maxWords = Math.max(...wordCounts);

    const coverageSummary = scraped.map((r, i) =>
        `Competitor ${i + 1} (${r.wordCount} words): ${(r.scrapedHeadings ?? []).slice(0, 6).join(" → ")}`
    ).join("\n");

    const allHeadings = scraped
        .flatMap((r, i) => (r.scrapedHeadings ?? []).map(h => `[C${i + 1}] ${h}`))
        .slice(0, 40);

    return `COMPETITOR DEPTH BENCHMARK (${scraped.length} full articles analysed):
- Average: ${avgWords} words | Longest: ${maxWords} words
- Your minimum target: ${Math.round(Math.max(avgWords * 1.2, maxWords))} words

SECTION STRUCTURE ACROSS ALL COMPETITORS:
${coverageSummary}

ALL HEADINGS IN USE (identify gaps — what none of them cover):
${allHeadings.join("\n")}

DEPTH RULE: Any topic competitors cover in 200 words, cover in 400.
Do not write a section that could be cut without the reader noticing.`;
}

/** Finds what competitors wrote on the specific subtopic of this section. */
function getCompetitorSectionContent(
    sectionHeading: string,
    serpContext: SerpContext | null
): string {
    if (!serpContext) return "";

    const headingWords = sectionHeading.toLowerCase()
        .split(/\s+/).filter(w => w.length > 3);

    const relevantExcerpts = serpContext.results
        .filter(r => r.scrapedContent && (r.wordCount ?? 0) > 500)
        .map((r, i) => {
            const paragraphs = r.scrapedContent!.split(/\n{2,}/);
            const relevant = paragraphs.find(p =>
                headingWords.some(w => p.toLowerCase().includes(w))
            );
            return relevant ? `[Competitor ${i + 1}]: ${relevant.slice(0, 600)}` : null;
        })
        .filter(Boolean)
        .slice(0, 3);

    if (relevantExcerpts.length === 0) return "";

    return `WHAT COMPETITORS WRITE ON THIS TOPIC (do not copy — go deeper):
${relevantExcerpts.join("\n\n")}

DEPTH RULE: Add something none of the above has — a specific named example,
a real number, a counterpoint, or a failure mode.`;
}

/** Fetches real facts from Serper for a section. Runs in parallel before writing starts. */
async function fetchSectionFacts(
    sectionHeading: string,
    keyword: string,
    evidenceType: OutlineSection["evidenceType"],
): Promise<string> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return "";

    const queryMap: Record<OutlineSection["evidenceType"], string> = {
        data:       `${sectionHeading} statistics data ${new Date().getFullYear()}`,
        case_study: `${sectionHeading} case study example results`,
        comparison: `${sectionHeading} comparison ${keyword}`,
        how_to:     `${sectionHeading} how to steps ${keyword}`,
        faq:        `${sectionHeading} ${keyword} common questions`,
        example:    `${sectionHeading} example ${keyword}`,
        opinion:    `${sectionHeading} ${keyword} expert opinion`,
    };

    try {
        const res = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: queryMap[evidenceType] ?? `${sectionHeading} ${keyword}`, num: 5 }),
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return "";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json();
        const facts: string[] = [];

        if (data.answerBox?.answer)  facts.push(`[Direct answer] ${data.answerBox.answer}`);
        if (data.answerBox?.snippet) facts.push(`[Google snippet] ${data.answerBox.snippet}`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.organic ?? []).slice(0, 4).map((r: any) => r.snippet)
            .filter((s: string) => s?.length > 60)
            .forEach((s: string, i: number) => facts.push(`[Source ${i + 1}] ${s}`));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.peopleAlsoAsk ?? []).slice(0, 3).forEach((p: any) => {
            if (p.snippet) facts.push(`[PAA] Q: ${p.question} → ${p.snippet}`);
        });

        if (facts.length === 0) return "";

        return `REAL FACTS — use at least 2 of these in the section:
${facts.join("\n")}

FACT RULES:
- If a fact contains a number (%, $, days, users), include it verbatim.
- Attribute naturally: "Research shows...", "According to [source type]..."
- Do NOT invent statistics not in this list. Write the insight without the number if you don’t have it.
- "Most teams see significant churn reduction" beats "63% of teams" when 63% is invented.`;
    } catch {
        return "";
    }
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
        ? `TOP SERP RESULTS:\n${serpContext.results.slice(0, 3).map((r, i) =>
            `[Rank ${i + 1}] ${r.title}\nSnippet: ${r.snippet}`
          ).join("\n\n")}\n\nPeople Also Ask (with current Google answers):\n${
            serpContext.peopleAlsoAsk.slice(0, 5).map(p =>
                `- Q: ${p.question}${p.answer ? `\n  Current answer: ${p.answer}` : ""}`
            ).join("\n")}`
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
    const depthBenchmark = buildDepthBenchmark(serpContext);
    const serpHeadings = serpContext?.results.slice(0, 3)
        .flatMap(r => r.scrapedHeadings ?? [])
        .slice(0, 10)
        .join(", ") ?? "";

    // Match the SERP format signal so structure aligns with what ranks
    const formatSignal = serpContext ? classifySerpFormat(serpContext.results) : null;
    const formatInstruction = formatSignal?.format === "listicle"
        ? "Structure must use a numbered list as the primary content vehicle — this SERP rewards lists."
        : formatSignal?.format === "comparison"
        ? "Include a direct comparison table — this SERP rewards comparative structure."
        : "";

    const gapSignal = serpContext
        ? `Table-stakes topics (every competitor covers these — you must too): ${
            serpContext.results.flatMap(r => r.scrapedHeadings ?? []).slice(0, 8).join(", ")}
Differentiation opportunities (none of them cover these well): ${brain.contentGaps.slice(0, 4).join(", ")}`
        : `Content gaps: ${brain.contentGaps.slice(0, 4).join(", ")}`;

    const prompt = `You are a content strategist planning an article structure. You do NOT write the article — you plan it.

KEYWORD: "${keyword}"
TARGET INTENT: ${ctx.intent}
TONE: ${tone ?? "Authoritative and direct"}
TOTAL WORD TARGET: ${targetWords}
YEAR: ${ctx.year}

${depthBenchmark}

RESEARCH BRIEF:
- Searcher mindset: ${brain.searcherMindset}
- Key entities to reference: ${brain.entities.slice(0, 6).join(", ")}
- ${gapSignal}
- Contrarian angles available: ${brain.contrarianAngles.slice(0, 2).join("; ")}
- Common misconceptions: ${brain.commonMisconceptions.slice(0, 2).join("; ")}

${formatInstruction}

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

    const raw = await callGemini(prompt, {
        model: AI_MODELS.GEMINI_FLASH,
        temperature: 0.3,
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
    serpContext: SerpContext | null,
): Promise<string> {
    // Pre-fetch all section facts in parallel before any writing starts
    logger.debug("[Pipeline] Pre-fetching section facts", { sections: outline.sections.length });
    const sectionFacts = await Promise.all(
        outline.sections.map(s =>
            fetchSectionFacts(s.heading, ctx.keyword, s.evidenceType).catch(() => "")
        )
    );

    const memory: EditorialMemory = {
        usedEntities: new Set(),
        usedSentenceOpeners: new Set(),
        usedTransitions: new Set(),
        recentConcepts: [],
        previousSectionSummary: "",
    };

    const sections: string[] = [];

    for (let i = 0; i < outline.sections.length; i++) {
        const section = outline.sections[i];
        const facts = sectionFacts[i] ?? "";
        const sectionText = await writeSingleSection(section, outline, brain, author, ctx, memory, serpContext, facts);

        const stripped = sectionText.replace(/\*?\*?\[EDITOR:[^\]]*\]\*?\*?\s*/g, "").trim();

        const finalText = section.evidenceType === "faq"
            ? enforceFaqOpeners(stripped)
            : stripped;
        sections.push(finalText);

        memory.previousSectionSummary = finalText.slice(0, 300) + "\u2026";
        const words = finalText.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
        const topConcepts = [...new Set(words)].slice(0, 5);
        memory.recentConcepts = [...memory.recentConcepts, ...topConcepts].slice(-15);
        const openerMatch = finalText.match(/^([A-Z][a-z]+)/m);
        if (openerMatch) memory.usedSentenceOpeners.add(openerMatch[1].toLowerCase());
    }

    const failedCount = sections.filter(s => s.includes("[Section generation failed")).length;
    if (failedCount > 0) {
        throw new Error(
            `[Pipeline] ${failedCount}/${sections.length} sections failed. ` +
            "Rethrowing for Inngest retry \u2014 will not save placeholder content to DB."
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
    serpContext: SerpContext | null,
    facts: string,
): Promise<string> {
    const isIntro = section.isIntro ?? false;
    const isFaq = section.evidenceType === "faq";

    const authorNote = author.realExperience
        ? `AUTHOR VOICE: Weave in naturally \u2014 "${author.realExperience.slice(0, 200)}"`
        : `EXPERIENCE SIGNAL: Include at least one "in practice" observation, a named failure mode,
or a scenario only someone who has actually done this would describe.
Generic advice without a grounding moment fails Google's E-E-A-T check.`;

    const memoryNote = memory.previousSectionSummary
        ? `PREVIOUS SECTION ENDED WITH: "${memory.previousSectionSummary}"
Do NOT repeat: ${memory.recentConcepts.slice(-8).join(", ")}
Do NOT re-introduce as new: ${[...memory.usedEntities].slice(-6).join(", ")}`
        : "";

    const entityNote = memory.usedEntities.size > 0
        ? `ALREADY CITED: ${[...memory.usedEntities].slice(0, 5).join(", ")} \u2014 vary references or introduce new ones.`
        : `ENTITIES TO INTRODUCE: ${brain.entities.slice(0, 4).join(", ")}`;

    const openerNote = memory.usedSentenceOpeners.size > 0
        ? `AVOID STARTING SENTENCES WITH: ${[...memory.usedSentenceOpeners].slice(0, 6).join(", ")}`
        : "";

    // Match PAA questions to this section's specific topic
    const relevantPAA = serpContext?.peopleAlsoAsk
        .filter(p => {
            const qWords = p.question.toLowerCase().split(/\s+/);
            const hWords = section.heading.toLowerCase().split(/\s+/);
            return qWords.some(w => hWords.includes(w) && w.length > 3);
        })
        .slice(0, 2) ?? [];

    const serpNote = serpContext ? `
SERP SIGNALS \u2014 write to beat what's ranking:
Featured snippet to beat: ${serpContext.featuredSnippet ?? "none"}
${relevantPAA.length > 0 ? `PAA questions to answer in this section:\n${relevantPAA.map(p =>
    `- ${p.question}\n  Current Google answer: ${p.answer ?? "not provided"}`
).join("\n")}` : ""}` : "";

    const competitorContext = getCompetitorSectionContent(section.heading, serpContext);

    const toneInstructions: Record<OutlineSection["tone"], string> = {
        analytical:    "Break down systematically. Use specific comparisons. State what data shows, not what you feel.",
        skeptical:     "Question the common approach. What does this NOT solve? Be honest about limitations.",
        instructional: "Tell the reader exactly what to do. Numbered steps where useful. Actions, not principles.",
        narrative:     "Tell a story or walk through a real scenario. Ground abstract points in what actually happened.",
        direct:        "No preamble. State the point immediately. Short sentences where possible.",
        contrarian:    "Take a position that contradicts consensus. Explain precisely why popular advice fails.",
    };

    const evidenceInstructions: Record<OutlineSection["evidenceType"], string> = {
        case_study: "Anchor in a real example. Pattern: '[Type of company] doing [X] saw [Y]'. Never invent statistics.",
        data:       "Lead with a specific statistic from the REAL FACTS below. If none fits, write the insight without a number.",
        example:    "Use at least one concrete, named example. Generic advice without a named example is not acceptable.",
        opinion:    "Take a clear editorial stance. 'In practice\u2026', 'What works better is\u2026'",
        comparison: "Compare two approaches or tools directly. Declare a winner for at least one use case.",
        how_to:     "Number the steps. Be specific \u2014 'do X' not 'consider doing X'.",
        faq:        "5-7 Q&A pairs. Each answer MUST open with: Yes / No / a number / a tool name / a time frame. Max 3 sentences.",
    };

    const prompt = `You are a senior editor writing one section of an article. Write ONLY this section.

ARTICLE TITLE: "${outline.title}"
KEYWORD: "${ctx.keyword}"

THIS SECTION:
Heading: "${section.heading}"
Goal: ${section.goal}
Tone: ${section.tone} \u2014 ${toneInstructions[section.tone]}
Evidence type: ${section.evidenceType} \u2014 ${evidenceInstructions[section.evidenceType]}
Word target: ${section.wordTarget} words (\u00b120%)
${section.keyEntities.length > 0 ? `Key entities: ${section.keyEntities.join(", ")}` : ""}
${serpNote}

${competitorContext}

${facts}

EDITORIAL MEMORY:
${memoryNote}
${entityNote}
${openerNote}
${authorNote}

${getClaimRules(ctx)}
${getToneRules(ctx)}

HUMAN WRITING RULES \u2014 this is what separates real writing from AI output:
- Vary sentence length deliberately. Short punches. Then a longer one that earns its length. Then short again.
- Imperfect transitions are fine: "Here's the thing.", "And that's where it breaks.", "Which sounds obvious. It isn't."
- Fragments work for emphasis. Like this. Use them.
- Vary paragraph length. Sometimes one sentence alone. Sometimes three or four build together.
- Avoid parallel sentence structure back to back \u2014 if two sentences open the same way, break the second.
- One moment of plain directness per section: "Don't do this.", "This is the part most people skip."
- Uncertainty is honest: "roughly", "in most cases", "typically" when you're not citing a specific number.

FRESHNESS: Reference what specifically changed or is different as of ${ctx.year}.

FACT HONESTY: If you don't have a specific number, write the insight without it.
"Most companies see significant churn reduction" beats "63% of companies" when 63% is invented.

FORBIDDEN:
- furthermore / moreover / in conclusion / delve into / leverage / robust / comprehensive
- "In this section" / "Now let's look at" / "Moving on to"
- Three consecutive sentences of the same length
- ${isIntro ? '"Welcome to" / "In this article" / opening with a question' : '"When it comes to" / "In the realm of"'}

${isIntro ? `INTRO RULE: 3 sentences max. (1) Most surprising/useful fact about "${ctx.keyword}". (2) What conventional wisdom gets wrong. (3) What the reader gets. No fluff.` : ""}
${isFaq ? `FAQ FORMAT: ## for each question. Answer opens immediately with Yes/No/number/tool/timeframe. No preamble. Max 3 sentences per answer.` : ""}

Output: ONLY the section in Markdown including the ## heading. No commentary.`;

    const fallbackText = `## ${section.heading}\n\n[Section generation failed \u2014 regenerate this section.]`;

    try {
        const text = await callGemini(prompt, {
            model: AI_MODELS.GEMINI_PRO,
            temperature: 0.75,
            maxOutputTokens: 3000,
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
    const rawDraft = await runSectionWriter(outline, brain, author, ctx, serpContext);

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
