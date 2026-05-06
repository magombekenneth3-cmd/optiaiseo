"use server";
import { logger } from "@/lib/logger";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchCompetitorKeywordGaps, fetchCompetitorIntelligence, getDynamicCtr, CTR_CURVE } from "@/lib/competitors";
import { generateBlogFromCompetitorGap } from "@/lib/blog";
import { revalidatePath } from "next/cache";
import { checkCompetitorRefreshLimit } from "@/lib/rate-limit";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { detectCompetitorsCore } from "@/lib/competitors/detect";
import { getDomainOverview, getCompetitorTopPages, resolveLocationCode } from "@/lib/keywords/dataforseo";
import { upsertTrafficSnapshot } from "@/lib/competitors/snapshots";


// ─── Ownership helper ─────────────────────────────────────────────────────────

async function assertSiteOwnership(siteId: string, userEmail: string) {
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) return null;
    const site = await prisma.site.findFirst({ where: { id: siteId, userId: user.id } });
    return site;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function addCompetitor(siteId: string, domain: string) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized" };

        // Security: verify the user owns this site
        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, error: "Site not found or access denied" };

        let cleanDomain = domain.trim().toLowerCase();
        cleanDomain = cleanDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

        // Check if under 12 competitors
        const count = await prisma.competitor.count({ where: { siteId } });
        if (count >= 12) {
            return { success: false, error: "Maximum of 12 competitors allowed." };
        }

        const comp = await prisma.competitor.create({
            data: { siteId, domain: cleanDomain }
        });

        revalidatePath('/dashboard/keywords');
        return { success: true, competitor: comp };
    } catch (e: unknown) {
        logger.error("Failed to add competitor:", { error: (e as Error)?.message || String(e) });
        return { success: false, error: "Server error adding competitor" };
    }
}

export async function getCompetitors(siteId: string) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized" };

        // Security: verify the user owns this site
        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, error: "Site not found or access denied" };

        const competitors = await prisma.competitor.findMany({
            where: { siteId },
            include: { keywords: true },
            orderBy: { addedAt: 'desc' }
        });

        return { success: true, competitors };
    } catch (e: unknown) {
        logger.error("Failed to get competitors:", { error: (e as Error)?.message || String(e) });
        return { success: false, error: "Server error fetching competitors" };
    }
}

