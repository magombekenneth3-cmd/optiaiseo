export interface BrandIdentity {
    domain: string;
    slug: string;
    displayName: string;
    variants: string[];
    citationRegex: RegExp;
}

/**
 * Suffixes used for two purposes:
 *  1. Recursive slug splitting: "surfer-seo" → ["surfer","seo"] → "Surfer SEO"
 *  2. Abbreviated variant generation: strip suffix to catch "OptiAI" from "OptiAISEO"
 *
 * Ordered longest-first so "aio" wins over "ai", "geo" wins over single-char.
 * Exclude "io","hq","ly","ify" from slug-split (TLD/suffix noise, not word parts).
 *
 * NOTE: These are used ONLY when the slug contains an explicit word boundary
 * (hyphen, underscore, camelCase). For all-lowercase slugs with no boundary,
 * we preserve the full slug as a single token to avoid mangling brand names
 * like "optiaiseo" → "Opti AI SEO".
 */
const SLUG_SPLIT_SUFFIXES = [
    "tool", "labs", "aio", "geo", "seo", "api", "app", "pro", "dev", "kit", "ai",
] as const;

const TECH_SUFFIXES = [
    "seo", "ai", "aio", "app", "io", "hub", "hq", "ly", "ify",
    "pro", "tool", "labs", "api", "dev", "kit",
] as const;

/** Words that should always be fully uppercased in display names. */
const ACRONYMS = new Set(["ai", "seo", "aio", "geo", "api", "ml", "llm", "gpt", "ui", "ux", "saas"]);

/**
 * Recursively peel known tech suffixes from the right of a slug to find word
 * boundaries that are invisible in a lowercase domain string.
 *
 * IMPORTANT: This is ONLY called when we already have evidence of word
 * boundaries (hyphens/underscores/camelCase). For plain all-lowercase slugs
 * with no separator, we do NOT auto-split — the slug is returned as-is to
 * preserve the brand owner's intended name (e.g. "optiaiseo" stays "optiaiseo",
 * displayed as "OptiAISEO" via toDisplayWord, not "Opti AI SEO").
 *
 * "surfer-seo" (hyphen split first) → ["surfer", "seo"]
 * "hubspot"    → ["hubspot"]   (no known suffix — not called for plain slugs)
 */
function splitSlugBySuffixes(slug: string): string[] {
    for (const suffix of SLUG_SPLIT_SUFFIXES) {
        if (slug.endsWith(suffix) && slug.length > suffix.length + 1) {
            const rest = slug.slice(0, -suffix.length);
            if (rest.length >= 2) {
                return [...splitSlugBySuffixes(rest), suffix];
            }
        }
    }
    return [slug];
}

