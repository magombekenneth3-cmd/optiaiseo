# Blog Generation System — Full Improvement Guide

## What This Fixes

Your blog generation pipeline has a well-architected 4-stage system (Research → Outline → Section Writer → Editorial Rewrite) but the SERP data you fetch never reaches the model that actually writes the content. The result is thin, generic content that doesn't reflect what's ranking and can't compete on depth. This guide covers every fix discussed, in the order you should implement them.

---

## The Core Problem (Plain English)

You scrape competitor articles, fetch Google's People Also Ask answers, grab featured snippets, and build a rich formatted context — then throw it all away before the writing starts. Stage 3 (the Section Writer) has no idea what's ranking for the keyword it's writing about. It's writing blind.

On top of that:
- Trending posts pass zero SERP data (hardcoded null)
- PAA answers are stripped, only questions reach the model
- Competitor scraping only captures the first 900 words (intro only)
- Word count is capped at 4,000 — which can put you below the field
- The section writer never searches for real facts — it makes them up
- Writing patterns are too uniform and AI-detectable

---

## File 1: `src/lib/blog/serp.ts`

### Fix 1 — Raise the scrape budget

Currently set to 6,000 characters (~900 words). That's only the intro of a competitor article. Raise it to cover a full article.

```typescript
const BUDGET = {
  scrapedContentPerResult: 25_000,  // was 6_000 (~900 words → ~3,800 words)
  snippetPerResult: 400,
  featuredSnippet: 600,
  paaTotal: 2_000,                  // was 1_200
  relatedSearches: 300,
} as const;
```

### Fix 2 — Fetch 7 results so you reliably get 5 after unscrappable domains are dropped

```typescript
const { organic, peopleAlsoAsk, featuredSnippet, relatedSearches } =
    await fetchGoogleSerp(keyword, 7); // was 5
```

### Fix 3 — Stop stripping PAA answers

Currently you send PAA questions to the model but drop the answers Serper returns. The model can't beat what's ranking if it doesn't know what's there.

```typescript
// In getSerpContextForKeyword, replace the PAA block:
if (peopleAlsoAsk.length > 0) {
    ctx += "PEOPLE ALSO ASK (questions your post must answer — beat these answers):\n";
    let paaChars = 0;
    for (const paa of peopleAlsoAsk) {
        const line = `- ${paa.question}${paa.answer 
            ? `\n  Current Google answer: ${paa.answer}` 
            : ""}\n`;
        if (paaChars + line.length > BUDGET.paaTotal) break;
        ctx += line;
        paaChars += line.length;
    }
    ctx += "\n";
}
```

### Fix 4 — Log how many full articles you actually scraped

```typescript
// Add after the scrape loop:
const fullyScraped = organic.filter(r => (r.wordCount ?? 0) > 800);
logger.info(`[SERP] Scraped ${fullyScraped.length} full articles for "${keyword}"`, {
    wordCounts: organic.map(r => r.wordCount ?? 0)
});
```

---

## File 2: `src/lib/blog/pipeline.ts`

This is the main file. Most of the work happens here.

### Fix 5 — Raise the word count ceiling and beat the longest competitor

Currently capped at 4,000 words regardless of what competitors write. If they average 3,800 you're structurally limited to just 200 words more — or potentially less.

```typescript
function wordCountTarget(ctx: PromptContext, serpContext: SerpContext | null): number {
    const intentBase =
        ctx.intent === "transactional" ? 1500
        : ctx.intent === "commercial"  ? 2200
        : ctx.intent === "local"       ? 1800
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
```

### Fix 6 — Add a depth benchmark function

This gives the Outline Planner a full picture of competitor structure and word counts before it plans your article.

```typescript
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

    return `
COMPETITOR DEPTH BENCHMARK (${scraped.length} full articles analysed):
- Average: ${avgWords} words | Longest: ${maxWords} words
- Your minimum target: ${Math.round(Math.max(avgWords * 1.2, maxWords))} words