export async function refreshCompetitorKeywords(siteId: string, competitorId: string) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized" };

        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, error: "Site not found or access denied" };

        const rl = await checkCompetitorRefreshLimit(site.userId);
        if (!rl.allowed) return { success: false, error: 'Competitor refresh limit reached (10/day). Resets tomorrow.' };

        const comp = await prisma.competitor.findUnique({ where: { id: competitorId } });
        if (!comp || comp.siteId !== siteId) return { success: false, error: "Competitor not found" };

        // Try the full intelligence engine first; fall back to basic gap fetch on error
        let gaps: Awaited<ReturnType<typeof fetchCompetitorKeywordGaps>> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let profile: any = null;
        try {
            const result = await fetchCompetitorIntelligence(site.domain, comp.domain, siteId);
            gaps = result.gaps;
            profile = result.profile;
        } catch (intelligenceErr) {
            logger.warn("[Competitor] Intelligence engine failed, falling back to basic gap fetch", {
                error: (intelligenceErr as Error)?.message,
            });
            gaps = await fetchCompetitorKeywordGaps(site.domain, comp.domain);
        }

        // ── Enrich with real GSC data ──────────────────────────────────────────
        type GscEntry = { position: number; clicks: number; impressions: number; ctr: number };
        const gscKeywords = new Map<string, GscEntry>();

        try {
            const user = await prisma.user.findUnique({ where: { id: site.userId } });
            if (user?.gscConnected) {
                const accessToken = await getUserGscToken(site.userId);
                const siteUrl = normaliseSiteUrl(site.domain);
                const gscRows = await fetchGSCKeywords(accessToken, siteUrl, 90, 1000);

                // Build a case-insensitive lookup map
                for (const row of gscRows) {
                    gscKeywords.set(row.keyword.toLowerCase(), {
                        position: row.position,
                        clicks: row.clicks,
                        impressions: row.impressions,
                        ctr: row.ctr,
                    });
                }
            }
        } catch (gscErr) {
            // GSC enrichment failure must never block the competitor sync
            logger.warn("[Competitor] GSC enrichment failed, falling back to estimates", {
                error: (gscErr as Error)?.message,
            });
        }
        // ─────────────────────────────────────────────────────────────────────

        // Clear old keywords
        await prisma.competitorKeyword.deleteMany({ where: { competitorId } });

        // Save gaps enriched with real GSC data where available
        if (gaps.length > 0) {
            await prisma.competitorKeyword.createMany({
                data: gaps.map(gap => {
                    const gsc = gscKeywords.get(gap.keyword.toLowerCase());

                    const estimatedCtr = gap.serpFeatures
                        ? getDynamicCtr(gap.position, gap.serpFeatures)
                        : (CTR_CURVE[Math.min(gap.position, 10)] ?? 0.01);
                    const estimatedImpressions = gap.searchVolume;
                    const estimatedClicks = Math.round(estimatedImpressions * estimatedCtr);

                    return {
                        competitorId,
                        keyword: gap.keyword,
                        position: gsc?.position ?? gap.position,
                        searchVolume: gsc
                            ? Math.round((gsc.impressions / 90) * 30)
                            : gap.searchVolume,
                        difficulty: gap.difficulty,
                        url: gap.url,
                        clicks: gsc?.clicks ?? estimatedClicks,
                        impressions: gsc?.impressions ?? estimatedImpressions,
                        ctr: gsc?.ctr ?? estimatedCtr,
                        dataSource: gsc ? "gsc" : "serp-estimate",
                    };
                }),
            });
        }

        const locationCode = resolveLocationCode(site.localContext ?? null);

        const [domainOverview, topPages] = await Promise.allSettled([
            getDomainOverview(comp.domain, locationCode),
            getCompetitorTopPages(comp.domain, locationCode),
        ]);

        const overview = domainOverview.status === "fulfilled" ? domainOverview.value : null;
        const pages = topPages.status === "fulfilled" ? topPages.value : [];

        await prisma.competitor.update({
            where: { id: competitorId },
            data: {
                metadata: {
                    estimatedMonthlyVisits: overview?.organicTraffic ?? profile?.estimatedMonthlyVisits,
                    organicKeywords: overview?.organicKeywords ?? null,
                    trafficCost: overview?.trafficCost ?? null,
                    topCountries: overview?.topCountries ?? [],
                    trafficTier: profile?.trafficTier,
                    domainAuthorityTier: profile?.domainAuthorityTier,
                    topContentPillars: profile?.topContentPillars,
                    growthTrend: profile?.growthTrend,
                    trafficSources: profile?.trafficSources,
                    topKeywordGapCount: profile?.topKeywordGapCount,
                    analysisNote: profile?.analysisNote,
                    topPages: pages,
                    profileUpdatedAt: new Date().toISOString(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any,
            },
        });

        await upsertTrafficSnapshot(
            competitorId,
            overview?.organicTraffic ?? profile?.estimatedMonthlyVisits ?? 0,
            overview?.organicKeywords ?? undefined,
        );

        revalidatePath('/dashboard/keywords');
        return { success: true, count: gaps.length, profile };
    } catch (e: unknown) {
        logger.error("Failed to refresh competitor gaps:", { error: (e as Error)?.message || String(e) });
        return { success: false, error: "Failed to refresh keyword gaps" };
    }
}



export async function deleteCompetitor(siteId: string, competitorId: string) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized" };

        // Security: verify the user owns this site
        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, error: "Site not found or access denied" };

        await prisma.competitor.delete({
            where: { id: competitorId, siteId: siteId }
        });

        revalidatePath('/dashboard/keywords');
        return { success: true };
    } catch (e: unknown) {
        logger.error("Failed to delete competitor:", { error: (e as Error)?.message || String(e) });
        return { success: false, error: "Server error deleting competitor" };
    }
}

export async function generateBlogForCompetitor(
    siteId: string,
    competitorDomain: string,
    keyword: string,
    searchVolume: number,
    difficulty: number,
    intent?: string
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized" };

        // Security: verify the user owns this site
        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, error: "Site not found or access denied" };

        const liveBlogPost = await generateBlogFromCompetitorGap(
            keyword,
            competitorDomain,
            searchVolume,
            difficulty,
            {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                name: (site as any).authorName || site.domain,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                role: (site as any).authorRole || undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                bio: (site as any).authorBio || undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                realExperience: (site as any).realExperience || undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                realNumbers: (site as any).realNumbers || undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                localContext: (site as any).localContext || undefined,
            },
            site.domain,    // siteDomain
            intent,         // intent
            undefined,      // tone
            siteId          // siteId
        );

        const newBlog = await prisma.blog.create({
            data: {
                siteId,
                pipelineType: "COMPETITOR_GAP",
                title: liveBlogPost.title,
                slug: liveBlogPost.slug,
                targetKeywords: liveBlogPost.targetKeywords,
                content: liveBlogPost.content,
                metaDescription: liveBlogPost.metaDescription,
                status: "DRAFT",
            },
        });

        revalidatePath('/dashboard/blogs');
        revalidatePath('/dashboard/keywords');
        return { success: true, blogId: newBlog.id };
    } catch (error: unknown) {
        logger.error("Failed to generate competitor blog:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to generate blog. Check logs." };
    }
}

