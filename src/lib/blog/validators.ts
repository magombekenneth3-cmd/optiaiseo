const STAT_PATTERN = /estimated\s+\d|~\d{1,3}%|\b\d{1,3}%|\b\d+x\b|\b\d+ (times|hours?|days?|weeks?)\b/gi;

export function auditComparisonTable(
    rows: { problem: string; industryAvg: string; fix: string; result: string }[]
): { flaggedIndexes: number[]; warnings: string[] } {
    const flaggedIndexes: number[] = [];
    const warnings: string[] = [];
    rows.forEach((row, i) => {
        const text = [row.problem, row.industryAvg, row.fix, row.result].join(" ");
        const matches = text.match(new RegExp(STAT_PATTERN.source, STAT_PATTERN.flags));
        if (matches && matches.length > 0) {
            flaggedIndexes.push(i);
            warnings.push(`Row ${i + 1}: unverified statistic detected — "${matches[0]}". Add a named source or rewrite as a descriptive outcome.`);
        }
    });
    return { flaggedIndexes, warnings };
}

export function auditRhythm(htmlContent: string): string[] {
    const warnings: string[] = [];
    const text = htmlContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];

    let sameLengthRun = 0;
    let prevBucket = "";
    for (const s of sentences) {
        const wordCount = s.trim().split(/\s+/).length;
        const bucket = wordCount < 10 ? "short" : wordCount < 20 ? "medium" : "long";
        if (bucket === prevBucket) {
            sameLengthRun++;
            if (sameLengthRun >= 2) {
                warnings.push(`Three or more consecutive ${bucket} sentences detected — vary the rhythm.`);
                sameLengthRun = 0;
            }
        } else {
            sameLengthRun = 0;
        }
        prevBucket = bucket;
    }

    if (!/\b(honestly|frankly|in my experience|worth it|skip this|don.t bother|almost always|rarely matters)\b/i.test(text)) {
        warnings.push("No opinion signal found. Add one direct stance — not a hedge.");
    }
    if (!/\b(unless|except when|doesn.t work if|breaks down when|not if|only works when)\b/i.test(text)) {
        warnings.push("No exception or boundary condition found. Add one 'this breaks when X' sentence.");
    }
    return warnings;
}

