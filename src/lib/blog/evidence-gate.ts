/**
 * Evidence Gate — provenance validator for the final article.
 *
 * The extractor supplies an EvidencePacket from the authoritative research
 * snapshot and final content. Missing support is an editorial review issue;
 * only independently proven fabrication is a rejection issue.
 */

import { logger } from "@/lib/logger";
import type {
    EvidenceAvailability,
    EvidencePacket,
    SourceEvidence,
} from "./contracts";
import {
    detectFakeExperience,
    detectGenericIntroductions,
    detectPaddingSections,
    detectRepetition,
} from "./validators";

export interface EvidenceGateResult {
    passed: boolean;
    availability: EvidenceAvailability;
    /** Evidence deficiencies that require EVIDENCE_REVIEW. */
    blockingIssues: string[];
    /** Editorial concerns that require NEEDS_REVIEW when evidence passes. */
    editorialIssues: string[];
    warnings: string[];
    unsourcedStatistics: string[];
    unverifiedCaseStudies: string[];
    unsupportedClaims: string[];
    /** Only claims independently proven false belong here. */
    fabricatedClaims: string[];
    fakeExperience: string[];
    genericIntros: string[];
    repetitionIssues: string[];
    paddingIssues: string[];
}

export interface EvidenceGateInput {
    content: string;
    /** A concrete packet is required at the publication boundary. */
    evidencePacket: EvidencePacket;
    hasFirstPartyEvidence: boolean;
    riskTier: string;
}

function validateSourceUrls(sources: SourceEvidence[]): string[] {
    const issues: string[] = [];

    for (const source of sources) {
        try {
            const url = new URL(source.url);
            if (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
                issues.push(`Source "${source.title}" has a non-public URL: ${source.url}`);
            }
            if (/example\.com|test\.com|fake\.com|placeholder/i.test(url.hostname)) {
                issues.push(`Source "${source.title}" uses a placeholder URL: ${source.url}`);
            }
        } catch {
            issues.push(`Source "${source.title}" has an invalid URL: ${source.url}`);
        }
    }

    return issues;
}

function validateClaimProvenance(evidencePacket: EvidencePacket): string[] {
    const issues: string[] = [];
    const sourceIds = new Set(evidencePacket.sources.map(source => source.id));
    const mappingByClaim = new Map(
        evidencePacket.claimSourceMap.map(mapping => [mapping.claim, mapping]),
    );

    for (const claim of evidencePacket.claims) {
        const mapping = mappingByClaim.get(claim.text);
        if (!mapping) {
            issues.push(`Claim has no provenance mapping: "${claim.text.slice(0, 120)}…"`);
        }
        if ((claim.type === "statistic" || claim.type === "fact") && claim.sourceIds.length === 0) {
            issues.push(`Claim with no source: "${claim.text.slice(0, 120)}…" (type: ${claim.type}) — add a source or rewrite it.`);
        }
        for (const sourceId of claim.sourceIds) {
            if (!sourceIds.has(sourceId)) {
                issues.push(`Claim references non-existent source ID "${sourceId}": "${claim.text.slice(0, 80)}…"`);
            }
        }
        if (mapping && mapping.sourceIds.some(sourceId => !sourceIds.has(sourceId))) {
            issues.push(`Provenance mapping references a non-existent source for claim "${claim.text.slice(0, 80)}…"`);
        }
    }

    return issues;
}

function validateCaseStudies(evidencePacket: EvidencePacket): string[] {
    const issues: string[] = [];
    const sourceIds = new Set(evidencePacket.sources.map(source => source.id));

    for (const caseStudy of evidencePacket.caseStudies) {
        if (!caseStudy.isVerified && /\d+(?:\.\d+)?%|\$\d|\d+x\b/.test(caseStudy.outcome)) {
            issues.push(`Unverified case study "${caseStudy.subject}" has precise results: "${caseStudy.outcome.slice(0, 100)}".`);
        }
        if (caseStudy.isVerified && caseStudy.sourceIds.length === 0) {
            issues.push(`Case study "${caseStudy.subject}" claims verified status but has no source IDs.`);
        }
        if (caseStudy.sourceIds.some(sourceId => !sourceIds.has(sourceId))) {
            issues.push(`Case study "${caseStudy.subject}" references a non-existent source ID.`);
        }
    }

    return issues;
}

/**
 * Runs code-level evidence and provenance checks. It never infers fabrication
 * from a missing citation: that result is EVIDENCE_REVIEW, not REJECTED.
 */
export function runEvidenceGate(input: EvidenceGateInput): EvidenceGateResult {
    const { content, evidencePacket, hasFirstPartyEvidence, riskTier } = input;
    const blockingIssues: string[] = [];
    const editorialIssues: string[] = [];
    const warnings: string[] = [];

    const fakeExperience = detectFakeExperience(content, hasFirstPartyEvidence);
    const genericIntros = detectGenericIntroductions(content);
    const repetition = detectRepetition(content);
    const paddingIssues = detectPaddingSections(content);

    if (evidencePacket.availability !== "AVAILABLE") {
        const message = evidencePacket.availability === "UNAVAILABLE"
            ? "Evidence research or extraction was unavailable; automatic publication is blocked."
            : "Research completed without usable source evidence; automatic publication is blocked.";
        blockingIssues.push(message);
    }

    if (evidencePacket.availability === "AVAILABLE") {
        blockingIssues.push(...validateSourceUrls(evidencePacket.sources));
        blockingIssues.push(...validateClaimProvenance(evidencePacket));
        blockingIssues.push(...validateCaseStudies(evidencePacket));
        blockingIssues.push(...evidencePacket.unsupportedClaims);
        blockingIssues.push(...evidencePacket.unsourcedStatistics);
        blockingIssues.push(...evidencePacket.unverifiedCaseStudies);
    }

    // First-party claims are supportable only when actual author evidence was
    // provided; otherwise they need evidence review, not a fabrication label.
    blockingIssues.push(...fakeExperience.slice(0, 5));

    // These are editorial quality findings, not evidence availability claims.
    editorialIssues.push(...genericIntros);
    editorialIssues.push(...repetition.duplicateSections);
    if (paddingIssues.length > 0) {
        if (riskTier === "high") editorialIssues.push(...paddingIssues);
        else warnings.push(...paddingIssues);
    }
    warnings.push(...repetition.repeatedParagraphs);

    const passed = blockingIssues.length === 0;
    if (!passed) {
        logger.warn("[Evidence Gate] REVIEW REQUIRED", {
            availability: evidencePacket.availability,
            blockingCount: blockingIssues.length,
            topIssues: blockingIssues.slice(0, 3),
        });
    } else {
        logger.info("[Evidence Gate] Evidence passed", {
            availability: evidencePacket.availability,
            editorialIssueCount: editorialIssues.length,
            warningCount: warnings.length,
        });
    }

    return {
        passed,
        availability: evidencePacket.availability,
        blockingIssues: [...new Set(blockingIssues)].slice(0, 50),
        editorialIssues: [...new Set(editorialIssues)].slice(0, 30),
        warnings: [...new Set(warnings)].slice(0, 50),
        unsourcedStatistics: evidencePacket.unsourcedStatistics,
        unverifiedCaseStudies: evidencePacket.unverifiedCaseStudies,
        unsupportedClaims: evidencePacket.unsupportedClaims,
        fabricatedClaims: evidencePacket.fabricatedClaims,
        fakeExperience,
        genericIntros,
        repetitionIssues: [
            ...repetition.duplicateSections,
            ...repetition.repeatedParagraphs,
        ],
        paddingIssues,
    };
}
