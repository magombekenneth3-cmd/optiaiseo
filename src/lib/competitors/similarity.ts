// =============================================================================
// Competitor detection engine — Similarity Engine
//
// computeSimilarity() compares two BusinessFingerprints across 4 axes:
//   Service overlap (40%) — do they sell the same things?
//   Business model (25%) — B2B SaaS vs marketplace vs blog?
//   Intent type    (20%) — transactional vs informational?
//   Audience       (15%) — same buyer?
//
// Pure string logic — zero API calls, zero embeddings.
// Synonym expansion prevents Jaccard failing on "AI SEO tool" vs "search optimisation software".
// =============================================================================

import type { BusinessFingerprint, SimilarityResult } from "./types";

// Synonym groups — tokens in the same group are treated as identical
// Each set defines a cluster of interchangeable terms.

const SYNONYM_GROUPS: string[][] = [
    // SEO / Search
    ["seo", "search", "optimisation", "optimization", "serp", "ranking", "rankings"],
    // AI / ML
    ["ai", "artificial", "intelligence", "machine", "learning", "ml", "llm", "gpt"],
    // Content
    ["content", "blog", "blogging", "writing", "copywriting", "article", "editorial"],
    // Marketing
    ["marketing", "digital", "advertising", "ads", "campaign", "growth", "inbound"],
    // Analytics / Data
    ["analytics", "data", "insights", "reporting", "metrics", "dashboard", "tracking"],
    // Audit / Analysis
    ["audit", "analysis", "analyse", "analyze", "review", "assessment", "check", "scan"],
    // Software / Tool / Platform
    ["software", "tool", "tools", "platform", "suite", "app", "application", "solution", "saas"],
    // Agency / Service
    ["agency", "service", "services", "consulting", "consultancy", "management"],
    // E-commerce
    ["ecommerce", "e-commerce", "shop", "store", "retail", "shopping", "commerce"],
    // Keyword / Research
    ["keyword", "keywords", "research", "discovery", "kw"],
    // Link / Backlink
    ["link", "backlink", "backlinks", "links", "linkbuilding", "outreach"],
    // Technical / Code
    ["technical", "tech", "code", "coding", "development", "developer", "engineering"],
    // Local / Location
    ["local", "location", "geo", "regional", "nearby", "maps"],
    // Competitor / Competition
    ["competitor", "competitors", "competitive", "competition", "rival", "rivals"],
    // Social / Social Media
    ["social", "socialmedia", "social-media", "facebook", "instagram", "twitter"],
    // Email
    ["email", "newsletter", "mailing", "inbox"],
    // CRM / Customer
    ["crm", "customer", "client", "clients", "customers", "relationship"],
    // Finance / Accounting
    ["finance", "financial", "accounting", "billing", "payments", "invoicing"],
    // Education / Learning
    ["education", "learning", "training", "course", "courses", "academy"],
    // Health / Medical
    ["health", "medical", "healthcare", "clinic", "wellness", "fitness"],
    // Real estate / Property
    ["realestate", "real-estate", "property", "properties", "housing", "homes"],
];

// Build a token → canonical map (first token in group is canonical)
const SYNONYM_MAP = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
    const canonical = group[0];
    for (const term of group) {
        SYNONYM_MAP.set(term, canonical);
    }
}

// Public API

/**
 * Computes weighted similarity between a site's fingerprint and a candidate's.
 * Returns a SimilarityResult with an overall 0–1 score and axis breakdown.
 */
export function computeSimilarity(
    site:      BusinessFingerprint,
    candidate: BusinessFingerprint,
): SimilarityResult {
    const service       = serviceOverlap(site.coreServices, candidate.coreServices);
    const businessModel = businessModelSimilarity(site.businessModel, candidate.businessModel);
    const intent        = intentSimilarity(site.intentType, candidate.intentType);
    const audience      = audienceSimilarity(site.audience, candidate.audience);

    const overall =
        service       * 0.40 +
        businessModel * 0.25 +
        intent        * 0.20 +
        audience      * 0.15;

    return {
        overall: clamp(overall),
        breakdown: { service, businessModel, intent, audience },
        competitorType: deriveType(overall, businessModel, site, candidate),
    };
}

// Axis scorers

/**
 * Synonym-aware Jaccard similarity between service arrays.
 * "AI SEO audit tool" and "search engine optimisation software" now share
 * canonical tokens ["seo", "software"] → meaningful overlap instead of 0.
 */
function serviceOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0.2; // neutral when unknown

    const tokensA = canonicalize(tokenize(a.join(" ")));
    const tokensB = canonicalize(tokenize(b.join(" ")));

    if (tokensA.size === 0 || tokensB.size === 0) return 0.2;

    const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
    const union        = new Set([...tokensA, ...tokensB]);

    const jaccard = intersection.size / union.size;

    // Boost if one side is a subset of the other (tight niche match)
    const subsetBonus = isSubset(tokensA, tokensB) || isSubset(tokensB, tokensA) ? 0.15 : 0;

    return clamp(jaccard + subsetBonus);
}

/**
 * Business model similarity matrix.
 * Identical = 1.0, same broad category = 0.6–0.8, different = 0.1–0.3
 */
function businessModelSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;

    const GROUPS: Record<string, string> = {
        "b2b-saas":   "saas",
        "b2c-saas":   "saas",
        "marketplace":"platform-adjacent",
        "platform":   "platform-adjacent",
        "services":   "services",
        "ecommerce":  "commerce",
        "content":    "media",
        "other":      "other",
    };

    const ga = GROUPS[a] ?? "other";
    const gb = GROUPS[b] ?? "other";

    if (ga === gb) return 0.75;

    // Adjacent pairings
    const ADJACENT_PAIRS: [string, string][] = [
        ["saas", "platform-adjacent"],
        ["services", "saas"],
    ];
    const isAdjacent = ADJACENT_PAIRS.some(
        ([x, y]) => (ga === x && gb === y) || (ga === y && gb === x)
    );
    if (isAdjacent) return 0.45;

    // Penalise hard mismatches
    if ((ga === "media" || gb === "media") && ga !== gb) return 0.05;

    return 0.20;
}

/**
 * Intent similarity.
 * Same = 1.0, one mixed = 0.6, opposite = 0.1
 */
function intentSimilarity(
    a: "transactional" | "informational" | "mixed",
    b: "transactional" | "informational" | "mixed",
): number {
    if (a === b) return 1.0;
    if (a === "mixed" || b === "mixed") return 0.6;
    // transactional vs informational → hard penalty
    return 0.1;
}

/**
 * Audience similarity — synonym-aware token overlap on the audience string.
 * "seo agencies" vs "search marketing professionals" now matches via canonical "seo".
 */
function audienceSimilarity(a: string, b: string): number {
    if (!a || !b) return 0.3; // neutral when unknown
    const tokensA = canonicalize(tokenize(a));
    const tokensB = canonicalize(tokenize(b));
    if (tokensA.size === 0 || tokensB.size === 0) return 0.3;
    const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
    const union        = new Set([...tokensA, ...tokensB]);
    return clamp(intersection.size / union.size);
}

// Competitor type derivation

function deriveType(
    overall:       number,
    businessModel: number,
    site:          BusinessFingerprint,
    candidate:     BusinessFingerprint,
): SimilarityResult["competitorType"] {
    // Hard content/media classification
    if (candidate.businessModel === "content" || candidate.industry === "media") {
        return "content";
    }
    // Platform/aggregator
    if (candidate.businessModel === "platform" || candidate.businessModel === "marketplace") {
        return "platform";
    }
    // Strong direct competitor
    if (overall >= 0.65 && businessModel >= 0.7) return "direct";
    // Weak overlap
    if (overall >= 0.35) return "indirect";
    // Catch-all
    if (site.industry === candidate.industry) return "indirect";
    return "content";
}

// Penalty helpers (used by detect.ts)

/**
 * Returns a multiplier (0–1) to apply to the raw SERP score
 * based on competitor type. "content" and "platform" are penalised heavily.
 */
export function typePenalty(type: SimilarityResult["competitorType"]): number {
    const PENALTIES: Record<SimilarityResult["competitorType"], number> = {
        direct:   1.0,
        indirect: 0.65,
        content:  0.15,
        platform: 0.20,
    };
    return PENALTIES[type] ?? 0.5;
}

// Utility

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "for", "of", "in", "to", "with", "is", "on", "at", "by"]);

function tokenize(text: string): Set<string> {
    return new Set(
        text.toLowerCase()
            .split(/[\s,;:\/\-_()\[\]]+/)
            .filter(t => t.length > 2 && !STOP_WORDS.has(t))
    );
}

/** Replace each token with its canonical synonym if one exists. */
function canonicalize(tokens: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const t of tokens) {
        result.add(SYNONYM_MAP.get(t) ?? t);
    }
    return result;
}

function isSubset(small: Set<string>, large: Set<string>): boolean {
    return [...small].every(t => large.has(t));
}

function clamp(v: number): number {
    return Math.max(0, Math.min(1, v));
}
