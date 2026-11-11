export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { inngest } from "@/lib/inngest/client";
import { randomUUID } from "node:crypto";

export async function GET(request: Request) {
    if (!isCronAuthorized(request)) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { prisma } = await import("@/lib/prisma");
    const { consumeCreditsIdempotent } = await import("@/lib/credits");
    const { blogGenerationEventId } = await import("@/lib/blog/generation-recovery");

    const sites = await prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        select: {
            id: true,
            domain: true,
            userId: true,
            coreServices: true,
        },
    });

    let queued = 0;
    let skipped = 0;

    for (const site of sites) {
        const usedKeywords = await prisma.blog.findMany({
            where: { siteId: site.id },
            select: { targetKeywords: true },
        });
        const usedSet = new Set(
            usedKeywords.flatMap(b => b.targetKeywords.map(k => k.toLowerCase()))
        );

        let keyword: string | undefined;
        let pipelineType = "TRENDING";
        let competitorDomain: string | undefined;
        let searchVolume = 0;
        let difficulty = 0;

        const compKeywords = await prisma.competitorKeyword.findMany({
            where: { competitor: { siteId: site.id } },
            orderBy: { searchVolume: "desc" },
            take: 20,
            select: {
                keyword: true,
                searchVolume: true,
                difficulty: true,
                competitor: { select: { domain: true } },
            },
        });

        const unusedComp = compKeywords.find(
            ck => ck.competitor && !usedSet.has(ck.keyword.toLowerCase())
        );

        if (unusedComp?.competitor) {
            keyword = unusedComp.keyword;
            pipelineType = "COMPETITOR_GAP";
            competitorDomain = unusedComp.competitor.domain;
            searchVolume = unusedComp.searchVolume ?? 0;
            difficulty = unusedComp.difficulty ?? 0;
        } else {
            const primaryService = (site.coreServices as string | null)?.split(",")[0]?.trim();
            if (!primaryService) {
                logger.warn(`[Cron/Blog] Site ${site.domain} has no coreServices and no unused competitor keywords — skipping`);
                skipped++;
                continue;
            }
            if (usedSet.has(primaryService.toLowerCase())) {
                logger.info(`[Cron/Blog] Site ${site.domain} already has blog for "${primaryService}" — skipping`);
                skipped++;
                continue;
            }
            keyword = primaryService;
        }

        const attemptId = randomUUID();
        const creditRef = `blog-generation:cron:${site.id}:${attemptId}`;
        const creditResult = await consumeCreditsIdempotent(site.userId, "blog_generation", creditRef);
        if (!creditResult.allowed) {
            logger.info(`[Cron/Blog] Site ${site.domain} — insufficient credits (${creditResult.remaining}), skipping`);
            skipped++;
            continue;
        }

        const blog = await prisma.blog.create({
            data: {
                siteId: site.id,
                pipelineType,
                title: `Generating: ${keyword}`,
                slug: `generating-${attemptId}`,
                targetKeywords: keyword ? [keyword] : [],
                content: "",
                metaDescription: "",
                status: "GENERATING",
                generationAttemptId: attemptId,
            },
        });

        const eventData = {
            siteId: site.id,
            blogId: blog.id,
            userId: site.userId,
            pipelineType,
            keyword,
            ...(competitorDomain ? { competitorDomain, searchVolume, difficulty } : {}),
        };

        await prisma.blog.update({
            where: { id: blog.id },
            data: { generationInput: eventData as any },
        });

        try {
            await inngest.send({
                id: blogGenerationEventId(blog.id, attemptId),
                name: "blog.generate",
                data: { ...eventData, attemptId },
            });
            queued++;
        } catch (err) {
            logger.warn("[Cron/Blog] Inngest dispatch pending recovery", {
                blogId: blog.id,
                error: (err as Error)?.message,
            });
            queued++;
        }
    }

    logger.debug(`[Cron/Blog] Queued ${queued}, skipped ${skipped} for ${sites.length} sites`);
    return NextResponse.json({ success: true, queued, skipped, sites: sites.length });
}
