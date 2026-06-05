"use server";

import { prisma } from "@/lib/prisma";
import { requireUser, assertSiteOwnership } from "@/lib/auth/require-user";
import { callGeminiJson } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import type { Campaign } from "@prisma/client";

export type CampaignKeyword = {
    keyword: string;
    position: number;
    url: string | null;
    searchVolume: number | null;
    fixPlan?: {
        priority: "high" | "medium" | "low";
        quickWin: string;
        tasks: string[];
        estimatedLift: string;
    };
};

export type CampaignRow = {
    id: string;
    siteId: string;
    userId: string;
    type: string | null;
    name: string;
    keyword: string;
    clientUrl: string;
    initialPosition: number;
    targetPosition: number;
    status: string;
    keywordCount: number | null;
    urlCount: number | null;
    keywords: CampaignKeyword[] | null;
    createdAt: string;
    completedAt: string | null;
};

export async function getCampaigns(siteId: string): Promise<{
    success: boolean;
    campaigns: CampaignRow[];
    error?: string;
}> {
    const auth = await requireUser();
    if (!auth.ok) return { success: false, campaigns: [], error: auth.error.error };

    const site = await assertSiteOwnership(siteId, auth.user.id);
    if (!site) return { success: false, campaigns: [], error: "Site not found" };

    const rows = await prisma.campaign.findMany({
        where: { siteId },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    const campaigns: CampaignRow[] = rows.map((c: Campaign) => ({
        id: c.id,
        siteId: c.siteId,
        userId: c.userId,
        type: c.type,
        name: c.name,
        keyword: c.keyword,
        clientUrl: c.clientUrl,
        initialPosition: c.initialPosition,
        targetPosition: c.targetPosition,
        status: c.status,
        keywordCount: c.keywordCount,
        urlCount: c.urlCount,
        keywords: (c.keywords as CampaignKeyword[] | null) ?? null,
        createdAt: c.createdAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
    }));

    return { success: true, campaigns };
}

export async function generateCampaignFixPlan(campaignId: string): Promise<{
    success: boolean;
    keywords?: CampaignKeyword[];
    error?: string;
}> {
    const auth = await requireUser();
    if (!auth.ok) return { success: false, error: auth.error.error };

    const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, userId: auth.user.id },
        include: { site: { select: { domain: true } } },
    });

    if (!campaign) return { success: false, error: "Campaign not found" };

    const keywords = (campaign.keywords as CampaignKeyword[] | null) ?? [];
    if (keywords.length === 0) return { success: false, error: "No keywords in campaign" };

    const domain = campaign.site.domain;
    const topKeywords = keywords.slice(0, 12);

    const prompt = `You are a senior SEO strategist. These keywords for ${domain} are ranked on page 2 (positions 11-25) and need targeted fixes to break onto page 1.

Keywords:
${topKeywords
            .map(
                (k) =>
                    `- "${k.keyword}" at position ${k.position}${k.url ? ` on ${k.url}` : ""}${k.searchVolume ? ` — ${k.searchVolume} monthly searches` : ""}`
            )
            .join("\n")}

For each keyword return a JSON array where every object has:
- keyword: exact string matching the input
- priority: "high" if searchVolume > 500 or position 11-14, "medium" if 15-19, "low" otherwise
- quickWin: one sentence — the single highest-impact action specific to this keyword and ${domain}
- tasks: exactly 3 specific tasks referencing ${domain} context, not generic SEO advice
- estimatedLift: realistic range like "3-5 positions in 6-8 weeks"

Return ONLY a valid JSON array. No preamble or markdown.`;

    try {
        type PlanItem = {
            keyword: string;
            priority: "high" | "medium" | "low";
            quickWin: string;
            tasks: string[];
            estimatedLift: string;
        };

        const plans = await callGeminiJson<PlanItem[]>(prompt, {
            model: "gemini-2.5-flash",
            temperature: 0.3,
            maxOutputTokens: 4000,
        });

        const updatedKeywords: CampaignKeyword[] = keywords.map((kw) => {
            const plan = plans.find((p) => p.keyword === kw.keyword);
            if (!plan) return kw;
            return {
                ...kw,
                fixPlan: {
                    priority: plan.priority,
                    quickWin: plan.quickWin,
                    tasks: plan.tasks,
                    estimatedLift: plan.estimatedLift,
                },
            };
        });

        await prisma.campaign.update({
            where: { id: campaignId },
            data: {
                keywords: updatedKeywords,
                status: "ACTIVE",
            },
        });

        return { success: true, keywords: updatedKeywords };
    } catch (err) {
        logger.error("[generateCampaignFixPlan] Failed", {
            campaignId,
            error: (err as Error).message,
        });
        return { success: false, error: "Failed to generate fix plan" };
    }
}

export async function updateCampaignStatus(
    campaignId: string,
    status: "ACTIVE" | "COMPLETED"
): Promise<{ success: boolean }> {
    const auth = await requireUser();
    if (!auth.ok) return { success: false };

    await prisma.campaign.update({
        where: { id: campaignId, userId: auth.user.id },
        data: {
            status,
            ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
        },
    });

    return { success: true };
}