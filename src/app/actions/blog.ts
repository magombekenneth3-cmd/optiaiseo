"use server";

import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit/check";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { AuthorProfile } from "@/lib/blog";
import { fetchGSCKeywords, findOpportunities } from "@/lib/gsc";
import { classifyGscError, logGscFailure, type GscDataResult } from "@/lib/gsc/gsc-availability";
import { getAuthorizedGscProperty } from "@/lib/gsc/property-resolver";
import { validateGscEvidence, type GscOpportunityEvidence } from "@/lib/gsc/gsc-evidence";
import { extractSiteContext } from "@/lib/blog/context";
import { scoreContent } from "@/lib/content-scoring";
import { getEffectiveTier } from "@/lib/stripe/guards";
import { getUserGscToken } from "@/lib/gsc/token";
import { consumeCreditsIdempotent } from "@/lib/credits";
import { requireUser } from "@/lib/auth/require-user";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { fetchGoogleSerp, classifySerpFormat, type SerpFormatSignal } from "@/lib/blog/serp";
import {
    evaluateSerpIntentGate,
    validateSerpPreflight,
    type SerpGateDecision,
} from "@/lib/blog/serp-gate";
import { blogGenerationEventId } from "@/lib/blog/generation-recovery";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthorInput = {
    authorName?: string;
    authorRole?: string;
    authorBio?: string;
    realExperience?: string;
    realNumbers?: string;
    localContext?: string;
    keyword?: string;
};

/** Input accepted by generateBlog / generateAttackBlog for SERP gate. */
type SerpGateInput = {
    /** preflightId returned by /api/blogs/serp-gate. Absent = gate runs now. */
    preflightId?: string;
    /** User explicitly acknowledged the SERP mismatch warning. */
    forceSerpMismatch?: boolean;
    /** Stable idempotency key retained by the client across ambiguous responses. */
    requestId?: string;
};

type BlogGenerationEventData = Record<string, unknown> & {
    siteId: string;
    blogId: string;
    userId: string;
    pipelineType: string;
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

const SITE_AUTHOR_SELECT = {
    id: true,
    domain: true,
    authorName: true,
    authorRole: true,
    authorBio: true,
    realExperience: true,
    realNumbers: true,
    localContext: true,
} as const;

type SiteAuthorFields = Prisma.SiteGetPayload<{ select: typeof SITE_AUTHOR_SELECT }>;

function normalizeRequestId(value: string | undefined): string {
    return value && /^[a-f0-9-]{36}$/i.test(value) ? value : randomUUID();
}

function isRecord(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toEventData(value: Record<string, unknown>): BlogGenerationEventData {
    return JSON.parse(JSON.stringify(value)) as BlogGenerationEventData;
}

async function dispatchBlogGeneration(
    blogId: string,
    attemptId: string,
    data: BlogGenerationEventData,
): Promise<void> {
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
        id: blogGenerationEventId(blogId, attemptId),
        name: "blog.generate",
        data: { ...data, attemptId },
    });
}

async function resumeStoredGeneration(blog: {
    id: string;
    status: string;
    generationAttemptId: string | null;
    generationInput: Prisma.JsonValue | null;
    title?: string;
    slug?: string;
    content?: string;
    metaDescription?: string | null;
    targetKeywords?: string[];
}) {
    if (blog.status !== "GENERATING") {
        const validSavedOutput = blog.status !== "FAILED"
            && !!blog.title?.trim()
            && !!blog.slug?.trim()
            && !!blog.content?.replace(/<[^>]*>/g, " ").trim()
            && !!blog.metaDescription?.trim()
            && !!blog.targetKeywords?.length;
        return validSavedOutput
            ? { success: true, status: blog.status, blog }
            : { success: false, error: blog.status === "FAILED" ? "This generation failed. Use Retry to start another attempt." : "Saved generation output is incomplete; please retry." };
    }
    if (!blog.generationAttemptId || !isRecord(blog.generationInput)) {
        return { success: true, error: "Generation is pending recovery. Please refresh shortly.", pending: true, blog };
    }
    try {
        await dispatchBlogGeneration(
            blog.id,
            blog.generationAttemptId,
            blog.generationInput as unknown as BlogGenerationEventData,
        );
    } catch (error) {
        logger.warn("[Blog Action] Re-dispatch remains pending", {
            blogId: blog.id,
            errorName: error instanceof Error ? error.name : "unknown",
        });
    }
    return { success: true, status: "Generating", pending: true, blog };
}

