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

import { AI_MODELS } from "@/lib/constants/ai-models";
import { generateWithFallback, generateWithFallbackJson } from "./ai-client";
import { logger } from "@/lib/logger";
import type { PromptContext } from "./prompt-context";
import type { SerpContext } from "./serp";
import { classifySerpFormat } from "./serp";
import type { AuthorProfile } from "./index";
import { getClaimRules, getToneRules, getScopeRules, getStructureRules, getEvidenceRules, getEditorialPolicy } from "./rules";
import type { GroundedSiteContext } from "@/lib/prompt-context/build-site-context";
import { runInformationGainAlgorithm } from "./information-gain";
import { injectVisualEvidenceIntoBlog } from "./image-evidence";
import {
    type ResearchPacket,
    type SectionResearch,
    type QueryDecomposition,
    ResearchBrainSchema,
    OutlinePlanSchema,
} from "./contracts";
import { extractEvidencePacket } from "./evidence-extractor";
import {
    buildResearchPacket,
    buildSectionResearchMap,
    getVerifiedCaseStudyAvailability,
    renderSourceContext,
} from "./research-packet";

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
    informationGainDirective?: string;
    queryDecomposition?: QueryDecomposition;
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

function wordCountTarget(
    ctx: PromptContext,
    serpContext: SerpContext | null,
    brain: ResearchBrain,
): number {
    const base =
        ctx.intent === "transactional" ? 1400
        : ctx.intent === "commercial" ? 1900
        : ctx.intent === "local" ? 1600
        : 1800;

    const decomposition = brain.queryDecomposition;
    const questionCount = decomposition?.requiredQuestions?.length ?? serpContext?.peopleAlsoAsk.length ?? 0;
    const decisionCount = decomposition?.decisionCriteria?.length ?? 0;
    const comparisonCount = decomposition?.comparisonDimensions?.length ?? 0;
    const riskCount = decomposition?.risksAndExceptions?.length ?? 0;
    const gapCount = brain.contentGaps.length;
    const evidenceSections = serpContext?.results.length
        ? Math.min(3, serpContext.results.filter(result => (result.scrapedContent?.length ?? 0) > 1_000).length)
        : 0;

    const complexity =
        Math.min(questionCount, 8) * 90 +
        Math.min(decisionCount, 5) * 110 +
        Math.min(comparisonCount, 5) * 100 +
        Math.min(riskCount, 4) * 100 +
        Math.min(gapCount, 4) * 100 +
        evidenceSections * 120;

    const format = serpContext ? classifySerpFormat(serpContext.results).format : null;
    const formatAdjustment = format === "comparison" ? 250 : format === "listicle" ? 150 : 0;

    return Math.min(Math.max(base, base + complexity + formatAdjustment), 4800);
}

