import { logger } from "@/lib/logger";
import type { ResearchPacket, SourceEvidence } from "./contracts";
import type { ResearchEvidenceLedger, LedgerEvidenceItem } from "./evidence-ledger";

export type ClaimType =
    | "FACT"
    | "STATISTIC"
    | "CASE_STUDY"
    | "FIRST_PARTY_EXPERIENCE"
    | "GSC_OBSERVATION"
    | "SERP_OBSERVATION"
    | "INFERENCE"
    | "OPINION"
    | "RECOMMENDATION";

export type ClaimStatus =
    | "VERIFIED"
    | "FIRST_PARTY"
    | "INFERRED"
    | "UNSUPPORTED"
    | "NEEDS_REVIEW"
    | "FABRICATION_RISK";

export type EvidenceSupportLevel = "STRONG" | "PARTIAL" | "WEAK" | "NONE";

export interface MaterialClaim {
    id: string;
    text: string;
    type: ClaimType;
    sectionHint: string | null;
    sentenceIndex: number;
}

export interface ClaimEvidenceMatch {
    evidenceId: string;
    sourceType: string;
    supportLevel: EvidenceSupportLevel;
    matchedOn: "url" | "keyword" | "publisher" | "content_fragment";
    excerpt: string;
    sourceUrl: string | null;
    confidence: number;
}

export interface VerifiedClaim {
    claim: MaterialClaim;
    status: ClaimStatus;
    supportLevel: EvidenceSupportLevel;
    evidenceMatches: ClaimEvidenceMatch[];
    reasoning: string;
    requiresSource: boolean;
    isFirstParty: boolean;
    isInference: boolean;
}

export interface ClaimVerificationReport {
    totalClaims: number;
    verifiedCount: number;
    firstPartyCount: number;
    inferredCount: number;
    unsupportedCount: number;
    fabricationRiskCount: number;
    needsReviewCount: number;
    coveragePct: number;
    overallStatus: "PASS" | "NEEDS_REVIEW" | "FAIL";
    verifiedClaims: VerifiedClaim[];
    unsupportedClaims: string[];
    fabricationRiskClaims: string[];
    summary: string;
}

const STATISTIC_PATTERN = /\b\d+(?:\.\d+)?(?:\s*%|\s*percent|\s*x\b|\s*times\b|\s*\$[\d,.]+|\s*million|\s*billion|\s*thousand)/i;

const CASE_STUDY_PATTERN = /\b(case study|customer|client|company|brand|startup|enterprise|firm)\s+(saw|achieved|gained|reduced|increased|grew|improved|cut|saved|generated|reported|experienced)/i;

const FABRICATION_SIGNAL_PATTERN = /\b(studies show|research shows|experts say|according to experts|industry reports|data shows|surveys reveal|research indicates|analysts say|reports suggest)\b(?!\s+(?:from|by|at|in)\s+[A-Z])/i;

const FIRST_PARTY_SIGNAL_PATTERN = /\b(our\s+(team|data|experience|clients|customers|users|platform|tool|research|testing)|we\s+(found|tested|discovered|observed|measured|analyzed|built|created|developed|use|have seen)|in\s+our\s+(experience|view|opinion|testing)|based\s+on\s+our)\b/i;

const INFERENCE_SIGNAL_PATTERN = /\b(likely|probably|suggests|appears|seems|we believe|we think|this implies|this means|therefore|thus|so|consequently|based\s+on\s+this|given\s+this|this\s+indicates)\b/i;

const OPINION_SIGNAL_PATTERN = /\b(in\s+our\s+(view|opinion)|we\s+(think|believe|recommend|suggest|prefer|favor)|best\s+(practice|approach|way|method)|you\s+should|we\s+would\s+recommend|the\s+best)\b/i;

const RECOMMENDATION_PATTERN = /\b(we\s+recommend|you\s+should|start\s+with|consider\s+using|use\s+[A-Z]|try\s+[A-Z]|avoid|don't\s+use|switch\s+to|migrate\s+to)\b/i;

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z])/;

