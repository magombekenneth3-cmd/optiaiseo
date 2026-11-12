/**
 * Research & Evidence Foundation (Content Intelligence Engine — Phase 1).
 *
 * Responsibilities:
 *   1. Prepare the SERP research snapshot BEFORE any writing begins, so it can
 *      be persisted as a durable artifact and reused by the writer.
 *   2. Assess research completeness with one shared rule, used by both the
 *      generation workflow and the publication gate. An article must never be
 *      treated as "research-backed" unless SERP research actually completed.
 *   3. Persist the evidence ledger, the claims found in the final article, and
 *      the claim → evidence links (ResearchArtifact / EvidenceItem / BlogClaim /
 *      ClaimEvidence) idempotently, so a retried workflow never duplicates rows.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type {
    PageExistenceResult,
    ResearchPacket,
    SerpCompetitiveBrief,
    SiteContentLibrary,
} from "./contracts";
import type { SerpContext } from "./serp";
import type { ResearchEvidenceLedger, LedgerEvidenceItem } from "./evidence-ledger";
import {
    extractMaterialClaims,
    verifyClaims,
    getClaimVerificationReport,
    type ClaimStatus,
    type ClaimType,
    type EvidenceSupportLevel as VerificationSupportLevel,
    type ClaimVerificationReport,
} from "./claim-verification";

// ─── Research completeness (pure rule lives in ./research-completeness) ─────

export {
    assessResearchCompleteness,
    MIN_ANALYZED_PAGES_FOR_COMPLETE_RESEARCH,
    type ResearchCompleteness,
    type ResearchCompletenessStatus,
} from "./research-completeness";
import { assessResearchCompleteness, type ResearchCompleteness } from "./research-completeness";

// ─── Research snapshot preparation (runs before writing) ────────────────────

export interface ResearchSnapshot {
    serpCompetitiveBrief: SerpCompetitiveBrief;
    siteContentLibrary: SiteContentLibrary | null;
    existingSite: PageExistenceResult | null;
    completeness: ResearchCompleteness;
}

/**
 * Builds the competitive research snapshot from already-fetched SERP data.
 * Mirrors the research preparation that previously ran inside runFullPipeline,
 * so the writer receives exactly the snapshot that was persisted.
 */
export async function prepareResearchSnapshot(params: {
    siteId: string;
    keyword: string;
    serpContext: SerpContext | null;
    priorIntent?: string;
    domain?: string | null;
}): Promise<ResearchSnapshot> {
    const { siteId, keyword, serpContext, priorIntent, domain } = params;
    const { resolvePageExistence } = await import("@/lib/opportunity-engine/page-existence-resolver");
    const { buildSerpCompetitiveBrief, loadRelevantSiteContentLibrary } = await import("./serp-competitive-brief");

    let existingSite: PageExistenceResult | null = null;
    try {
        existingSite = await resolvePageExistence(siteId, keyword) as PageExistenceResult;
    } catch (err) {
        logger.warn("[ResearchFoundation] Existing-page resolution failed", {
            siteId,
            keyword,
            error: err instanceof Error ? err.message : String(err),
        });
        existingSite = {
            verdict: "NEEDS_REVIEW",
            existingPage: null,
            allCandidates: [],
            recommendedAction: "REQUEST_REVIEW",
            recommendedCategory: "EXISTING_PAGE_RESOLUTION_UNAVAILABLE",
            reasoning: "Existing-page resolution failed; a duplicate-safe content action could not be selected.",
        };
    }

    const siteContentLibrary = await loadRelevantSiteContentLibrary({ siteId, keyword, domain: domain ?? null });

    const serpCompetitiveBrief = buildSerpCompetitiveBrief({
        keyword,
        serpContext,
        priorIntent,
        siteContentLibrary,
        existingSite,
    });

    return {
        serpCompetitiveBrief,
        siteContentLibrary,
        existingSite,
        completeness: assessResearchCompleteness(serpCompetitiveBrief),
    };
}

/**
 * Persists the research snapshot on the Blog row immediately, so research is
 * auditable even if writing later fails. Guarded by attemptId so a stale
 * workflow can never overwrite a newer attempt.
 */
export async function persistResearchSnapshot(params: {
    blogId: string;
    attemptId?: string | null;
    snapshot: ResearchSnapshot;
}): Promise<boolean> {
    const { blogId, attemptId, snapshot } = params;
    const result = await prisma.blog.updateMany({
        where: {
            id: blogId,
            status: "GENERATING",
            ...(attemptId ? { generationAttemptId: attemptId } : {}),
        },
        data: {
            serpCompetitiveBrief: snapshot.serpCompetitiveBrief as unknown as Prisma.InputJsonValue,
        },
    });
    return result.count === 1;
}

// ─── Evidence ledger + claim persistence ────────────────────────────────────

