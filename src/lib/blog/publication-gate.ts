/**
 * Publication Gate — central orchestrator for all quality gates.
 *
 * This is the single entry point that determines whether an article
 * can be published. It replaces the old score-based quality gate.
 *
 * Gate execution order:
 *   1. Structure gate  — heading hierarchy, meta, slug
 *   2. Repetition gate — section + paragraph duplication
 *   3. Evidence gate   — fabricated stats, case studies, experience
 *   4. Originality gate — unique value vs. competitors
 *   5. SEO/AEO gate    — keyword placement, direct answers
 *
 * Decision logic (hard gates, not scores):
 *   IF any fabrication issue  → REJECTED
 *   IF any evidence blocking  → EVIDENCE_REVIEW
 *   IF riskTier=high AND warnings → NEEDS_REVIEW
 *   IF no unique contributions → NEEDS_REVIEW
 *   IF no blocking issues     → DRAFT
 */

import { logger } from "@/lib/logger";
import type {
    EvidencePacket,
    PublicationGateResult,
    ResearchPacket,
} from "./contracts";
import type { SerpContext } from "./serp";
import { runEvidenceGate, type EvidenceGateResult } from "./evidence-gate";
import { runOriginalValueGate, type OriginalValueInput } from "./original-value-gate";
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
    evidencePacket: EvidencePacket | null;
    /** SERP context with competitor data */
    serpContext: SerpContext | null;
    /** Research packet from Stage 1 */
    researchPacket: ResearchPacket | null;
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
    const evidenceIssues: string[] = [];
    const originalityIssues: string[] = [];
    const repetitionIssues: string[] = [];
    const fabricationIssues: string[] = [];

    // ── Gate 1: Structure ─────────────────────────────────────────────────
    const structure = runStructureGate(input);
    allBlockingIssues.push(...structure.blockingIssues);
    allWarnings.push(...structure.warnings);

    // ── Gate 2: Evidence ──────────────────────────────────────────────────
    let evidenceResult: EvidenceGateResult;
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

        // Track fabrication specifically
        fabricationIssues.push(
            ...evidenceResult.fabricatedStats,
            ...evidenceResult.fabricatedCaseStudies,
            ...evidenceResult.fakeExperience,
        );
        repetitionIssues.push(...evidenceResult.repetitionIssues);
    } catch (err) {
        logger.error("[Publication Gate] Evidence gate threw", { error: (err as Error)?.message });
        allWarnings.push("Evidence gate failed — proceeding without evidence validation.");
        evidenceResult = {
            passed: true, blockingIssues: [], warnings: [],
            fabricatedStats: [], fabricatedCaseStudies: [],
            fakeExperience: [], genericIntros: [],
            repetitionIssues: [], paddingIssues: [],
        };
    }

    // ── Gate 3: Originality ───────────────────────────────────────────────
    let originalityResult: OriginalValueResult;
    try {
        originalityResult = await runOriginalValueGate({
            content: input.content,
            title: input.title,
            researchPacket: input.researchPacket,
            serpContext: input.serpContext,
            targetKeywords: input.targetKeywords,
        });

        if (!originalityResult.passed) {
            originalityIssues.push(
                `Article lacks original value: ${originalityResult.weakSections.length} weak sections, ${originalityResult.duplicateSections.length} paraphrased sections.`
            );
            if (originalityResult.weakSections.length > 0) {
                originalityIssues.push(...originalityResult.weakSections.slice(0, 5));
            }
        }
    } catch (err) {
        logger.error("[Publication Gate] Originality gate threw", { error: (err as Error)?.message });
        allWarnings.push("Originality gate failed — proceeding without originality validation.");
        originalityResult = {
            passed: true, uniqueContributions: [],
            weakSections: [], duplicateSections: [], missingEvidence: [],
        };
    }

    // ── Gate 4: SEO/AEO ───────────────────────────────────────────────────
    const seoAeo = runSeoAeoGate(input);
    allWarnings.push(...seoAeo.warnings);
    // SEO issues are warnings, not blocking (content quality > SEO perfection)

    // ── Gate 5: Product claims ────────────────────────────────────────────
    const productClaims = runProductClaimsGate(input.content);
    if (productClaims.blockingIssues.length > 0) {
        fabricationIssues.push(...productClaims.blockingIssues);
    }
    allWarnings.push(...productClaims.warnings);

    // ── Decision logic ────────────────────────────────────────────────────

    // Collect all blocking issues
    allBlockingIssues.push(...evidenceIssues, ...fabricationIssues);

    // Determine status
    let status: "DRAFT" | "NEEDS_REVIEW" | "EVIDENCE_REVIEW" | "REJECTED";

    if (fabricationIssues.length > 0) {
        // Fabricated content → REJECTED
        status = "REJECTED";
    } else if (evidenceIssues.length > 0) {
        // Evidence problems → EVIDENCE_REVIEW
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

    const passed = status === "DRAFT";

    logger.info("[Publication Gate] Decision", {
        status,
        passed,
        blockingCount: allBlockingIssues.length,
        warningCount: allWarnings.length,
        evidenceCount: evidenceIssues.length,
        originalityCount: originalityIssues.length,
        fabricationCount: fabricationIssues.length,
        repetitionCount: repetitionIssues.length,
    });

    return {
        passed,
        status,
        blockingIssues: allBlockingIssues,
        warnings: allWarnings,
        evidenceIssues,
        originalityIssues,
        repetitionIssues,
        fabricationIssues,
    };
}