function buildAuthorProfile(
    authorInput: AuthorInput | undefined,
    site: SiteAuthorFields,
    userName: string | null | undefined
): AuthorProfile {
    return {
        name: authorInput?.authorName?.trim() || site.authorName || userName || site.domain,
        role: authorInput?.authorRole?.trim() || site.authorRole || undefined,
        bio: authorInput?.authorBio?.trim() || site.authorBio || undefined,
        realExperience: authorInput?.realExperience?.trim() || site.realExperience || undefined,
        realNumbers: authorInput?.realNumbers?.trim() || site.realNumbers || undefined,
        localContext: authorInput?.localContext?.trim() || site.localContext || undefined,
    };
}

/**
 * Persists non-empty author fields back to the site row for next-time pre-fill.
 * Skips the DB write entirely when nothing new was supplied.
 */
async function maybeSaveAuthorToSite(
    siteId: string,
    authorInput: AuthorInput | undefined
): Promise<void> {
    if (!authorInput) return;

    const data: Record<string, string> = {};
    if (authorInput.authorName?.trim()) data.authorName = authorInput.authorName.trim();
    if (authorInput.authorRole?.trim()) data.authorRole = authorInput.authorRole.trim();
    if (authorInput.authorBio?.trim()) data.authorBio = authorInput.authorBio.trim();
    if (authorInput.realExperience?.trim()) data.realExperience = authorInput.realExperience.trim();
    if (authorInput.realNumbers?.trim()) data.realNumbers = authorInput.realNumbers.trim();
    if (authorInput.localContext?.trim()) data.localContext = authorInput.localContext.trim();

    if (Object.keys(data).length === 0) return;

    await prisma.site.update({ where: { id: siteId }, data });
}


async function runRateLimitChecks(
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _effectiveTier: string
): Promise<string | null> {
    // Burst limiter only — prevents rapid-fire spam (e.g. 10 clicks in 1 second).
    // The monthly blog COUNT limit is removed: credits are the single gate.
    // If a user has 10 credits, they can generate a blog — no arbitrary cap.
    const burstLimited = await rateLimit("blogGenerate", userId);
    if (burstLimited) {
        const body = await burstLimited.json();
        return body.error ?? "Too many requests. Please wait a moment.";
    }

    return null;
}

/**
 * Authoritative server-side SERP gate enforcement.
 *
 * Invariants:
 *   BLOCK                         → credits MUST NOT be consumed (cannot override)
 *   WARN + !forceSerpMismatch     → credits MUST NOT be consumed
 *   WARN + forceSerpMismatch + valid preflight → credits may be consumed
 *   ALLOW + valid preflight       → credits may be consumed
 *   SKIP                          → generation proceeds without gating
 *   forceSerpMismatch without valid preflight → MUST NOT bypass gate
 *
 * Returns null on pass, or an error object to return immediately.
 */