type DbClaimType = "STATISTIC" | "FACT" | "QUOTE" | "COMPARISON" | "EXPERIENCE" | "OPINION" | "RECOMMENDATION";
type DbClaimStatus = "PENDING" | "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "DISPUTED" | "RETRACTED";
type DbSupportLevel = "STRONG" | "MODERATE" | "WEAK" | "CONTRADICTORY" | "NEUTRAL";

function toDbClaimType(type: ClaimType): DbClaimType {
    switch (type) {
        case "STATISTIC": return "STATISTIC";
        case "FIRST_PARTY_EXPERIENCE": return "EXPERIENCE";
        case "OPINION":
        case "INFERENCE": return "OPINION";
        case "RECOMMENDATION": return "RECOMMENDATION";
        default: return "FACT"; // FACT, CASE_STUDY, GSC_OBSERVATION, SERP_OBSERVATION
    }
}

function toDbClaimStatus(status: ClaimStatus, support: VerificationSupportLevel): DbClaimStatus {
    switch (status) {
        case "VERIFIED": return support === "STRONG" ? "SUPPORTED" : "PARTIALLY_SUPPORTED";
        case "FIRST_PARTY": return "PARTIALLY_SUPPORTED";
        case "UNSUPPORTED": return "UNSUPPORTED";
        case "FABRICATION_RISK": return "DISPUTED";
        default: return "PENDING"; // INFERRED, NEEDS_REVIEW
    }
}

function toDbSupportLevel(level: VerificationSupportLevel): DbSupportLevel | null {
    if (level === "STRONG") return "STRONG";
    if (level === "PARTIAL") return "MODERATE";
    if (level === "WEAK") return "WEAK";
    return null;
}

/** Finds which H2 section a claim sentence belongs to (best effort). */
function locateSection(html: string, claimText: string): string | null {
    const probe = claimText.slice(0, 60).replace(/\s+/g, " ").trim().toLowerCase();
    if (!probe) return null;
    const plainWithHeadings = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, h: string) => `\n§H2§${h.replace(/<[^>]+>/g, "").trim()}§\n`)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase();
    const idx = plainWithHeadings.indexOf(probe);
    if (idx < 0) return null;
    const before = plainWithHeadings.slice(0, idx);
    const marker = before.lastIndexOf("§h2§");
    if (marker < 0) return null;
    const end = before.indexOf("§", marker + 4);
    return end > marker ? before.slice(marker + 4, end).trim().slice(0, 200) : null;
}

export interface PersistEvidenceResult {
    artifactId: string;
    evidenceItemCount: number;
    claimCount: number;
    claimLinkCount: number;
    report: ClaimVerificationReport;
}

/**
 * Idempotently replaces the evidence ledger and claim records for a blog.
 * Prior ResearchArtifact rows (and cascaded EvidenceItem / ClaimEvidence rows)
 * and BlogClaim rows for this blog are deleted inside the same transaction.
 */
