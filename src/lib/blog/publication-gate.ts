import { logger } from "@/lib/logger";
import type {
    EvidencePacket,
    PublicationGateResult,
    ResearchPacket,
} from "./contracts";
import type { SerpContext } from "./serp";
import { runEvidenceGate, type EvidenceGateResult } from "./evidence-gate";
import { evaluateOriginality } from "./original-value-gate";
import { runContentLint } from "./content-lint";
import { buildClaimLedger } from "./claim-ledger";
import {
    extractMaterialClaims,
    verifyClaims,
    getClaimVerificationReport,
    type ClaimVerificationReport,
} from "./claim-verification";
import type { ResearchEvidenceLedger } from "./evidence-ledger";
import type { ClaimPlan } from "./claim-plan";

export type GateStatus = "PASS" | "REVIEW" | "FAIL";

export interface IndependentGateResult {
    name: string;
    status: GateStatus;
    isHard: boolean;
    issues: string[];
    warnings: string[];
}

export interface PublicationGateInput {
    content: string;
    title: string;
    metaDescription: string;
    targetKeywords: string[];
    evidencePacket: EvidencePacket;
    serpContext: SerpContext | null;
    researchPacket: ResearchPacket;
    riskTier: string;
    hasFirstPartyEvidence: boolean;
    factCheckComplete?: boolean;
    factCheckCoverage?: number;
    additionalOriginalityIssues?: string[];
    ledger?: ResearchEvidenceLedger | null;
    claimPlan?: ClaimPlan | null;
}

export interface PublicationDecision {
    canPublish: boolean;
    status: "DRAFT" | "NEEDS_REVIEW" | "EVIDENCE_REVIEW" | "REJECTED";
    gates: IndependentGateResult[];
    blockers: string[];
    reviewReasons: string[];
    summary: string;
    legacyResult: PublicationGateResult;
}

function evaluateResearchGate(input: PublicationGateInput): IndependentGateResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    if (input.evidencePacket.availability !== "AVAILABLE") {
        issues.push("Research evidence is not available. Evidence availability must be AVAILABLE before publication.");
    }

    if (input.researchPacket.sources.length === 0) {
        issues.push("Research packet contains no sources.");
    }

    if (input.evidencePacket.sources.length === 0 && input.evidencePacket.availability === "AVAILABLE") {
        issues.push("Evidence packet is marked AVAILABLE but contains no source evidence.");
    }

    if (input.evidencePacket.extraction.researchCollectedAt !== input.researchPacket.collectedAt) {
        warnings.push("Evidence packet does not originate from the authoritative research packet used by the writer.");
    }

    const researchSources = new Map(
        input.researchPacket.sources.map((source) => [source.id, source.url]),
    );
    for (const source of input.evidencePacket.sources) {
        if (researchSources.get(source.id) !== source.url) {
            warnings.push(`Evidence source "${source.id}" is not part of the authoritative research packet.`);
        }
    }

    let status: GateStatus = "PASS";
    if (issues.length > 0) status = "FAIL";
    else if (warnings.length > 0) status = "REVIEW";

    return { name: "Research", status, isHard: true, issues, warnings };
}

function evaluateEvidenceGate(input: PublicationGateInput): IndependentGateResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
        const result: EvidenceGateResult = runEvidenceGate({
            content: input.content,
            evidencePacket: input.evidencePacket,
            hasFirstPartyEvidence: input.hasFirstPartyEvidence,
            riskTier: input.riskTier,
        });

        if (!result.passed) {
            issues.push(...result.blockingIssues);
        }
        warnings.push(...result.warnings);

        if (result.fabricatedClaims.length > 0) {
            issues.push(...result.fabricatedClaims.map(c => `Fabrication detected: ${c}`));
        }
    } catch (err) {
        issues.push("Evidence validation failed; human evidence review is required.");
        logger.error("[Publication Gate] Evidence gate threw", { error: (err as Error)?.message });
    }

    let status: GateStatus = "PASS";
    if (issues.length > 0) status = "FAIL";
    else if (warnings.length > 0) status = "REVIEW";

    return { name: "Evidence", status, isHard: true, issues, warnings };
}

