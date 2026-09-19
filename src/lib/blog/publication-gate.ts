/**
 * Publication Gate — central editorial decision boundary.
 *
 * A generation may complete without being ready to publish. Evidence absence
 * is routed to EVIDENCE_REVIEW; only independently proven fabrication is
 * REJECTED. Infrastructure errors are handled by the job runner, not here.
 */

import { logger } from "@/lib/logger";
import type {
    EvidencePacket,
    PublicationGateResult,
    ResearchPacket,
} from "./contracts";
import type { SerpContext } from "./serp";
import { runEvidenceGate, type EvidenceGateResult } from "./evidence-gate";
import { runOriginalValueGate } from "./original-value-gate";
import type { OriginalValueResult } from "./contracts";

// ─── Types ────────────────────────────────────────────────────────────────

export interface PublicationGateInput {
    /** Final HTML content */
    content: string;
    /** Article title */
    title: string;
    /** Meta description */
    metaDescription: string;
    /** Target keywords */
    targetKeywords: string[];
    /** Evidence gathered during research phase */
    evidencePacket: EvidencePacket;
    /** SERP context with competitor data */
    serpContext: SerpContext | null;
    /** Research packet from Stage 1 */
    researchPacket: ResearchPacket;
    /** Risk tier from prompt context */
    riskTier: string;
    /** Whether the author has real first-party evidence */
    hasFirstPartyEvidence: boolean;
}

// ─── Structure gate ───────────────────────────────────────────────────────

function runStructureGate(input: PublicationGateInput): {
    blockingIssues: string[];
    warnings: string[];
} {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    // Title checks
    if (!input.title || input.title.trim().length < 10) {
        blockingIssues.push("Title is missing or too short (minimum 10 characters).");
    }
    if (input.title && input.title.length > 90) {
        warnings.push(`Title is ${input.title.length} chars — aim for ≤70 for full SERP display.`);
    }

    // Meta description checks
    if (!input.metaDescription) {
        blockingIssues.push("Meta description is missing.");
    } else {
        if (input.metaDescription.length > 160) {
            warnings.push(`Meta description is ${input.metaDescription.length} chars — max is 160.`);
        }
        if (input.metaDescription.length < 70) {
            warnings.push(`Meta description is ${input.metaDescription.length} chars — aim for 140-160.`);
        }
    }

    // Heading structure
    const h1Count = (input.content.match(/<h1[\s>]/gi) ?? []).length;
    const h2Count = (input.content.match(/<h2[\s>]/gi) ?? []).length;

    if (h1Count > 1) {
        warnings.push(`Multiple H1 tags detected (${h1Count}). Use exactly one H1.`);
    }
    if (h2Count < 3) {
        warnings.push(`Only ${h2Count} H2 sections. Articles need at least 3 for proper structure.`);
    }

    // Content minimum
    const wordCount = input.content.replace(/<[^>]+>/g, " ").split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 300) {
        blockingIssues.push(`Content is ${wordCount} words — minimum is 300.`);
    }

    return { blockingIssues, warnings };
}

// ─── SEO/AEO gate ─────────────────────────────────────────────────────────

function runSeoAeoGate(input: PublicationGateInput): {
    blockingIssues: string[];
    warnings: string[];
} {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];
    const text = input.content.replace(/<[^>]+>/g, " ").toLowerCase();
    const keyword = input.targetKeywords[0]?.toLowerCase() ?? "";

    if (!keyword) {
        warnings.push("No target keyword specified.");
        return { blockingIssues, warnings };
    }

    // Keyword in title
    if (!input.title.toLowerCase().includes(keyword)) {
        warnings.push(`Primary keyword "${keyword}" not found in title.`);
    }

    // Keyword in meta description
    if (input.metaDescription && !input.metaDescription.toLowerCase().includes(keyword)) {
        warnings.push(`Primary keyword "${keyword}" not found in meta description.`);
    }

    // Keyword density (rough check — 0.3% to 3% of words)
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const keywordCount = (text.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) ?? []).length;
    const density = words.length > 0 ? (keywordCount / words.length) * 100 : 0;

    if (density > 3) {
        warnings.push(`Keyword density is ${density.toFixed(1)}% — reduce to avoid keyword stuffing.`);
    }
    if (keywordCount < 2) {
        warnings.push(`Primary keyword appears only ${keywordCount} time(s) — use it naturally 3-8 times.`);
    }

    // Direct answer check — for AEO, the first 20% of content should contain a direct answer
    const firstFifth = text.slice(0, Math.floor(text.length * 0.2));
    const hasDirectAnswer = /(?:is |are |means? |refers? to |defined as |the answer is |you can |the best |the most )/i.test(firstFifth);
    if (!hasDirectAnswer) {
        warnings.push("No direct answer detected in the first 20% of content. AEO engines prefer direct answers early.");
    }

    return { blockingIssues, warnings };
}