export async function persistEvidenceLedgerAndClaims(params: {
    blogId: string;
    ledger: ResearchEvidenceLedger;
    content: string;
    researchPacket: ResearchPacket | null;
    hasRealExperience: boolean;
    hasRealNumbers: boolean;
    completeness: ResearchCompleteness;
    extraMetadata?: Record<string, unknown>;
}): Promise<PersistEvidenceResult> {
    const { blogId, ledger, content, researchPacket, completeness } = params;

    const materialClaims = extractMaterialClaims(content);
    const verified = verifyClaims(
        materialClaims,
        researchPacket,
        ledger,
        params.hasRealExperience,
        params.hasRealNumbers,
    );
    const report = getClaimVerificationReport(verified);

    // Research-packet source ids → ledger items (matched on URL) so claim matches
    // against packet sources can be linked to persisted EvidenceItem rows.
    const ledgerItemsById = new Map<string, LedgerEvidenceItem>(ledger.evidenceItems.map(i => [i.id, i]));
    const ledgerItemIdBySourceUrl = new Map<string, string>();
    for (const item of ledger.evidenceItems) {
        const url = item.provenance.sourceUrl;
        if (url && item.category === "research_source" && !ledgerItemIdBySourceUrl.has(url)) {
            ledgerItemIdBySourceUrl.set(url, item.id);
        }
    }
    const resolveLedgerItemId = (evidenceId: string, sourceUrl: string | null): string | null => {
        if (ledgerItemsById.has(evidenceId)) return evidenceId;
        if (sourceUrl) return ledgerItemIdBySourceUrl.get(sourceUrl) ?? null;
        return null;
    };

    return prisma.$transaction(async (tx) => {
        await tx.blogClaim.deleteMany({ where: { blogId } });
        await tx.researchArtifact.deleteMany({ where: { blogId } });

        const artifact = await tx.researchArtifact.create({
            data: {
                blogId,
                sourceType: "EXTERNAL_SOURCE",
                retrievedAt: new Date(ledger.collectedAt),
                confidence: completeness.researchBacked ? 1 : completeness.status === "PARTIAL" ? 0.5 : 0,
                metadata: JSON.parse(JSON.stringify({
                    kind: "EVIDENCE_LEDGER",
                    ledgerId: ledger.id,
                    topic: ledger.topic,
                    searchIntent: ledger.searchIntent,
                    collectedAt: ledger.collectedAt,
                    serpObservations: ledger.serpObservations.length,
                    competitorObservations: ledger.competitorObservations.length,
                    gscObservations: ledger.gscObservations.length,
                    evidenceItems: ledger.evidenceItems.length,
                    firstPartyContext: ledger.firstPartyContext,
                    researchCompleteness: completeness,
                    claimVerification: {
                        totalClaims: report.totalClaims,
                        verifiedCount: report.verifiedCount,
                        firstPartyCount: report.firstPartyCount,
                        inferredCount: report.inferredCount,
                        unsupportedCount: report.unsupportedCount,
                        fabricationRiskCount: report.fabricationRiskCount,
                        needsReviewCount: report.needsReviewCount,
                        coveragePct: report.coveragePct,
                        overallStatus: report.overallStatus,
                        summary: report.summary,
                    },
                    ...(params.extraMetadata ?? {}),
                })) as Prisma.InputJsonValue,
            },
        });

        if (ledger.evidenceItems.length > 0) {
            await tx.evidenceItem.createMany({
                data: ledger.evidenceItems.map(item => ({
                    artifactId: artifact.id,
                    sourceType: item.provenance.sourceType,
                    content: item.content,
                    extractedClaim: item.excerpt,
                    confidence: item.provenance.confidence,
                    metadata: JSON.parse(JSON.stringify({
                        ...item.metadata,
                        ledgerItemId: item.id,
                        category: item.category,
                        retrievalMethod: item.provenance.retrievalMethod,
                        sourceUrl: item.provenance.sourceUrl,
                        sourceTitle: item.provenance.sourceTitle,
                        sourcePublisher: item.provenance.sourcePublisher,
                        sourcePublishedAt: item.provenance.sourcePublishedAt,
                        authorityScore: item.provenance.authorityScore,
                        capturedAt: item.provenance.capturedAt,
                    })) as Prisma.InputJsonValue,
                })),
            });
        }

        const persistedItems = await tx.evidenceItem.findMany({
            where: { artifactId: artifact.id },
            select: { id: true, metadata: true },
        });
        const dbIdByLedgerId = new Map<string, string>();
        for (const row of persistedItems) {
            const ledgerItemId = (row.metadata as Record<string, unknown> | null)?.ledgerItemId;
            if (typeof ledgerItemId === "string") dbIdByLedgerId.set(ledgerItemId, row.id);
        }

        let claimLinkCount = 0;
        for (const v of verified) {
            const claim = await tx.blogClaim.create({
                data: {
                    blogId,
                    text: v.claim.text.slice(0, 2_000),
                    type: toDbClaimType(v.claim.type),
                    status: toDbClaimStatus(v.status, v.supportLevel),
                    sectionId: locateSection(content, v.claim.text),
                    position: v.claim.sentenceIndex,
                    metadata: JSON.parse(JSON.stringify({
                        verificationStatus: v.status,
                        verificationType: v.claim.type,
                        supportLevel: v.supportLevel,
                        reasoning: v.reasoning,
                        requiresSource: v.requiresSource,
                        isFirstParty: v.isFirstParty,
                        isInference: v.isInference,
                        verifier: "claim-verification:lexical-v1",
                    })) as Prisma.InputJsonValue,
                },
            });

            const links = new Map<string, { supportLevel: DbSupportLevel; reasoning: string }>();
            for (const match of v.evidenceMatches.slice(0, 5)) {
                const level = toDbSupportLevel(match.supportLevel);
                if (!level) continue;
                const ledgerId = resolveLedgerItemId(match.evidenceId, match.sourceUrl);
                const dbId = ledgerId ? dbIdByLedgerId.get(ledgerId) : undefined;
                if (!dbId || links.has(dbId)) continue;
                links.set(dbId, {
                    supportLevel: level,
                    reasoning: `Matched on ${match.matchedOn} (confidence ${match.confidence.toFixed(2)}): ${match.excerpt.slice(0, 280)}`,
                });
            }
            if (links.size > 0) {
                await tx.claimEvidence.createMany({
                    data: [...links.entries()].map(([evidenceId, link]) => ({
                        claimId: claim.id,
                        evidenceId,
                        supportLevel: link.supportLevel,
                        reasoning: link.reasoning,
                    })),
                    skipDuplicates: true,
                });
                claimLinkCount += links.size;
            }
        }

        logger.info("[ResearchFoundation] Persisted evidence ledger and claims", {
            blogId,
            evidenceItems: ledger.evidenceItems.length,
            claims: verified.length,
            claimLinks: claimLinkCount,
            coveragePct: report.coveragePct,
            researchStatus: completeness.status,
        });

        return {
            artifactId: artifact.id,
            evidenceItemCount: ledger.evidenceItems.length,
            claimCount: verified.length,
            claimLinkCount,
            report,
        };
    }, { timeout: 30_000 });
}
