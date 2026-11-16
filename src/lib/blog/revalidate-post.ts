import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { AuthorProfile } from "./index";
import { cleanDomainToDisplayName } from "./prompt-context";
import { runCompositeValidation } from "./validators";
import {
    gateCitationScore,
    normalizeCitationCriteria,
    type CitationCriterion,
} from "./ai-citation-template";
import { extractEvidencePacket } from "./evidence-extractor";
import {
    evaluatePublicationGate,
    type IndependentGateResult,
    type PublicationDecision,
} from "./publication-gate";
import type {
    EvidencePacket,
    ResearchPacket,
    SerpCompetitiveBrief,
    SourceEvidence,
} from "./contracts";

const PLACEHOLDER_CHECKS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\[Section generation failed/i, label: "[Section generation failed] (section writer failure)" },
    { pattern: /\[EDITOR:/i, label: "[EDITOR:] (editorial pass artefact)" },
    { pattern: /\b(?:TODO|FIXME)\b/i, label: "TODO/FIXME (LLM template artefact)" },
    { pattern: /\bTBD\b/i, label: "TBD (LLM template artefact)" },
    { pattern: /lorem ipsum/i, label: "lorem ipsum (LLM filler)" },
    { pattern: /Example Company|YourCompany/i, label: "Example Company/YourCompany (template variable)" },
    { pattern: /\{\{[^}]+\}\}/, label: "{{...}} (unresolved template variable)" },
    { pattern: /\[INSERT STAT\]/i, label: "[INSERT STAT] (stat placeholder)" },
    { pattern: /\[IMAGE HERE\]/i, label: "[IMAGE HERE] (image placeholder)" },
];

/**
 * Converts article HTML into clean plain text for validators and word counting.
 */
