import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { CONCURRENCY } from "../concurrency";
import { getFullAuditEngine } from "@/lib/seo-audit";
import { diffAuditSnapshots } from "@/lib/seo-audit/audit-diff";
import { sendSEODigest } from "@/lib/email";
import { fetchGSCKeywords, findOpportunities, normaliseSiteUrl } from "@/lib/gsc";
import { detectGsovDrop, generateHealingPlan } from "@/lib/self-healing/engine";
import { executeHealingWithConfidenceGate } from "@/lib/self-healing/confidence";
import { detectGscAnomalies, generateGscHealingPlan } from "@/lib/self-healing/gsc";
import { writeMetricSnapshot } from "@/lib/metrics/metric-snapshot";
import { redis } from "@/lib/redis";

// ── Manual Audit Job (triggered from dashboard "Run Audit" button) ────────────
// Handles the non-blocking audit.run.manual event fired by the runAudit server
// action. The server action creates a PENDING audit record immediately and
// returns to the UI — this job runs the actual audit in the background.

export const processManualAuditJob = inngest.createFunction(
    {
        id: "process-manual-audit",
        name: "Process Manual Audit",
        retries: 1,
        concurrency: {
            limit: CONCURRENCY.auditFull,
            key: `event.data.siteId`,
        },

        triggers: [{ event: "audit.run.manual" }],
    },
    async ({ event, step }) => {
        const { siteId, auditId, domain, tier, auditMode, lockKey } = event.data as {
            siteId: string;
            auditId: string;
            domain: string;
            userId: string;
            tier: string;
            auditMode?: "homepage" | "full";
            lockKey?: string;   // forwarded from the server action
        };

        // Step 1: Run the homepage audit
        const auditResult = await step.run("run-homepage-audit", async () => {
            const engine = getFullAuditEngine();
            const url = domain.startsWith("http") ? domain : `https://${domain}`;
            return engine.runAudit(url);
        });

        // Step 2: Save results to the PENDING audit record
        const isPaid = ["PRO", "AGENCY", "ENTERPRISE"].includes((tier ?? "").toUpperCase());
        // For homepage-only mode, mark completed immediately — no fan-out needed
        const fanOut = auditMode !== "homepage";

        await step.run("save-homepage-audit", async () => {
            const categoryScores: Record<string, number> = {};
            auditResult.categories.forEach((cat: { id: string; score: number }) => {
                categoryScores[cat.id] = cat.score;
            });
            categoryScores["seo"] = auditResult.overallScore;

            await prisma.audit.update({
                where: { id: auditId },
                data: {
                    categoryScores,
                    issueList: auditResult as any,
                    fixStatus: fanOut && isPaid ? "IN_PROGRESS" : "COMPLETED",
                },
            });

            // Write time-series metric snapshot
            await writeMetricSnapshot({
                siteId,
                overallScore: auditResult.overallScore,
                schemaScore: null,
                lcp: null,
                cls: null,
                inp: null,
            }).catch(() => { /* non-fatal */ });
        });

        // Release the dashboard lock — homepage audit is done, user can re-run now.
        // Do this BEFORE fan-out so the UI unlocks immediately even if page audits
        // take another few minutes.
        if (lockKey) {
            await step.run("release-audit-lock", async () => {
                await redis.del(lockKey).catch(() => null);
            });
        }

        // Fan out to per-page audits only for full-site mode
        if (fanOut) {
            await step.sendEvent("queue-page-audits", {
                name: "audit.pages.run" as const,
                data: { siteId, auditId, domain, tier, auditMode },
            });
            logger.info("[ManualAudit] Queued multi-page audit", { domain, auditId, tier });
        }

        logger.info("[ManualAudit] Homepage audit complete", {
            domain,
            score: auditResult.overallScore,
            auditId,
        });

        return { auditId, score: auditResult.overallScore };
    }
);

// ── Weekly Audit Job ──────────────────────────────────────────────────────────


