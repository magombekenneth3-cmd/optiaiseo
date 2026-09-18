/**
 * Evidence Gate — Hard-blocking evidence validator.
 *
 * Runs AFTER the editorial pass, BEFORE save. Orchestrates all sub-checks
 * from validators.ts and produces a single pass/fail result.
 *
 * Architecture:
 *   content + evidencePacket → evidence gate → { passed, blockingIssues, warnings }
 *
 * The gate does NOT use LLM calls. It uses code-level pattern matching
 * to catch the most common fabrication patterns. The LLM is responsible
 * for producing good content; the gate is responsible for catching
 * content that should not be published.
 */

import { logger } from "@/lib/logger";
import type { EvidencePacket, SourceEvidence } from "./contracts";
import {
    detectUnsourcedStatistics,
    detectFabricatedCaseStudies,
    detectFakeExperience,
    detectGenericIntroductions,
    detectRepetition,
    detectPaddingSections,
} from "./validators";

// ─── Types ────────────────────────────────────────────────────────────────

export interface EvidenceGateResult {
    passed: boolean;
    blockingIssues: string[];
    warnings: string[];
    fabricatedStats: string[];
    fabricatedCaseStudies: string[];
    fakeExperience: string[];
    genericIntros: string[];
    repetitionIssues: string[];
    paddingIssues: string[];
}

export interface EvidenceGateInput {
    /** The final HTML content to validate */
    content: string;
    /** Evidence gathered during the research phase */
    evidencePacket: EvidencePacket | null;
    /** Whether the author has real first-party evidence */
    hasFirstPartyEvidence: boolean;
    /** Risk tier from prompt context (high/medium/low) */
    riskTier: string;
}

// ─── Source verification ──────────────────────────────────────────────────

/**
 * Checks that source URLs in the evidence packet are plausible.
 * Does NOT fetch the URLs (too slow for a gate), but validates format
 * and known domain patterns.
 */
function validateSourceUrls(sources: SourceEvidence[]): string[] {
    const issues: string[] = [];

    for (const source of sources) {
        try {
            const url = new URL(source.url);

            // Flag localhost, IP, or obviously fake domains
            if (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
                issues.push(`Source "${source.title}" has a non-public URL: ${source.url}`);
            }

            // Flag obviously AI-hallucinated domains
            if (/example\.com|test\.com|fake\.com|placeholder/i.test(url.hostname)) {
                issues.push(`Source "${source.title}" uses a placeholder URL: ${source.url}`);
            }
        } catch {
            issues.push(`Source "${source.title}" has an invalid URL: ${source.url}`);
        }
    }

    return issues;
}

/**
 * Cross-checks claims in the evidence packet against available sources.
 * Claims with type "statistic" or "fact" that reference no source IDs
 * produce blocking issues.
 */
function validateClaimProvenance(evidencePacket: EvidencePacket): string[] {
    const issues: string[] = [];
    const sourceIds = new Set(evidencePacket.sources.map(s => s.id));

    for (const claim of evidencePacket.claims) {
        // Statistics and facts MUST have at least one source
        if ((claim.type === "statistic" || claim.type === "fact") && claim.sourceIds.length === 0) {
            issues.push(
                `Claim with no source: "${claim.text.slice(0, 120)}…" (type: ${claim.type}) — add a source or rewrite as opinion.`
            );
        }

        // Verify referenced source IDs actually exist
        for (const sid of claim.sourceIds) {
            if (!sourceIds.has(sid)) {
                issues.push(
                    `Claim references non-existent source ID "${sid}": "${claim.text.slice(0, 80)}…"`
                );
            }
        }
    }

    return issues;
}

/**
 * Validates case studies in the evidence packet.
 * Unverified case studies with precise outcomes are blocked.
 */
