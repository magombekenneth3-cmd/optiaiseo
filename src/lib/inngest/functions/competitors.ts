/**
 * src/lib/inngest/functions/competitors.ts
 *
 * Async competitor page analysis — runs the heavy Gemini call in the
 * background so the HTTP request can return a 202 immediately.
 *
 * Event: "competitor/analyse-page"
 * Data:  { analysisId: string, url: string, keyword: string, domain: string }
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { analyseCompetitorPage } from "@/lib/competitors";
import { CONCURRENCY } from "../concurrency";

export const analyseCompetitorPageJob = inngest.createFunction(
    {
        id: "analyse-competitor-page",
        name: "Analyse Competitor Page",
        concurrency: [
            // Global cap across all concurrent competitor analyses
            { scope: "fn", limit: CONCURRENCY.competitors },
            // Per-user fairness: at most 1 analysis per user at a time
            { scope: "fn", limit: 1, key: "event.data.userId" },
        ],
        retries: 2,
    
        triggers: [{ event: "competitor/analyse-page" as const }],
    },
    async ({ event, step }) => {
        const { analysisId, url, keyword, domain } = event.data as {
            analysisId: string;
            url: string;
            keyword: string;
            domain: string;
        };

        const analysis = await step.run("analyse-page", () =>
            analyseCompetitorPage(url, keyword, domain)
        );

        await step.run("save-result", async () => {
            if (!analysis) {
                await prisma.competitorPageAnalysis.update({
                    where: { id: analysisId },
                    data: {
                        status: "failed",
                        error: "Could not fetch or analyse competitor page",
                    },
                });
                return;
            }
            await prisma.competitorPageAnalysis.update({
                where: { id: analysisId },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: { status: "done", result: analysis as any },
            });
        });

        return { analysisId, status: analysis ? "done" : "failed" };
    }
);