async function runSerpGate(
    userId: string,
    siteId: string,
    keyword: string | undefined,
    gateInput: SerpGateInput | undefined
): Promise<{ blocked: true; result: Record<string, unknown> } | { blocked: false; signal: SerpFormatSignal | null }> {
    // No keyword — nothing to classify.
    if (!keyword) {
        return { blocked: false, signal: null };
    }

    const { preflightId, forceSerpMismatch = false } = gateInput ?? {};

    let decision: SerpGateDecision;
    let signal: SerpFormatSignal | null = null;

    if (preflightId) {
        // Validate the preflight token from Redis.
        const validation = await validateSerpPreflight(preflightId, userId, siteId, keyword);

        if (!validation.valid) {
            // Token missing, expired, or mismatched — run the gate fresh.
            logger.warn("[SerpGate] Invalid preflight — re-running gate", {
                reason: validation.reason,
                userId,
                keyword,
            });
            // Fall through to fresh fetch below.
            const { organic } = await fetchGoogleSerp(keyword, 7).catch(() => ({ organic: [] }));
            signal = organic.length > 0 ? classifySerpFormat(organic) : null;
            decision = evaluateSerpIntentGate(signal);
        } else {
            signal = validation.record.signal;
            decision = validation.record.decision;
        }
    } else {
        // No preflight provided — run fresh.
        if (!process.env.SERPER_API_KEY) {
            return { blocked: false, signal: null }; // SKIP — not configured
        }
        const { organic } = await fetchGoogleSerp(keyword, 7).catch(() => ({ organic: [] }));
        signal = organic.length > 0 ? classifySerpFormat(organic) : null;
        decision = evaluateSerpIntentGate(signal);
    }

    // Enforce the decision.
    if (decision.verdict === "SKIP") {
        return { blocked: false, signal };
    }

    if (decision.verdict === "BLOCK") {
        return {
            blocked: true,
            result: {
                success: false,
                error: "reason" in decision ? decision.reason : "SERP format mismatch — generation blocked.",
                code: "SERP_GATE_BLOCK",
                serpGate: decision,
            },
        };
    }

    if (decision.verdict === "WARN") {
        if (!forceSerpMismatch) {
            return {
                blocked: true,
                result: {
                    success: false,
                    error: "reason" in decision ? decision.reason : "SERP format mismatch — please confirm to proceed.",
                    code: "SERP_GATE_WARN",
                    serpGate: decision,
                    // Tells the UI to show the banner and send forceSerpMismatch=true
                    requiresConfirmation: true,
                },
            };
        }
        // WARN + forceSerpMismatch — user acknowledged, allow through.
    }

    // ALLOW or acknowledged WARN — gate passed.
    return { blocked: false, signal };
}

// ─── Public actions ───────────────────────────────────────────────────────────

/**
 * Retry a FAILED blog — resets it to GENERATING and re-fires the Inngest job.
 * Credits are NOT re-deducted: the user already paid for the original attempt.
 * If the original attempt was refunded by onFailure, we deduct 10 credits here
 * to keep accounting consistent (fail → refund → retry → deduct).
 */