export const runWeeklyAuditJob = inngest.createFunction(
    {
        id: "run-weekly-audit",
        name: "Run Weekly Site Audit",
        retries: 3,
        concurrency: {
            limit: CONCURRENCY.auditFull,
            // Per-site key: one concurrent audit per site, not a shared global bucket.
            // Previously "global-audit" caused a single slow domain to block all others.
            key: "event.data.siteId",
        },
        throttle: {
            limit: 20,
            period: "1m",
            key: "global-audit-throttle",
        },
        onFailure: async ({ error, event }) => {
            logger.error("[Inngest/WeeklyAudit] Failed after all retries", {
                siteId: (event.data?.event?.data as Record<string, unknown>)?.siteId,
                error: error.message,
            });
        },

        triggers: [{ event: "audit.run" }],
    },
    async ({ event, step }) => {
        if (!process.env.GEMINI_API_KEY) throw new NonRetriableError("Missing GEMINI_API_KEY - dropping job to save retries");
        const { siteId } = event.data;

        const site = await step.run("fetch-site", async () => {
            const s = await prisma.site.findUnique({ where: { id: siteId } });
            if (!s) throw new Error("Site not found");
            return s;
        });

        const auditResult = await step.run("run-audit", async () => {
            const engine = getFullAuditEngine();
            const url = site.domain.startsWith("http") ? site.domain : `https://${site.domain}`;
            return await engine.runAudit(url);
        });

        const previousAudit = await step.run("fetch-previous-audit", async () => {
            return prisma.audit.findFirst({
                where: { siteId: site.id },
                orderBy: { runTimestamp: "desc" },
            });
        });

        await step.run("save-audit", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allItems = auditResult.categories.flatMap((c: { items: any[] }) => c.items);

            // issueList may be stored as FullAuditReport (new shape: { categories[], recommendations[] })
            // or as raw categories[] (old shape). Handle both so diffs work on existing records.
            const prevItems = (() => {
                if (!previousAudit?.issueList) return [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const il = previousAudit.issueList as any;
                // New shape: FullAuditReport object with categories[]
                if (!Array.isArray(il) && Array.isArray(il.categories)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return il.categories.flatMap((c: any) => c.items ?? []);
                }
                // Old shape: raw categories[] array
                if (Array.isArray(il)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return il.flatMap((c: any) => c.items ?? []);
                }
                return [];
            })();

            const diff = prevItems.length > 0 ? diffAuditSnapshots(prevItems, allItems) : null;

            function resolveFixStatus(
                d: typeof diff,
                isFirstRun: boolean
            ): "FIRST_RUN" | "FIXED" | "IMPROVED" | "PENDING" {
                if (isFirstRun || d === null) return "FIRST_RUN";
                if (d.fixed.length > 0 && (!d.newIssues || d.newIssues.length === 0)) return "FIXED";
                if (d.fixed.length > 0) return "IMPROVED";
                return "PENDING";
            }

            await prisma.audit.create({
                data: {
                    siteId: site.id,
                    categoryScores: auditResult.categories.reduce(
                        (acc: Record<string, number>, c: { id: string; score: number }) => ({ ...acc, [c.id]: c.score }),
                        {}
                    ),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    // Store the full FullAuditReport so the display page can read
                    // recommendations[] and categories[] from one consistent shape.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    issueList: auditResult as any,
                    fixStatus: resolveFixStatus(diff, prevItems.length === 0),
                    // Gap 4.2: Populate Core Web Vitals columns from the performance module output.
                    // PerformanceModule returns LCP/CLS/INP as numeric values on items with matching IDs.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ...(() => {
                        const perfCat = auditResult.categories.find(
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (c: any) => c.id === "performance"
                        ) as { items?: { id: string; value?: number }[] } | undefined;
                        const getMetric = (id: string): number | null => {
                            const item = perfCat?.items?.find((i) => i.id === id);
                            return typeof item?.value === "number" ? item.value : null;
                        };
                        return {
                            lcp: getMetric("lcp"),
                            cls: getMetric("cls"),
                            inp: getMetric("inp"),
                        };
                    })(),
                },
            });

            // 2.1: Write MetricSnapshot for time-series trend charts
            const perfCatForSnap = auditResult.categories.find(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (c: any) => c.id === "performance"
            ) as { items?: { id: string; value?: number }[] } | undefined;
            const schemaCat = auditResult.categories.find(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (c: any) => c.id === "schema"
            ) as { score?: number } | undefined;
            const getSnapMetric = (id: string): number | null => {
                const item = perfCatForSnap?.items?.find((i) => i.id === id);
                return typeof item?.value === "number" ? item.value : null;
            };
            await writeMetricSnapshot({
                siteId: site.id,
                overallScore: auditResult.overallScore,
                schemaScore: schemaCat?.score ?? null,
                lcp: getSnapMetric("lcp"),
                cls: getSnapMetric("cls"),
                inp: getSnapMetric("inp"),
            }).catch(() => {/* non-fatal */ });

            return { score: auditResult.overallScore, diff: diff?.summary };

        });

        await step.run("maybe-trigger-healing", async () => {
            if (!previousAudit) return;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const prevScore: number = (previousAudit.categoryScores as any)?.seo ?? 0;
            const scoreDelta = prevScore - auditResult.overallScore;
            const REGRESSION_THRESHOLD = 10;

            if (scoreDelta < REGRESSION_THRESHOLD) return;

            logger.info("[WeeklyAudit] Score regressed — generating healing plan", {
                siteId: site.id,
                prevScore,
                currentScore: auditResult.overallScore,
                delta: scoreDelta,
            });

            const { detectGsovDrop: _detectGsovDrop, generateHealingPlan } = await import("@/lib/self-healing/engine");
            const gsovStatus = await _detectGsovDrop(site.id);
            const actions = await generateHealingPlan(
                site.id,
                gsovStatus.currentGsov,
                gsovStatus.prevGsov
            );

            if (actions.length > 0) {
                await prisma.healingPlan.create({
                    data: {
                        siteId: site.id,
                        trigger: "seo_regression",
                        scoreDelta,
                        actions: actions as object,
                        status: "PENDING",
                    },
                });
                logger.info("[WeeklyAudit] Healing plan created", {
                    siteId: site.id,
                    actionCount: actions.length,
                });
            }
        });

        return { success: true, score: auditResult.overallScore };
    }
);