// =============================================================================
// Competitor auto-detection via SERP
// Full pipeline: scrape → AI extract → 4-intent Serper queries → 5-layer filter
// → freq×position scoring → geo-strip fallback → deduplicate
// =============================================================================

export async function detectCompetitorsFromSerp(siteId: string): Promise<{
    success: boolean;
    suggestions?: string[];
    warnings?: string[];
    error?: string;
}> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized" };

        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, error: "Site not found" };

        if (!process.env.SERPER_API_KEY) {
            return { success: false, error: "SERPER_API_KEY not configured" };
        }
        if (!process.env.ANTHROPIC_API_KEY) {
            return { success: false, error: "ANTHROPIC_API_KEY not configured" };
        }

        logger.info("[competitor-detect] Starting SERP detection", {
            siteId,
            domain: site.domain,
            location: site.localContext,
        });

        // ── Pull real ranking keywords from DB (mirrors blog intelligence pipeline) ──
        let rankingKeywords: string[] = [];
        try {
            const snapshots = await prisma.rankSnapshot.findMany({
                where: { siteId },
                orderBy: { recordedAt: "desc" },
                take: 150,
                select: { keyword: true, position: true },
            });
            const seen = new Set<string>();
            for (const snap of snapshots) {
                const kw = snap.keyword.trim().toLowerCase();
                if (!seen.has(kw) && kw.length > 2) {
                    seen.add(kw);
                    rankingKeywords.push(snap.keyword.trim());
                }
                if (rankingKeywords.length >= 12) break;
            }
        } catch (snapErr) {
            logger.warn("[competitor-detect] Could not fetch RankSnapshots — proceeding without", {
                error: (snapErr as Error)?.message,
            });
        }

        // Fetch user tier for query budget
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { subscriptionTier: true },
        });
        const subscriptionTier = (user?.subscriptionTier ?? "FREE") as "FREE" | "STARTER" | "PRO" | "AGENCY";

        const result = await detectCompetitorsCore(site.domain, {
            location:                 site.localContext ?? undefined,
            coreServices:             site.targetKeyword ?? undefined,
            targetKeyword: rankingKeywords.length === 0 ? (site.targetKeyword ?? undefined) : undefined,
            rankingKeywords: rankingKeywords,
            maxCompetitorsPerService: 10,
            maxServices: 4,
            minFrequencyThreshold: 1.5,
            subscriptionTier,
        });

        logger.info("[competitor-detect] Detection complete", {
            services: result.services.map((s) => s.label),
            competitors: result.competitors.length,
            warnings: result.warnings,
        });

        // ── Guard: do NOT return suggestions if nothing passed scoring ─────────
        if (result.competitors.length === 0) {
            return {
                success: false,
                error: "Detection ran but found no qualifying competitors. " +
                    (result.warnings.at(-1) ?? "Check site fingerprint or lower score threshold."),
                warnings: result.warnings,
            };
        }

        // Return top 12 unique domains
        const suggestions = result.competitors
            .slice(0, 12)
            .map((c) => c.domain);

        return { success: true, suggestions, warnings: result.warnings };
    } catch (e: unknown) {
        logger.error("[competitor-detect] detectCompetitorsFromSerp failed", {
            error: (e as Error)?.message,
        });
        return { success: false, error: "Detection failed" };
    }
}

// =============================================================================
// Auto-detect + bulk-save — service-aware, saves top 12 directly to DB
// =============================================================================

