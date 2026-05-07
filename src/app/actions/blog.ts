"use server";

import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit/check";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { AuthorProfile } from "@/lib/blog";
import { fetchGSCKeywords, findOpportunities, normaliseSiteUrl } from "@/lib/gsc";
import { extractSiteContext } from "@/lib/blog/context";
import { scoreContent } from "@/lib/content-scoring";
import { getEffectiveTier } from "@/lib/stripe/guards";
import { getUserGscToken } from "@/lib/gsc/token";
import { consumeCredits } from "@/lib/credits";
import { requireUser } from "@/lib/auth/require-user";


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

// ─── Shared helpers ───────────────────────────────────────────────────────────

function buildAuthorProfile(
    authorInput: AuthorInput | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    site: any,
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
    effectiveTier: string
): Promise<string | null> {
    const burstLimited = await rateLimit("blogGenerate", userId);
    if (burstLimited) {
        const body = await burstLimited.json();
        return body.error ?? "Too many requests. Please wait a moment.";
    }

    const { checkBlogLimit } = await import("@/lib/rate-limit");
    const rateCheck = await checkBlogLimit(userId, effectiveTier);
    if (!rateCheck.allowed) {
        return `You have reached your blog generation limit. Upgrade to Pro for unlimited. Resets on ${rateCheck.resetAt.toLocaleDateString()}.`;
    }

    return null;
}

// ─── Public actions ───────────────────────────────────────────────────────────

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