function extractSentences(html: string): string[] {
    const plain = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    return plain.split(SENTENCE_SPLIT).map((s) => s.trim()).filter((s) => s.length > 20);
}

function generateClaimId(text: string, index: number): string {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40)
        .replace(/^-|-$/g, "");
    return `claim-${index}-${slug}`;
}

export function classifyClaim(sentence: string): ClaimType | null {
    if (RECOMMENDATION_PATTERN.test(sentence)) return "RECOMMENDATION";
    if (CASE_STUDY_PATTERN.test(sentence)) return "CASE_STUDY";
    if (OPINION_SIGNAL_PATTERN.test(sentence)) return "OPINION";
    if (FIRST_PARTY_SIGNAL_PATTERN.test(sentence)) {
        return "FIRST_PARTY_EXPERIENCE";
    }
    if (STATISTIC_PATTERN.test(sentence)) return "STATISTIC";
    if (/\b(gsc|google search console|impression|click(-through)?|ctr|search\s+volume|keyword\s+(position|ranking|rank))\b/i.test(sentence)) return "GSC_OBSERVATION";
    if (FABRICATION_SIGNAL_PATTERN.test(sentence)) return "FACT";
    if (/\b(serp|featured\s+snippet|people\s+also\s+ask|top\s+result|rank\s+(for|in)|position\s+\d|organic\s+(result|traffic))\b/i.test(sentence)) return "SERP_OBSERVATION";
    if (INFERENCE_SIGNAL_PATTERN.test(sentence)) return "INFERENCE";
    return null;
}

function isMaterialType(type: ClaimType): boolean {
    return type === "FACT" || type === "STATISTIC" || type === "CASE_STUDY";
}

export function extractMaterialClaims(html: string): MaterialClaim[] {
    const sentences = extractSentences(html);
    const claims: MaterialClaim[] = [];
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const type = classifyClaim(sentence);
        if (type === null || !isMaterialType(type)) continue;
        claims.push({
            id: generateClaimId(sentence, i),
            text: sentence,
            type,
            sectionHint: null,
            sentenceIndex: i,
        });
    }
    return claims;
}

function keywordsFrom(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4);
}

function scoreOverlap(claimWords: string[], evidenceWords: string[]): number {
    const evidenceSet = new Set(evidenceWords);
    const matches = claimWords.filter((w) => evidenceSet.has(w)).length;
    return claimWords.length > 0 ? matches / claimWords.length : 0;
}

function supportLevelFromScore(score: number, confidence: number): EvidenceSupportLevel {
    const combined = score * 0.6 + confidence * 0.4;
    if (combined >= 0.55) return "STRONG";
    if (combined >= 0.35) return "PARTIAL";
    if (combined >= 0.15) return "WEAK";
    return "NONE";
}

