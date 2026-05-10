// =============================================================================
// Competitor detection engine — shared types
// =============================================================================

/** A service/product offering detected from a website */
export interface DetectedService {
    /** Search-optimised name, e.g. "fibre broadband Uganda" */
    name: string;
    /** Human-readable label, e.g. "Fibre Broadband" */
    label: string;
}

/** A ranked competitor domain */
export interface Competitor {
    /** Bare hostname, e.g. "rival.io" */
    domain: string;
    /** Which service this competitor was found for */
    service: DetectedService;
    /** Final weighted score — higher = stronger match */
    score: number;
    /** Highest Google position this domain appeared at */
    bestPosition: number;
    /** How many search queries this domain appeared in */
    frequency: number;
    /** Raw SERP score before weighting: frequency × 1/√position */
    serpScore?: number;
    /** Similarity engine output (0–1) */
    similarityScore?: number;
    /** Relationship type to the user's site */
    competitorType?: "direct" | "indirect" | "content" | "platform";
    /** AI verification confidence (0–1) */
    confidence?: number;
    /** Human-readable reason from AI verification */
    reason?: string;
    /** Full score breakdown for explainability/debugging */
    scoreBreakdown?: {
        serp:       number;
        similarity: number;
        intent:     number;
        confidence: number;
    };
}

/** Final result returned by detectCompetitorsCore() */
export interface CompetitorDetectionResult {
    domain:      string;
    services:    DetectedService[];
    competitors: Competitor[];
    warnings:    string[];
}

/** Internal search result from Serper */
export interface SerperSearchResult {
    domainFrequency:    Map<string, number>;
    domainBestPosition: Map<string, number>;
    /** Best snippet text seen for each domain across all queries (title + snippet) */
    domainSnippets:     Map<string, string>;
}


/**
 * Structured identity of a business.
 * Built from: site title+meta, ranking keywords, AI extraction output.
 * Cached by domain — one Claude call per domain per detection session.
 */
export interface BusinessFingerprint {
    domain:        string;
    /** High-level industry: "saas" | "agency" | "ecommerce" | "local" | "media" | "finance" | ... */
    industry:      string;
    /** Revenue/delivery model: "b2b-saas" | "b2c-saas" | "marketplace" | "services" | "content" | "platform" */
    businessModel: string;
    /** The actual services/products this business sells */
    coreServices:  string[];
    /** Primary buyer intent: transactional = they charge money, informational = mostly content */
    intentType:    "transactional" | "informational" | "mixed";
    /** Target buyer, e.g. "seo agencies", "small business owners", "enterprise" */
    audience:      string;
    /** 0–1: confidence in this fingerprint (higher when more data was available) */
    confidence:    number;
}

/** Output of the similarity engine for a pair of fingerprints */
export interface SimilarityResult {
    /** Weighted overall similarity 0–1 */
    overall:  number;
    breakdown: {
        service:       number;
        businessModel: number;
        intent:        number;
        audience:      number;
    };
    /** Inferred relationship */
    competitorType: "direct" | "indirect" | "content" | "platform";
}

/** Structured verdict returned by the upgraded AI verification pass */
export interface VerificationVerdict {
    domain:     string;
    type:       "direct" | "indirect" | "content" | "platform" | "irrelevant";
    similarity: number;   // 0–1
    confidence: number;   // 0–1
    reason:     string;
}
