/**
 * 3.3: Multi-agent parallel strategy orchestration.
 * Triggered by strategy/requested event. Runs SEO audit, AEO audit,
 * competitor analysis, and keyword research simultaneously via Promise.all,
 * then synthesises a unified strategy document with Gemini Pro.
 */
import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { NonRetriableError } from "inngest";

export const runFullStrategyJob = inngest.createFunction(
    {
        id: "run-full-strategy",
        name: "Full Strategy Parallel Orchestration",
        concurrency: { limit: 5, key: "global-strategy" },
    
        triggers: [{ event: "strategy/requested" }],
    },
    async ({ event, step }) => {
        const { siteId, userId, domain } = event.data as {
            siteId: string;
            userId: string;
            domain: string;
        };

        if (!siteId || !domain) throw new NonRetriableError("Missing siteId or domain");

        logger.info(`[FullStrategy] Starting parallel orchestration for ${domain}`);

        // ── Phase 1: Run all four audits sequentially (Inngest requires sequential step.run calls
        //           for deterministic replay — Promise.all([step.run()]) is unsupported) ─────
        const seoResult = await step.run("run-seo-audit", async () => {
            const { getFullAuditEngine } = await import("@/lib/seo-audit");
            const engine = getFullAuditEngine();
            const result = await engine.runAudit(`https://${domain}`);
            return {
                overallScore: result.overallScore,
                topIssues: result.categories
                    .flatMap((c: { items?: { label: string; status: string; recommendation?: { text: string } }[] }) =>
                        (c.items ?? []).filter((i) => i.status === "Fail")
                    )
                    .slice(0, 5)
                    .map((i: { label: string; recommendation?: { text: string } }) => ({
                        label: i.label,
                        recommendation: i.recommendation?.text ?? "",
                    })),
            };
        });

        const aeoResult = await step.run("run-aeo-audit", async (): Promise<{
            score: number;
            grade: string;
            generativeShareOfVoice: number;
            topGaps: { label: string; impact: string }[];
        }> => {
            const { runAeoAudit } = await import("@/lib/aeo");
            const result = await runAeoAudit(`https://${domain}`);
            return {
                score: result.score,
                grade: result.grade,
                generativeShareOfVoice: result.generativeShareOfVoice,
                topGaps: result.checks
                    .filter((c) => !c.passed)
                    .slice(0, 5)
                    .map((c) => ({ label: c.label, impact: c.impact })),
            };
        });

        const competitorResult = await step.run("run-competitor-analysis", async () => {
            const competitors = await prisma.competitor.findMany({
                where: { siteId },
                take: 3,
                select: { domain: true },
            });
            return {
                competitorCount: competitors.length,
                domains: competitors.map((c) => c.domain),
            };
        });

        const keywordResult = await step.run("run-keyword-research", async () => {
            const snapshots = await prisma.rankSnapshot.findMany({
                where: { siteId },
                orderBy: { recordedAt: "desc" },
                take: 50,
                select: { keyword: true, position: true },
            });
            const page2 = snapshots.filter((s) => s.position >= 11 && s.position <= 20);
            return {
                totalKeywords: snapshots.length,
                page2Opportunities: page2.map((s) => ({ keyword: s.keyword, position: s.position })),
            };
        });


        const memories = await step.run("load-strategy-memories", async () => {
            const { loadMemories, formatMemoriesForPrompt } = await import("@/lib/strategy-memory");
            const mems = await loadMemories(userId, siteId, 15);
            return formatMemoriesForPrompt(mems);
        });

        const groundedContext = await step.run("build-grounded-context", async () => {
            const { getGroundedContextBlock } = await import("@/lib/prompt-context/build-site-context");
            return getGroundedContextBlock(siteId);
        });

        const strategy = await step.run("synthesise-strategy", async () => {
            const { callGemini } = await import("@/lib/gemini");

            const memorySection = memories
                ? `\n## PREVIOUS RECOMMENDATIONS (don't repeat these — build on them)\n${memories}\n`
                : "";

            const prompt = `You are an elite SEO strategist. Based on the following site context and audit data, produce a highly specific unified strategy document.

${groundedContext}
${memorySection}
SEO Audit:
- Overall score: ${seoResult.overallScore}/100
- Top issues: ${seoResult.topIssues.map((i: { label: string; recommendation: string }) => `${i.label}: ${i.recommendation}`).join("; ")}

AEO Audit:
- Score: ${aeoResult.score}/100 (Grade: ${aeoResult.grade})
- Generative Share of Voice: ${aeoResult.generativeShareOfVoice}%
- Top AEO gaps: ${aeoResult.topGaps.map((g: { label: string; impact: string }) => `${g.label} (${g.impact})`).join(", ")}

Keyword Data:
- Total tracked keywords: ${keywordResult.totalKeywords}
- Page 2 opportunities (quick wins): ${keywordResult.page2Opportunities.slice(0, 5).map((k: { keyword: string; position: number }) => `${k.keyword} (pos ${k.position})`).join(", ")}

Competitors tracked: ${competitorResult.domains.join(", ")}

Write a 3-section strategy document:
1. PRIORITY ACTIONS (top 3 fixes with expected impact for THIS specific site in its market)
2. 30-DAY ROADMAP (week-by-week plan, specific to the site's current scores)
3. AEO OPPORTUNITY (specific AI search wins — which keywords to target for citation)

Rules:
- Be specific to this site's domain, location, and services — no generic advice
- If previous recommendations exist above, reference what happened and what to do next
- Keep it concise, actionable. No preamble, no filler.`;

            const text = await callGemini(prompt, { maxOutputTokens: 4000, temperature: 0.4 });
            return text ?? "Strategy generation failed.";
        });

        await step.run("save-strategy", async () => {
            await prisma.site.update({
                where: { id: siteId },
                data: {
                    plannerState: {
                        lastStrategy: strategy,
                        generatedAt: new Date().toISOString(),
                        seoScore: seoResult.overallScore as number,
                        aeoScore: aeoResult.score as number,
                    },
                },
            });
        });

        await step.run("save-strategy-memory", async () => {
            const { saveMemory } = await import("@/lib/strategy-memory");
            // Extract top action from first line of strategy
            const topAction = strategy.split("\n").find((l: string) => l.trim().length > 20) ?? strategy.substring(0, 120);
            await saveMemory(userId, siteId, {
                memoryType: "session_summary",
                content: `Strategy generated for ${domain}. SEO score: ${seoResult.overallScore}/100, AEO score: ${aeoResult.score}/100. Top action: ${topAction.trim().substring(0, 200)}`,
                metadata: {
                    seoScore: seoResult.overallScore,
                    aeoScore: aeoResult.score,
                    generatedAt: new Date().toISOString(),
                },
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
            });
        });

        logger.info(`[FullStrategy] Complete for ${domain} — SEO: ${seoResult.overallScore}, AEO: ${aeoResult.score}`);
        return { strategy, seoScore: seoResult.overallScore, aeoScore: aeoResult.score };
    }
);