SECTION STRUCTURE ACROSS ALL COMPETITORS:
${coverageSummary}

ALL HEADINGS IN USE (identify gaps — what none of them cover):
${allHeadings.join("\n")}

DEPTH RULE: Any topic competitors cover in 200 words, cover in 400.
Do not write a section that could be cut without the reader noticing.`;
}
```

### Fix 7 — Add a competitor section content function

Each section needs to know what competitors wrote on that specific topic, not just the overall article.

```typescript
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
            return relevant
                ? `[Competitor ${i + 1}]: ${relevant.slice(0, 600)}`
                : null;
        })
        .filter(Boolean)
        .slice(0, 3);

    if (relevantExcerpts.length === 0) return "";

    return `
WHAT COMPETITORS WRITE ON THIS TOPIC (do not copy — go deeper):
${relevantExcerpts.join("\n\n")}

DEPTH RULE: Add something none of the above has — a specific named example,
a real number, a counterpoint, or a failure mode.`;
}
```

### Fix 8 — Add a fact fetching function

Before each section is written, fetch real facts from Serper. This runs in parallel across all sections so it adds ~2-3 seconds total, not per section.

```typescript
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
            headers: {
                "X-API-KEY": apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                q: queryMap[evidenceType] ?? `${sectionHeading} ${keyword}`,
                num: 5
            }),
            signal: AbortSignal.timeout(8_000),
        });

        if (!res.ok) return "";
        const data: any = await res.json();

        const facts: string[] = [];

        if (data.answerBox?.answer)  facts.push(`[Direct answer] ${data.answerBox.answer}`);
        if (data.answerBox?.snippet) facts.push(`[Google snippet] ${data.answerBox.snippet}`);

        (data.organic ?? [])
            .slice(0, 4)
            .map((r: any) => r.snippet)
            .filter((s: string) => s?.length > 60)
            .forEach((s: string, i: number) => facts.push(`[Source ${i + 1}] ${s}`));

        (data.peopleAlsoAsk ?? [])
            .slice(0, 3)
            .forEach((p: any) => {
                if (p.snippet) facts.push(`[PAA] Q: ${p.question} → ${p.snippet}`);
            });

        if (facts.length === 0) return "";

        return `
REAL FACTS — use at least 2 of these in the section:
${facts.join("\n")}

FACT RULES:
- If a fact contains a number (%, $, days, users), include it verbatim.
- Attribute naturally: "Research shows...", "According to [source type]...", "Studies suggest..."
- Do NOT invent statistics not in this list. Write the insight without the number if you don't have it.
- "Most teams see significant churn reduction" beats "63% of teams" when 63% is invented.`;

    } catch {
        return "";
    }
}
```

### Fix 9 — Update Stage 1 (Research Brain) to include PAA answers

```typescript
const serpSummary = serpContext
    ? `TOP SERP RESULTS:\n${serpContext.results.slice(0, 3).map((r, i) =>
        `[Rank ${i + 1}] ${r.title}\nSnippet: ${r.snippet}`
      ).join("\n\n")}\n\nPeople Also Ask (with current Google answers):\n${
        serpContext.peopleAlsoAsk.slice(0, 5).map(p =>
            `- Q: ${p.question}${p.answer ? `\n  Current answer: ${p.answer}` : ""}`
        ).join("\n")}`
    : "No SERP data available.";
```

### Fix 10 — Update Stage 2 (Outline Planner) to use depth benchmark + format signal

```typescript
export async function runOutlinePlanner(
    keyword: string,
    brain: ResearchBrain,
    serpContext: SerpContext | null,
    ctx: PromptContext,
    tone?: string,
): Promise<OutlinePlan> {
    const ai = getClient();
    const targetWords = wordCountTarget(ctx, serpContext);
    const depthBenchmark = buildDepthBenchmark(serpContext);

    const serpHeadings = serpContext?.results.slice(0, 3)
        .flatMap(r => r.scrapedHeadings ?? [])
        .slice(0, 10)
        .join(", ") ?? "";

    // Match the SERP format — if listicles dominate, use a list structure
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

    const prompt = `You are a content strategist planning an article structure.