export async function autoDetectAndSaveCompetitors(siteId: string): Promise<{
    success: boolean;
    added: string[];
    skipped: string[];
    warnings?: string[];
    error?: string;
}> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, added: [], skipped: [], error: "Unauthorized" };

        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, added: [], skipped: [], error: "Site not found" };

        if (!process.env.SERPER_API_KEY)    return { success: false, added: [], skipped: [], error: "SERPER_API_KEY not configured" };
        if (!process.env.ANTHROPIC_API_KEY) return { success: false, added: [], skipped: [], error: "ANTHROPIC_API_KEY not configured" };

        // Fetch existing competitors to skip duplicates
        const existing = await prisma.competitor.findMany({
            where: { siteId },
            select: { domain: true },
        });
        const existingDomains = new Set(existing.map(c => c.domain.toLowerCase()));

        if (existing.length >= 12) {
            return { success: false, added: [], skipped: [], error: "Already tracking 12 competitors. Remove some before auto-detecting again." };
        }

        // Pull ranking keywords for better service context
        let rankingKeywords: string[] = [];
        try {
            const snapshots = await prisma.rankSnapshot.findMany({
                where: { siteId },
                orderBy: { recordedAt: "desc" },
                take: 150,
                select: { keyword: true, position: true },
            });
            const seen = new Set<string>();
            for (const snap of snapshots) {
                const kw = snap.keyword.trim().toLowerCase();
                if (!seen.has(kw) && kw.length > 2) {
                    seen.add(kw);
                    rankingKeywords.push(snap.keyword.trim());
                }
                if (rankingKeywords.length >= 15) break;
            }
        } catch { /* proceed without */ }

        logger.info("[autoDetect] Starting service-aware detection", {
            siteId, domain: site.domain, rankingKeywords: rankingKeywords.length,
        });

        // Fetch user tier for query budget
        const userRec = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { subscriptionTier: true },
        });
        const subscriptionTier = (userRec?.subscriptionTier ?? "FREE") as "FREE" | "STARTER" | "PRO" | "AGENCY";

        const result = await detectCompetitorsCore(site.domain, {
            location:                 site.localContext ?? undefined,
            coreServices:             site.targetKeyword ?? undefined,
            rankingKeywords,
            maxCompetitorsPerService: 12,
            maxServices:              5,
            minFrequencyThreshold:    1.0,
            subscriptionTier,
        });

        // ── Guard: abort if detection failed or returned nothing ───────────────
        // An empty result means a critical pipeline step failed (SERP quota,
        // AI extraction, or all candidates below threshold). Never save
        // partial / degraded results to the DB.
        if (result.competitors.length === 0) {
            logger.warn("[autoDetect] Detection returned 0 qualifying competitors — aborting save", {
                siteId,
                warnings: result.warnings,
            });
            return {
                success: false,
                added:   [],
                skipped: [],
                warnings: result.warnings,
                error: "No qualifying competitors found. " +
                    (result.warnings.at(-1) ?? "Try again later or check API keys."),
            };
        }

        // Bulk-upsert new competitors (skip duplicates, respect 12-cap)
        const slotsLeft  = 12 - existing.length;
        const candidates = result.competitors
            .map(c => c.domain.toLowerCase())
            .filter(d => !existingDomains.has(d))
            .slice(0, slotsLeft);

        const added: string[] = [];
        const skipped: string[] = [];

        for (const domain of candidates) {
            try {
                await prisma.competitor.create({ data: { siteId, domain } });
                added.push(domain);
            } catch {
                skipped.push(domain); // unique constraint or other error
            }
        }

        revalidatePath("/dashboard/competitors");
        revalidatePath("/dashboard/keywords");

        logger.info("[autoDetect] Complete", {
            siteId, added: added.length, skipped: skipped.length,
            services: result.services.map(s => s.label),
        });

        return { success: true, added, skipped, warnings: result.warnings };
    } catch (e: unknown) {
        logger.error("[autoDetect] autoDetectAndSaveCompetitors failed", {
            error: (e as Error)?.message,
        });
        return { success: false, added: [], skipped: [], error: "Auto-detection failed" };
    }
}

// =============================================================================
// Clear stale competitors + re-run detection from scratch
// =============================================================================