export function htmlToPlainText(html: string): string {
    return html
        .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
        .replace(/<\/(?:p|li|tr|div|ul|ol|table|h[1-6]|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();
}

/**
 * Returns descriptive labels for any unresolved LLM/template placeholder artifacts
 * remaining inside the HTML or widget markup.
 */
export function findUnresolvedPlaceholders(content: string): string[] {
    if (!content) return [];
    return PLACEHOLDER_CHECKS
        .filter(({ pattern }) => pattern.test(content))
        .map(({ label }) => label);
}

/**
 * Computes consistent 0–100 claim evidence coverage and missing-evidence messages
 * from an extracted `EvidencePacket`.
 */
export function computeEvidenceMetrics(evidencePacket: EvidencePacket): {
    evidenceCoverage: number;
    missingEvidence: string[];
} {
    const missingEvidence = evidencePacket.unsupportedClaims.slice(0, 50);
    if (evidencePacket.claims.length > 0) {
        const sourcedCount = evidencePacket.claims.filter((c) => c.sourceIds.length > 0).length;
        return {
            evidenceCoverage: Math.round((sourcedCount / evidencePacket.claims.length) * 100),
            missingEvidence,
        };
    }
    const evidenceCoverage =
        evidencePacket.availability === "AVAILABLE" && evidencePacket.sources.length > 0 ? 100 : 0;
    return { evidenceCoverage, missingEvidence };
}

function mapArtifactSourceType(sourceType: string): SourceEvidence["sourceType"] {
    switch (sourceType) {
        case "FIRST_PARTY_EXPERIENCE":
        case "FIRST_PARTY_DATA":
            return "company";
        case "GSC_DATA":
        case "SERP_OBSERVATION":
            return "research";
        default:
            return "other";
    }
}

export interface PersistedArtifactInput {
    id: string;
    url: string | null;
    title: string | null;
    publisher: string | null;
    publishedAt?: Date | string | null;
    retrievedAt: Date | string;
    sourceType: string;
    snippet: string | null;
    confidence: number;
    authorityScore: number | null;
    evidenceItems?: Array<{
        content: string;
        extractedClaim: string | null;
    }>;
}

/**
 * Reconstructs a `ResearchPacket` from persisted DB artifacts and competitive brief
 * so saved-post revalidation uses the exact original research baseline without external calls.
 */
export function buildReconstructedResearchPacket(params: {
    keyword: string;
    brief: SerpCompetitiveBrief | null | undefined;
    artifacts: PersistedArtifactInput[];
    author: AuthorProfile;
    fallbackCollectedAt?: Date | string;
}): ResearchPacket {
    const { keyword, brief, artifacts, author } = params;

    const sources: SourceEvidence[] = [];
    const seenUrls = new Set<string>();
    const normalizeUrlKey = (u: string) => u.trim().replace(/\/$/, "").toLowerCase();
    const briefPageStatusByUrl = new Map(
        (brief?.pages ?? []).map(p => [normalizeUrlKey(p.url), p.scrapeStatus] as const),
    );

    for (const artifact of artifacts) {
        if (!artifact.url || !/^https?:\/\//i.test(artifact.url)) continue;
        const observedStatus = briefPageStatusByUrl.get(normalizeUrlKey(artifact.url));
        if (observedStatus && observedStatus !== "ANALYZED") continue;
        if (seenUrls.has(artifact.url)) continue;
        seenUrls.add(artifact.url);

        const safeId = /^[a-z0-9_-]+$/i.test(artifact.id) ? artifact.id : `src-${sources.length + 1}`;
        const itemTexts = (artifact.evidenceItems ?? [])
            .map((item) => item.extractedClaim || item.content)
            .filter((text): text is string => Boolean(text && text.trim()));
        const evidenceText = [artifact.snippet, ...itemTexts]
            .filter((part): part is string => Boolean(part && part.trim()))
            .join(" ")
            .trim();
        const claimText = (itemTexts[0] ?? artifact.snippet ?? artifact.title ?? artifact.url).trim();

        const retrievedIso =
            artifact.retrievedAt instanceof Date
                ? artifact.retrievedAt.toISOString()
                : artifact.retrievedAt || new Date().toISOString();
        const publishedIso =
            artifact.publishedAt instanceof Date
                ? artifact.publishedAt.toISOString()
                : artifact.publishedAt ?? undefined;

        sources.push({
            id: safeId,
            url: artifact.url.slice(0, 1000),
            title: (artifact.title?.trim() || artifact.url).slice(0, 500),
            publisher: artifact.publisher?.trim()?.slice(0, 200) || undefined,
            publishedAt: publishedIso,
            retrievedAt: retrievedIso,
            claim: claimText.slice(0, 1000) || artifact.url,
            evidence: (evidenceText || claimText || artifact.url).slice(0, 4000),
            sourceType: mapArtifactSourceType(artifact.sourceType),
            confidence: Math.max(0, Math.min(1, Number.isFinite(artifact.confidence) ? artifact.confidence : 0.7)),
            authorityScore: artifact.authorityScore ?? undefined,
            scrapeStatus: briefPageStatusByUrl.get(normalizeUrlKey(artifact.url)),
        });
        if (sources.length >= 40) break;
    }

    if (sources.length === 0 && brief?.pages?.length) {
        for (const page of brief.pages) {
            if (!page.url || page.scrapeStatus !== "ANALYZED" || seenUrls.has(page.url)) continue;
            seenUrls.add(page.url);
            sources.push({
                id: `serp-source-${sources.length + 1}`,
                url: page.url,
                title: page.title.slice(0, 500),
                retrievedAt: brief.researchedAt,
                claim: (page.snippet || page.title).slice(0, 1000),
                evidence: (page.snippet || page.title).slice(0, 4000),
                sourceType: "other",
                confidence: 0.7,
                scrapeStatus: page.scrapeStatus,
            });
            if (sources.length >= 40) break;
        }
    }

    const collectedAt =
        brief?.researchedAt ??
        sources[0]?.retrievedAt ??
        (params.fallbackCollectedAt instanceof Date
            ? params.fallbackCollectedAt.toISOString()
            : params.fallbackCollectedAt) ??
        new Date().toISOString();

    const evidenceAvailability =
        sources.length > 0 ? "AVAILABLE" : brief ? "EMPTY" : "EMPTY";
    const resolvedIntent = brief?.intent?.label ?? "informational";

    return {
        collectedAt,
        evidenceAvailability,
        keyword: keyword.slice(0, 500) || "article",
        intent: resolvedIntent,
        brain: {
            intent: resolvedIntent,
            searcherMindset: "Evaluated post-edit draft against stored search research",
            contentGaps: (brief?.opportunities ?? []).slice(0, 15).map((o) => o.description),
            entities: (brief?.requiredCoverage ?? []).slice(0, 15).map((r) => r.topic),
            contrarianAngles: [],
            examplesNeeded: [],
            faqTargets: (brief?.readerNeeds ?? []).slice(0, 15).map((q) => q.question),
            commonMisconceptions: [],
            industryMyths: [],
            whatPeopleAvoidSaying: [],
        },
        serp: {
            competitors: (brief?.pages ?? []).slice(0, 10).map((page) => ({
                title: page.title,
                url: page.url,
                snippet: page.snippet,
                headings: [],
                rank: page.rank,
                pageType: page.pageType,
            })),
            paa: (brief?.readerNeeds ?? [])
                .filter((n) => n.source === "people_also_ask")
                .slice(0, 20)
                .map((n) => ({
                    question: n.question,
                    answer: n.answerSnippetObserved,
                })),
            format: brief?.recommendedFormat ?? null,
        },
        sources,
        entities: [],
        authorEvidence: {
            name: author.name.slice(0, 500) || "Editorial Team",
            role: author.role?.slice(0, 300),
            bio: author.bio?.slice(0, 2000),
            experience: author.realExperience?.slice(0, 4000) ?? undefined,
            realNumbers: author.realNumbers?.slice(0, 2000) ?? undefined,
            localContext: author.localContext?.slice(0, 2000) ?? undefined,
        },
        ...(author.realExperience || author.realNumbers
            ? {
                firstPartyEvidence: {
                    authorName: author.name,
                    authorRole: author.role ?? null,
                    authorBio: author.bio ?? null,
                    realExperience: author.realExperience ?? null,
                    realNumbers: author.realNumbers ?? null,
                    localContext: author.localContext ?? null,
                },
            }
            : {}),
        serpCompetitiveBrief: brief ?? undefined,
        contentGaps: [],
        misconceptions: [],
        contrarianAngles: [],
    };
}

export interface EvaluateBlogPostStateInput {
    title: string;
    content: string;
    metaDescription: string;
    targetKeywords: string[];
    author: AuthorProfile;
    researchPacket: ResearchPacket;
    schemaMarkup?: string | null;
    interactiveWidget?: string | null;
    currentStatus: string;
    hasFirstPartyEvidence: boolean;
    previousPublicationGates?: IndependentGateResult[] | null;
}

export interface EvaluatedBlogPostState {
    status: string;
    validationScore: number;
    validationErrors: string[];
    validationWarnings: string[];
    citationScore: number;
    citationCriteria: CitationCriterion[];
    evidenceCoverage: number;
    missingEvidence: string[];
    publicationGates: IndependentGateResult[];
    decision: PublicationDecision;
}

const NON_PROMOTABLE_STATUSES = new Set(["PUBLISHED", "GENERATING", "QUEUED", "PENDING", "FAILED"]);

/**
 * Pure deterministic evaluation of validation, citations, evidence, and publication gates
 * for an article HTML body. Skips external LLM originality calls by reusing any previous
 * Originality gate result so interactive saves and re-checks complete synchronously.
 */
export async function evaluateBlogPostState(
    input: EvaluateBlogPostStateInput,
): Promise<EvaluatedBlogPostState> {
    const plainText = htmlToPlainText(input.content);
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    const validation = runCompositeValidation({
        title: input.title,
        htmlContent: input.content,
        markdownContent: plainText,
        metaDescription: input.metaDescription,
        author: input.author,
    });

    const placeholderMatches = findUnresolvedPlaceholders(
        `${input.content}${input.interactiveWidget ?? ""}`,
    );
    const placeholderErrors =
        placeholderMatches.length > 0
            ? [
                `Content contains unresolved placeholder text (${placeholderMatches.join("; ")}). Remove placeholders before publishing.`,
            ]
            : [];

    const lengthErrors =
        wordCount < 500
            ? [`Content too short: ${wordCount} words (minimum 500).`]
            : [];

    const validationErrors = [...new Set([
        ...lengthErrors,
        ...placeholderErrors,
        ...validation.errors,
        ...validation.blockingIssues,
    ])];
    const validationWarnings = [...new Set(validation.warnings)];

    const contentForCitations = input.schemaMarkup
        ? `${input.content}\n\n<script type="application/ld+json">\n${input.schemaMarkup}\n</script>`
        : input.content;
    const citationResult = gateCitationScore(
        contentForCitations,
        input.targetKeywords,
        input.title,
    );

    const evidencePacket = extractEvidencePacket(input.researchPacket, input.content);
    const { evidenceCoverage, missingEvidence } = computeEvidenceMetrics(evidencePacket);

    const previousGates = Array.isArray(input.previousPublicationGates)
        ? input.previousPublicationGates
        : [];
    const previousOriginalityGate =
        previousGates.find((g) => g.name === "Originality") ?? null;
    const previousOutlineGate =
        previousGates.find((g) => g.name === "OutlineQuality") ?? null;

    const decision = await evaluatePublicationGate({
        content: input.content,
        title: input.title,
        metaDescription: input.metaDescription,
        targetKeywords: input.targetKeywords,
        evidencePacket,
        serpContext: null,
        researchPacket: input.researchPacket,
        riskTier: "low",
        hasFirstPartyEvidence: input.hasFirstPartyEvidence,
        outlineDegraded: previousOutlineGate?.status === "FAIL",
        skipRemoteOriginality: true,
        previousOriginalityGate,
    });

    let nextStatus = input.currentStatus;
    if (!NON_PROMOTABLE_STATUSES.has(input.currentStatus)) {
        nextStatus = decision.status;
        if (nextStatus === "DRAFT" && (placeholderErrors.length > 0 || lengthErrors.length > 0)) {
            nextStatus = "NEEDS_REVIEW";
        }
    }

    return {
        status: nextStatus,
        validationScore: validation.score,
        validationErrors,
        validationWarnings,
        citationScore: citationResult.citationScore,
        citationCriteria: normalizeCitationCriteria(citationResult.citationCriteria),
        evidenceCoverage,
        missingEvidence,
        publicationGates: decision.gates,
        decision,
    };
}

export interface RevalidatedBlogSnapshot {
    id: string;
    content: string;
    status: string;
    validationScore: number;
    validationErrors: string[];
    validationWarnings: string[];
    citationScore: number;
    citationCriteria: CitationCriterion[];
    evidenceCoverage: number;
    missingEvidence: string[];
    publicationGates: IndependentGateResult[];
    updatedAt: string;
}

/**
 * Loads an owned blog post + research artifacts from Prisma, optionally updates its
 * sanitized HTML content, recomputes all quality/citation/evidence/publication gates,
 * persists the updated fields, and returns the fresh blog snapshot.
 */
export async function revalidateAndPersistBlog(params: {
    blogId: string;
    nextContent?: string;
}): Promise<RevalidatedBlogSnapshot | null> {
    const blog = await prisma.blog.findUnique({
        where: { id: params.blogId },
        select: {
            id: true,
            title: true,
            content: true,
            metaDescription: true,
            targetKeywords: true,
            status: true,
            schemaMarkup: true,
            interactiveWidget: true,
            serpCompetitiveBrief: true,
            publicationGates: true,
            createdAt: true,
            site: {
                select: {
                    domain: true,
                    brandName: true,
                    authorName: true,
                    authorRole: true,
                    authorBio: true,
                    realExperience: true,
                    realNumbers: true,
                    localContext: true,
                    user: { select: { name: true } },
                },
            },
            researchArtifacts: {
                orderBy: { retrievedAt: "desc" },
                take: 40,
                select: {
                    id: true,
                    url: true,
                    title: true,
                    publisher: true,
                    publishedAt: true,
                    retrievedAt: true,
                    sourceType: true,
                    snippet: true,
                    confidence: true,
                    authorityScore: true,
                    evidenceItems: {
                        take: 5,
                        select: {
                            content: true,
                            extractedClaim: true,
                        },
                    },
                },
            },
        },
    });

    if (!blog) return null;

    const effectiveContent = params.nextContent ?? blog.content;
    const displayName = blog.site.brandName?.trim() || cleanDomainToDisplayName(blog.site.domain);
    const author: AuthorProfile = {
        name: blog.site.authorName?.trim() || blog.site.user?.name?.trim() || displayName || blog.site.domain,
        role: blog.site.authorRole ?? undefined,
        bio: blog.site.authorBio ?? undefined,
        realExperience: blog.site.realExperience ?? null,
        realNumbers: blog.site.realNumbers ?? null,
        localContext: blog.site.localContext ?? null,
    };

    const brief = (blog.serpCompetitiveBrief ?? null) as SerpCompetitiveBrief | null;
    const researchPacket = buildReconstructedResearchPacket({
        keyword: blog.targetKeywords[0] ?? blog.title,
        brief,
        artifacts: blog.researchArtifacts,
        author,
        fallbackCollectedAt: blog.createdAt,
    });

    const hasFirstPartyEvidence = Boolean(
        blog.site.realExperience?.trim() ||
        blog.site.realNumbers?.trim() ||
        blog.researchArtifacts.some(
            (a) => a.sourceType === "FIRST_PARTY_EXPERIENCE" || a.sourceType === "FIRST_PARTY_DATA",
        ),
    );

    const previousPublicationGates = Array.isArray(blog.publicationGates)
        ? (blog.publicationGates as unknown as IndependentGateResult[])
        : null;

    const evaluated = await evaluateBlogPostState({
        title: blog.title,
        content: effectiveContent,
        metaDescription: blog.metaDescription ?? "",
        targetKeywords: blog.targetKeywords,
        author,
        researchPacket,
        schemaMarkup: blog.schemaMarkup,
        interactiveWidget: blog.interactiveWidget,
        currentStatus: blog.status,
        hasFirstPartyEvidence,
        previousPublicationGates,
    });

    const updatedAt = new Date();
    await prisma.blog.update({
        where: { id: blog.id },
        data: {
            ...(params.nextContent !== undefined ? { content: effectiveContent } : {}),
            status: evaluated.status,
            validationScore: evaluated.validationScore,
            validationErrors: evaluated.validationErrors,
            validationWarnings: evaluated.validationWarnings,
            citationScore: evaluated.citationScore,
            citationCriteria: evaluated.citationCriteria as unknown as Prisma.InputJsonValue,
            evidenceCoverage: evaluated.evidenceCoverage,
            missingEvidence: evaluated.missingEvidence,
            publicationGates: evaluated.publicationGates as unknown as Prisma.InputJsonValue,
            updatedAt,
        },
    });

    return {
        id: blog.id,
        content: effectiveContent,
        status: evaluated.status,
        validationScore: evaluated.validationScore,
        validationErrors: evaluated.validationErrors,
        validationWarnings: evaluated.validationWarnings,
        citationScore: evaluated.citationScore,
        citationCriteria: evaluated.citationCriteria,
        evidenceCoverage: evaluated.evidenceCoverage,
        missingEvidence: evaluated.missingEvidence,
        publicationGates: evaluated.publicationGates,
        updatedAt: updatedAt.toISOString(),
    };
}

export interface PublishPreconditionResult {
    ok: boolean;
    error?: string;
    hint?: string;
    status?: string;
    validationErrors?: string[];
    blockers?: Array<{ name: string; issues: string[] }>;
}

/**
 * Shared publish-route blocker evaluation: ensures placeholders, held review
 * statuses, unresolved validationErrors, non-refresh UPDATE_EXISTING conflicts,
 * and failed mandatory publication gates cannot be bypassed at publish time.
 */
export function evaluatePublishPreconditions(blog: {
    content: string;
    status?: string | null;
    pipelineType?: string | null;
    sourceUrl?: string | null;
    validationErrors?: unknown;
    publicationGates?: unknown;
    serpCompetitiveBrief?: unknown;
}): PublishPreconditionResult {
    const unresolvedPlaceholders = findUnresolvedPlaceholders(blog.content);
    if (unresolvedPlaceholders.length > 0) {
        return {
            ok: false,
            error: "Publication blocked: the article contains unresolved generation or editorial placeholders.",
            hint: "Regenerate the failed section or resolve every editorial instruction before publishing.",
            blockers: [{ name: "Unresolved placeholders", issues: unresolvedPlaceholders }],
        };
    }

    if (blog.status === "EVIDENCE_REVIEW" || blog.status === "REJECTED") {
        const errors = Array.isArray(blog.validationErrors)
            ? blog.validationErrors.filter((e): e is string => typeof e === "string" && e.trim().length > 0).slice(0, 10)
            : [];
        return {
            ok: false,
            status: blog.status,
            validationErrors: errors,
            error: blog.status === "REJECTED"
                ? "Publication blocked: this article was rejected during automated review."
                : "Publication blocked: this article is held in Evidence Review due to unsupported claims or quality blockers.",
            hint: "Resolve all flagged evidence and quality issues and rerun review before publishing.",
        };
    }

    const validationErrors = Array.isArray(blog.validationErrors)
        ? blog.validationErrors.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
        : [];
    if (validationErrors.length > 0) {
        return {
            ok: false,
            validationErrors: validationErrors.slice(0, 10),
            error: "Publication blocked: unresolved validation blockers remain on this draft.",
            hint: "Resolve the listed validation errors and save/revalidate before publishing.",
        };
    }

    const briefObj = blog.serpCompetitiveBrief && typeof blog.serpCompetitiveBrief === "object"
        ? (blog.serpCompetitiveBrief as { siteFit?: { recommendedAction?: unknown; overlappingUrls?: unknown[] } })
        : null;
    const isRefreshDraft = blog.pipelineType === "CONTENT_REFRESH" || Boolean(blog.sourceUrl);
    if (!isRefreshDraft && briefObj?.siteFit?.recommendedAction === "UPDATE_EXISTING") {
        const overlapping = Array.isArray(briefObj.siteFit.overlappingUrls)
            ? briefObj.siteFit.overlappingUrls.filter((u): u is string => typeof u === "string").slice(0, 3)
            : [];
        return {
            ok: false,
            error: overlapping.length > 0
                ? `Publication blocked: competitive analysis recommends updating existing page (${overlapping.join(", ")}) instead of publishing a competing post.`
                : "Publication blocked: competitive analysis recommends updating an existing page instead of publishing a competing post.",
            hint: "Update the existing page via Content Refresh instead, or resolve the overlap conflict before publishing.",
        };
    }

    const storedPublicationGates = Array.isArray(blog.publicationGates)
        ? blog.publicationGates as Array<{
            name?: unknown;
            status?: unknown;
            isHard?: unknown;
            issues?: unknown;
        }>
        : [];
    const failedMandatoryGates = storedPublicationGates.filter(gate =>
        gate?.isHard === true && gate.status === "FAIL",
    );
    if (failedMandatoryGates.length > 0) {
        return {
            ok: false,
            error: "Publication blocked: one or more mandatory quality gates failed.",
            blockers: failedMandatoryGates.map(gate => ({
                name: typeof gate.name === "string" ? gate.name : "Mandatory quality gate",
                issues: Array.isArray(gate.issues)
                    ? gate.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 5)
                    : [],
            })),
            hint: "Fix the mandatory issues and rerun review before publishing.",
        };
    }

    return { ok: true };
}