// ─── Unsupported product claims gate ──────────────────────────────────────

function runProductClaimsGate(content: string): {
    blockingIssues: string[];
    warnings: string[];
} {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];
    const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    const UNSUPPORTED_CLAIMS = [
        [/\b(?:best|#1|number one|number 1)\s+(?:SEO|AEO|content|platform|tool|software)\b/gi, 'Unsupported superlative claim ("best/number one") — remove or qualify.'],
        [/\bthe only (?:platform|tool|software|solution)\b/gi, '"The only platform" — almost certainly false. Remove or qualify.'],
        [/\bguaranteed?\s+(?:to )?(?:increase|improve|boost|rank|results?)\b/gi, '"Guaranteed results" — never promise specific outcomes.'],
        [/\bwill (?:definitely|certainly|absolutely) (?:increase|improve|boost|rank)\b/gi, 'Definitive promise about outcomes — qualify with conditions.'],
        [/\bmost powerful\s+(?:SEO|AEO|AI|content|marketing)\b/gi, '"Most powerful" — remove or replace with specific capability.'],
    ] as const;

    for (const [pattern, message] of UNSUPPORTED_CLAIMS) {
        if (pattern.test(text)) {
            blockingIssues.push(message as string);
        }
    }

    return { blockingIssues, warnings };
}

/**
 * The article writer and evidence extractor must consume the same research
 * snapshot. This prevents a second, drifting research run from passing the
 * publication gate for content it did not inform.
 */
function validateEvidenceSnapshot(
    evidencePacket: EvidencePacket,
    researchPacket: ResearchPacket,
): string[] {
    if (evidencePacket.availability !== "AVAILABLE") return [];

    const issues: string[] = [];
    if (evidencePacket.sources.length === 0) {
        issues.push("EvidencePacket is marked AVAILABLE but contains no source evidence.");
    }
    if (evidencePacket.extraction.researchCollectedAt !== researchPacket.collectedAt) {
        issues.push("EvidencePacket does not originate from the authoritative ResearchPacket used by the writer.");
    }

    const researchSources = new Map(
        researchPacket.sources.map((source) => [source.id, source.url]),
    );
    for (const source of evidencePacket.sources) {
        if (researchSources.get(source.id) !== source.url) {
            issues.push(`Evidence source "${source.id}" is not part of the authoritative ResearchPacket.`);
        }
    }

    return issues;
}

function uniqueIssues(issues: string[], limit: number): string[] {
    return [...new Set(issues)].slice(0, limit);
}

// ─── Main publication gate ────────────────────────────────────────────────

/**
 * Runs all quality gates and returns a single publication decision.
 *
 * Status determination:
 *   REJECTED       — fabrication detected (fake stats, fake case studies)
 *   EVIDENCE_REVIEW — evidence issues that need human review
 *   NEEDS_REVIEW   — quality concerns (weak originality, high-risk warnings)
 *   DRAFT          — all gates passed, ready for publication
 */
export async function runPublicationGate(
    input: PublicationGateInput
): Promise<PublicationGateResult> {
    const allBlockingIssues: string[] = [];
    const allWarnings: string[] = [];
    const evidenceIssues = validateEvidenceSnapshot(input.evidencePacket, input.researchPacket);
    const originalityIssues: string[] = [];
    const repetitionIssues: string[] = [];
    const fabricationIssues: string[] = [];

    // ── Gate 1: Structure ─────────────────────────────────────────────────
    const structure = runStructureGate(input);
    allBlockingIssues.push(...structure.blockingIssues);
    // Structure failures require editorial review, but are not evidence
    // failures and must not be silently ignored when evidence is available.
    originalityIssues.push(...structure.blockingIssues);
    allWarnings.push(...structure.warnings);

    // ── Gate 2: Evidence ──────────────────────────────────────────────────
    let evidenceResult: EvidenceGateResult | null = null;
    try {
        evidenceResult = runEvidenceGate({
            content: input.content,
            evidencePacket: input.evidencePacket,
            hasFirstPartyEvidence: input.hasFirstPartyEvidence,
            riskTier: input.riskTier,
        });

        if (!evidenceResult.passed) {
            evidenceIssues.push(...evidenceResult.blockingIssues);
        }
        allWarnings.push(...evidenceResult.warnings);

        // Missing sources do not prove fabrication. Only independently
        // verified false claims can trigger a rejection.
        fabricationIssues.push(...evidenceResult.fabricatedClaims);
        repetitionIssues.push(...evidenceResult.repetitionIssues);
        originalityIssues.push(...evidenceResult.editorialIssues);
    } catch (err) {
        logger.error("[Publication Gate] Evidence gate threw", { error: (err as Error)?.message });
        evidenceIssues.push("Evidence validation failed; human evidence review is required.");
    }

    // ── Gate 3: Originality ───────────────────────────────────────────────
    let originalityResult: OriginalValueResult | null = null;
    try {
        originalityResult = await runOriginalValueGate({
            content: input.content,
            title: input.title,
            researchPacket: input.researchPacket,
            serpContext: input.serpContext,
            targetKeywords: input.targetKeywords,
        });

        if (!originalityResult.passed) {
            originalityIssues.push(...originalityResult.missingValue);
            if (originalityResult.weakSections.length > 0) {
                originalityIssues.push(...originalityResult.weakSections.slice(0, 5));
            }
            if (originalityResult.duplicateSections.length > 0) {
                originalityIssues.push(...originalityResult.duplicateSections.slice(0, 5));
            }
        }
    } catch (err) {
        logger.error("[Publication Gate] Originality gate threw", { error: (err as Error)?.message });
        originalityIssues.push("Originality validation failed; human editorial review is required.");
    }

    // ── Gate 4: SEO/AEO ───────────────────────────────────────────────────
    const seoAeo = runSeoAeoGate(input);
    allWarnings.push(...seoAeo.warnings);
    // SEO issues are warnings, not blocking (content quality > SEO perfection)

    // ── Gate 5: Product claims ────────────────────────────────────────────
    const productClaims = runProductClaimsGate(input.content);
    if (productClaims.blockingIssues.length > 0) {
        originalityIssues.push(...productClaims.blockingIssues);
    }
    allWarnings.push(...productClaims.warnings);

    // ── Decision logic ────────────────────────────────────────────────────

    // Collect all blocking issues
    allBlockingIssues.push(...evidenceIssues, ...fabricationIssues, ...originalityIssues);

    // Determine status
    let status: "DRAFT" | "NEEDS_REVIEW" | "EVIDENCE_REVIEW" | "REJECTED";

    if (fabricationIssues.length > 0) {
        // Independently proven fabricated content → REJECTED
        status = "REJECTED";
    } else if (
        input.evidencePacket.availability !== "AVAILABLE" ||
        evidenceIssues.length > 0
    ) {
        // Missing or insufficient evidence is never automatically publishable.
        status = "EVIDENCE_REVIEW";
    } else if (
        originalityIssues.length > 0 ||
        (input.riskTier === "high" && allWarnings.length > 0)
    ) {
        // Weak originality or high-risk with warnings → NEEDS_REVIEW
        status = "NEEDS_REVIEW";
    } else {
        // All gates passed → DRAFT
        status = "DRAFT";
    }

    // Defense in depth: a later decision branch must never make an absent or
    // empty evidence packet automatically publishable.
    if (status === "DRAFT" && input.evidencePacket.availability !== "AVAILABLE") {
        status = "EVIDENCE_REVIEW";
        evidenceIssues.push("Evidence availability must be AVAILABLE before automatic publication.");
        allBlockingIssues.push("Evidence availability must be AVAILABLE before automatic publication.");
    }

    const passed = status === "DRAFT";
    const normalizedBlockingIssues = uniqueIssues(allBlockingIssues, 50);
    const normalizedWarnings = uniqueIssues(allWarnings, 50);
    const normalizedEvidenceIssues = uniqueIssues(evidenceIssues, 30);
    const normalizedOriginalityIssues = uniqueIssues(originalityIssues, 20);
    const normalizedRepetitionIssues = uniqueIssues(repetitionIssues, 20);
    const normalizedFabricationIssues = uniqueIssues(fabricationIssues, 20);

    logger.info("[Publication Gate] Decision", {
        status,
        passed,
        evidenceAvailability: input.evidencePacket.availability,
        blockingCount: normalizedBlockingIssues.length,
        warningCount: normalizedWarnings.length,
        evidenceCount: normalizedEvidenceIssues.length,
        originalityCount: normalizedOriginalityIssues.length,
        fabricationCount: normalizedFabricationIssues.length,
        repetitionCount: normalizedRepetitionIssues.length,
    });

    return {
        passed,
        status,
        evidenceAvailability: input.evidencePacket.availability,
        blockingIssues: normalizedBlockingIssues,
        warnings: normalizedWarnings,
        evidenceIssues: normalizedEvidenceIssues,
        originalityIssues: normalizedOriginalityIssues,
        repetitionIssues: normalizedRepetitionIssues,
        fabricationIssues: normalizedFabricationIssues,
    };
}