/** Title-case a single word, uppercasing if it's a known acronym. */
function toDisplayWord(word: string): string {
    return ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Smart display name for a single all-lowercase slug with no explicit boundaries.
 *
 * Strategy: capitalise the first letter and uppercase any embedded ACRONYM tokens
 * that appear as substrings, working left-to-right greedily. This preserves the
 * brand's casing intent without inserting unwanted spaces.
 *
 * Examples:
 *   "optiaiseo"  → "OptiAISEO"
 *   "surferseo"  → "SurferSEO"
 *   "hubspot"    → "Hubspot"
 *   "ahrefs"     → "Ahrefs"
 *   "semrush"    → "Semrush"
 */
function toDisplayNameNoSplit(slug: string): string {
    // Sort ACRONYMS longest-first so "saas" matches before "aa"
    const acronymsSorted = Array.from(ACRONYMS).sort((a, b) => b.length - a.length);
    let result = "";
    let i = 0;
    // Capitalise the very first character
    let firstCharDone = false;

    while (i < slug.length) {
        let matched = false;
        for (const acronym of acronymsSorted) {
            if (slug.startsWith(acronym, i)) {
                result += acronym.toUpperCase();
                i += acronym.length;
                matched = true;
                firstCharDone = true;
                break;
            }
        }
        if (!matched) {
            const ch = slug[i];
            result += firstCharDone ? ch : ch.toUpperCase();
            firstCharDone = true;
            i++;
        }
    }
    return result;
}

export function extractBrandIdentity(rawDomain: string, brandNameOverride?: string | null): BrandIdentity {
    const domain = rawDomain
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .trim();

    const firstLabel = domain.split(".")[0];

    // Only split if the original slug (before lowercasing) has separators or
    // camelCase. Since domains are always lowercase, we can only detect
    // hyphens/underscores here — camelCase detection is left for non-domain
    // use cases.
    const hasExplicitBoundary = /[-_]/.test(firstLabel);

    let words: string[];
    let displayName: string;

    if (hasExplicitBoundary) {
        // Hyphenated slug: "surfer-seo" → ["surfer", "seo"] → "Surfer SEO"
        words = firstLabel
            .split(/[-_]+/)
            .flatMap((part) => splitSlugBySuffixes(part));
        displayName = brandNameOverride?.trim() || words.map(toDisplayWord).join(" ");
    } else {
        // All-lowercase, no separator: preserve the slug as a single token.
        // toDisplayNameNoSplit capitalises intelligently without adding spaces.
        words = [firstLabel];
        displayName = brandNameOverride?.trim() || toDisplayNameNoSplit(firstLabel);
    }

    // Include every reasonable way a human or LLM might write the brand name.
    const spaced = words.map((w) => w.toLowerCase()).join(" ");     // "opti ai seo" (only useful if split)
    const collapsed = firstLabel.toLowerCase();                      // "optiaiseo"
    const displayLower = displayName.toLowerCase();                  // e.g. "optiaiseo"

    const variantSet = new Set<string>([
        collapsed,                                // "optiaiseo"
        displayName,                              // "OptiAISEO" (mixed case, kept for regex)
        displayLower,                             // "optiaiseo"
        spaced,                                   // "opti ai seo" (for split slugs)
        ...(brandNameOverride
            ? [
                brandNameOverride.trim(),
                brandNameOverride.trim().toLowerCase(),
                brandNameOverride.trim().toLowerCase().replace(/\s+/g, ""),
              ]
            : []),
    ]);

    // Suffix-stripped abbreviated forms: "optiai" catches "OptiAI" mentions
    for (const suffix of TECH_SUFFIXES) {
        const slug = firstLabel.toLowerCase();
        if (slug.endsWith(suffix) && slug.length > suffix.length + 2) {
            variantSet.add(slug.slice(0, -suffix.length));
        }
    }

    const variants = Array.from(variantSet).filter((v) => v.length >= 3);

    const escapedDomain = domain.replace(/\./g, "\\.");
    const parts = [
        `(?:www\\.)?${escapedDomain}`,
        ...variants.map((v) => `\\b${v.replace(/\s+/g, "[\\s\\-]*")}\\b`),
    ];
    const citationRegex = new RegExp(parts.join("|"), "i");

    return { domain, slug: firstLabel.toLowerCase(), displayName, variants, citationRegex };
}

export function isBrandCited(responseText: string, identity: BrandIdentity): boolean {
    return identity.citationRegex.test(responseText);
}

//
// brandProminenceScore() returns 0–100. Scores 10–40 are "low confidence" —
// the regex found something, but it may be a partial match or a co-mention
// rather than a genuine citation. Surface these for human review instead of
// silently treating them as certain positives or certain negatives.
//
// Tier thresholds:
//   absent         0–9   — regex found nothing
//   low_confidence 10–39 — weak signal; possible regex miss or false positive
//   certain        40+   — confident citation
export type MentionConfidenceTier = "certain" | "low_confidence" | "absent";

export function classifyMentionConfidence(score: number): MentionConfidenceTier {
    if (score >= 40) return "certain";
    if (score >= 10) return "low_confidence";
    return "absent";
}

export function brandProminenceScore(responseText: string, identity: BrandIdentity): number {
    if (!responseText) return 0;

    const lower = responseText.toLowerCase();
    let firstIndex = Infinity;
    let totalCount = 0;

    for (const variant of identity.variants) {
        const variantRegex = new RegExp(
            `\\b${variant.replace(/\s+/g, "[\\s\\-]*")}\\b`,
            "gi",
        );
        let match: RegExpExecArray | null;
        while ((match = variantRegex.exec(lower)) !== null) {
            totalCount++;
            if (match.index < firstIndex) firstIndex = match.index;
        }
    }

    const domainIdx = lower.indexOf(identity.domain);
    if (domainIdx !== -1 && domainIdx < firstIndex) firstIndex = domainIdx;

    if (firstIndex === Infinity) return 0;

    const positionScore = Math.round((1 - firstIndex / responseText.length) * 70);
    const frequencyScore = Math.min(30, totalCount * 10);
    return Math.min(100, positionScore + frequencyScore);
}