export async function retryFailedBlog(blogId: string) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return { success: false, error: "Unauthorized" };
        const { user } = auth;
        const blog = await prisma.blog.findFirst({
            where: { id: blogId, site: { userId: user.id } },
            select: {
                id: true, siteId: true, status: true, targetKeywords: true, pipelineType: true,
                generationAttemptId: true, generationInput: true,
                site: {
                    select: {
                        id: true, domain: true, authorName: true, authorRole: true, authorBio: true,
                        realExperience: true, realNumbers: true, localContext: true,
                        user: { select: { name: true } },
                    },
                },
            },
        });
        if (!blog) return { success: false, error: "Blog not found." };
        if (blog.status !== "FAILED") {
            return blog.status === "GENERATING"
                ? { success: true, status: "Retrying" }
                : { success: false, error: `Blog is not in FAILED state (current: ${blog.status}).` };
        }

        const attemptId = randomUUID();
        const baseData = isRecord(blog.generationInput)
            ? blog.generationInput as unknown as BlogGenerationEventData
            : {
                siteId: blog.siteId,
                blogId: blog.id,
                userId: user.id,
                pipelineType: blog.pipelineType ?? "USER_KEYWORD",
                keyword: blog.targetKeywords[0],
                authorName: blog.site.authorName ?? blog.site.user?.name ?? undefined,
                authorRole: blog.site.authorRole ?? undefined,
                authorBio: blog.site.authorBio ?? undefined,
                realExperience: blog.site.realExperience ?? undefined,
                realNumbers: blog.site.realNumbers ?? undefined,
                localContext: blog.site.localContext ?? undefined,
            };
        const eventData = toEventData({ ...baseData, siteId: blog.siteId, blogId: blog.id, userId: user.id });

        // Claim the failed row before charging. Concurrent retry clicks race on
        // this conditional transition; only one attempt can become GENERATING.
        const claimed = await prisma.blog.updateMany({
            where: { id: blog.id, status: "FAILED", generationAttemptId: blog.generationAttemptId },
            data: {
                status: "GENERATING",
                generationAttemptId: attemptId,
                generationInput: eventData as Prisma.InputJsonValue,
                validationErrors: [], validationWarnings: [], factCheckIssues: [], factCheckSuggestions: [],
            },
        });
        if (claimed.count !== 1) return { success: true, status: "Retrying" };

        const creditReference = `blog-generation:${blog.id}:${attemptId}`;
        const creditResult = await consumeCreditsIdempotent(user.id, "blog_generation", creditReference);
        if (!creditResult.allowed) {
            await prisma.blog.updateMany({
                where: { id: blog.id, status: "GENERATING", generationAttemptId: attemptId },
                data: { status: "FAILED", generationAttemptId: blog.generationAttemptId, generationInput: blog.generationInput ?? Prisma.DbNull },
            });
            return {
                success: false,
                error: creditResult.reason === "credits_locked"
                    ? "Your credits are locked. Resubscribe or buy a credit pack to unlock them."
                    : `Insufficient credits. Retry costs 10 credits. You have ${creditResult.remaining}.`,
                code: creditResult.reason ?? "insufficient_credits",
            };
        }

        try {
            await dispatchBlogGeneration(blog.id, attemptId, eventData);
        } catch (error) {
            // Dispatch acknowledgement can be lost after Inngest accepted the
            // event. Keep the persisted attempt and debit; the recovery cron will
            // resend the same event id safely.
            logger.warn("[Blog Action] Retry dispatch pending recovery", {
                blogId: blog.id,
                errorName: error instanceof Error ? error.name : "unknown",
            });
        }

        revalidatePath("/dashboard/blogs");
        revalidatePath("/dashboard");
        return { success: true, status: "Retrying" };
    } catch (error: unknown) {
        logger.error("[Blog Action] retryFailedBlog failed:", {
            errorName: error instanceof Error ? error.name : "unknown",
        });
        return { success: false, error: "Retry failed. Please try again." };
    }
}

export async function scoreBlogContent(content: string, targetKeywords: string[]) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const result = await scoreContent(content, targetKeywords);
        return { success: true, result };
    } catch {
        return { success: false, error: "Failed to perform NLP content analysis." };
    }
}

export async function getUserBlogs() {
    try {
        const auth = await requireUser();
        // Read-only — unauthenticated gets empty list
        if (!auth.ok) return { success: true, blogs: [], userRole: "CLIENT_VIEWER", subscriptionTier: "FREE" };
        const { user } = auth;

        const blogs = await prisma.blog.findMany({
            where: { site: { userId: user.id } },
            include: { site: true },
            orderBy: { createdAt: "desc" },
        });

        return {
            success: true,
            blogs,
            userRole: user.role || "AGENCY_ADMIN",
            subscriptionTier: user.subscriptionTier,
        };
    } catch {
        return {
            success: false,
            error: "Failed to fetch blogs.",
            blogs: [],
            userRole: "CLIENT_VIEWER",
            subscriptionTier: "FREE",
        };
    }
}

export async function getSiteAuthorDetails(siteId: string) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
            select: {
                id: true,
                domain: true,
                authorName: true,
                authorRole: true,
                authorBio: true,
                realExperience: true,
                realNumbers: true,
                localContext: true,
            },
        });

        if (!site) return { success: false, error: "Site not found" };
        return { success: true, site };
    } catch {
        return { success: false, error: "Failed to fetch site details" };
    }
}