// ── Post-Fix Impact Audit ─────────────────────────────────────────────────────

export const auditPostFixJob = inngest.createFunction(
    {
        id: "audit-post-fix", name: "Post-Fix Impact Audit",
        triggers: [{ event: "audit/run-post-fix" }],
    },
    async ({ event, step }) => {
        const { siteId, logId, baselineScore } = event.data as {
            siteId: string;
            logId: string;
            baselineScore: number;
        };

        const newAudit = await step.run("run-full-audit", async () => {
            const { getFullAuditEngine } = await import("@/lib/seo-audit");
            const site = await prisma.site.findUnique({ where: { id: siteId }, select: { domain: true } });
            if (!site) throw new Error("Site not found");
            const engine = getFullAuditEngine();
            const url = site.domain.startsWith("http") ? site.domain : `https://${site.domain}`;
            return engine.runAudit(url);
        });

        await step.run("save-impact", async () => {
            const scoreValues = newAudit.categories.map((c: { score: number }) => c.score);
            const newScore = scoreValues.length > 0
                ? scoreValues.reduce((a: number, b: number) => a + b, 0) / scoreValues.length
                : 0;
            const impact = Math.round(newScore - baselineScore);

            await prisma.selfHealingLog.update({
                where: { id: logId },
                data: {
                    impactScore: impact,
                    status: impact > 0 ? "COMPLETED" : "NO_IMPACT",
                },
            });
        });

        return { success: true };
    }
);

// ── Weekly Email Digest ───────────────────────────────────────────────────────

export const sendWeeklyDigestJob = inngest.createFunction(
    {
        id: "send-weekly-digest", name: "Send Weekly SEO Digest",
        triggers: [{ event: "email.digest" }],
    },
    async ({ event, step }) => {
        const { userId, siteId, auditScore, prevScore, windowMs, now } = event.data;

        const user = await step.run("fetch-user", async () => {
            const u = await prisma.user.findUnique({ where: { id: userId } });
            if (!u || !u.email) throw new Error("User or email not found");
            return u;
        });

        const site = await step.run("fetch-site", async () => {
            const s = await prisma.site.findUnique({ where: { id: siteId } });
            if (!s) throw new Error("Site not found");
            return s;
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prefs = (user.preferences as Record<string, any>) ?? {};
        const lastSentAt: number = prefs.lastDigestSentAt ?? 0;
        if (now - lastSentAt < windowMs) {
            return { skipped: true, reason: "Too early to send next digest" };
        }

        const topOpportunities = await step.run("fetch-gsc-opportunities", async () => {
            const gscAccount = await prisma.account.findFirst({
                where: { userId: user.id, provider: "google-gsc" },
                select: { access_token: true },
            });
            if (gscAccount?.access_token) {
                try {
                    const siteUrl = normaliseSiteUrl(site.domain);
                    const keywords = await fetchGSCKeywords(gscAccount.access_token, siteUrl, 90, 50);
                    return findOpportunities(keywords, 5).map((o) => ({
                        keyword: o.keyword,
                        position: Math.round(o.avgPosition),
                        impressions: o.impressions,
                    }));
                } catch (err: unknown) {
                    logger.warn(`[Inngest/EmailDigest] GSC fetch failed for ${user.email}:`, { error: (err as Error)?.message || String(err) });
                }
            }
            return [];
        });

        await step.run("send-email", async () => {
            const result = await sendSEODigest(user.email as string, {
                userName: user.name ?? (user.email as string).split("@")[0],
                domain: site.domain,
                auditScore,
                auditScoreChange: auditScore - prevScore,
                topOpportunities,
                newBacklinks: 0,
                lostBacklinks: 0,
                topPage: { url: `https://${site.domain}`, clicks: 0 },
            });
            if (!result.success) throw new Error(result.error || "Failed to send email");
        });

        await step.run("update-preferences", async () => {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    preferences: {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ...(user.preferences as Record<string, any> ?? {}),
                        lastDigestSentAt: now,
                    },
                },
            });
        });

        return { success: true };
    }
);

