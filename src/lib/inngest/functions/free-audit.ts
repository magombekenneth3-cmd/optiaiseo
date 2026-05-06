/**
 * Inngest function: free-audit/run
 *
 * Runs a lightweight 3-module audit (OnPage + Technical + ContentQuality —
 * no AEO, no competitors) via the shared getAuditEngine('free') factory.
 * Updates progress in DB so the SSE route can stream it to the client.
 */

import { inngest } from '../client';
import { NonRetriableError } from 'inngest';
import { CONCURRENCY } from '../concurrency';
import prisma from '@/lib/prisma';
import { getAuditEngine } from '@/lib/seo-audit';
import type { NormalizedRecommendation } from '@/lib/seo-audit/types';


async function updateProgress(auditId: string, progress: number, step: string) {
    await prisma.freeAudit
        .update({ where: { id: auditId }, data: { progress, currentStep: step, status: 'RUNNING' } })
        .catch(() => { /* non-fatal — SSE can still work from last known state */ });
}

export const runFreeAuditJob = inngest.createFunction(
    {
        id: 'run-free-audit',
        name: 'Run Free SEO Audit',
        concurrency: { limit: CONCURRENCY.auditFree, key: 'global-free-audit' },
        throttle: { limit: 30, period: '1m', key: 'global-free-audit-throttle' },
    
        triggers: [{ event: 'free-audit/run' }],
    },
    async ({ event, step }) => {
        const { auditId, url, domain } = event.data as {
            auditId: string;
            url: string;
            domain: string;
        };

        if (!auditId || !url) throw new NonRetriableError('Missing auditId or url');

        // ── Phase 1.3: shared engine factory ─────────────────────────────────
        // getAuditEngine('free') runs the same 3 modules (OnPage + Technical +
        // ContentQuality) that were previously wired by hand, but via the single
        // PROFILE_MODULES registry — no more duplicate module configuration.
        const report = await step.run('run-audit-engine', async () => {
            await updateProgress(auditId, 10, 'Fetching page...');
            const engine = getAuditEngine('free');

            await updateProgress(auditId, 40, 'Analysing page...');
            const result = await engine.runAudit(url);

            await updateProgress(auditId, 95, 'Calculating score...');
            return result;
        });

        // ── Persist results ───────────────────────────────────────────────────
        await step.run('save-results', async () => {
            const categoryScores = Object.fromEntries(
                report.categories.map(c => [c.id, c.score])
            );
            const topRecs: NormalizedRecommendation[] = report.recommendations.slice(0, 5);

            await prisma.freeAudit.update({
                where: { id: auditId },
                data: {
                    status:        'DONE',
                    progress:      100,
                    currentStep:   'Complete',
                    overallScore:  report.overallScore,
                    categoryScores,
                    topRecs:  topRecs  as object[],
                    allRecs:  report.recommendations as object[],
                },
            });
        });

        return { auditId, domain };
    }
);