/** Builds a full competitor depth benchmark string for the Outline Planner. */
function buildDepthBenchmark(serpContext: SerpContext | null): string {
    if (!serpContext) return "";
    const competitors = serpContext.results
        .filter(result => (result.scrapedHeadings?.length ?? 0) > 0)
        .slice(0, 5);
    if (competitors.length === 0) return "";

    const coverage = competitors.map((result, index) =>
        `Competitor ${index + 1}: ${(result.scrapedHeadings ?? []).slice(0, 10).join(" → ")}`
    ).join("\n");

    const formats = competitors.map(result => result.scrapedSchemaTypes ?? []).flat();
    return `SERP COVERAGE MAP:
${coverage}

SERP STRUCTURE SIGNALS:
- Schema types observed: ${[...new Set(formats)].slice(0, 12).join(", ") || "not available"}
- Build the article around searcher task completion, required questions, entities, evidence, risks, and differentiation.
- Do not increase length simply to exceed competitor word counts.`;
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

    const competitorSaturation = serpContext?.results
        .slice(0, 5)
        .flatMap(r => r.scrapedHeadings ?? [])
        .filter(h => h.length > 5)
        .slice(0, 14)
        .join(" | ") ?? "";

    const contentGapsInstruction = competitorSaturation
        ? `topic or angle genuinely absent from current SERP results — MUST NOT overlap with saturated competitor angles: ${competitorSaturation}`
        : "topic or angle not covered by current top results";

    const prompt = `You are an editorial research analyst. Your job is NOT to write content — it is to produce a structured research brief that a writer will use.

KEYWORD: "${keyword}"
INTENT: ${ctx.intent}
RISK LEVEL: ${ctx.riskTier}

${serpSummary}

DIFFERENTIATION MANDATE:
- "contentGaps" MUST NOT duplicate these saturated competitor angles: ${competitorSaturation || "Not available"}
- "contrarianAngles" must challenge or reframe a saturated angle, not repeat it.

Produce a research brief as a JSON object with these exact keys:

{
  "intent": "One sentence describing exactly what the searcher wants to accomplish",
  "searcherMindset": "What emotional state or urgency does the searcher have? What do they already know?",
  "contentGaps": ["${contentGapsInstruction}", "..."],
  "entities": ["specific named tools, people, companies, frameworks, studies to reference", "..."],
  "contrarianAngles": ["a counterintuitive or surprising truth about this topic that experts know but articles avoid — must challenge a saturated angle, not repeat it", "..."],
  "examplesNeeded": ["type of real-world example that would make this concrete", "..."],
  "faqTargets": ["actual question a searcher types, answered directly", "..."],
  "commonMisconceptions": ["a widespread belief that is partially or fully wrong", "..."],
  "industryMyths": ["something the industry repeats but practitioners know is false", "..."],
  "whatPeopleAvoidSaying": ["an uncomfortable truth or unpopular opinion in this space", "..."],
  "queryDecomposition": {
    "primaryIntent": "the single primary task the searcher needs to complete",
    "secondaryIntents": ["secondary tasks that materially affect the answer"],
    "requiredQuestions": ["questions that must be answered for the task to be complete"],
    "decisionCriteria": ["criteria the reader uses to choose or act"],
    "comparisonDimensions": ["dimensions that matter when comparing options"],
    "entities": ["important entities, tools, standards, organizations, or concepts"],
    "risksAndExceptions": ["important caveats, failure modes, edge cases, or exceptions"],
    "freshnessSensitiveFacts": ["facts that become stale quickly and must be sourced carefully"]
  }
}

Rules:
- Be specific and concrete. No generic placeholders.
- "contentGaps" should name actual topics, not vague descriptions.
- "entities" should be real named things or established concepts.
- Decompose the query before recommending article structure.
- "requiredQuestions" must be questions needed to satisfy the primary and secondary tasks, not filler FAQs.
- "decisionCriteria" and "comparisonDimensions" should be present only when they materially affect the query.
- "freshnessSensitiveFacts" should identify claims that require recent sources.
- Do not use "LSI" as an SEO requirement; use related entities, subtopics, concepts, attributes, and terminology.
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
        queryDecomposition: {
            primaryIntent: `Help the reader accomplish the main task behind "${keyword}"`,
            secondaryIntents: [],
            requiredQuestions: [],
            decisionCriteria: [],
            comparisonDimensions: [],
            entities: [],
            risksAndExceptions: [],
            freshnessSensitiveFacts: [],
        },
    };

    const infoGain = await runInformationGainAlgorithm(
        keyword,
        // Reuse already-scraped SERP results — avoids a duplicate 10-result fetch
        serpContext?.results ?? undefined,
    ).catch(() => null);

    try {
        const result = await generateWithFallbackJson<ResearchBrain>({
            prompt,
            model: AI_MODELS.GEMINI_FLASH,
            maxTokens: 2048,
            validate: (data) => ResearchBrainSchema.parse(data),
        });

        if (infoGain) {
            result.informationGainDirective = infoGain.informationGainPromptDirective;
            result.contentGaps = [...new Set([...(result.contentGaps || []), ...infoGain.uniqueContentGaps])];
        }

        return result;
    } catch (e) {
        logger.warn("[Pipeline] Research brain failed — using fallback", { error: (e as Error).message });
        return {
            ...fallback,
            informationGainDirective: infoGain?.informationGainPromptDirective,
        };
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
    const targetWords = wordCountTarget(ctx, serpContext, brain);
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
- Required questions: ${brain.queryDecomposition?.requiredQuestions?.slice(0, 6).join("; ") || "none identified"}
- Decision criteria: ${brain.queryDecomposition?.decisionCriteria?.slice(0, 5).join("; ") || "none identified"}
- Comparison dimensions: ${brain.queryDecomposition?.comparisonDimensions?.slice(0, 5).join("; ") || "none identified"}
- Risks and exceptions: ${brain.queryDecomposition?.risksAndExceptions?.slice(0, 5).join("; ") || "none identified"}
- Freshness-sensitive facts: ${brain.queryDecomposition?.freshnessSensitiveFacts?.slice(0, 5).join("; ") || "none identified"}

${formatInstruction}

COMPETITOR HEADINGS (DO NOT copy these — they define what to differentiate from):
${serpHeadings || "Not available"}

BANNED STRUCTURES: Do NOT produce the following section pattern:
"What is X → Why X matters → How to X → Common mistakes → FAQ"
This is predictable and AI-detectable. Create a narrative that flows differently.

${getScopeRules(ctx)}

${getStructureRules(ctx)}

${getEditorialPolicy(ctx)}

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
- wordTargets should be driven by task complexity and evidence needs, not competitor word counts.
- Every required question that materially affects the task must be assigned to a section or the FAQ.
- Every decision criterion or comparison dimension must appear in the outline when relevant.
- Avoid sections that exist only to increase word count.
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
        const parsed = await generateWithFallbackJson<OutlinePlan>({
            prompt,
            model: AI_MODELS.GEMINI_FLASH,
            maxTokens: 3000,
            validate: (data) => OutlinePlanSchema.parse(data),
        });

        if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
            logger.warn("[Pipeline] Outline planner returned empty sections — using fallback");
            return fallback;
        }

        logger.debug("[Pipeline] Outline parsed successfully", {
            title: parsed.title,
            sections: parsed.sections.length,
        });

        return parsed;
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
    researchPacket: ResearchPacket,
    sectionResearch: SectionResearch[],
    ctx: PromptContext,
): Promise<string> {
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
        const research = sectionResearch[i];
        if (!research) {
            throw new Error(`[Pipeline] Missing authoritative research for section ${i + 1}.`);
        }
        const sectionText = await writeSingleSection(
            section,
            outline,
            researchPacket,
            research,
            ctx,
            memory,
        );

        const stripped = sectionText.replace(/\*?\*?\[EDITOR:[^\]]*\]\*?\*?\s*/g, "").trim();

        let finalText = section.evidenceType === "faq"
            ? enforceFaqOpeners(stripped)
            : stripped;

        if (i === 1 || section.evidenceType === "data") {
            finalText = injectVisualEvidenceIntoBlog(finalText, section.heading || ctx.keyword || "Research");
        }

        sections.push(finalText);

        memory.previousSectionSummary = finalText.slice(0, 300) + "\u2026";
        const words = finalText.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
        const topConcepts = [...new Set(words)].slice(0, 5);
        memory.recentConcepts = [...memory.recentConcepts, ...topConcepts].slice(-15);
        const openerMatch = finalText.match(/^([A-Z][a-z]+)/m);
        if (openerMatch) memory.usedSentenceOpeners.add(openerMatch[1].toLowerCase());
    }

    const failedIndexes = sections
        .map((s, i) => s.includes("[Section generation failed") ? i : -1)
        .filter(i => i >= 0);

    if (failedIndexes.length > 0 && failedIndexes.length <= Math.ceil(sections.length / 2)) {
        logger.info(`[Pipeline] Retrying ${failedIndexes.length} failed sections`);
        for (const idx of failedIndexes) {
            const section = outline.sections[idx];
            const research = sectionResearch[idx];
            if (!research) continue;
            const retry = await writeSingleSection(
                section,
                outline,
                researchPacket,
                research,
                ctx,
                memory,
            );
            const stripped = retry.replace(/\*?\*?\[EDITOR:[^\]]*\]\*?\*?\s*/g, "").trim();
            if (!stripped.includes("[Section generation failed")) {
                sections[idx] = section.evidenceType === "faq" ? enforceFaqOpeners(stripped) : stripped;
            }
        }
    }

    const finalFailedCount = sections.filter(s => s.includes("[Section generation failed")).length;
    if (finalFailedCount > Math.ceil(sections.length / 2)) {
        throw new Error(
            `[Pipeline] ${finalFailedCount}/${sections.length} sections failed after retries.`
        );
    }

    const goodSections = sections.filter(s => !s.includes("[Section generation failed"));
    if (goodSections.length === 0) {
        throw new Error("[Pipeline] All sections failed.");
    }

    const totalWords = goodSections.join(" ").split(/\s+/).length;
    if (totalWords < outline.estimatedTotal * 0.7) {
        logger.warn("[Pipeline] Final article significantly underweight", {
            target: outline.estimatedTotal,
            actual: totalWords,
            ratio: (totalWords / outline.estimatedTotal).toFixed(2),
        });
    }

    return `# ${outline.title}\n\n${sections.join("\n\n")}`;
}

