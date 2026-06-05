import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { NonRetriableError } from "inngest";
import { callGeminiJson } from "@/lib/gemini";

type UrlGroup = {
    url: string;
    keywords: string[];
    avgPosition: number;
    totalSearchVolume: number;
};

type InputKeyword = {
    keyword: string;
    position: number;
    url: string | null;
    searchVolume: number | null;
};

type KeywordWithPlan = InputKeyword & {
    fixPlan?: {
        priority: "high" | "medium" | "low";
        quickWin: string;
        tasks: string[];
        estimatedLift: string;
    };
};

type FixPlanItem = {
    keyword: string;
    priority: "high" | "medium" | "low";
    quickWin: string;
    tasks: string[];
    estimatedLift: string;
};

export const processCampaignPage2Push = inngest.createFunction(
    {
        id: "campaign-page-2-push",
        name: "Campaign: Page 2 Push Plan Generator",
        retries: 2,
        concurrency: { limit: 3, key: "event.data.userId" },
        triggers: [{ event: "campaign/page-2-push/requested" }],
    },
    async ({ event, step }: { event: { data: Record<string, unknown> }; step: any }) => {
        const { campaignId, siteId, userId, domain, topUrls } = event.data as {
            campaignId: string;
            siteId: string;
            userId: string;
            domain: string;
            topUrls: UrlGroup[];
        };

        if (!campaignId || !domain) {
            throw new NonRetriableError("Missing campaignId or domain");
        }

        const campaign = await step.run("fetch-campaign", async () => {
            return prisma.campaign.findUnique({
                where: { id: campaignId },
                select: { id: true, keywords: true, keyword: true, keywordCount: true },
            });
        });

        if (!campaign) {
            throw new NonRetriableError(`Campaign ${campaignId} not found`);
        }

        const updatedKeywords = await step.run("generate-fix-plans", async (): Promise<KeywordWithPlan[] | null> => {
            const keywords = campaign.keywords as InputKeyword[] | null;
            if (!keywords || keywords.length === 0) return null;

            const topKeywords = keywords.slice(0, 12);
            const topUrlSummary = topUrls
                .slice(0, 3)
                .map((g) => `${g.url}: covers ${g.keywords.join(", ")} (avg pos: ${g.avgPosition})`)
                .join("\n");

            const prompt = `You are a senior SEO strategist. These keywords for ${domain} are stuck on page 2 (positions 11-25). Generate a specific, actionable fix plan for each to break onto page 1.

Keywords:
${topKeywords.map((k) => `- "${k.keyword}" at position ${k.position}${k.url ? ` on ${k.url}` : ""}${k.searchVolume ? ` (${k.searchVolume} searches/month)` : ""}`).join("\n")}

Top landing pages needing improvement:
${topUrlSummary}

Return a JSON array. Each item must have:
- keyword: exact string from the input list
- priority: "high" if searchVolume > 500 or position 11-14, "medium" if 15-19, "low" otherwise
- quickWin: single sentence — the one action with the highest impact for this exact keyword
- tasks: array of exactly 3 specific tasks (reference ${domain} context, not generic advice)
- estimatedLift: realistic range like "3-5 positions in 6-8 weeks"

Return ONLY valid JSON. No preamble or markdown fences.`;

            try {
                const plans = await callGeminiJson<FixPlanItem[]>(prompt, {
                    model: "gemini-2.5-flash",
                    temperature: 0.3,
                    maxOutputTokens: 4000,
                });

                return keywords.map((kw): KeywordWithPlan => {
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
            } catch (err) {
                logger.error("[Campaign/Page2Push] Fix plan generation failed", {
                    campaignId,
                    error: (err as Error).message,
                });
                return null;
            }
        });

        await step.run("update-campaign-status", async () => {
            await prisma.campaign.update({
                where: { id: campaignId },
                data: {
                    status: updatedKeywords ? "ACTIVE" : "PENDING",
                    ...(updatedKeywords ? { keywords: updatedKeywords } : {}),
                },
            });
        });

        logger.info("[Campaign/Page2Push] Completed", {
            campaignId,
            domain,
            keywordsPlanned: updatedKeywords ? updatedKeywords.filter((k: KeywordWithPlan) => k.fixPlan).length : 0,
        });

        return {
            campaignId,
            keywordsPlanned: updatedKeywords ? updatedKeywords.filter((k: KeywordWithPlan) => k.fixPlan).length : 0,
        };
    }
);