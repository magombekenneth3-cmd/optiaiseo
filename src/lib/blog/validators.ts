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

export function runCompositeValidation(params: {
    title: string;
    htmlContent: string;
    markdownContent: string;
    metaDescription: string;
    quickAnswer: string;
    comparisonTable: { problem: string; industryAvg: string; fix: string; result: string }[];
    author: { name: string };
}): { errors: string[]; warnings: string[]; score: number } {
    const errors: string[] = [];
    const warnings: string[] = [];
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

    const wordCount = params.markdownContent.split(/\s+/).length;
    if (wordCount < 1500) {
        warnings.push(`Content is ${wordCount} words — aim for at least 2000.`);
        score -= 10;
    }

    if (!params.author?.name) {
        errors.push("Author name is missing — required for E-E-A-T.");
        score -= 20;
    }

    return { errors, warnings, score: Math.max(0, score) };
}