KEYWORD: "${keyword}"
TARGET INTENT: ${ctx.intent}
TONE: ${tone ?? "Authoritative and direct"}
TOTAL WORD TARGET: ${targetWords}
YEAR: ${ctx.year}

${depthBenchmark}

RESEARCH BRIEF:
- Searcher mindset: ${brain.searcherMindset}
- Key entities: ${brain.entities.slice(0, 6).join(", ")}
- ${gapSignal}
- Contrarian angles: ${brain.contrarianAngles.slice(0, 2).join("; ")}
- Misconceptions to address: ${brain.commonMisconceptions.slice(0, 2).join("; ")}

${formatInstruction}

COMPETITOR HEADINGS (differentiate from these — don't copy):
${serpHeadings || "Not available"}

BANNED STRUCTURE: Do NOT produce "What is X → Why X matters → How to X → Common mistakes → FAQ"

${getScopeRules(ctx)}
${getStructureRules(ctx)}

[rest of existing JSON output instructions unchanged]`;
```

### Fix 11 — Update Stage 3 (Section Writer) to accept serpContext and facts, enable Gemini grounding

This is the biggest change. Stage 3 currently receives no SERP data at all.

```typescript
export async function runSectionWriter(
    outline: OutlinePlan,
    brain: ResearchBrain,
    author: AuthorProfile,
    ctx: PromptContext,
    serpContext: SerpContext | null,   // ← new parameter
): Promise<string> {
    const ai = getClient();

    // Pre-fetch all section facts in parallel before writing starts
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

        const sectionText = await writeSingleSection(
            ai, section, outline, brain, author, ctx, memory, serpContext, facts
        );

        const finalText = section.evidenceType === "faq"
            ? enforceFaqOpeners(sectionText)
            : sectionText;

        sections.push(finalText);

        memory.previousSectionSummary = sectionText.slice(0, 300) + "…";
        const words = sectionText.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
        memory.recentConcepts = [...memory.recentConcepts, ...[...new Set(words)].slice(0, 5)].slice(-15);
        const openerMatch = sectionText.match(/^([A-Z][a-z]+)/m);
        if (openerMatch) memory.usedSentenceOpeners.add(openerMatch[1].toLowerCase());
    }

    return `# ${outline.title}\n\n${sections.join("\n\n")}`;
}
```

### Fix 12 — The full writeSingleSection with all improvements

```typescript
async function writeSingleSection(
    ai: GoogleGenAI,
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

    // E-E-A-T — always include, even without real grounding data
    const authorNote = author.realExperience
        ? `AUTHOR VOICE: Weave in naturally — "${author.realExperience.slice(0, 200)}"`
        : `EXPERIENCE SIGNAL: Include at least one "in practice" observation, a named failure mode,
or a scenario only someone who has actually done this would describe. Generic advice without
a grounding moment fails Google's E-E-A-T check.`;

    const memoryNote = memory.previousSectionSummary
        ? `PREVIOUS SECTION ENDED WITH: "${memory.previousSectionSummary}"
Do NOT repeat: ${memory.recentConcepts.slice(-8).join(", ")}
Do NOT re-introduce as new: ${[...memory.usedEntities].slice(-6).join(", ")}`
        : "";

    const entityNote = memory.usedEntities.size > 0
        ? `ALREADY CITED: ${[...memory.usedEntities].slice(0, 5).join(", ")} — vary references or introduce new ones.`
        : `ENTITIES TO INTRODUCE: ${brain.entities.slice(0, 4).join(", ")}`;

    const openerNote = memory.usedSentenceOpeners.size > 0
        ? `AVOID STARTING SENTENCES WITH: ${[...memory.usedSentenceOpeners].slice(0, 6).join(", ")}`
        : "";

    // Match PAA questions to this specific section's topic
    const relevantPAA = serpContext?.peopleAlsoAsk
        .filter(p => {
            const qWords = p.question.toLowerCase().split(/\s+/);
            const hWords = section.heading.toLowerCase().split(/\s+/);
            return qWords.some(w => hWords.includes(w) && w.length > 3);
        })
        .slice(0, 2) ?? [];

    const serpNote = serpContext ? `
SERP SIGNALS — write to beat what's ranking:
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
        data:       "Lead with a specific statistic. If unknown, write the insight without the number.",
        example:    "Use at least one concrete, named example. Generic advice without a named example is not acceptable.",
        opinion:    "Take a clear editorial stance. 'In practice…', 'What works better is…'",
        comparison: "Compare two approaches or tools directly. Declare a winner for at least one use case.",
        how_to:     "Number the steps. Be specific — 'do X' not 'consider doing X'.",
        faq:        "5-7 Q&A pairs. Each answer MUST open with: Yes / No / a number / a tool name / a time frame.",
    };

    const prompt = `You are a senior editor writing one section of an article.

ARTICLE TITLE: "${outline.title}"
KEYWORD: "${ctx.keyword}"

THIS SECTION:
Heading: "${section.heading}"
Goal: ${section.goal}
Tone: ${section.tone} — ${toneInstructions[section.tone]}
Evidence type: ${section.evidenceType} — ${evidenceInstructions[section.evidenceType]}
Word target: ${section.wordTarget} words (±20%)
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

HUMAN WRITING RULES — this is what separates real writing from AI output:
- Vary sentence length deliberately. Short punches. Then a longer one that earns its length by building a point the reader needs time to absorb. Then short again.
- Imperfect transitions are fine — "Here's the thing.", "And that's where it breaks.", "Which sounds obvious. It isn't."
- Fragments work for emphasis. Like this. Use them.
- Colloquial phrases grounded in the topic — "the thing is", "in practice", "nine times out of ten", "the short answer is"
- Vary paragraph length. Sometimes one sentence stands alone. Sometimes three or four build together.
- Avoid parallel sentence structure back to back — if two sentences open the same way, break the second one.
- One moment of plain directness per section: "Don't do this.", "This is the part most people skip.", "It's not complicated — people just overthink it."
- Uncertainty is honest: use "roughly", "in most cases", "typically" when you're not citing a specific number.

FRESHNESS: Reference what specifically changed or is different as of ${ctx.year}. Not a timeless platitude.

FACT HONESTY: If you don't have a specific number, write the insight without it.
"Most companies see significant churn reduction" beats "63% of companies" when 63% is invented.
Real writers admit uncertainty. Invented precision destroys trust and E-E-A-T.

FORBIDDEN:
- furthermore / moreover / in conclusion / delve into / leverage / robust / comprehensive
- "In this section" / "Now let's look at" / "Moving on to"
- Three consecutive sentences of the same length
- ${isIntro ? '"Welcome to" / "In this article" / opening with a question' : '"When it comes to" / "In the realm of"'}

${isIntro ? `INTRO RULE: 3 sentences max. (1) Most surprising/useful fact about "${ctx.keyword}". (2) What conventional wisdom gets wrong. (3) What the reader gets. No fluff.` : ""}
${isFaq ? `FAQ FORMAT: ## for each question. Answer opens immediately with Yes/No/number/tool/timeframe. No preamble. Max 3 sentences per answer.` : ""}

Output: ONLY the section in Markdown including the ## heading. No commentary.`;

    const fallbackText = `## ${section.heading}\n\n[Section generation failed — regenerate.]`;

    try {
        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_PRO,
            contents: prompt,
            config: {
                temperature: 0.75,
                maxOutputTokens: 3000,           // raised from 2048
                tools: [{ googleSearch: {} }],   // Gemini grounding — searches when it needs more
            },
        });

        const text = response.text?.trim() ?? "";
        if (text.length < 80) return fallbackText;

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
```

### Fix 13 — Thread serpContext through runFullPipeline

```typescript
// In runFullPipeline, update this line:
const rawDraft = await runSectionWriter(outline, brain, author, ctx, serpContext);
```

---

## File 3: `src/lib/blog/index.ts`

### Fix 14 — Trending posts pass null SERP context (one line, biggest quick win)

Currently hardcoded to null with a comment claiming Stage 1 handles it. Stage 1 only sees what you pass it.

```typescript
// Replace this:
const serpContext = null; // Pipeline Stage 1 will handle SERP internally via keyword

