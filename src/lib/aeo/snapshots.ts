import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { AeoResult } from "./index";
import { checkGrokVisibility } from "./check-grok";
import { checkCopilotVisibility } from "./check-copilot";

export async function saveAeoSnapshot(siteId: string, result: AeoResult) {
    const platformBreakdown = result.multiModelResults.reduce((acc, r) => {
        acc[r.model] = { mentioned: r.mentioned, confidence: r.confidence };
        return acc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, {} as Record<string, any>);

    const failedChecks = result.checks
        .filter(c => !c.passed)
        .map(c => ({ id: c.id, label: c.label, impact: c.impact }));

    const brand = (result as unknown as Record<string, string>).domain ?? siteId;
    const query = `What are the best tools for ${brand}?`;

    const [grokScore, copilotScore] = await Promise.allSettled([
        checkGrokVisibility(brand, query),
        checkCopilotVisibility(brand, query),
    ]);

    // Gap 4.4: Use upsert with the @@unique([siteId, createdAt]) constraint.
    // Inngest retries the function on transient failures — using plain .create()
    // would duplicate the snapshot row on each retry. We key on (siteId, todayStart)
    // so at most one snapshot per site per calendar day is ever inserted.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const snapshotData = {
        score: result.score,
        grade: result.grade,
        citationScore: result.citationScore,
        generativeShareOfVoice: result.generativeShareOfVoice,
        citationLikelihood: result.citationLikelihood,
        perplexityScore: result.multiEngineScore?.perplexity ?? 0,
        chatgptScore: result.multiEngineScore?.chatgpt ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        claudeScore: (result.multiEngineScore as any)?.claude ?? 0,
        googleAioScore: result.multiEngineScore?.googleAio ?? 0,
        grokScore: grokScore.status === "fulfilled" ? grokScore.value : 0,
        copilotScore: copilotScore.status === "fulfilled" ? copilotScore.value : 0,
        platformBreakdown,
        failedChecks,
    };

    const snapshot = await prisma.aeoSnapshot.upsert({
        where: { siteId_createdAt: { siteId, createdAt: todayStart } },
        create: { siteId, createdAt: todayStart, ...snapshotData },
        update: snapshotData,
    });


    try {
        // Fetch the site and user to send an email if there's a drop
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            include: { user: true }
        });

        if (site && site.user && site.user.email) {
            // Get the previous snapshot to compare
            const previousSnapshot = await prisma.aeoSnapshot.findFirst({
                where: {
                    siteId: siteId,
                    id: { not: snapshot.id }
                },
                orderBy: { createdAt: 'desc' }
            });

            if (previousSnapshot) {
                const dropAmount = previousSnapshot.score - snapshot.score;
                // Configurable threshold (default 10)
                const dropThreshold = parseInt(process.env.AEO_DROP_THRESHOLD || '10', 10);

                if (dropAmount >= dropThreshold) {
                    const { sendAeoDropAlert } = await import("@/lib/email/aeo-alert");
                    await sendAeoDropAlert(site.user.email, {
                        domain: site.domain,
                        previousScore: previousSnapshot.score,
                        currentScore: snapshot.score,
                        dropAmount: dropAmount
                    });
                }
             
            }
        }
     
    } catch (e: unknown) {
        logger.error("[AEO Audit] Error checking for score drop alert:", { error: (e as Error)?.message || String(e) });
    }

    return snapshot;
}

export async function getAeoTrend(siteId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const snapshots = await prisma.aeoSnapshot.findMany({
        where: { siteId, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
    });

    // Gap 4: grokScore and copilotScore are proper Int columns with @default(0).
    // The previous 'as any' casts are removed — Prisma types these correctly.
    return snapshots.map(s => ({
        date:       s.createdAt,
        score:      s.score,
        gsov:       s.generativeShareOfVoice,
        perplexity: s.perplexityScore,
        chatgpt:    s.chatgptScore,
        claude:     s.claudeScore,
        grok:       s.grokScore,
        copilot:    s.copilotScore,
    }));
}

/**
 * Gap 4 — getModelBreakdown
 *
 * Returns a unified per-model breakdown joining:
 *   - AeoSnapshot per-model score columns (perplexity, chatgpt, claude, grok, copilot)
 *   - AiShareOfVoice mention rates bucketed by modelName
 *
 * Used by the SOV trend chart to display per-model mention rates over time
 * without needing separate queries to two different data sources.
 *
 * Shape: { date: string; perplexity: number; chatgpt: number; claude: number;
 *           grok: number; copilot: number; gemini: number }[]
 */
export async function getModelBreakdown(siteId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // 1. AeoSnapshot columns give us the platform-level mention scores
    const snapshots = await prisma.aeoSnapshot.findMany({
        where: { siteId, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        select: {
            createdAt:      true,
            perplexityScore: true,
            chatgptScore:   true,
            claudeScore:    true,
            grokScore:      true,
            copilotScore:   true,
            platformBreakdown: true,
        },
    });

    // 2. AiShareOfVoice gives us the SOV mention rate per model on that day
    const sovRows = await prisma.aiShareOfVoice.findMany({
        where: { siteId, recordedAt: { gte: since } },
        select: { modelName: true, brandMentioned: true, recordedAt: true },
    });

    // Bucket SOV by day + model
    const sovByDay = new Map<string, Record<string, { mentioned: number; total: number }>>();
    for (const row of sovRows) {
        const day = row.recordedAt.toISOString().slice(0, 10);
        if (!sovByDay.has(day)) sovByDay.set(day, {});
        const bucket = sovByDay.get(day)!;
        const model  = (row.modelName ?? "gemini").toLowerCase();
        if (!bucket[model]) bucket[model] = { mentioned: 0, total: 0 };
        bucket[model].total++;
        if (row.brandMentioned) bucket[model].mentioned++;
    }

    // Merge: snapshot columns are authoritative for model-level scores;
    // SOV mention rate fills gaps where snapshot scores are missing.
    return snapshots.map(s => {
        const day    = s.createdAt.toISOString().slice(0, 10);
        const sov    = sovByDay.get(day) ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pb     = (s.platformBreakdown ?? {}) as Record<string, any>;

        const mentionRate = (model: string): number => {
            const b = sov[model];
            return b && b.total > 0 ? Math.round((b.mentioned / b.total) * 100) : 0;
        };

        return {
            date:       day,
            perplexity: s.perplexityScore  || mentionRate("perplexity"),
            chatgpt:    s.chatgptScore     || mentionRate("chatgpt"),
            claude:     s.claudeScore      || mentionRate("claude"),
            grok:       s.grokScore        || mentionRate("grok"),
            copilot:    s.copilotScore     || mentionRate("copilot"),
            // Gemini lives in platformBreakdown — not a dedicated AeoSnapshot column
            gemini:     pb["Gemini"]?.confidence ?? mentionRate("gemini"),
        };
    });
}