async function writeSingleSection(
    section: OutlineSection,
    outline: OutlinePlan,
    researchPacket: ResearchPacket,
    sectionResearch: SectionResearch,
    ctx: PromptContext,
    memory: EditorialMemory,
): Promise<string> {
    const brain = researchPacket.brain;
    const isIntro = section.isIntro ?? false;
    const isFaq = section.evidenceType === "faq";

    const mythNote = brain.industryMyths.length > 0
        ? `INDUSTRY MYTHS TO CHALLENGE (weave into contrarian sections): ${brain.industryMyths.slice(0, 2).join("; ")}`
        : "";

    const misconceptionNote = brain.commonMisconceptions.length > 0
        ? `MISCONCEPTIONS TO CORRECT (one per article, frames your authority): ${brain.commonMisconceptions.slice(0, 2).join("; ")}`
        : "";

    const introSnippetNote = isIntro && outline.quickAnswer
        ? `FEATURED SNIPPET TARGET: The intro paragraph must contain or closely mirror this answer:\n"${outline.quickAnswer}"\nThis is what Google will extract for Position 0.`
        : "";

    const authorNote = sectionResearch.authorEvidence
        ? `AUTHOR EVIDENCE: Weave in naturally only when it is relevant — "${sectionResearch.authorEvidence.slice(0, 500)}"`
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

    // Match PAA questions to this section's specific topic from the same
    // authoritative packet the publication gate will later inspect.
    const relevantPAA = researchPacket.serp.paa
        .filter(p => {
            const qWords = p.question.toLowerCase().split(/\s+/);
            const hWords = section.heading.toLowerCase().split(/\s+/);
            return qWords.some(w => hWords.includes(w) && w.length > 3);
        })
        .slice(0, 2);

    const serpNote = researchPacket.serp.competitors.length > 0 ? `
SERP SIGNALS \u2014 write to beat what's ranking:
Competitor coverage for this section: ${sectionResearch.competitorCoverage.join(" | ") || "not available"}
${relevantPAA.length > 0 ? `PAA questions to answer in this section:\n${relevantPAA.map(p =>
    `- ${p.question}\n  Current Google answer: ${p.answer ?? "not provided"}`
).join("\n")}` : ""}` : "";

    const sourceContext = renderSourceContext(sectionResearch.relevantSources);
    const caseStudyEvidenceNote = section.evidenceType === "case_study"
        ? getVerifiedCaseStudyAvailability(sectionResearch.relevantSources)
            ? "Verified case-study evidence is available below. Cite it when using its outcome."
            : "No verified case-study evidence is available. Use a clearly labelled hypothetical example; do not invent a company, outcome, or metric."
        : "";

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

AUTHORITATIVE RESEARCH SNAPSHOT (the only external evidence you may use):
${sourceContext}
${sectionResearch.warnings.length > 0 ? `RESEARCH WARNINGS:\n${sectionResearch.warnings.map(warning => `- ${warning}`).join("\n")}` : ""}
${caseStudyEvidenceNote}

EVIDENCE CITATION RULES:
- Use a concrete external fact, statistic, or case-study outcome only when it is supported by a source above.
- Preserve provenance by linking the sentence to that exact source: [Source: source title](source URL).
- If no supplied source supports a number, write the point qualitatively instead. Never invent a source, metric, or company result.

EDITORIAL MEMORY:
${memoryNote}
${entityNote}
${openerNote}
${authorNote}
${mythNote}
${misconceptionNote}
${introSnippetNote}

${brain.informationGainDirective || ""}

${getClaimRules(ctx)}
${getToneRules(ctx)}
${getEvidenceRules(ctx)}

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
${!isIntro && !isFaq ? `ANSWER-FIRST RULE (mandatory for AEO/AI search citability):
- Sentence 1–2: Deliver the direct answer to "${section.goal}" immediately. No preamble, no context-setting.
  ❌ BAD:  "Many marketers wonder about ${section.heading.toLowerCase()}..."
  ✅ GOOD: Start with the specific answer, recommendation, or verdict.
- Sentence 3–5: Explain WHY the answer is correct. Mechanism, not restatement.
- Evidence: One named source, real statistic, or concrete example that proves the answer.
- Action: One specific thing the reader can do today based on this section.
This structure lets AI search engines (Perplexity, ChatGPT, Gemini) extract your answer for citations.` : ""}

Output: ONLY the section in Markdown including the ## heading. No commentary.`;

    const fallbackText = `## ${section.heading}\n\n[Section generation failed \u2014 regenerate this section.]`;

    try {
        const temperatureByEvidence: Partial<Record<OutlineSection["evidenceType"], number>> = {
            data:       0.20,
            case_study: 0.30,
            how_to:     0.35,
            comparison: 0.40,
            faq:        0.40,
            example:    0.55,
            opinion:    0.65,
        };

        const sectionTemperature = temperatureByEvidence[section.evidenceType] ?? 0.50;

        // Use Flash for low-complexity outputs (intro = 3 sentences, FAQ = structured Q&A).
        // Pro is reserved for sections requiring nuanced prose and evidence synthesis.
        const model = (isIntro || isFaq)
            ? AI_MODELS.GEMINI_FLASH
            : AI_MODELS.GEMINI_PRO;

        const text = await generateWithFallback({
            prompt,
            model,
            maxTokens: 3000,
            temperature: sectionTemperature,
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

const BANNED_EDITORIAL_PHRASES = [
    "in conclusion", "it's worth noting", "furthermore", "moreover", "additionally",
    "delve into", "leverage", "seamlessly", "cutting-edge", "game-changing", "robust",
    "now more than ever", "when it comes to", "in today's digital landscape",
    "it is important to", "it is essential to", "final thoughts", "to summarise",
    "in summary", "unlock the potential", "drive engagement", "foster growth",
    "empower users", "in the realm of", "comprehensive guide",
];

/**
 * Cheap local audit to decide if a section needs the expensive Pro rewrite.
 * Returns true if the section needs intervention.
 */
function sectionNeedsRewrite(section: string): boolean {
    const lower = section.toLowerCase();

    // Banned phrases?
    if (BANNED_EDITORIAL_PHRASES.some((phrase) => lower.includes(phrase))) return true;

    // Passive openers (e.g. "It is", "There is/are", "This can be")
    if (/^(it is|there is|there are|this can be|these are|this is)\b/im.test(section)) return true;

    // Keyword stuffing — same word (5+ chars) appearing 5+ times in 200 chars
    const words = lower.match(/\b[a-z]{5,}\b/g) ?? [];
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    for (const [, count] of freq) {
        if (count >= 5) return true;
    }

    // Consecutive sentence openers starting with the same word
    const sentences = section.split(/(?<=[.!?])\s+/);
    for (let i = 0; i < sentences.length - 1; i++) {
        const a = sentences[i]?.match(/^([A-Za-z]+)/)?.[1]?.toLowerCase();
        const b = sentences[i + 1]?.match(/^([A-Za-z]+)/)?.[1]?.toLowerCase();
        if (a && b && a === b && a.length > 2) return true;
    }

    return false;
}

/**
 * Selective editorial rewrite.
 *
 * For each H2 section, runs a fast local audit first.
 * - Sections that FAIL the audit → Gemini Pro full rewrite (original behaviour).
 * - Sections that PASS the audit → Gemini Flash light polish (contractions, micro-imperfections).
 *
 * This typically reduces Pro calls from 2 full chunks to 1 partial chunk, saving
 * ~26,000 output tokens on the most expensive stage in the pipeline.
 */
export async function runEditorialRewrite(
    draft: string,
    ctx: PromptContext,
    groundedCtx?: GroundedSiteContext,
): Promise<{ content: string; truncated: boolean }> {
    const authorVoiceNote = groundedCtx?.data.authorName
        ? `AUTHOR: ${groundedCtx.data.authorName}${groundedCtx.data.authorRole ? ` (${groundedCtx.data.authorRole})` : ""}. Voice should reflect their expertise level.`
        : "";

    // Split at H2 boundaries for section-level decisions
    const sections = draft.split(/(?=^## )/m).filter(Boolean);

    const rewrittenSections: string[] = [];
    let previousSummary = "";
    let proRewrites = 0;
    let flashPolishes = 0;

    for (const section of sections) {
        const needsFullRewrite = sectionNeedsRewrite(section);
        const continuityNote = previousSummary
            ? `CONTINUITY: Previous section ended with: "${previousSummary}". Do not re-introduce topics already covered.`
            : "";

        if (needsFullRewrite) {
            // ── Full Pro rewrite for dirty sections ──────────────────────────
            const prompt = `You are a senior editor at a trade publication. Rewrite the article section below so it reads like a confident practitioner wrote it — not an AI, and not a content marketer.

KEYWORD: "${ctx.keyword}"
${continuityNote}
${authorVoiceNote}

EDITORIAL INSTRUCTIONS — apply every one:

1. REPETITION SWEEP: Scan each 150-word window. If any non-keyword content word appears more than 4 times, rephrase using pronouns, synonyms, or sentence restructuring.
2. SENTENCE LENGTH MIX: Break any sentence over 28 words into two. Mix short (8-12w), medium (13-20w), and longer (21-28w). Never two identical length categories back-to-back.
3. OPENER VARIETY: Never start two consecutive sentences with the same word.
4. ACTIVE VOICE: Replace every passive construction.
5. CONTRACTIONS: Add natural contractions throughout — "you'll", "it's", "don't", "here's", "we've". At least one per paragraph.
6. OPINION SIGNALS: Each H2 section must contain at least one contradiction, named exception, or practitioner note.
7. KEYWORD DENSITY AUDIT: Count how many times the primary keyword "${ctx.keyword}" appears. Target: once per 150–200 words. Replace excess with a pronoun, category term, or related phrase. Never remove from H2 headings or first 100 words.
8. REMOVE THESE PHRASES (replace with plain language): ${BANNED_EDITORIAL_PHRASES.slice(0, 12).join(" / ")}
9. FAQ ANSWERS: Every FAQ answer must open with: Yes / No / a number / a tool name / a time frame.
10. MICRO-IMPERFECTIONS: Add one or two controlled irregularities per 500 words.
11. PRESERVE: All factual claims, named entities, statistics with sources, heading structure, FAQ questions. Do NOT invent new facts.

Return ONLY the rewritten content in Markdown — same heading structure, no commentary.

CONTENT:
${section}`;

            try {
                const rewritten = await generateWithFallback({
                    prompt,
                    model: AI_MODELS.GEMINI_PRO,
                    maxTokens: 6000,
                });

                const trimmed = rewritten.trim();
                if (!trimmed || trimmed.length < section.length * 0.4) {
                    logger.warn("[Pipeline] Pro editorial rewrite returned too-short output — keeping original");
                    rewrittenSections.push(section);
                } else {
                    const cleaned = trimmed
                        .replace(/^```(?:markdown|html)?\s*/i, "")
                        .replace(/\s*```$/i, "")
                        .trim();
                    rewrittenSections.push(cleaned);
                    previousSummary = cleaned.slice(-200).replace(/\s+/g, " ");
                    proRewrites++;
                }
            } catch (e) {
                logger.warn("[Pipeline] Pro editorial rewrite failed — keeping original", { error: (e as Error).message });
                rewrittenSections.push(section);
            }
        } else {
            // ── Flash light polish for already-clean sections ─────────────────
            const flashPrompt = `Light editorial polish only. Do NOT restructure or rewrite.

Tasks:
- Add one natural contraction per paragraph where absent ("you'll", "it's", "don't", "here's")
- Add one micro-imperfection per 300 words (a fragment, an abrupt transition, or a short emphatic standalone)
- Remove any of these exact phrases if present: ${BANNED_EDITORIAL_PHRASES.slice(0, 6).join(" / ")}
- PRESERVE everything else: facts, structure, headings, citations, sentence flow

${continuityNote}

Return ONLY the polished Markdown. No commentary.

CONTENT:
${section}`;

            try {
                const polished = await generateWithFallback({
                    prompt: flashPrompt,
                    model: AI_MODELS.GEMINI_FLASH,
                    maxTokens: 3000,
                });

                const trimmed = polished.trim();
                if (!trimmed || trimmed.length < section.length * 0.5) {
                    rewrittenSections.push(section);
                } else {
                    const cleaned = trimmed
                        .replace(/^```(?:markdown|html)?\s*/i, "")
                        .replace(/\s*```$/i, "")
                        .trim();
                    rewrittenSections.push(cleaned);
                    previousSummary = cleaned.slice(-200).replace(/\s+/g, " ");
                    flashPolishes++;
                }
            } catch {
                // Flash failed — keep original section, no retry needed
                rewrittenSections.push(section);
                flashPolishes++;
            }
        }
    }

    logger.info("[Pipeline] Selective editorial rewrite complete", {
        keyword: ctx.keyword,
        totalSections: sections.length,
        proRewrites,
        flashPolishes,
        skipped: sections.length - proRewrites - flashPolishes,
    });

    return {
        content: rewrittenSections.join("\n\n"),
        truncated: false,
    };
}

async function repairUnsupportedClaims(
    content: string,
    researchPacket: ResearchPacket,
    ctx: PromptContext,
): Promise<string> {
    const evidence = extractEvidencePacket(researchPacket, content);
    const issues = [...evidence.unsourcedStatistics, ...evidence.unverifiedCaseStudies].slice(0, 12);
    if (issues.length === 0 || researchPacket.sources.length === 0) return content;

    const sourceContext = renderSourceContext(researchPacket.sources);
    const prompt = `You are a senior fact-preservation editor. Repair only unsupported factual claims in the article below.

PRIMARY KEYWORD: "${ctx.keyword}"

UNSUPPORTED CLAIMS TO REPAIR:
${issues.map(issue => `- ${issue}`).join("\n")}

AUTHORITATIVE SOURCES:
${sourceContext}

RULES:
- Use only facts supported by the supplied sources.
- Never invent a statistic, date, result, company outcome, quote, or source.
- If a numeric claim lacks supporting evidence, remove the number and keep the statement qualitative.
- If a case-study result lacks supporting evidence, remove the precise result or turn it into a clearly labelled hypothetical example.
- Preserve every supported claim, citation URL, heading, link, and the article's structure.
- Do not add new sections.
- Return the full article in Markdown.

ARTICLE:
${content}`;

    try {
        const repaired = await generateWithFallback({
            prompt,
            model: AI_MODELS.GEMINI_PRO,
            maxTokens: 7000,
            temperature: 0.15,
        });
        const cleaned = repaired
            .replace(/^```(?:markdown|html)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        if (!cleaned || cleaned.length < content.length * 0.55) return content;

        const after = extractEvidencePacket(researchPacket, cleaned);
        const h2Before = (content.match(/^##\s+/gm) ?? []).length;
        const h2After = (cleaned.match(/^##\s+/gm) ?? []).length;
        if (h2After !== h2Before) return content;
        if (after.unsourcedStatistics.length + after.unverifiedCaseStudies.length > issues.length) return content;
        return cleaned;
    } catch (error) {
        logger.warn("[Pipeline] Unsupported-claim repair failed — keeping original", {
            keyword: ctx.keyword,
            error: error instanceof Error ? error.message : String(error),
        });
        return content;
    }
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
    /** One immutable-in-practice snapshot used by writer and publication gate. */
    researchPacket: ResearchPacket;
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
    groundedCtx?: GroundedSiteContext;
}): Promise<PipelineResult> {
    const { keyword, serpContext, ctx, author, tone, groundedCtx } = params;

    logger.debug("[Pipeline] Stage 1 — Research Brain", { keyword });
    const brain = await runResearchBrain(keyword, serpContext, ctx);

    logger.debug("[Pipeline] Stage 2 — Outline Planner", { keyword });
    const outline = await runOutlinePlanner(keyword, brain, serpContext, ctx, tone);

    // Build exactly one authoritative research packet after the outline tells
    // us which evidence-intensive sections need source deepening. The writer,
    // evidence extractor, and publication gate all receive this same object.
    logger.debug("[Pipeline] Research packet — collecting authoritative sources", {
        keyword,
        sections: outline.sections.length,
    });
    const researchPacket = await buildResearchPacket({
        keyword,
        brain,
        serpContext,
        author,
        sections: outline.sections,
    });
    const sectionResearch = await buildSectionResearchMap(outline.sections, researchPacket);

    logger.debug("[Pipeline] Stage 3 — Section Writer", { keyword, sections: outline.sections.length });
    const rawDraft = await runSectionWriter(outline, researchPacket, sectionResearch, ctx);

    logger.debug("[Pipeline] Stage 4 — Editorial Rewrite", { keyword, chunks: Math.ceil(rawDraft.length / 18000) });
    const { content: polishedMarkdown, truncated } = await runEditorialRewrite(rawDraft, ctx, groundedCtx);
    if (truncated) {
        logger.warn("[Pipeline] Editorial rewrite was truncated", { keyword });
    }

    const repairedMarkdown = await repairUnsupportedClaims(polishedMarkdown, researchPacket, ctx);

    return {
        title: outline.title,
        slug: outline.slug,
        quickAnswer: outline.quickAnswer,
        metaDescription: outline.metaDescription,
        markdownContent: repairedMarkdown,
        brain,
        outline,
        researchPacket,
    };
}
