import { inngest } from "../client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { bustLeaderboardCache } from "@/lib/leaderboard";

// ── Percentile helper ─────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
}

type NicheKey = "saas" | "ecommerce" | "local" | "agency" | "blog" | "other";
type TechStack = "nextjs" | "wordpress" | "shopify" | "other";

// ── Win 8: Weekly benchmark recomputation ─────────────────────────────────────
export const computeBenchmarksJob = inngest.createFunction(
    {
        id: "compute-benchmarks",
        name: "Weekly Benchmark Stat Recomputation",
        retries: 1,
        concurrency: { limit: 1 }, // cron — only one run at a time
    
        triggers: [{ cron: "0 3 * * 2" }],
    },
    // Every Tuesday at 03:00 UTC (was Monday — spread load)
    async ({ step }) => {
        const niches: NicheKey[] = ["saas", "ecommerce", "local", "agency", "blog", "other"];
        const stacks: TechStack[] = ["nextjs", "wordpress", "shopify", "other"];
        const metrics = ["overallScore", "aeoScore", "lcp", "cls", "inp"] as const;

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        let upserted = 0;

        for (const niche of niches) {
            for (const stack of stacks) {
                await step.run(`bench-${niche}-${stack}`, async () => {
                    // Fetch sites matching this niche + techStack combination
                    const sites = await prisma.site.findMany({
                        where: { niche, techStack: stack },
                        select: { id: true },
                    });
                    if (sites.length === 0) return;

                    const siteIds = sites.map(s => s.id);

                    // Fetch recent audit data
                    const audits = await prisma.audit.findMany({
                        where: { siteId: { in: siteIds }, runTimestamp: { gte: ninetyDaysAgo } },
                        select: { categoryScores: true, lcp: true, cls: true, inp: true },
                    });
                    if (audits.length < 30) return;

                    type CategoryScores = Record<string, number>;
                    const overallScores = audits.map(a => {
                        const cats = a.categoryScores as CategoryScores;
                        const vals = Object.entries(cats)
                            .filter(([key]) => key !== "seo")
                            .map(([, v]) => v)
                            .filter((v): v is number => typeof v === "number");
                        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
                    }).sort((a, b) => a - b);

                    // AEO scores — from AeoSnapshot
                    const aeoSnapshots = await prisma.aeoSnapshot.findMany({
                        where: { siteId: { in: siteIds }, createdAt: { gte: ninetyDaysAgo } },
                        select: { score: true },
                    });
                    const aeoScores = aeoSnapshots.map(s => s.score).sort((a, b) => a - b);

                    const lcpVals = audits.flatMap(a => a.lcp != null ? [a.lcp] : []).sort((a, b) => a - b);
                    const clsVals = audits.flatMap(a => a.cls != null ? [a.cls] : []).sort((a, b) => a - b);
                    const inpVals = audits.flatMap(a => a.inp != null ? [a.inp] : []).sort((a, b) => a - b);

                    const metricData: Record<typeof metrics[number], number[]> = {
                        overallScore: overallScores,
                        aeoScore: aeoScores,
                        lcp: lcpVals,
                        cls: clsVals,
                        inp: inpVals,
                    };

                    for (const metric of metrics) {
                        const vals = metricData[metric];
                        if (vals.length < 10) continue;

                        await prisma.benchmarkStat.upsert({
                            where: { niche_techStack_metric: { niche, techStack: stack, metric } },
                            create: {
                                niche, techStack: stack, metric,
                                p25: percentile(vals, 25),
                                p50: percentile(vals, 50),
                                p75: percentile(vals, 75),
                                p90: percentile(vals, 90),
                                sampleSize: vals.length,
                            },
                            update: {
                                p25: percentile(vals, 25),
                                p50: percentile(vals, 50),
                                p75: percentile(vals, 75),
                                p90: percentile(vals, 90),
                                sampleSize: vals.length,
                            },
                        });
                        upserted++;
                    }
                });
            }
        }

        logger.info(`[Benchmarks] Recomputed ${upserted} benchmark stats`);

        await step.run("bust-leaderboard-cache", async () => {
            await bustLeaderboardCache();
        });

        return { upserted };
    }
);

// ── Benchmark lookup helper (used by audit UI) ─────────────────────────────────
export async function getBenchmarkLabel(
    score: number,
    metric: string,
    niche: string,
    techStack: string
): Promise<{ label: string; percentile: number; sampleSize: number } | null> {
    try {
        const stat = await prisma.benchmarkStat.findUnique({
            where: { niche_techStack_metric: { niche, techStack, metric } },
        });
        if (!stat || stat.sampleSize < 10) return null;

        let label: string;
        let pct: number;

        if (score >= stat.p90) { label = "top 10%"; pct = 90; }
        else if (score >= stat.p75) { label = "top 25%"; pct = 75; }
        else if (score >= stat.p50) { label = "above average"; pct = 50; }
        else if (score >= stat.p25) { label = "below average"; pct = 25; }
        else { label = "bottom 25% — priority improvements needed"; pct = 0; }

        return { label, percentile: pct, sampleSize: stat.sampleSize };
    } catch {
        return null;
    }
}