// With this:
let serpContext: SerpContext | null = null;
try {
    serpContext = await getSerpContextForKeyword(industry, true);
    logger.debug("[Blog Engine] Trending post SERP fetched", { industry });
} catch (e) {
    logger.error("[Blog Engine] Trending SERP fetch failed", { error: (e as Error)?.message });
}
```

---

## File 4: `src/lib/blog/rules.ts`

### Fix 15 — Add freshness and human variation requirements to structure rules

```typescript
export function getStructureRules(ctx: PromptContext): string {
    return `STRUCTURE:
- ONE H1 = the article title only. Primary keyword within first 60 characters.
- 5–8 H2 sections. Derive structure from the topic and SERP data — not a template.
- Answer the primary search intent in the FIRST 30% of the article.
- TITLE-COUNT RULE: if the title contains a number, content must contain exactly that many H3 items.
- Intro: 3 sentences — (1) most useful/surprising fact, (2) your unique angle, (3) what the reader gets. No "Welcome to" or "In this article".
- FAQs MUST align to real PAA queries for "${ctx.keyword}". Every FAQ answer opens with Yes / No / a number / a named tool or time frame.
- DO NOT use: What Is X → Why X Matters → How to X → Common Mistakes → FAQ.
- FRESHNESS: at least one section must reference what specifically changed or is different as of ${ctx.year} — not a timeless fact.
- HUMAN VARIATION: sentence length, paragraph length, and transition style must vary visibly across the article. Uniform structure is the clearest AI signal. Mix short sections with longer ones, terse paragraphs with developed ones. This variation should be intentional, not random.`;
}
```

### Fix 16 — E-E-A-T fallback in getAuthorGrounding

When no author grounding data exists, the current code returns an empty string. Always include an experience instruction.

```typescript
// In getAuthorGrounding, ensure there's always a signal:
export function getAuthorGrounding(author: AuthorProfile, ctx: PromptContext): string {
    if (author.realExperience || author.realNumbers || author.localContext) {
        const parts: string[] = ["AUTHOR GROUNDING — weave these naturally into the content:"];
        if (author.realExperience) parts.push(`- Real experience: ${sanitizeGrounding(author.realExperience)}`);
        if (author.realNumbers)   parts.push(`- Real numbers / results: ${sanitizeGrounding(author.realNumbers)}`);
        if (author.localContext)  parts.push(`- Local / niche context: ${sanitizeGrounding(author.localContext)}`);
        return parts.join("\n");
    }
    
    // No grounding data — still require an experience signal
    return `EXPERIENCE SIGNAL: Include at least one "in practice" observation, a named failure mode,
or a scenario only someone who has actually done this would describe.
Generic advice without a grounding moment fails Google's E-E-A-T check.`;
}
```

---

## Why Each Fix Matters (Plain English)

**SERP data not reaching the writer** — The most impactful fix. You're paying for Serper data and scraping competitor articles but none of it reaches the writing stage. Everything about "write to beat what's ranking" is currently aspirational, not functional.

**PAA answers stripped** — People Also Ask questions are the clearest signal of what Google thinks the searcher needs. You had the answers, you just weren't passing them. FAQ sections are your best shot at featured snippets — they should be built around what Google is already showing.

**Trending posts getting null** — Every trending post is written with zero knowledge of what's ranking for the topic. It's the same as not having SERP integration at all for that content type.

**900-word scrape limit** — You can only compare against competitor intros. The real differentiation happens in the middle sections where competitors either go deep or run out of things to say. You need to see that.

**4,000-word cap** — If your competitors are writing 3,800 words and you cap at 4,000, you're never going to significantly outperform. Beat the longest competitor, don't just match the average.

**No real facts** — Without fact fetching, the model fills gaps with invented statistics. That's both a quality problem and an E-E-A-T problem. Real facts sourced from Serper plus Gemini grounding means the model can find what it needs rather than making it up.

**Uniform sentence structure** — Google's quality classifiers are specifically tuned to detect AI writing patterns. The most common tell is uniform sentence length and parallel structure. Real writing varies — short punches followed by longer development, fragments for emphasis, imperfect transitions. The human writing rules address this directly.

**E-E-A-T signal missing when author data is empty** — Google's Helpful Content system specifically scores first-hand experience. When no author grounding data exists, the prompt currently says nothing — it should always ask for at least one "in practice" observation, a named failure mode, or a scenario that demonstrates real experience.

---

## Execution Order

Do these in sequence. Each one adds to the last.

| Step | File | Time | What it does |
|---|---|---|---|
| 1 | `serp.ts` | 30 min | Bigger scrape budget, 7 results, PAA answers included |
| 2 | `index.ts` | 5 min | Fix trending posts null — one line |
| 3 | `pipeline.ts` | 20 min | Add `buildDepthBenchmark` and `getCompetitorSectionContent` functions |
| 4 | `pipeline.ts` | 20 min | Add `fetchSectionFacts` function |
| 5 | `pipeline.ts` | 15 min | Update `wordCountTarget` to beat the field |
| 6 | `pipeline.ts` | 15 min | Update `runResearchBrain` PAA summary |
| 7 | `pipeline.ts` | 30 min | Update `runOutlinePlanner` with depth benchmark + format signal |
| 8 | `pipeline.ts` | 45 min | Update `runSectionWriter` signature + parallel fact fetch |
| 9 | `pipeline.ts` | 45 min | Full `writeSingleSection` rewrite with all signals + Gemini grounding |
| 10 | `pipeline.ts` | 5 min | Thread `serpContext` through `runFullPipeline` |
| 11 | `rules.ts` | 15 min | Add freshness + human variation to structure rules |
| 12 | `rules.ts` | 10 min | Fix E-E-A-T fallback in getAuthorGrounding |

**Total: approximately 4 hours**

---

## Timing Impact After All Changes

| Addition | Time added per generation |
|---|---|
| Serper fact fetch (5-7 sections, parallel) | +2–3 seconds |
| Gemini grounding (model searches when it needs to) | +0–2 seconds per section |
| Larger scrape budget (25k chars × 7 results) | +8–10 seconds |
| **Total added** | ~15 seconds |

If generation time matters, run the SERP scrape as a background job when a keyword is queued for generation. By the time the user hits generate, the competitor data is already cached.

---

## What You Get After All This

- Stage 1 sees PAA questions **and** their current Google answers
- Stage 2 sees full competitor section structures and word counts before it plans anything
- Stage 3 sees what competitors wrote on each specific subtopic, relevant PAA answers, the featured snippet to beat, and real sourced facts — before writing a single word
- The model can also search Google during generation if the fetched facts aren't enough
- Word targets beat the longest competitor, not just the average
- Writing rules enforce sentence length variation, paragraph variation, imperfect transitions, and honest uncertainty — the signals that separate real writing from AI output
- Every section has an E-E-A-T signal even when no author data exists
- Trending posts are no longer SERP-blind