export async function generateBlog(
    targetPipelineType?: string,
    siteId?: string,
    authorInput?: AuthorInput,
    gateInput?: SerpGateInput
) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = siteId
            ? await prisma.site.findUnique({ where: { id: siteId, userId: user.id } })
            : await prisma.site.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

        if (!site) {
            return {
                success: false,
                error: siteId
                    ? "Site not found or you do not have access to it."
                    : "Please register a website first before generating blogs.",
            };
        }

        const requestId = normalizeRequestId(gateInput?.requestId);
        const priorRequest = await prisma.blog.findFirst({
            where: { siteId: site.id, generationRequestId: requestId },
            select: {
                id: true, status: true, generationAttemptId: true, generationInput: true,
                title: true, slug: true, content: true, metaDescription: true, targetKeywords: true,
            },
        });
        if (priorRequest) return resumeStoredGeneration(priorRequest);

        const effectiveTier = await getEffectiveTier(user.id);
        const rateLimitError = await runRateLimitChecks(user.id, effectiveTier);
        if (rateLimitError) return { success: false, error: rateLimitError };

        // ── SERP gate (authoritative) ──────────────────────────────────────────
        // Resolve the keyword that will be used — same priority order as the
        // Inngest dispatch below.  At this point GSC/seed not yet fetched so
        // we only have authorInput.keyword; the gate skips when keyword is absent.
        const chosenKeywordForGate = authorInput?.keyword?.trim() || undefined;
        const gateResult = await runSerpGate(user.id, site.id, chosenKeywordForGate, gateInput);
        if (gateResult.blocked) return gateResult.result;
        const serpSignalForInngest = gateResult.signal;

        const author = buildAuthorProfile(authorInput, site, user.name);

        // Fire author save without blocking — we don't need the result
        void maybeSaveAuthorToSite(site.id, authorInput);

        const chosenKeyword = authorInput?.keyword?.trim();

        // Original code fired these sequentially; they have no dependency on each
        // other, so run them concurrently. Typical saving: ~600–1200ms per call.
        const [siteContext, gscResult, compKeyword, usedBlogKeywords, seedKeywords] =
            await Promise.all([
                extractSiteContext(site.domain),

                // GSC — typed availability semantics; API_ERROR ≠ NO_DATA ≠ NOT_CONNECTED
                (async (): Promise<{ opportunities: Awaited<ReturnType<typeof findOpportunities>>; gscStatus: GscDataResult<unknown>["status"]; gscProperty?: string }> => {
                    try {
                        const token = await getUserGscToken(user.id);
                        const gscProperty = await getAuthorizedGscProperty(user.id, token, site.domain);
                        const raw = await fetchGSCKeywords(token, gscProperty);
                        const opps = findOpportunities(raw);
                        return {
                            opportunities: opps,
                            gscStatus: opps.length > 0 ? "AVAILABLE" : "NO_DATA",
                            gscProperty,
                        };
                    } catch (err) {
                        const status = classifyGscError(err);
                        logGscFailure("Blog", status, {
                            siteId: site.id,
                            userId: user.id,
                            note: "Proceeding without GSC opportunities — pipeline selection may be degraded",
                        });
                        return {
                            opportunities: [] as Awaited<ReturnType<typeof findOpportunities>>,
                            gscStatus: status,
                        };
                    }
                })(),

                prisma.competitorKeyword.findFirst({
                    where: { competitor: { siteId: site.id } },
                    orderBy: { searchVolume: "desc" },
                    include: { competitor: true },
                }),

                prisma.blog.findMany({
                    where: { siteId: site.id },
                    select: { targetKeywords: true },
                }),

                prisma.rankSnapshot.findMany({
                    where: { siteId: site.id, device: "seed" },
                    orderBy: { recordedAt: "desc" },
                }),
            ]);

        // Build used-keywords set once
        const usedKeywordsSet = new Set(
            usedBlogKeywords.flatMap((b: { targetKeywords: string[] }) =>
                b.targetKeywords.map((k: string) => k.toLowerCase())
            )
        );

        const unusedSeed = seedKeywords.find(
            (sk: { keyword: string }) => !usedKeywordsSet.has(sk.keyword.toLowerCase())
        );

        // If the user explicitly chose a keyword we've already covered, warn
        // rather than burning an LLM call on a duplicate post.
        if (chosenKeyword && usedKeywordsSet.has(chosenKeyword.toLowerCase())) {
            logger.warn("[Blog Action] Chosen keyword already used, continuing anyway", {
                keyword: chosenKeyword,
                siteId: site.id,
            });
            // We continue (don't block) — user intent wins — but it's logged.
        }

        // Inngest handles all generation; this action only decides which
        // pipeline the job should run.
        let pipelineType = targetPipelineType || "INDUSTRY";
        if (targetPipelineType === "DATA_REPORT") {
            // Explicit override — keep as-is
        } else if (chosenKeyword) {
            pipelineType = "USER_KEYWORD";
        } else if (unusedSeed) {
            pipelineType = "SEED_KEYWORD";
        } else if (gscResult.opportunities[0]) {
            pipelineType = "GSC_GAP";
        } else if (compKeyword?.competitor) {
            pipelineType = "COMPETITOR_GAP";
        } else if (siteContext) {
            pipelineType = "INDUSTRY";
        }

        // The Inngest job owns all LLM generation and overwrites these placeholder
        // fields with the real content once complete. The stub lets the UI render
        // a spinner immediately without waiting for generation to finish.
        const placeholderTitle = chosenKeyword
            ? `Generating: ${chosenKeyword}`
            : `Generating post for ${site.domain}`;
        const attemptId = randomUUID();
        const placeholderSlug = `generating-${attemptId}`;

        let savedBlog: Awaited<ReturnType<typeof prisma.blog.create>>;
        try {
            savedBlog = await prisma.blog.create({
                data: {
                siteId: site.id,
                pipelineType,
                title: placeholderTitle,
                slug: placeholderSlug,
                targetKeywords: chosenKeyword ? [chosenKeyword] : [],
                content: "",
                metaDescription: "",
                status: "GENERATING",
                generationRequestId: requestId,
                generationAttemptId: attemptId,
                },
            });
        } catch (error) {
            if ((error as { code?: string })?.code === "P2002") {
                const racedRequest = await prisma.blog.findFirst({
                    where: { siteId: site.id, generationRequestId: requestId },
                    select: {
                        id: true, status: true, generationAttemptId: true, generationInput: true,
                        title: true, slug: true, content: true, metaDescription: true, targetKeywords: true,
                    },
                });
                if (racedRequest) return resumeStoredGeneration(racedRequest);
            }
            throw error;
        }

        // Build GSC opportunity evidence for GSC_GAP blogs (provenance snapshot)
        let gscEvidence: GscOpportunityEvidence | undefined;
        if (pipelineType === "GSC_GAP" && gscResult.opportunities[0] && gscResult.gscProperty) {
            const opp = gscResult.opportunities[0];
            // Reconstruct the exact date range used by fetchGSCKeywords (90 days, 3-day lag)
            const GSC_LAG_DAYS = 3;
            const endDate = new Date();
            endDate.setDate(endDate.getDate() - GSC_LAG_DAYS);
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 90);
            const fmtDate = (d: Date) => d.toISOString().split("T")[0];

            const rawEvidence = {
                generationId: savedBlog.id,
                siteId: site.id,
                property: gscResult.gscProperty,
                sourceStatus: "AVAILABLE" as const,
                query: opp.keyword,
                url: opp.urls?.[0]?.url,
                dateRange: {
                    startDate: fmtDate(startDate),
                    endDate: fmtDate(endDate),
                },
                position: opp.avgPosition,
                impressions: opp.impressions,
                clicks: opp.clicks,
                ctr: opp.ctr,
                expectedCtr: undefined,
                opportunityScore: opp.opportunityScore,
                opportunityType: opp.opportunityType,
                reason: opp.reason,
                capturedAt: new Date().toISOString(),
            };

            gscEvidence = validateGscEvidence(rawEvidence, `blog:${savedBlog.id}`) ?? undefined;
        }

        const eventData = JSON.parse(JSON.stringify({
                    siteId: site.id,
                    blogId: savedBlog.id,
                    userId: user.id,
                    pipelineType,
                    // Always forward keyword so SERP research, intent detection,
                    // and semantic enrichment all target the correct term.
                    keyword: chosenKeyword || compKeyword?.keyword || unusedSeed?.keyword || gscResult.opportunities[0]?.keyword || undefined,
                    // Forward the pre-classified SERP signal so Inngest doesn't
                    // need to re-classify (it still fetches for research context).
                    serpSignal: serpSignalForInngest ?? undefined,
                    // Forward author context so Inngest doesn't need an extra
                    // DB round-trip to reconstruct the AuthorProfile.
                    authorName: author.name,
                    authorRole: author.role,
                    authorBio: author.bio,
                    realExperience: author.realExperience,
                    realNumbers: author.realNumbers,
                    localContext: author.localContext,
                    ...(compKeyword?.competitor
                        ? {
                            competitorDomain: compKeyword.competitor.domain,
                            searchVolume: compKeyword.searchVolume ?? 0,
                            difficulty: compKeyword.difficulty ?? 0,
                        }
                        : {}),
                    // GSC opportunity evidence — full provenance for GSC_GAP blogs.
                    // Undefined for non-GSC pipelines (USER_KEYWORD, COMPETITOR_GAP, etc.)
                    gscEvidence: gscEvidence ?? undefined,
        })) as BlogGenerationEventData;

        try {
            await prisma.blog.update({
                where: { id: savedBlog.id },
                data: { generationInput: eventData as Prisma.InputJsonValue },
            });
        } catch (error) {
            await prisma.blog.delete({ where: { id: savedBlog.id } }).catch(() => null);
            throw error;
        }

        const creditResult = await consumeCreditsIdempotent(
            user.id,
            "blog_generation",
            `blog-generation:${savedBlog.id}:${attemptId}`,
        );
        if (!creditResult.allowed) {
            await prisma.blog.delete({ where: { id: savedBlog.id } });
            return {
                success: false,
                error: creditResult.reason === "credits_locked"
                    ? "Your credits are locked. Resubscribe or buy a credit pack to unlock them."
                    : `Insufficient credits. Blog generation costs 10 credits. You have ${creditResult.remaining}. Credits reset monthly.`,
                code: creditResult.reason ?? "insufficient_credits",
            };
        }

        try {
            await dispatchBlogGeneration(savedBlog.id, attemptId, eventData);
        } catch (e) {
            logger.warn("[Blog Action] Inngest dispatch acknowledgement pending recovery", {
                blogId: savedBlog.id,
                errorName: e instanceof Error ? e.name : "unknown",
            });
        }

        revalidatePath("/dashboard/blogs");
        revalidatePath("/dashboard");
        return { success: true, blog: savedBlog, status: "Generating", pending: true };

    } catch (error: unknown) {
        logger.error("[Blog Action] generateBlog failed:", { errorName: error instanceof Error ? error.name : "unknown" });
        return { success: false, error: "Generation could not be started. Please try again." };
    }
}