export function auditBannedPhrases(htmlContent: string): { warnings: string[] } {
    const text = htmlContent.replace(/<[^>]+>/g, " ");
    const BANNED: [RegExp, string][] = [
        // Unverified stats
        [/\bestimated\s+\d+\s*%/gi,              '"Estimated X%" without a source — remove the number or add a named source.'],
        // AI topic openers
        [/\bit is worth noting\b/gi,             '"It is worth noting" — lead with the fact directly.'],
        [/\bin today.s (rapidly|digital|ever)/gi,"AI topic opener — rewrite the paragraph opener."],
        [/\bin the realm of\b/gi,                '"In the realm of" — be specific about the context.'],
        [/\bin an increasingly\b/gi,             '"In an increasingly" — cut and start with the claim.'],
        [/\bas we navigate\b/gi,                 '"As we navigate" — AI opener, rewrite directly.'],
        [/\bnow more than ever\b/gi,             '"Now more than ever" — AI filler, cut it.'],
        [/\bat the end of the day\b/gi,          '"At the end of the day" — cliché, rewrite.'],
        [/\bwhen it comes to\b/gi,               '"When it comes to" — cut and lead with the subject.'],
        // Buzzword verbs
        [/\bleverage the power\b/gi,             '"Leverage the power" — replace with a plain verb.'],
        [/\bseamlessly integrat/gi,              '"Seamlessly integrate" — replace with a specific action.'],
        [/\bunlock the potential\b/gi,           '"Unlock the potential" — replace with what it actually does.'],
        [/\bdrive engagement\b/gi,              '"Drive engagement" — say what engagement metric you mean.'],
        [/\bfoster (growth|innovation|collab)/gi,'"Foster X" — use a plain verb like "build" or "grow".'],
        [/\bempower (users?|businesses?|teams?)/gi,'"Empower X" — say what they can actually do.'],
        [/\belevate your\b/gi,                   '"Elevate your" — be specific about the improvement.'],
        // Hollow adjectives
        [/\bdelve into\b/gi,                     '"Delve into" — use "cover", "explain", or "show" instead.'],
        [/\bdive into\b/gi,                      '"Dive into" — use "look at" or "walk through".'],
        [/\bcomprehensive guide\b/gi,            '"Comprehensive guide" — describe what is covered instead.'],
        [/\bultimate guide\b/gi,                 '"Ultimate guide" — replace with a specific angle.'],
        [/\brobust\b/gi,                         '"Robust" — say what property makes it strong.'],
        [/\bcutting.edge\b/gi,                   '"Cutting-edge" — name the specific advancement.'],
        [/\bgame.changing\b/gi,                  '"Game-changing" — describe the actual change.'],
        [/\bgroundbreaking\b/gi,                 '"Groundbreaking" — say what it breaks ground on.'],
        // Hedge phrases
        [/\bit is (important|essential|crucial|vital) to\b/gi, '"It is [important/essential] to" — just state the action directly.'],
        [/\bit cannot be overstated\b/gi,        '"It cannot be overstated" — overstatement. State the fact directly.'],
        [/\bit depends\b/gi,                     '"It depends" in FAQ — replace with Yes/No/number/tool/time frame.'],
        // Generic closers
        [/\bin (summary|conclusion|closing)\b/gi,'"In summary/conclusion" — cut. Let the content speak.'],
        [/\bfinal thoughts\b/gi,                 '"Final thoughts" — remove and end with the last point directly.'],
        [/\bkey takeaways?\b(?!\s*[\n<]?\s*[•\-*\d])/gi, '"Key takeaways" without a following list — remove or add bullets.'],
        [/\bto sum up\b/gi,                      '"To sum up" — AI closer, cut it.'],
        [/\bwrapping up\b/gi,                    '"Wrapping up" — remove and end the section directly.'],
    ];
    const warnings: string[] = [];
    for (const [pattern, message] of BANNED) {
        if (pattern.test(text)) warnings.push(message);
    }

    // Flags any non-keyword content word appearing >5 times in a 200-word window.
    // This is the most common cause of AI-sounding "over-repetition" complaints.
    const STOP_WORDS = new Set([
        "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
        "from","as","is","was","are","were","be","been","being","have","has","had",
        "do","does","did","will","would","could","should","may","might","can","shall",
        "this","that","these","those","it","its","they","them","their","there","here",
        "we","our","you","your","he","she","his","her","not","no","so","if","then",
        "than","when","which","who","what","how","all","any","more","most","also",
        "just","about","up","out","into","over","after","before","between",
    ]);
    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    const WINDOW = 200;
    const THRESHOLD = 5;
    const alreadyFlagged = new Set<string>();
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (STOP_WORDS.has(word) || alreadyFlagged.has(word)) continue;
        const window = words.slice(i, i + WINDOW);
        const count = window.filter(w => w === word).length;
        if (count > THRESHOLD) {
            warnings.push(`Word repetition: "${word}" appears ${count}× in a ${WINDOW}-word section — use synonyms or pronouns.`);
            alreadyFlagged.add(word);
        }
    }

    return { warnings };
}


export function validateListCount(title: string, htmlContent: string): { errors: string[] } {
    const errors: string[] = [];
    const match = title.match(/\b(\d+)\s+(ways?|best|tips?|steps?|reasons?|tools?|mistakes?|examples?|ideas?)\b/i);
    if (!match) return { errors };
    const expected = parseInt(match[1], 10);
    const actual = (htmlContent.match(/<h3[\s>]/gi) ?? []).length;
    if (actual !== expected) {
        errors.push(`Title says "${expected}" but content has ${actual} H3 items. Adjust until they match.`);
    }
    return { errors };
}