export function findEvidenceForClaim(
    claim: MaterialClaim,
    researchPacket: ResearchPacket | null,
    ledger: ResearchEvidenceLedger | null,
): ClaimEvidenceMatch[] {
    const matches: ClaimEvidenceMatch[] = [];
    const claimWords = keywordsFrom(claim.text);

    if (researchPacket) {
        for (const source of researchPacket.sources) {
            const evidenceWords = keywordsFrom(source.evidence + " " + source.claim);
            const overlap = scoreOverlap(claimWords, evidenceWords);
            if (overlap < 0.1) continue;
            const level = supportLevelFromScore(overlap, source.confidence);
            if (level === "NONE") continue;
            matches.push({
                evidenceId: source.id,
                sourceType: "EXTERNAL_SOURCE",
                supportLevel: level,
                matchedOn: "keyword",
                excerpt: source.claim.slice(0, 300),
                sourceUrl: source.url,
                confidence: source.confidence,
            });
        }
    }

    if (ledger) {
        const factualItems = ledger.evidenceItems.filter(
            (item) =>
                item.provenance.sourceType !== "LLM_GENERATED" &&
                item.provenance.sourceType !== "INFERENCE",
        );
        for (const item of factualItems) {
            const evidenceWords = keywordsFrom(item.content + " " + (item.excerpt ?? ""));
            const overlap = scoreOverlap(claimWords, evidenceWords);
            if (overlap < 0.1) continue;
            const level = supportLevelFromScore(overlap, item.provenance.confidence);
            if (level === "NONE") continue;
            matches.push({
                evidenceId: item.id,
                sourceType: item.provenance.sourceType,
                supportLevel: level,
                matchedOn: "keyword",
                excerpt: (item.excerpt ?? item.content).slice(0, 300),
                sourceUrl: item.provenance.sourceUrl ?? null,
                confidence: item.provenance.confidence,
            });
        }
    }

    return matches.sort((a, b) => {
        const levelOrder: Record<EvidenceSupportLevel, number> = { STRONG: 0, PARTIAL: 1, WEAK: 2, NONE: 3 };
        return levelOrder[a.supportLevel] - levelOrder[b.supportLevel];
    });
}

function hasFirstPartySignal(
    claim: MaterialClaim,
    authorHasRealExperience: boolean,
    authorHasRealNumbers: boolean,
): boolean {
    if (claim.type === "FIRST_PARTY_EXPERIENCE") return true;
    if (FIRST_PARTY_SIGNAL_PATTERN.test(claim.text)) {
        return authorHasRealExperience || authorHasRealNumbers;
    }
    return false;
}

export function verifyClaim(
    claim: MaterialClaim,
    evidenceMatches: ClaimEvidenceMatch[],
    hasFirstParty: boolean,
    hasFirstPartyData: boolean,
): VerifiedClaim {
    const isFirstParty = hasFirstParty || claim.type === "FIRST_PARTY_EXPERIENCE";
    const isInference =
        claim.type === "INFERENCE" || INFERENCE_SIGNAL_PATTERN.test(claim.text);
    const isFabricationRisk = FABRICATION_SIGNAL_PATTERN.test(claim.text) && evidenceMatches.length === 0;
    const bestMatch = evidenceMatches[0] ?? null;
    const topLevel: EvidenceSupportLevel = bestMatch?.supportLevel ?? "NONE";
    const requiresSource = isMaterialType(claim.type) && !isFirstParty && !isInference;

    let status: ClaimStatus;
    let reasoning: string;

    if (isFabricationRisk) {
        status = "FABRICATION_RISK";
        reasoning = "Claim uses vague authority signal (e.g. 'studies show') with no traceable source in the evidence ledger.";
    } else if (isFirstParty) {
        status = "FIRST_PARTY";
        reasoning = hasFirstPartyData
            ? "Claim is backed by author first-party data."
            : "Claim is attributed to first-party experience. Verify data source exists.";
    } else if (isInference) {
        status = "INFERRED";
        reasoning = "Claim is explicitly marked as inference or interpretation — not presented as fact.";
    } else if (topLevel === "STRONG" || topLevel === "PARTIAL") {
        status = "VERIFIED";
        reasoning = `Claim matched ${evidenceMatches.length} evidence item(s); best support: ${topLevel}.`;
    } else if (topLevel === "WEAK") {
        status = "NEEDS_REVIEW";
        reasoning = "Claim has only weak evidence overlap. Source confirmation recommended before publishing.";
    } else if (!requiresSource) {
        status = "VERIFIED";
        reasoning = "Claim type does not require a hard source (opinion or recommendation).";
    } else {
        status = "UNSUPPORTED";
        reasoning = "No evidence found in research packet or ledger that supports this claim.";
    }

    return {
        claim,
        status,
        supportLevel: topLevel,
        evidenceMatches,
        reasoning,
        requiresSource,
        isFirstParty,
        isInference,
    };
}

