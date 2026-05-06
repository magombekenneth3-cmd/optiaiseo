import { logger } from "@/lib/logger";
import { AuditModule, AuditModuleContext, FullAuditReport, NormalizedRecommendation, ModulePerfEntry, AeoScoreBreakdown } from './types';
import { fetchHtml } from './utils/fetch-html';

export const SCORING_WEIGHTS = {
    ROI_IMPACT: 0.6,
    AI_VISIBILITY: 0.4
};

// AEO check weights (must sum to 1.0)
const AEO_WEIGHTS: Record<string, number> = {
    'aeo-llm-citation-probe':      0.30,
    'llms-txt':                    0.20,
    'schema-completeness':         0.20,
    'aeo-citation-readiness':      0.15,
    'aeo-answer-box-structure':    0.10,
    'aeo-conversational-headings': 0.05,
};

export class AuditEngine {
    private modules: AuditModule[] = [];

    constructor(modules?: AuditModule[]) {
        if (modules) {
            this.modules = modules;
        }
    }

    registerModule(module: AuditModule) {
        this.modules.push(module);
    }

    async runAudit(url: string, opts?: { targetKeyword?: string }): Promise<FullAuditReport> {
        // ─────────────────────────────────────────────────────────────
        // WARM-UP: Fetch HTML once (with retry) BEFORE running modules.
        //
        // All 8 modules run in parallel below via Promise.all. Without
        // pre-fetching, each module independently hits the 503 cold-start
        // and retries on its own → 8 × 4 retries = 32 network calls over
        // 2+ minutes. By pre-fetching here and caching in context.html,
        // only ONE fetch with retries ever runs.
        //
        // FIX: skip the fetch entirely when all registered modules declare
        // requiresHtml: false (e.g. schema-only or API-only audit subsets).
        // ─────────────────────────────────────────────────────────────
        const needsHtml = this.modules.some((m) => m.requiresHtml !== false);
        let html = "";

        if (needsHtml) {
            logger.debug(`[Audit Engine] Pre-fetching HTML for ${url}…`);
            html = await fetchHtml(url);

            if (!html) {
                logger.error(`[Audit Engine] Could not fetch HTML for ${url} after all retries. Failing audit.`);
                throw new Error(`Failed to reach the site at ${url}. It may be down, blocking requests, or encountering a 503 error.`);
            }
            logger.debug(`[Audit Engine] HTML pre-fetched (${html.length} chars). Starting ${this.modules.length} parallel modules…`);
        } else {
            logger.debug(`[Audit Engine] All modules are HTML-free — skipping pre-fetch. Starting ${this.modules.length} parallel modules…`);
        }

        // Phase 1.2: immutable context — modules cannot mutate url/html,
        // and append to frameworkHints[] instead of overwriting a single string.
        const context: AuditModuleContext = {
            url,
            html: html ?? "",
            frameworkHints: [],
            targetKeyword: opts?.targetKeyword ?? undefined,
        };


        // Run all modules in parallel, with a 90s hard timeout to prevent infinite hangs
        const MODULE_TIMEOUT_MS = 90_000;
        const timeoutGuard = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Audit timed out after ${MODULE_TIMEOUT_MS / 1000}s — the site may be slow or blocking crawlers.`)), MODULE_TIMEOUT_MS)
        );

        const categoryResults = await Promise.race([
            Promise.all(
                this.modules.map(async (module) => {
                    const t0 = performance.now();
                    try {
                        const result = await module.run(context);
                        const durationMs = Math.round(performance.now() - t0);
                        logger.debug(`[ModulePerf] ${module.id} ${durationMs}ms score=${result.score}`);
                        return { ...result, _durationMs: durationMs };
                    } catch (err) {
                        const durationMs = Math.round(performance.now() - t0);
                        logger.error(`Error running module ${module.id} for URL ${url}:`, { error: (err as Error)?.message || err });
                        return {
                            id: module.id,
                            label: module.label,
                            items: [],
                            score: 0,
                            passed: 0,
                            failed: 0,
                            warnings: 0,
                            crashed: true,
                            _durationMs: durationMs,
                        };
                    }
                })
            ),
            timeoutGuard,
        ]);

        const allRecommendations: NormalizedRecommendation[] = [];

        categoryResults.forEach((category) => {
            category.items.forEach((item) => {
                if ((item.status === 'Fail' || item.status === 'Warning') && item.recommendation) {
                    const roiImpact = item.roiImpact ?? 50;
                    const aiVisibilityImpact = item.aiVisibilityImpact ?? 50;
                    allRecommendations.push({
                        categoryId: category.id,
                        itemId: item.id,
                        finding: item.finding,
                        recommendation: item.recommendation.text,
                        priority: item.recommendation.priority,
                        roiImpact,
                        aiVisibilityImpact,
                        // Weighted business impact: ROI 60% + AI Visibility 40%
                        priorityScore: Math.round(roiImpact * SCORING_WEIGHTS.ROI_IMPACT + aiVisibilityImpact * SCORING_WEIGHTS.AI_VISIBILITY),
                    });
                }
            });
        });

        // Gap 2.3: exclude only modules that crashed (network error, timeout, etc.)
        // A module that ran successfully and found no issues returns score=0, passed=0,
        // failed=0, warnings=0 AND crashed=undefined — include it in the average.
        // A crashed module returns score=0 with crashed=true — exclude it.
        const scoredCategories = categoryResults.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (c) => !(c as any).crashed
        );
        const overallScore = scoredCategories.length > 0
            ? Math.round(scoredCategories.reduce((sum, c) => sum + c.score, 0) / scoredCategories.length)
            : 100; // all modules ran cleanly and found zero issues → perfect score


        // God Level Impact Sorting: Weighted blend of ROI and AI Visibility
        // ROI is weighted 60%, AI Visibility 40%. Use priorityScore for deterministic sort.
        allRecommendations.sort((a, b) => {
            if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;

            // Fallback to priority label if scores are equal
            const priorityWeight: Record<string, number> = { 'High': 3, 'Medium': 2, 'Low': 1 };
            return priorityWeight[b.priority] - priorityWeight[a.priority];
        });

        // Phase 3.1: build telemetry from _durationMs tags attached above
        const moduleTelemetry: ModulePerfEntry[] = categoryResults.map(c => ({
            moduleId:   c.id,
            durationMs: (c as { _durationMs?: number })._durationMs ?? 0,
            score:      c.score,
            itemCount:  c.items.length,
            crashed:    !!(c as { crashed?: boolean }).crashed,
        }));

        // Phase 2.2: compute aeoScore from ai-visibility module checks
        const aioCategory = categoryResults.find(c => c.id === 'ai-visibility');
        let aeoScore: number | undefined;
        let aeoBreakdown: AeoScoreBreakdown | undefined;
        if (aioCategory) {
            const breakdown: AeoScoreBreakdown = {
                llmProbe:               0,
                llmsTxtQuality:         0,
                schemaCompleteness:     0,
                citationReadiness:      0,
                answerBoxStructure:     0,
                conversationalHeadings: 0,
            };
            let weighted = 0;
            let totalWeight = 0;
            for (const item of aioCategory.items) {
                const itemScore = item.status === 'Pass' ? 100 : item.status === 'Warning' ? 50 : 0;
                const weight = AEO_WEIGHTS[item.id] ?? 0;
                if (weight > 0) {
                    weighted += itemScore * weight;
                    totalWeight += weight;
                    const key = item.id === 'aeo-llm-citation-probe'      ? 'llmProbe'
                              : item.id === 'llms-txt'                    ? 'llmsTxtQuality'
                              : item.id === 'schema-completeness'         ? 'schemaCompleteness'
                              : item.id === 'aeo-citation-readiness'      ? 'citationReadiness'
                              : item.id === 'aeo-answer-box-structure'    ? 'answerBoxStructure'
                              : item.id === 'aeo-conversational-headings' ? 'conversationalHeadings'
                              : null;
                    if (key) (breakdown as unknown as Record<string, number>)[key] = itemScore;
                }
            }
            aeoScore = totalWeight > 0 ? Math.round(weighted / totalWeight) : undefined;
            aeoBreakdown = breakdown;
        }

        return {
            url,
            timestamp: new Date().toISOString(),
            overallScore,
            aeoScore,
            aeoBreakdown,
            categories: categoryResults,
            recommendations: allRecommendations,
            moduleTelemetry,
        };
    }
}