export function validateMetaDescription(meta: string): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!meta) { errors.push("Meta description is missing."); return { errors, warnings }; }
    if (meta.length > 160) errors.push(`Meta description is ${meta.length} chars — max is 160.`);
    if (meta.length < 140) warnings.push(`Meta description is ${meta.length} chars — aim for 140-160.`);
    if (/\b(best|ultimate|perfect|greatest|most powerful)\b/i.test(meta)) {
        warnings.push("Meta description contains superlatives — replace with specific coverage description.");
    }
    return { errors, warnings };
}

export function validateQuickAnswerUniqueness(
    quickAnswer: string,
    htmlContent: string
): { warnings: string[] } {
    const warnings: string[] = [];
    if (!quickAnswer) return { warnings };
    const introMatch = htmlContent.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!introMatch) return { warnings };
    const intro = introMatch[1].replace(/<[^>]+>/g, " ").toLowerCase();
    const qa = quickAnswer.toLowerCase();
    const qaWords = qa.split(/\s+/).filter(w => w.length > 4);
    const overlapCount = qaWords.filter(w => intro.includes(w)).length;
    if (overlapCount > qaWords.length * 0.6) {
        warnings.push("Quick answer overlaps heavily with intro — rewrite to add new information.");
    }
    return { warnings };
}

// ─── Evidence-Gated Fabrication Detectors (hard blocking) ─────────────────
//
// These are CODE-LEVEL validators, not LLM prompts. They catch common
// fabrication patterns in generated content and produce blocking issues
// that prevent publication.

/**
 * Detects unsourced statistics — precise percentages, multipliers, dollar
 * amounts, or user counts that appear without a named source within the
 * surrounding 2-sentence window.
 */
export function detectUnsourcedStatistics(content: string): string[] {
    const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const issues: string[] = [];

    // Patterns that look like precise stats
    const STAT_PATTERNS = [
        /\b(\d{1,3}(?:\.\d+)?)\s*%/g,                            // "37%", "4.5%"
        /\b\$\d[\d,.]*(?:\s*(?:million|billion|M|B|k))?\b/gi,    // "$1.2 million"
        /\b\d+(?:\.\d+)?x\b/gi,                                  // "3.2x"
        /\b\d[\d,]*\+?\s*(?:users?|customers?|companies|businesses|sites?|clients?)\b/gi, // "50,000 users"
    ];

    // Source attribution patterns — if present near the stat, it's OK
    const SOURCE_NEARBY = /(?:according to|source:|per |data from|reported by|study by|research by|found that|published by|survey|analysis by|[\(\[].*?(?:20\d{2}|source).*?[\)\]])/i;

    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        for (const pattern of STAT_PATTERNS) {
            pattern.lastIndex = 0;
            const match = pattern.exec(sentence);
            if (!match) continue;

            // Check surrounding 2-sentence window for source attribution
            const window = [
                sentences[i - 1] ?? "",
                sentence,
                sentences[i + 1] ?? "",
            ].join(" ");

            if (!SOURCE_NEARBY.test(window)) {
                const stat = match[0].trim();
                issues.push(
                    `Unsourced statistic: "${stat}" in "${sentence.trim().slice(0, 120)}…" — add a named source or remove the number.`
                );
            }
        }
    }

    return issues;
}

/**
 * Detects fabricated case studies — precise performance results
 * ("increased by X%", "saw Y improvement") without "hypothetical" labeling
 * or source attribution.
 */