export function verifyClaims(
    claims: MaterialClaim[],
    researchPacket: ResearchPacket | null,
    ledger: ResearchEvidenceLedger | null,
    authorHasRealExperience: boolean,
    authorHasRealNumbers: boolean,
): VerifiedClaim[] {
    return claims.map((claim) => {
        const evidenceMatches = findEvidenceForClaim(claim, researchPacket, ledger);
        const isFirstParty = hasFirstPartySignal(claim, authorHasRealExperience, authorHasRealNumbers);
        const isFirstPartyData = authorHasRealNumbers && isFirstParty;
        return verifyClaim(claim, evidenceMatches, isFirstParty, isFirstPartyData);
    });
}

export function getClaimVerificationReport(
    verifiedClaims: VerifiedClaim[],
): ClaimVerificationReport {
    const total = verifiedClaims.length;

    if (total === 0) {
        return {
            totalClaims: 0,
            verifiedCount: 0,
            firstPartyCount: 0,
            inferredCount: 0,
            unsupportedCount: 0,
            fabricationRiskCount: 0,
            needsReviewCount: 0,
            coveragePct: 100,
            overallStatus: "PASS",
            verifiedClaims: [],
            unsupportedClaims: [],
            fabricationRiskClaims: [],
            summary: "No material claims detected — no verification required.",
        };
    }

    const verifiedCount = verifiedClaims.filter((v) => v.status === "VERIFIED").length;
    const firstPartyCount = verifiedClaims.filter((v) => v.status === "FIRST_PARTY").length;
    const inferredCount = verifiedClaims.filter((v) => v.status === "INFERRED").length;
    const unsupportedCount = verifiedClaims.filter((v) => v.status === "UNSUPPORTED").length;
    const fabricationRiskCount = verifiedClaims.filter((v) => v.status === "FABRICATION_RISK").length;
    const needsReviewCount = verifiedClaims.filter((v) => v.status === "NEEDS_REVIEW").length;

    const resolvedCount = verifiedCount + firstPartyCount + inferredCount;
    const coveragePct = Math.round((resolvedCount / total) * 100);

    let overallStatus: "PASS" | "NEEDS_REVIEW" | "FAIL";
    if (fabricationRiskCount > 0) {
        overallStatus = "FAIL";
    } else if (unsupportedCount > 0 || needsReviewCount > 0 || coveragePct < 60) {
        overallStatus = "NEEDS_REVIEW";
    } else {
        overallStatus = "PASS";
    }

    const unsupportedClaims = verifiedClaims
        .filter((v) => v.status === "UNSUPPORTED")
        .map((v) => v.claim.text.slice(0, 200));

    const fabricationRiskClaims = verifiedClaims
        .filter((v) => v.status === "FABRICATION_RISK")
        .map((v) => v.claim.text.slice(0, 200));

    const summary = fabricationRiskCount > 0
        ? `${fabricationRiskCount} claim(s) use vague authority signals with no traceable source. Evidence coverage: ${coveragePct}%.`
        : unsupportedCount > 0
          ? `${unsupportedCount} claim(s) have no supporting evidence. Coverage: ${coveragePct}%. Review before publishing.`
          : `${resolvedCount}/${total} claims resolved (${coveragePct}% coverage). Status: ${overallStatus}.`;

    logger.info("[ClaimVerification] Report generated", {
        total,
        verifiedCount,
        firstPartyCount,
        inferredCount,
        unsupportedCount,
        fabricationRiskCount,
        needsReviewCount,
        coveragePct,
        overallStatus,
    });

    return {
        totalClaims: total,
        verifiedCount,
        firstPartyCount,
        inferredCount,
        unsupportedCount,
        fabricationRiskCount,
        needsReviewCount,
        coveragePct,
        overallStatus,
        verifiedClaims,
        unsupportedClaims,
        fabricationRiskClaims,
        summary,
    };
}