function evaluateClaimsGate(
    input: PublicationGateInput,
): IndependentGateResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    const materialClaims = extractMaterialClaims(input.content);
    if (materialClaims.length === 0) {
        return { name: "Claims", status: "PASS", isHard: true, issues: [], warnings: ["No material claims detected."] };
    }

    const hasRealExperience = input.hasFirstPartyEvidence;
    const hasRealNumbers = !!(input.researchPacket.authorEvidence.realNumbers);
    const verified = verifyClaims(
        materialClaims,
        input.researchPacket,
        input.ledger ?? null,
        hasRealExperience,
        hasRealNumbers,
    );
    const report = getClaimVerificationReport(verified);

    if (report.fabricationRiskCount > 0) {
        issues.push(
            ...report.fabricationRiskClaims.map(c => `Fabrication risk: "${c.slice(0, 120)}"`),
        );
    }

    if (report.unsupportedCount > 0) {
        warnings.push(
            ...report.unsupportedClaims.map(c => `Unsupported claim: "${c.slice(0, 120)}"`),
        );
    }

    if (report.needsReviewCount > 0) {
        warnings.push(`${report.needsReviewCount} claim(s) have only weak evidence and need review.`);
    }

    let status: GateStatus;
    if (report.overallStatus === "FAIL") {
        status = "FAIL";
    } else if (report.overallStatus === "NEEDS_REVIEW") {
        status = "REVIEW";
    } else {
        status = "PASS";
    }

    return { name: "Claims", status, isHard: true, issues, warnings };
}

async function evaluateOriginalityGate(input: PublicationGateInput): Promise<IndependentGateResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
        const { status: origStatus, result } = await evaluateOriginality({
            content: input.content,
            title: input.title,
            researchPacket: input.researchPacket,
            serpContext: input.serpContext,
            targetKeywords: input.targetKeywords,
        });

        if (!result.passed) {
            issues.push(...result.missingValue);
            if (result.weakSections.length > 0) {
                issues.push(...result.weakSections.slice(0, 5));
            }
            if (result.duplicateSections.length > 0) {
                issues.push(...result.duplicateSections.slice(0, 5));
            }
        }

        return { name: "Originality", status: origStatus, isHard: false, issues, warnings };
    } catch (err) {
        logger.error("[Publication Gate] Originality gate threw", { error: (err as Error)?.message });
        return {
            name: "Originality",
            status: "REVIEW",
            isHard: false,
            issues: ["Originality validation failed; human editorial review is required."],
            warnings: [],
        };
    }
}

function evaluateSeoGate(input: PublicationGateInput): IndependentGateResult {
    const issues: string[] = [];
    const warnings: string[] = [];
    const text = input.content.replace(/<[^>]+>/g, " ").toLowerCase();
    const keyword = input.targetKeywords[0]?.toLowerCase() ?? "";

    if (!keyword) {
        return { name: "SEO", status: "REVIEW", isHard: false, issues: [], warnings: ["No target keyword specified."] };
    }

    if (!input.title.toLowerCase().includes(keyword)) {
        warnings.push(`Primary keyword "${keyword}" not found in title.`);
    }

    if (input.metaDescription && !input.metaDescription.toLowerCase().includes(keyword)) {
        warnings.push(`Primary keyword "${keyword}" not found in meta description.`);
    }

    const words = text.split(/\s+/).filter(w => w.length > 0);
    const keywordCount = (text.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) ?? []).length;
    const density = words.length > 0 ? (keywordCount / words.length) * 100 : 0;

    if (density > 3) {
        warnings.push(`Keyword density is ${density.toFixed(1)}% — reduce to avoid keyword stuffing.`);
    }
    if (keywordCount < 2) {
        warnings.push(`Primary keyword appears only ${keywordCount} time(s) — use it naturally 3-8 times.`);
    }

    const firstFifth = text.slice(0, Math.floor(text.length * 0.2));
    const hasDirectAnswer = /(?:is |are |means? |refers? to |defined as |the answer is |you can |the best |the most )/i.test(firstFifth);
    if (!hasDirectAnswer) {
        warnings.push("No direct answer detected in the first 20% of content.");
    }

    let status: GateStatus = "PASS";
    if (warnings.length > 3) status = "REVIEW";

    return { name: "SEO", status, isHard: false, issues, warnings };
}