// ── Main blog generation action ───────────────────────────────────────────────
export async function generateBlog(
    targetPipelineType?: string,
    siteId?: string,
    authorInput?: AuthorInput
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

        // ── Rate limiting ─────────────────────────────────────────────────────
        const effectiveTier = await getEffectiveTier(user.id);
        const rateLimitError = await runRateLimitChecks(user.id, effectiveTier);
        if (rateLimitError) return { success: false, error: rateLimitError };

        // CREDITS: deduct BEFORE running the expensive LLM pipeline.
        // The rule: check → deduct → generate. Credits consumed on failure are intentional —
        // this prevents the free-generation exploit. Cost: CREDIT_COSTS.blog_generation (10).
        const creditResult = await consumeCredits(user.id, "blog_generation");
        if (!creditResult.allowed) {
            return {
                success: false,
                error: `Insufficient credits. Blog generation costs 10 credits. You have ${creditResult.remaining}. Credits reset monthly.`,
                code: "insufficient_credits",
            };
        }

        // ── Author ────────────────────────────────────────────────────────────
        const author = buildAuthorProfile(authorInput, site, user.name);

        // Fire author save without blocking — we don't need the result
        void maybeSaveAuthorToSite(site.id, authorInput);

        const chosenKeyword = authorInput?.keyword?.trim();

        // ── Parallel data fetch ───────────────────────────────────────────────
        // Original code fired these sequentially; they have no dependency on each
        // other, so run them concurrently. Typical saving: ~600–1200ms per call.
        const [siteContext, gscOpportunities, compKeyword, usedBlogKeywords, seedKeywords] =
            await Promise.all([
                extractSiteContext(site.domain),

                // GSC — swallow errors; missing token is expected for new users
                (async () => {
                    try {
                        const token = await getUserGscToken(user.id);
                        const raw = await fetchGSCKeywords(token, normaliseSiteUrl(site.domain));
                        return findOpportunities(raw);
                    } catch {
                        return [] as Awaited<ReturnType<typeof findOpportunities>>;
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

        // ── Duplicate guard ───────────────────────────────────────────────────
        // If the user explicitly chose a keyword we've already covered, warn
        // rather than burning an LLM call on a duplicate post.
        if (chosenKeyword && usedKeywordsSet.has(chosenKeyword.toLowerCase())) {
            logger.warn("[Blog Action] Chosen keyword already used, continuing anyway", {
                keyword: chosenKeyword,
                siteId: site.id,
            });
            // We continue (don't block) — user intent wins — but it's logged.
        }

        // ── Pipeline type resolution (no LLM calls) ───────────────────────────
        // Inngest handles all generation; this action only decides which
        // pipeline the job should run.
        let pipelineType = targetPipelineType || "INDUSTRY";
        if (targetPipelineType === "DATA_REPORT") {
            // Explicit override — keep as-is
        } else if (chosenKeyword) {
            pipelineType = "USER_KEYWORD";
        } else if (unusedSeed) {
            pipelineType = "SEED_KEYWORD";
        } else if (gscOpportunities[0]) {
            pipelineType = "GSC_GAP";
        } else if (compKeyword?.competitor) {
            pipelineType = "COMPETITOR_GAP";
        } else if (siteContext) {
            pipelineType = "INDUSTRY";
        }

        // ── Create GENERATING stub ────────────────────────────────────────────
        // The Inngest job owns all LLM generation and overwrites these placeholder
        // fields with the real content once complete. The stub lets the UI render
        // a spinner immediately without waiting for generation to finish.
        const placeholderTitle = chosenKeyword
            ? `Generating: ${chosenKeyword}`
            : `Generating post for ${site.domain}`;
        const placeholderSlug = `generating-${Date.now()}`;

        const savedBlog = await prisma.blog.create({
            data: {
                siteId: site.id,
                pipelineType,
                title: placeholderTitle,
                slug: placeholderSlug,
                targetKeywords: chosenKeyword ? [chosenKeyword] : [],
                content: "",
                metaDescription: "",
                status: "GENERATING",
            },
        });

        // ── Dispatch Inngest — all LLM work happens there ─────────────────────
        try {
            const { inngest } = await import("@/lib/inngest/client");
            await inngest.send({
                name: "blog.generate",
                data: {
                    siteId: site.id,
                    blogId: savedBlog.id,
                    userId: user.id,
                    pipelineType,
                    // Always forward keyword so SERP research, intent detection,
                    // and semantic enrichment all target the correct term.
                    keyword: chosenKeyword || compKeyword?.keyword || unusedSeed?.keyword || gscOpportunities[0]?.keyword || undefined,
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
                },
            });
        } catch (e) {
            // Non-fatal: stub exists — mark FAILED so the UI doesn't spin forever.
            logger.warn("[Blog Action] inngest.send failed — marking blog FAILED", {
                blogId: savedBlog.id,
                error: e instanceof Error ? e.message : String(e),
            });
            await prisma.blog.update({
                where: { id: savedBlog.id },
                data: { status: "FAILED" },
            }).catch(() => null);
        }

        revalidatePath("/dashboard/blogs");
        revalidatePath("/dashboard");
        return { success: true, blog: savedBlog, status: "Generating" };

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("[Blog Action] generateBlog failed:", { error: msg });
        return { success: false, error: `Generation failed: ${msg}` };
    }
}

// ── Competitor attack blog ────────────────────────────────────────────────────
export async function generateAttackBlog(
    siteId: string,
    keyword: string,
    competitorDomain: string,
    searchVolume: number,
    difficulty: number,
    authorInput?: Omit<AuthorInput, "keyword">
) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const effectiveTier = await getEffectiveTier(user.id);
        const rateLimitError = await runRateLimitChecks(user.id, effectiveTier);
        if (rateLimitError) return { success: false, error: rateLimitError };

        // CREDITS: same 10-credit cost as generateBlog
        const creditResult = await consumeCredits(user.id, "blog_generation");
        if (!creditResult.allowed) {
            return {
                success: false,
                error: `Insufficient credits. Competitor blog generation costs 10 credits. You have ${creditResult.remaining}. Credits reset monthly.`,
                code: "insufficient_credits",
            };
        }

        const site = await prisma.site.findUnique({ where: { id: siteId, userId: user.id } });
        if (!site) return { success: false, error: "Site not found" };

        const author = buildAuthorProfile(authorInput, site, user.name);

        // Create rank snapshot if it doesn't already exist
        const existingRank = await prisma.rankSnapshot.findFirst({ where: { siteId: site.id, keyword } });
        if (!existingRank) {
            await prisma.rankSnapshot.create({
                data: { siteId: site.id, keyword, position: 100, device: "desktop", intent: "unknown" },
            }).catch(() => null); // non-fatal
        }

        // ── Create GENERATING stub ────────────────────────────────────────────
        const blog = await prisma.blog.create({
            data: {
                siteId: site.id,
                pipelineType: "COMPETITOR_ATTACK",
                title: `Generating: ${keyword}`,
                slug: `generating-attack-${Date.now()}`,
                targetKeywords: [keyword],
                content: "",
                metaDescription: "",
                status: "GENERATING",
            },
        });

        // ── Dispatch Inngest ──────────────────────────────────────────────────
        try {
            const { inngest } = await import("@/lib/inngest/client");
            await inngest.send({
                name: "blog.generate",
                data: {
                    siteId: site.id,
                    blogId: blog.id,
                    userId: user.id,
                    pipelineType: "COMPETITOR_ATTACK",
                    keyword,
                    competitorDomain,
                    searchVolume,
                    difficulty,
                    authorName: author.name,
                    authorRole: author.role,
                    authorBio: author.bio,
                    realExperience: author.realExperience,
                    realNumbers: author.realNumbers,
                    localContext: author.localContext,
                },
            });
        } catch (e) {
            logger.warn("[Blog Action] inngest.send failed for attack blog — marking FAILED", {
                blogId: blog.id,
                error: e instanceof Error ? e.message : String(e),
            });
            await prisma.blog.update({
                where: { id: blog.id },
                data: { status: "FAILED" },
            }).catch(() => null);
        }

        revalidatePath("/dashboard/blogs");
        revalidatePath(`/dashboard/sites/${site.id}`);
        revalidatePath("/dashboard");

        return { success: true, blog, status: "Generating" };

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("[Blog Action] generateAttackBlog failed:", { error: msg });
        return { success: false, error: `Generation failed: ${msg}` };
    }
}