// ── GSoV Monitor & Self-Healing ───────────────────────────────────────────────

export const monitorGsovJob = inngest.createFunction(
    {
        id: "monitor-gsov", name: "Hourly GSoV & Self-Healing Monitor",
        triggers: [{ cron: "0 * * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-autopilot-sites", async () => {
            return await prisma.site.findMany({
                where: { operatingMode: "AUTOPILOT" },
                select: { id: true, domain: true },
            });
        });

        await step.sendEvent(
            "fan-out-gsov-checks",
            sites.map((site) => ({
                name: "gsov.check.site" as const,
                data: { siteId: site.id, domain: site.domain },
            }))
        );

        return { sitesMonitored: sites.length };
    }
);

export const processGsovSiteJob = inngest.createFunction(
    {
        id: "process-gsov-site",
        name: "Process GSoV Site",
        retries: 2,
        concurrency: { limit: CONCURRENCY.gsovChild },
        onFailure: async ({ error, event }) => {
            logger.error("[Inngest/GSoV] Site job failed after retries", {
                siteId: (event.data?.event?.data as Record<string, unknown>)?.siteId,
                error: error.message,
            });
        },

        triggers: [{ event: "gsov.check.site" }],
    },
    async ({ event, step }) => {
        const { siteId } = event.data;

        // Fix #5: wrap all DB + external calls in step.run for replay isolation
        const detection = await step.run("detect-gsov-drop", async () => {
            const result = await detectGsovDrop(siteId);
            return {
                dropped: result.dropped,
                currentGsov: result.currentGsov,
                prevGsov: result.prevGsov,
            };
        });

        if (detection.dropped) {
            await step.run("generate-and-execute-gsov-healing", async () => {
                const actions = await generateHealingPlan(siteId, detection.currentGsov, detection.prevGsov);
                if (actions.length > 0) {
                    const result = await executeHealingWithConfidenceGate(siteId, actions);
                    logger.info("[GSoV/ConfidenceGate] Batch complete", { siteId, ...result });
                }
            });
        }

        return { siteId, dropped: detection.dropped };
    }
);

// ── Daily GSC Anomaly Monitor ─────────────────────────────────────────────────

export const monitorGscAnomaliesJob = inngest.createFunction(
    {
        id: "monitor-gsc-anomalies", name: "Daily GSC Anomaly & Intent Shift Monitor",
        triggers: [{ cron: "0 8 * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-autopilot-gsc-sites", async () => {
            return await prisma.site.findMany({
                where: { operatingMode: "AUTOPILOT" },
                select: { id: true, domain: true },
            });
        });

        await step.sendEvent(
            "fan-out-gsc-checks",
            sites.map((site) => ({
                name: "gsc.anomaly.check.site" as const,
                data: { siteId: site.id, domain: site.domain },
            }))
        );

        return { sitesProcessed: sites.length };
    }
);

export const processGscSiteJob = inngest.createFunction(
    {
        id: "process-gsc-site",
        name: "Process GSC Anomaly Site",
        retries: 2,
        concurrency: { limit: CONCURRENCY.gscChild },
        onFailure: async ({ error, event }) => {
            logger.error("[Inngest/GSC] Site job failed after retries", {
                siteId: (event.data?.event?.data as Record<string, unknown>)?.siteId,
                error: error.message,
            });
        },

        triggers: [{ event: "gsc.anomaly.check.site" }],
    },
    async ({ event, step }) => {
        const { siteId } = event.data;

        // Fix #5: wrap all DB + external calls in step.run for replay isolation
        const detection = await step.run("detect-gsc-anomalies", async () => {
            const result = await detectGscAnomalies(siteId);
            return { dropped: result.dropped, anomalies: result.anomalies };
        });

        if (detection.dropped && detection.anomalies.length > 0) {
            await step.run("generate-and-execute-gsc-healing", async () => {
                const actions = await generateGscHealingPlan(siteId, detection.anomalies);
                if (actions.length > 0) {
                    const result = await executeHealingWithConfidenceGate(siteId, actions);
                    logger.info("[GSC/ConfidenceGate] Batch complete", { siteId, ...result });
                }
            });
        }

        return { siteId, dropped: detection.dropped, anomalyCount: detection.anomalies.length };
    }
);