export function detectFabricatedCaseStudies(content: string): string[] {
    const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const issues: string[] = [];

    const CASE_STUDY_RESULT_PATTERNS = [
        /(?:increased|decreased|improved|reduced|boosted|grew|dropped|rose|fell)\s+(?:by\s+)?\d[\d.]*\s*%/gi,
        /(?:saw|achieved|experienced|reported|generated|delivered)\s+(?:a\s+)?\d[\d.]*\s*%\s+(?:increase|decrease|improvement|reduction|growth|boost|drop)/gi,
        /traffic\s+(?:increased|grew|rose|jumped)\s+(?:by\s+)?\d/gi,
        /conversion(?:s|rate)?\s+(?:increased|improved|rose|jumped)\s+(?:by\s+)?\d/gi,
        /revenue\s+(?:increased|grew|rose|jumped)\s+(?:by\s+)?\d/gi,
        /bounce\s+rate\s+(?:decreased|dropped|fell|reduced)\s+(?:by\s+)?\d/gi,
    ];

    const HYPOTHETICAL_LABELS = /hypothetical|for illustration|example scenario|imagine|suppose|let's say|if a company|fictional/i;
    const SOURCE_NEARBY = /according to|source:|verified|documented|case study by|published|reported by/i;

    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        for (const pattern of CASE_STUDY_RESULT_PATTERNS) {
            pattern.lastIndex = 0;
            if (!pattern.test(sentence)) continue;

            // Check 3-sentence window for hypothetical label or source
            const window = [
                sentences[i - 2] ?? "",
                sentences[i - 1] ?? "",
                sentence,
                sentences[i + 1] ?? "",
            ].join(" ");

            if (!HYPOTHETICAL_LABELS.test(window) && !SOURCE_NEARBY.test(window)) {
                issues.push(
                    `Likely fabricated case study result: "${sentence.trim().slice(0, 150)}…" — label as hypothetical or add a verified source.`
                );
            }
        }
    }

    return issues;
}

/**
 * Detects fake expertise claims — "we tested", "in our experience",
 * "our data shows" etc. These require actual first-party evidence to use.
 */
export function detectFakeExperience(content: string, hasFirstPartyEvidence: boolean = false): string[] {
    if (hasFirstPartyEvidence) return []; // Author has real data — allow experience claims

    const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const issues: string[] = [];

    const EXPERIENCE_CLAIMS = [
        /\bwe tested\b/gi,
        /\bwe analyzed\b/gi,
        /\bwe measured\b/gi,
        /\bwe tracked\b/gi,
        /\bour (?:data|research|analysis|testing|experiments?|findings?|results?) (?:shows?|reveals?|found|indicates?|demonstrates?|confirms?)\b/gi,
        /\bour team (?:found|discovered|tested|analyzed|measured|built|ran)\b/gi,
        /\bwe ran (?:an? )?(?:experiment|test|analysis|audit|study)\b/gi,
        /\bwe surveyed\b/gi,
        /\bin our (?:testing|analysis|research|experience|work)\b/gi,
        /\bwe.ve (?:tested|seen|found|measured|tracked|analyzed)\b/gi,
    ];

    for (const pattern of EXPERIENCE_CLAIMS) {
        pattern.lastIndex = 0;
        const match = text.match(pattern);
        if (match) {
            issues.push(
                `Unverified experience claim: "${match[0]}" — remove or provide first-party evidence (set realExperience/realNumbers in author profile).`
            );
        }
    }

    return issues;
}

/**
 * Detects generic AI introductions — the 5 most common AI opener patterns.
 */
export function detectGenericIntroductions(content: string): string[] {
    const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const issues: string[] = [];

    // Only check the first 500 characters (intro area)
    const intro = text.slice(0, 500);

    const GENERIC_OPENERS = [
        [/in today.s (?:digital|rapidly|ever|modern)/i, '"In today\'s digital world..." — generic AI opener. Start with the problem, answer, or insight.'],
        [/businesses are (?:constantly|increasingly|always) (?:looking|searching|seeking)/i, '"Businesses are constantly looking..." — generic opener. Lead with the specific problem.'],
        [/finding the right (?:tool|platform|solution|software) can (?:significantly|greatly|really)/i, '"Finding the right tool can..." — generic opener. State what the reader will learn.'],
        [/(?:SEO|marketing|content) has become (?:increasingly|more|ever)/i, '"X has become increasingly important..." — generic opener. Start with the specific insight.'],
        [/whether you.re a (?:beginner|novice|expert|seasoned|small|large)/i, '"Whether you\'re a beginner or expert..." — generic opener. Pick one audience and address them directly.'],
    ] as const;

    for (const [pattern, message] of GENERIC_OPENERS) {
        if (pattern.test(intro)) {
            issues.push(message as string);
        }
    }

    return issues;
}

/**
 * Detects section-to-section repetition using word-level overlap analysis.
 * Flags sections where >60% of content words overlap with another section.
 */