function validateCaseStudies(evidencePacket: EvidencePacket): string[] {
    const issues: string[] = [];

    for (const cs of evidencePacket.caseStudies) {
        if (!cs.isVerified) {
            // Check if the outcome contains precise numbers
            if (/\d+(?:\.\d+)?%|\$\d|\d+x\b/.test(cs.outcome)) {
                issues.push(
                    `Unverified case study "${cs.subject}" has precise results: "${cs.outcome.slice(0, 100)}" — verify or label as hypothetical.`
                );
            }
        }

        if (cs.isVerified && cs.sourceIds.length === 0) {
            issues.push(
                `Case study "${cs.subject}" claims verified status but has no source IDs.`
            );
        }
    }

    return issues;
}

// ─── Main gate ────────────────────────────────────────────────────────────

/**
 * Orchestrates all evidence checks and returns a single pass/fail result.
 *
 * Blocking rules (any of these → EVIDENCE_REVIEW or REJECTED):
 * - Statistic with no source
 * - Case study with precise results and no verification
 * - "We tested" claims with no first-party evidence
 * - Generic AI introduction
 * - Section-level content duplication
 *
 * Warning rules (logged but non-blocking):
 * - Paragraph-level repetition
 * - Padding sections
 * - Source URL format issues
 */
export function runEvidenceGate(input: EvidenceGateInput): EvidenceGateResult {
    const { content, evidencePacket, hasFirstPartyEvidence, riskTier } = input;

    // Run all code-level detectors
    const fabricatedStats = detectUnsourcedStatistics(content);
    const fabricatedCaseStudies = detectFabricatedCaseStudies(content);
    const fakeExperience = detectFakeExperience(content, hasFirstPartyEvidence);
    const genericIntros = detectGenericIntroductions(content);
    const repetition = detectRepetition(content);
    const paddingIssues = detectPaddingSections(content);

    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    // Fabricated statistics → BLOCKING
    if (fabricatedStats.length > 0) {
        blockingIssues.push(...fabricatedStats.slice(0, 10));
    }

    // Fabricated case studies → BLOCKING
    if (fabricatedCaseStudies.length > 0) {
        blockingIssues.push(...fabricatedCaseStudies.slice(0, 5));
    }

    // Fake experience → BLOCKING
    if (fakeExperience.length > 0) {
        blockingIssues.push(...fakeExperience.slice(0, 5));
    }

    // Generic intro → BLOCKING
    if (genericIntros.length > 0) {
        blockingIssues.push(...genericIntros);
    }

    // Section duplication → BLOCKING
    if (repetition.duplicateSections.length > 0) {
        blockingIssues.push(...repetition.duplicateSections);
    }

    // Paragraph repetition → WARNING
    if (repetition.repeatedParagraphs.length > 0) {
        warnings.push(...repetition.repeatedParagraphs);
    }

    // Padding → WARNING (unless high-risk, then BLOCKING)
    if (paddingIssues.length > 0) {
        if (riskTier === "high") {
            blockingIssues.push(...paddingIssues);
        } else {
            warnings.push(...paddingIssues);
        }
    }

    // Evidence packet validation (if available)
    if (evidencePacket) {
        const sourceIssues = validateSourceUrls(evidencePacket.sources);
        warnings.push(...sourceIssues);

        const provenanceIssues = validateClaimProvenance(evidencePacket);
        if (provenanceIssues.length > 0) {
            // For high-risk topics, provenance issues are blocking
            if (riskTier === "high") {
                blockingIssues.push(...provenanceIssues);
            } else {
                warnings.push(...provenanceIssues);
            }
        }

        const caseStudyIssues = validateCaseStudies(evidencePacket);
        blockingIssues.push(...caseStudyIssues);
    }

    const passed = blockingIssues.length === 0;

    if (!passed) {
        logger.warn("[Evidence Gate] BLOCKED — article has evidence issues", {
            blockingCount: blockingIssues.length,
            warningCount: warnings.length,
            topIssues: blockingIssues.slice(0, 3),
        });
    } else {
        logger.info("[Evidence Gate] PASSED", {
            warningCount: warnings.length,
        });
    }

    return {
        passed,
        blockingIssues,
        warnings,
        fabricatedStats,
        fabricatedCaseStudies,
        fakeExperience,
        genericIntros,
        repetitionIssues: [
            ...repetition.duplicateSections,
            ...repetition.repeatedParagraphs,
        ],
        paddingIssues,
    };
}