function evaluateSchemaGate(input: PublicationGateInput): IndependentGateResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!input.title || input.title.trim().length < 10) {
        issues.push("Title is missing or too short (minimum 10 characters).");
    }
    if (input.title && input.title.length > 90) {
        warnings.push(`Title is ${input.title.length} chars — aim for ≤70 for full SERP display.`);
    }

    if (!input.metaDescription) {
        issues.push("Meta description is missing.");
    } else {
        if (input.metaDescription.length > 160) {
            warnings.push(`Meta description is ${input.metaDescription.length} chars — max is 160.`);
        }
        if (input.metaDescription.length < 70) {
            warnings.push(`Meta description is ${input.metaDescription.length} chars — aim for 140-160.`);
        }
    }

    const h1Count = (input.content.match(/<h1[\s>]/gi) ?? []).length;
    const h2Count = (input.content.match(/<h2[\s>]/gi) ?? []).length;

    if (h1Count > 1) {
        warnings.push(`Multiple H1 tags detected (${h1Count}). Use exactly one H1.`);
    }
    if (h2Count < 3) {
        warnings.push(`Only ${h2Count} H2 sections. Articles need at least 3 for proper structure.`);
    }

    const wordCount = input.content.replace(/<[^>]+>/g, " ").split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 300) {
        issues.push(`Content is ${wordCount} words — minimum is 300.`);
    }

    let status: GateStatus = "PASS";
    if (issues.length > 0) status = "FAIL";
    else if (warnings.length > 0) status = "REVIEW";

    return { name: "Schema", status, isHard: true, issues, warnings };
}