export function detectRepetition(content: string): {
    duplicateSections: string[];
    repeatedParagraphs: string[];
} {
    const duplicateSections: string[] = [];
    const repeatedParagraphs: string[] = [];

    // Extract H2 sections
    const sections = content.split(/<h2[\s>]/i).slice(1); // skip before first H2
    const sectionTexts = sections.map(s => {
        const text = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return text.slice(0, 2000); // Cap per section for performance
    });

    const STOP_WORDS = new Set([
        "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
        "from","as","is","was","are","were","be","been","have","has","had",
        "do","does","did","will","would","could","should","this","that","it",
        "they","them","their","we","our","you","your","not","no","so","if",
    ]);

    function contentWords(text: string): Set<string> {
        const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
        return new Set(words.filter(w => !STOP_WORDS.has(w)));
    }

    // Compare each pair of sections
    for (let i = 0; i < sectionTexts.length; i++) {
        const wordsA = contentWords(sectionTexts[i]);
        if (wordsA.size < 10) continue; // Too short to analyze

        for (let j = i + 1; j < sectionTexts.length; j++) {
            const wordsB = contentWords(sectionTexts[j]);
            if (wordsB.size < 10) continue;

            const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
            const smallerSet = Math.min(wordsA.size, wordsB.size);
            const overlapRatio = overlap / smallerSet;

            if (overlapRatio > 0.6) {
                // Extract heading from each section
                const headingA = sections[i].match(/^([^<]*)</)?.[1]?.trim().slice(0, 80) ?? `Section ${i + 1}`;
                const headingB = sections[j].match(/^([^<]*)</)?.[1]?.trim().slice(0, 80) ?? `Section ${j + 1}`;
                duplicateSections.push(
                    `Sections "${headingA}" and "${headingB}" have ${Math.round(overlapRatio * 100)}% content overlap — merge or differentiate.`
                );
            }
        }
    }

    // Check paragraph-level repetition (same paragraph appearing twice)
    const paragraphs = content.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
    const seen = new Map<string, number>();

    for (let i = 0; i < paragraphs.length; i++) {
        const text = paragraphs[i].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (text.length < 50) continue;

        // Use first 100 chars as fingerprint
        const fingerprint = text.slice(0, 100).toLowerCase();
        if (seen.has(fingerprint)) {
            repeatedParagraphs.push(
                `Paragraph repeated (first seen at index ${seen.get(fingerprint)}, again at ${i}): "${text.slice(0, 80)}…"`
            );
        } else {
            seen.set(fingerprint, i);
        }
    }

    return { duplicateSections, repeatedParagraphs };
}

/**
 * Detects padding sections — sections that provide no new information,
 * evidence, example, analysis, comparison, or practical recommendation.
 * Uses a lightweight heuristic approach (no LLM call).
 */
export function detectPaddingSections(content: string): string[] {
    const issues: string[] = [];
    const sections = content.split(/<h2[\s>]/i).slice(1);

    // Signals that a section provides substance
    const SUBSTANCE_SIGNALS = [
        /\d+(?:\.\d+)?%/,                                    // Has a statistic
        /<(?:table|ol|ul)[\s>]/i,                             // Has structured content
        /<code[\s>]/i,                                        // Has code
        /(?:step \d|first|second|third|next|then|finally)/i,  // Has procedural steps
        /(?:for example|for instance|such as|e\.g\.|consider)/i, // Has examples
        /(?:compared to|versus|vs\.?|unlike|whereas|better than|worse than)/i, // Has comparison
        /(?:data shows?|research|study|survey|report|according to)/i, // Has evidence reference
        /(?:screenshot|diagram|chart|figure|table \d)/i,      // Has visual reference
        /(?:tip:|note:|warning:|important:|\*\*tip\*\*)/i,    // Has practical callout
    ];

    for (const section of sections) {
        const text = section.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const heading = section.match(/^([^<]*)</)?.[1]?.trim().slice(0, 80) ?? "Unknown";
        const wordCount = text.split(/\s+/).length;

        // Skip very short sections (likely not padding, just concise)
        if (wordCount < 60) continue;

        const hasSubstance = SUBSTANCE_SIGNALS.some(p => p.test(text));

        if (!hasSubstance && wordCount > 100) {
            issues.push(
                `Section "${heading}" (${wordCount} words) contains no statistics, examples, evidence, comparisons, or procedural steps. Add substance or remove.`
            );
        }
    }

    return issues;
}

