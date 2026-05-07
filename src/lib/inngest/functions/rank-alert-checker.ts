/**
 * Rank Alert Checker — fires after rank.tracker.site completes
 * Compares today's positions vs the previous snapshot for the same keywords.
 * If any keyword dropped more than the user's configured threshold (default 3),
 * sends an immediate Slack/Zapier alert and queues the data for the weekly digest.
 */

import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { dispatchWebhooks, type WebhookEventType } from "@/lib/alerts/webhook-dispatcher";

const APP_URL = (process.env.NEXTAUTH_URL ?? "https://optiaiseo.online").replace(/\/$/, "");
const DEFAULT_ALERT_THRESHOLD = 3; // positions

export const rankAlertCheckerJob = inngest.createFunction(
    {
        id: "rank-alert-checker",
        name: "Rank Alert — Drop & Win Detector",
        retries: 1,
        concurrency: { limit: 5 },  // capped at Inngest plan limit
    
        triggers: [{ event: "rank.tracker.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain, userId } = event.data as {
            siteId: string;
            domain: string;
            userId: string;
        };

        // Load site with user prefs and webhook config
        const site = await step.run("load-site-and-user", async () => {
            return prisma.site.findUnique({
                where: { id: siteId },
                select: {
                    id: true,
                    domain: true,
                    slackWebhookUrl: true,
                    zapierWebhookUrl: true,
                    user: {
                        select: {
                            id: true,
                            preferences: true,
                            subscriptionTier: true,
                        },
                    },
                },
            });
        });

        if (!site) return { skipped: true, reason: "site_not_found" };

        // Only Pro/Agency users get rank alerts
        const tier = site.user.subscriptionTier;
        if (!["PRO", "AGENCY"].includes(tier)) return { skipped: true, reason: "free_tier" };

        const prefs = (site.user.preferences as Record<string, unknown>) ?? {};
        const rankAlerts = prefs.rankAlerts !== false; // default on
        if (!rankAlerts) return { skipped: true, reason: "alerts_disabled" };

        const alertThreshold = typeof prefs.rankAlertThreshold === "number"
            ? prefs.rankAlertThreshold
            : DEFAULT_ALERT_THRESHOLD;

        const { drops, wins } = await step.run("compute-rank-changes", async () => {
            const now = new Date();
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);

            const sevenDaysAgo = new Date(todayStart);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const [todaySnaps, historySnaps] = await Promise.all([
                prisma.rankSnapshot.findMany({
                    where: { siteId, recordedAt: { gte: todayStart } },
                    select: { keyword: true, position: true },
                    orderBy: { recordedAt: "desc" },
                }),
                prisma.rankSnapshot.findMany({
                    where: { siteId, recordedAt: { gte: sevenDaysAgo, lt: todayStart } },
                    select: { keyword: true, position: true },
                }),
            ]);

            const todayMap = new Map<string, number>();
            for (const s of todaySnaps) {
                if (!todayMap.has(s.keyword)) todayMap.set(s.keyword, s.position);
            }

            const historyByKeyword = new Map<string, number[]>();
            for (const s of historySnaps) {
                const arr = historyByKeyword.get(s.keyword) ?? [];
                arr.push(s.position);
                historyByKeyword.set(s.keyword, arr);
            }

            function median(values: number[]): number {
                const sorted = [...values].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 !== 0
                    ? sorted[mid]
                    : (sorted[mid - 1] + sorted[mid]) / 2;
            }

            const drops: { keyword: string; from: number; to: number; delta: number }[] = [];
            const wins:  { keyword: string; from: number; to: number; delta: number }[] = [];

            for (const [keyword, currentPos] of todayMap) {
                const history = historyByKeyword.get(keyword);
                if (!history || history.length < 3) continue;

                const baseline = median(history);
                const delta = currentPos - baseline;

                if (delta >= alertThreshold) {
                    drops.push({ keyword, from: Math.round(baseline), to: currentPos, delta: Math.round(delta) });
                } else if (delta <= -2) {
                    wins.push({ keyword, from: Math.round(baseline), to: currentPos, delta: Math.round(delta) });
                }
            }

            drops.sort((a, b) => b.delta - a.delta);
            wins.sort((a, b) => a.delta - b.delta);

            return { drops, wins };
        });

        if (drops.length > 0 && (site.slackWebhookUrl || site.zapierWebhookUrl)) {
            await step.run("send-rank-drop-alert", async () => {
                const topDrop = drops[0];
                await dispatchWebhooks(
                    { id: siteId, domain, slackWebhookUrl: site.slackWebhookUrl, zapierWebhookUrl: site.zapierWebhookUrl },
                    {
                        event: "rank_drop" as WebhookEventType,
                        summary: `⚠️ ${domain}: "${topDrop.keyword}" dropped ${topDrop.delta} positions (#${topDrop.from} → #${topDrop.to})`,
                        details: {
                            "Keywords dropped": drops.length,
                            "Worst drop": `"${topDrop.keyword}" #${topDrop.from} → #${topDrop.to}`,
                            "Alert threshold": `>= ${alertThreshold} positions`,
                            "Site": domain,
                        },
                        dashboardUrl: `${APP_URL}/dashboard/keywords?siteId=${siteId}`,
                    }
                );
                logger.info("[RankAlert] Drop alert sent", { siteId, domain, drops: drops.length });
            });
        }

        if (wins.length > 0 && (site.slackWebhookUrl || site.zapierWebhookUrl)) {
            await step.run("send-rank-win-alert", async () => {
                const topWin = wins[0];
                await dispatchWebhooks(
                    { id: siteId, domain, slackWebhookUrl: site.slackWebhookUrl, zapierWebhookUrl: site.zapierWebhookUrl },
                    {
                        event: "rank_win" as WebhookEventType,
                        summary: `🎉 ${domain}: "${topWin.keyword}" moved up ${Math.abs(topWin.delta)} positions (#${topWin.from} → #${topWin.to})`,
                        details: {
                            "Keywords improved": wins.length,
                            "Best mover": `"${topWin.keyword}" #${topWin.from} → #${topWin.to}`,
                            "Site": domain,
                        },
                        dashboardUrl: `${APP_URL}/dashboard/keywords?siteId=${siteId}`,
                    }
                );
                logger.info("[RankAlert] Win alert sent", { siteId, domain, wins: wins.length });
            });
        }

        if ((drops.length > 0 || wins.length > 0) && !site.slackWebhookUrl && !site.zapierWebhookUrl) {
            await step.run("send-rank-email-fallback", async () => {
                const { sendRankMovementEmail } = await import("@/lib/email");
                await sendRankMovementEmail({ userId, domain, drops, wins, siteId });
                logger.info("[RankAlert] Email fallback sent", { siteId, userId });
            });
        }

        // Store rank movement summary in site preferences for the weekly digest collector
        if (drops.length > 0 || wins.length > 0) {
            await step.run("store-rank-movements", async () => {
                const safeWins  = wins.slice(0, 10).map(w => ({ keyword: String(w.keyword).slice(0, 200), from: Number(w.from), to: Number(w.to), delta: Number(w.delta) }));
                const safeDrops = drops.slice(0, 10).map(d => ({ keyword: String(d.keyword).slice(0, 200), from: Number(d.from), to: Number(d.to), delta: Number(d.delta) }));

                const current = await prisma.user.findUnique({
                    where: { id: userId },
                    select: { preferences: true },
                });
                const prefs = (current?.preferences as Record<string, unknown>) ?? {};

                await prisma.$transaction([
                    prisma.site.update({
                        where: { id: siteId },
                        data: { updatedAt: new Date() },
                    }),
                    prisma.user.update({
                        where: { id: userId },
                        data: {
                            preferences: {
                                ...prefs,
                                rankWins:  safeWins,
                                rankDrops: safeDrops,
                            },
                        },
                    }),
                ]);
            });
        }

        return {
            siteId,
            domain,
            drops: drops.length,
            wins: wins.length,
            alertSent: drops.length > 0 && !!(site.slackWebhookUrl || site.zapierWebhookUrl),
        };
    }
);