export async function generateAttackBlog(
    siteId: string,
    keyword: string,
    competitorDomain: string,
    searchVolume: number,
    difficulty: number,
    authorInput?: Omit<AuthorInput, "keyword">,
    gateInput?: SerpGateInput
) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await prisma.site.findUnique({ where: { id: siteId, userId: user.id } });
        if (!site) return { success: false, error: "Site not found" };
        const requestId = normalizeRequestId(gateInput?.requestId);
        const priorRequest = await prisma.blog.findFirst({
            where: { siteId, generationRequestId: requestId },
            select: {
                id: true, status: true, generationAttemptId: true, generationInput: true,
                title: true, slug: true, content: true, metaDescription: true, targetKeywords: true,
            },
        });
        if (priorRequest) return resumeStoredGeneration(priorRequest);

        const effectiveTier = await getEffectiveTier(user.id);
        const rateLimitError = await runRateLimitChecks(user.id, effectiveTier);
        if (rateLimitError) return { success: false, error: rateLimitError };

        // ── SERP gate (authoritative) ──────────────────────────────────────────
        const gateResult = await runSerpGate(user.id, siteId, keyword, gateInput);
        if (gateResult.blocked) return gateResult.result;
        const serpSignalForInngest = gateResult.signal;

        const author = buildAuthorProfile(authorInput, site, user.name);

        // Create rank snapshot if it doesn't already exist
        const existingRank = await prisma.rankSnapshot.findFirst({ where: { siteId: site.id, keyword } });
        if (!existingRank) {
            await prisma.rankSnapshot.create({
                data: { siteId: site.id, keyword, position: 100, device: "desktop", intent: "unknown" },
            }).catch(() => null); // non-fatal
        }

        const attemptId = randomUUID();
        let blog: Awaited<ReturnType<typeof prisma.blog.create>>;
        try {
            blog = await prisma.blog.create({
                data: {
                siteId: site.id,
                pipelineType: "COMPETITOR_ATTACK",
                title: `Generating: ${keyword}`,
                slug: `generating-attack-${attemptId}`,
                targetKeywords: [keyword],
                content: "",
                metaDescription: "",
                status: "GENERATING",
                generationRequestId: requestId,
                generationAttemptId: attemptId,
                },
            });
        } catch (error) {
            if ((error as { code?: string })?.code === "P2002") {
                const racedRequest = await prisma.blog.findFirst({
                    where: { siteId, generationRequestId: requestId },
                    select: {
                        id: true, status: true, generationAttemptId: true, generationInput: true,
                        title: true, slug: true, content: true, metaDescription: true, targetKeywords: true,
                    },
                });
                if (racedRequest) return resumeStoredGeneration(racedRequest);
            }
            throw error;
        }

        const eventData = toEventData({
            siteId: site.id,
            blogId: blog.id,
            userId: user.id,
            pipelineType: "COMPETITOR_ATTACK",
            keyword,
            competitorDomain,
            searchVolume,
            difficulty,
            serpSignal: serpSignalForInngest ?? undefined,
            authorName: author.name,
            authorRole: author.role,
            authorBio: author.bio,
            realExperience: author.realExperience,
            realNumbers: author.realNumbers,
            localContext: author.localContext,
        });
        try {
            await prisma.blog.update({ where: { id: blog.id }, data: { generationInput: eventData as Prisma.InputJsonValue } });
        } catch (error) {
            await prisma.blog.delete({ where: { id: blog.id } }).catch(() => null);
            throw error;
        }

        const creditResult = await consumeCreditsIdempotent(
            user.id,
            "blog_generation",
            `blog-generation:${blog.id}:${attemptId}`,
        );
        if (!creditResult.allowed) {
            await prisma.blog.delete({ where: { id: blog.id } });
            return {
                success: false,
                error: creditResult.reason === "credits_locked"
                    ? "Your credits are locked. Resubscribe or buy a credit pack to unlock them."
                    : `Insufficient credits. Competitor blog generation costs 10 credits. You have ${creditResult.remaining}. Credits reset monthly.`,
                code: creditResult.reason ?? "insufficient_credits",
            };
        }

        try {
            await dispatchBlogGeneration(blog.id, attemptId, eventData);
        } catch (e) {
            logger.warn("[Blog Action] Attack blog dispatch acknowledgement pending recovery", {
                blogId: blog.id,
                errorName: e instanceof Error ? e.name : "unknown",
            });
        }

        revalidatePath("/dashboard/blogs");
        revalidatePath(`/dashboard/sites/${site.id}`);
        revalidatePath("/dashboard");

        return { success: true, blog, status: "Generating", pending: true };

    } catch (error: unknown) {
        logger.error("[Blog Action] generateAttackBlog failed:", { errorName: error instanceof Error ? error.name : "unknown" });
        return { success: false, error: "Generation could not be started. Please try again." };
    }
}