// ─── Composite Validation ─────────────────────────────────────────────────

export function runCompositeValidation(params: {
    title: string;
    htmlContent: string;
    markdownContent: string;
    metaDescription: string;
    quickAnswer: string;
    comparisonTable: { problem: string; industryAvg: string; fix: string; result: string }[];
    author: { name: string; realExperience?: string | null; realNumbers?: string | null };
}): { errors: string[]; warnings: string[]; blockingIssues: string[]; passed: boolean; score: number } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const blockingIssues: string[] = [];
    let score = 100;

    const listCount = validateListCount(params.title, params.htmlContent);
    errors.push(...listCount.errors);
    score -= listCount.errors.length * 15;

    const meta = validateMetaDescription(params.metaDescription);
    errors.push(...meta.errors);
    warnings.push(...meta.warnings);
    score -= meta.errors.length * 10;
    score -= meta.warnings.length * 5;

    const qa = validateQuickAnswerUniqueness(params.quickAnswer, params.htmlContent);
    warnings.push(...qa.warnings);
    score -= qa.warnings.length * 5;

    if (params.comparisonTable?.length > 0) {
        const table = auditComparisonTable(params.comparisonTable);
        warnings.push(...table.warnings);
        score -= table.warnings.length * 5;
    }

    const banned = auditBannedPhrases(params.htmlContent);
    warnings.push(...banned.warnings);
    score -= Math.min(banned.warnings.length * 3, 15);

    const rhythmWarnings = auditRhythm(params.htmlContent);
    warnings.push(...rhythmWarnings);
    score -= Math.min(rhythmWarnings.length * 3, 12);

    // ── Evidence-gated hard checks ────────────────────────────────────────

    // Fabricated statistics (BLOCKING)
    const unsourcedStats = detectUnsourcedStatistics(params.htmlContent);
    if (unsourcedStats.length > 0) {
        blockingIssues.push(...unsourcedStats.slice(0, 10));
    }

    // Fabricated case studies (BLOCKING)
    const fabricatedCases = detectFabricatedCaseStudies(params.htmlContent);
    if (fabricatedCases.length > 0) {
        blockingIssues.push(...fabricatedCases.slice(0, 5));
    }

    // Fake experience claims (BLOCKING)
    const hasFirstPartyEvidence = !!(params.author.realExperience || params.author.realNumbers);
    const fakeExperience = detectFakeExperience(params.htmlContent, hasFirstPartyEvidence);
    if (fakeExperience.length > 0) {
        blockingIssues.push(...fakeExperience.slice(0, 5));
    }

    // Generic AI introductions (BLOCKING)
    const genericIntros = detectGenericIntroductions(params.htmlContent);
    if (genericIntros.length > 0) {
        blockingIssues.push(...genericIntros);
    }

    // Section repetition (WARNING that can escalate)
    const repetition = detectRepetition(params.htmlContent);
    if (repetition.duplicateSections.length > 0) {
        blockingIssues.push(...repetition.duplicateSections);
    }
    if (repetition.repeatedParagraphs.length > 0) {
        warnings.push(...repetition.repeatedParagraphs);
    }

    // Padding detection (WARNING)
    const padding = detectPaddingSections(params.htmlContent);
    if (padding.length > 0) {
        warnings.push(...padding);
    }

    // Word count is a WARNING, not a quality signal
    const wordCount = params.markdownContent.split(/\s+/).length;
    if (wordCount < 500) {
        errors.push(`Content too short: ${wordCount} words (minimum 500).`);
        score -= 20;
    }

    if (!params.author?.name) {
        errors.push("Author name is missing — required for E-E-A-T.");
        score -= 20;
    }

    const passed = blockingIssues.length === 0 && errors.length === 0;

    return { errors, warnings, blockingIssues, passed, score: Math.max(0, score) };
}