function evaluateEditorialGate(input: PublicationGateInput): IndependentGateResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    const contentLint = runContentLint(input.content);
    issues.push(...contentLint.blockingIssues);
    warnings.push(...contentLint.warnings);

    const claimLedger = buildClaimLedger(input.evidencePacket);
    const weakClaims = claimLedger
        .filter(claim => claim.verificationStatus === "weak")
        .slice(0, 8);
    for (const claim of weakClaims) {
        warnings.push(`Claim requires review — low-confidence or stale source: "${claim.text.slice(0, 120)}…"`);
    }

    const text = input.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const UNSUPPORTED_CLAIMS = [
        [/\b(?:best|#1|number one|number 1)\s+(?:SEO|AEO|content|platform|tool|software)\b/gi, 'Unsupported superlative claim ("best/number one") — remove or qualify.'],
        [/\bthe only (?:platform|tool|software|solution)\b/gi, '"The only platform" — almost certainly false. Remove or qualify.'],
        [/\bguaranteed?\s+(?:to )?(?:increase|improve|boost|rank|results?)\b/gi, '"Guaranteed results" — never promise specific outcomes.'],
        [/\bmost powerful\s+(?:SEO|AEO|AI|content|marketing)\b/gi, '"Most powerful" — remove or replace with specific capability.'],
    ] as const;
    for (const [pattern, message] of UNSUPPORTED_CLAIMS) {
        if (pattern.test(text)) {
            issues.push(message as string);
        }
    }

    if (input.additionalOriginalityIssues && input.additionalOriginalityIssues.length > 0) {
        issues.push(...input.additionalOriginalityIssues);
    }

    if (input.factCheckComplete === false) {
        const coverage = typeof input.factCheckCoverage === "number"
            ? Math.max(0, Math.min(100, Math.round(input.factCheckCoverage)))
            : 0;
        issues.push(
            `Fact-check coverage is incomplete (${coverage}%). Automatic publication requires a complete fact-check pass.`
        );
    }

    let status: GateStatus = "PASS";
    if (issues.length > 0) status = "REVIEW";
    else if (warnings.length > 0) status = "REVIEW";

    return { name: "Editorial", status, isHard: false, issues, warnings };
}

function uniqueIssues(issues: string[], limit: number): string[] {
    return [...new Set(issues)].slice(0, limit);
}

export function getPublicationBlockers(gates: IndependentGateResult[]): string[] {
    return gates
        .filter(g => g.isHard && g.status === "FAIL")
        .flatMap(g => g.issues.map(issue => `[${g.name}] ${issue}`));
}

export function canPublishBlog(gates: IndependentGateResult[]): boolean {
    return gates.filter(g => g.isHard).every(g => g.status !== "FAIL");
}

export function buildPublicationDecision(
    gates: IndependentGateResult[],
    evidenceAvailability: string,
): PublicationDecision {
    const blockers = getPublicationBlockers(gates);
    const reviewReasons = gates
        .filter(g => g.status === "REVIEW")
        .flatMap(g => g.issues.map(issue => `[${g.name}] ${issue}`));

    const hasFabrication = gates.some(
        g => g.name === "Claims" && g.status === "FAIL" && g.issues.some(i => /fabrication/i.test(i)),
    ) || gates.some(
        g => g.name === "Evidence" && g.status === "FAIL" && g.issues.some(i => /fabricat/i.test(i)),
    );

    let status: "DRAFT" | "NEEDS_REVIEW" | "EVIDENCE_REVIEW" | "REJECTED";
    if (hasFabrication) {
        status = "REJECTED";
    } else if (blockers.length > 0) {
        const hasEvidenceBlocker = gates.some(g =>
            (g.name === "Research" || g.name === "Evidence") && g.status === "FAIL",
        );
        status = hasEvidenceBlocker ? "EVIDENCE_REVIEW" : "NEEDS_REVIEW";
    } else if (reviewReasons.length > 0) {
        status = "NEEDS_REVIEW";
    } else {
        status = "DRAFT";
    }

    if (status === "DRAFT" && evidenceAvailability !== "AVAILABLE") {
        status = "EVIDENCE_REVIEW";
        blockers.push("[Research] Evidence availability must be AVAILABLE before automatic publication.");
    }

    const passed = status === "DRAFT";

    const allBlockingIssues = gates.flatMap(g => g.issues);
    const allWarnings = gates.flatMap(g => g.warnings);
    const evidenceIssues = gates
        .filter(g => g.name === "Research" || g.name === "Evidence")
        .flatMap(g => g.issues);
    const originalityIssues = gates
        .filter(g => g.name === "Originality" || g.name === "Editorial")
        .flatMap(g => g.issues);
    const fabricationIssues = gates
        .filter(g => g.name === "Claims" || g.name === "Evidence")
        .flatMap(g => g.issues.filter(i => /fabricat/i.test(i)));
    const repetitionIssues = gates
        .filter(g => g.name === "Editorial")
        .flatMap(g => g.warnings.filter(w => /repetit|duplicate/i.test(w)));

    const legacyResult: PublicationGateResult = {
        passed,
        status,
        evidenceAvailability: evidenceAvailability as PublicationGateResult["evidenceAvailability"],
        blockingIssues: uniqueIssues(allBlockingIssues, 50),
        warnings: uniqueIssues(allWarnings, 50),
        evidenceIssues: uniqueIssues(evidenceIssues, 30),
        originalityIssues: uniqueIssues(originalityIssues, 20),
        repetitionIssues: uniqueIssues(repetitionIssues, 20),
        fabricationIssues: uniqueIssues(fabricationIssues, 20),
    };

    const gateStatusSummary = gates.map(g => `${g.name}: ${g.status}`).join(", ");
    const summary = passed
        ? `All gates passed (${gateStatusSummary}). Ready for publication.`
        : blockers.length > 0
          ? `Publication blocked by ${blockers.length} hard gate failure(s): ${blockers.slice(0, 3).join("; ")}. Gate states: ${gateStatusSummary}.`
          : `Requires review: ${reviewReasons.slice(0, 3).join("; ")}. Gate states: ${gateStatusSummary}.`;

    return {
        canPublish: passed,
        status,
        gates,
        blockers,
        reviewReasons,
        summary,
        legacyResult,
    };
}

export async function evaluatePublicationGate(
    input: PublicationGateInput,
): Promise<PublicationDecision> {
    const gates: IndependentGateResult[] = [];

    gates.push(evaluateResearchGate(input));
    gates.push(evaluateEvidenceGate(input));
    gates.push(evaluateClaimsGate(input));
    gates.push(await evaluateOriginalityGate(input));
    gates.push(evaluateSeoGate(input));
    gates.push(evaluateSchemaGate(input));
    gates.push(evaluateEditorialGate(input));

    const decision = buildPublicationDecision(gates, input.evidencePacket.availability);

    logger.info("[Publication Gate] Decision", {
        status: decision.status,
        canPublish: decision.canPublish,
        gateStates: Object.fromEntries(gates.map(g => [g.name, g.status])),
        blockerCount: decision.blockers.length,
        reviewCount: decision.reviewReasons.length,
    });

    return decision;
}

export async function runPublicationGate(
    input: PublicationGateInput,
): Promise<PublicationGateResult> {
    const decision = await evaluatePublicationGate(input);
    return decision.legacyResult;
}
