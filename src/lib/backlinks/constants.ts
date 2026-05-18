/**
 * Shared backlink constants — single source of truth.
 * Import from here in both production code and test files
 * to keep detection rules and test fixtures in sync.
 */

/** Keywords that indicate a toxic / spammy backlink anchor text. */
export const TOXIC_KEYWORDS = [
    // Gambling
    "casino", "poker", "slots", "bet", "gambling", "lottery",
    // Pharma
    "viagra", "cialis", "pharmacy", "pills", "medication", "drug",
    // Adult
    "porn", "adult", "xxx", "sex", "escort", "nude",
    // Finance spam (previously only in tests)
    "cbd", "loan", "payday",
] as const;

export type ToxicKeyword = typeof TOXIC_KEYWORDS[number];