export async function clearAndRedetectCompetitors(siteId: string): Promise<{
    success: boolean;
    added: string[];
    cleared: number;
    warnings?: string[];
    error?: string;
}> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, added: [], cleared: 0, error: "Unauthorized" };

        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, added: [], cleared: 0, error: "Site not found" };

        if (!process.env.SERPER_API_KEY)    return { success: false, added: [], cleared: 0, error: "SERPER_API_KEY not configured" };
        if (!process.env.ANTHROPIC_API_KEY) return { success: false, added: [], cleared: 0, error: "ANTHROPIC_API_KEY not configured" };

        // ── Step 1: Pull ranking keywords ────────────────────────────────────
        let rankingKeywords: string[] = [];
        try {
            const snapshots = await prisma.rankSnapshot.findMany({
                where: { siteId },
                orderBy: { recordedAt: "desc" },
                take: 150,
                select: { keyword: true },
            });
            const seen = new Set<string>();
            for (const snap of snapshots) {
                const kw = snap.keyword.trim().toLowerCase();
                if (!seen.has(kw) && kw.length > 2) { seen.add(kw); rankingKeywords.push(snap.keyword.trim()); }
                if (rankingKeywords.length >= 15) break;
            }
        } catch { /* proceed without */ }

        // ── Step 2: DETECT FIRST — do not touch DB yet ────────────────────────
        // We call detectCompetitorsCore directly so we can validate the result
        // before making any destructive DB changes. If detection fails or returns
        // 0 results the user's existing competitor list is fully preserved.
        // Fetch user tier for query budget
        const userTierRec = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { subscriptionTier: true },
        });
        const subscriptionTier = (userTierRec?.subscriptionTier ?? "FREE") as "FREE" | "STARTER" | "PRO" | "AGENCY";

        const result = await detectCompetitorsCore(site.domain, {
            location:                 site.localContext ?? undefined,
            coreServices:             site.targetKeyword ?? undefined,
            rankingKeywords,
            maxCompetitorsPerService: 12,
            maxServices:              5,
            minFrequencyThreshold:    1.0,
            subscriptionTier,
        });

        if (result.competitors.length === 0) {
            logger.warn("[clearAndRedetect] Detection returned 0 competitors — existing data preserved", {
                siteId, warnings: result.warnings,
            });
            return {
                success: false,
                added:   [],
                cleared: 0,
                warnings: result.warnings,
                error: "Detection found no qualifying competitors — your existing competitor list was NOT changed. " +
                    (result.warnings.at(-1) ?? "Try again later."),
            };
        }

        // ── Step 3: CLEAR — only now that we have good data ───────────────────
        const { count: cleared } = await prisma.competitor.deleteMany({ where: { siteId } });
        logger.info("[clearAndRedetect] Cleared stale competitors", { siteId, cleared });

        // ── Step 4: SAVE new competitors ──────────────────────────────────────
        const newDomains = result.competitors.slice(0, 12).map(c => c.domain.toLowerCase());
        const added: string[] = [];

        for (const domain of newDomains) {
            try {
                await prisma.competitor.create({ data: { siteId, domain } });
                added.push(domain);
            } catch { /* skip constraint violations */ }
        }

        revalidatePath("/dashboard/competitors");
        revalidatePath("/dashboard/keywords");

        logger.info("[clearAndRedetect] Complete", { siteId, cleared, added: added.length });

        return { success: true, added, cleared, warnings: result.warnings };
    } catch (e: unknown) {
        logger.error("[clearAndRedetect] failed", { error: (e as Error)?.message });
        return { success: false, added: [], cleared: 0, error: "Reset failed — your existing competitors were NOT removed." };
    }
}

export async function fetchCompetitorTopPages(
    siteId: string,
    competitorId: string,
): Promise<{
    success: boolean;
    pages?: Awaited<ReturnType<typeof getCompetitorTopPages>>;
    error?: string;
}> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized" };

        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false, error: "Site not found or access denied" };

        const comp = await prisma.competitor.findFirst({ where: { id: competitorId, siteId } });
        if (!comp) return { success: false, error: "Competitor not found" };

        const { limiters } = await import("@/lib/rate-limit/client");
        const rl = await limiters.competitorFetch.limit(`comp-pages:${session.user.email}`);
        if (!rl.success) return { success: false, error: "Too many requests — try again in an hour" };

        const locationCode = resolveLocationCode(site.localContext ?? null);
        const pages = await getCompetitorTopPages(comp.domain, locationCode);
        return { success: true, pages };
    } catch (e: unknown) {
        logger.error("[competitor] fetchCompetitorTopPages failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to fetch top pages" };
    }
}

// ─── Backlink Gap ─────────────────────────────────────────────────────────────

export async function fetchCompetitorBacklinkGap(siteId: string, competitorId: string) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false as const, error: "Unauthorized" };

        const site = await assertSiteOwnership(siteId, session.user.email);
        if (!site) return { success: false as const, error: "Site not found" };

        const comp = await prisma.competitor.findFirst({
            where: { id: competitorId, siteId },
            select: { id: true, domain: true },
        });
        if (!comp) return { success: false as const, error: "Competitor not found" };

        // Rate-limit: 5 gap analyses per day per user
        const { getCompetitorBacklinkGap } = await import("@/lib/backlinks/index");
        const report = await getCompetitorBacklinkGap(site.domain, comp.domain, 25);

        return { success: true as const, report };
    } catch (e: unknown) {
        logger.error("[competitor] fetchCompetitorBacklinkGap failed", { error: (e as Error)?.message });
        return { success: false as const, error: "Failed to fetch backlink gap" };
    }
}