/**
 * Inngest function: backlinks-check-site
 *
 * Triggered by the "backlinks.check.site" event (fired by the cron scheduler).
 * Fetches live backlink details from DataForSEO, persists them, runs quality
 * analysis, and detects gained/lost alerts — all as durable, retryable steps.
 *
 * Concurrency key on `siteId` ensures the same site is never processed twice
 * simultaneously. retries: 2 gives two attempts before Inngest marks the event
 * as failed — DataForSEO is reliable but you don't want infinite loops eating credits.
 */

import { inngest } from "@/lib/inngest/client";
import { getBacklinkDetails } from "@/lib/backlinks/index";
import { analyseAndStoreBacklinks } from "@/lib/backlinks/quality-analysis";
import { detectBacklinkAlerts } from "@/lib/backlinks/alerts";
import { logger } from "@/lib/logger";
import { fireWhiteLabelWebhook } from "@/lib/webhooks/white-label";

export const backlinkCheckSite = inngest.createFunction(
    {
        id:          "backlinks-check-site",
        name:        "Backlinks: check site",
        concurrency: { limit: 5, key: "event.data.siteId" },
        retries:     2,
        triggers: [
            { event: "backlinks.check.site" },
            { cron: "0 3 * * 1" },   // every Monday 3am UTC — matches vercel.json schedule
        ],
    },
    async ({ event, step }) => {
        // When fired by cron, event.data is CronEventData (no siteId) — fan out to all eligible sites.
        // When fired by event, event.data has { siteId, domain } — process that single site.
        const eventData = event.data as Record<string, unknown>;
        if (!eventData?.siteId) {
            const { prisma } = await import("@/lib/prisma");
            const sites = await step.run("fetch-sites", () =>
                prisma.site.findMany({
                    where:  { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
                    select: { id: true, domain: true },
                })
            );
            await inngest.send(
                sites.map(s => ({ name: "backlinks.check.site" as const, data: { siteId: s.id, domain: s.domain } }))
            );
            return { fanned: sites.length };
        }

        const { siteId, domain } = eventData as { siteId: string; domain: string };

        // Step 1 — fetch live backlink records from DataForSEO (cached 6h)
        const details = await step.run("fetch-details", () =>
            getBacklinkDetails(domain, 200)
        );

        if (details.length === 0) {
            logger.info("[Inngest/Backlinks] No details returned — skipping", { siteId, domain });
            return { skipped: true, reason: "no_data" };
        }

        // Step 2 — persist and run quality analysis
        await step.run("store-and-analyse", () =>
            analyseAndStoreBacklinks(
                siteId,
                details.map((d: import("@/types/backlinks").BacklinkDetail) => ({
                    srcDomain:    (() => { try { return new URL(d.sourceUrl).hostname; } catch { return d.sourceUrl; } })(),
                    anchorText:   d.anchorText,
                    domainRating: d.domainRating,
                    isDoFollow:   true,
                    targetUrl:    d.targetUrl,
                    firstSeen:    d.firstSeen ? new Date(d.firstSeen) : undefined,  // Bug 2 fix
                }))
            )
        );

        // Step 3 — detect gained/lost alerts by diffing against stored data
        const { gained, lost } = await step.run("detect-alerts", () =>
            detectBacklinkAlerts(siteId, domain)
        );

        if (gained > 0 || lost > 0) {
            await step.run("fire-webhook", async () => {
                const site = await prisma.site.findUnique({
                    where: { id: siteId },
                    select: { userId: true },
                });
                if (!site) return;
                await fireWhiteLabelWebhook(site.userId, {
                    event: "backlinks.alerts_detected",
                    siteId,
                    domain,
                    timestamp: new Date().toISOString(),
                    data: { gained, lost },
                });
            });

            await step.run("deliver-alerts", async () => {
                const { prisma } = await import("@/lib/prisma");
                const site = await prisma.site.findUnique({
                    where: { id: siteId },
                    select: { userId: true, domain: true, user: { select: { email: true, name: true } } },
                });
                if (!site?.user?.email) return;

                const alerts = await prisma.backlinkAlert.findMany({
                    where: { siteId, detectedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
                    select: { type: true, domain: true, dr: true },
                    orderBy: { dr: "desc" },
                    take: 20,
                });

                const gainedList = alerts.filter(a => a.type === "gained").map(a => ({ domain: a.domain, dr: a.dr }));
                const lostList = alerts.filter(a => a.type === "lost").map(a => ({ domain: a.domain, dr: a.dr }));

                const { sendBacklinkAlertEmail } = await import("@/lib/email/backlink-alert");
                await sendBacklinkAlertEmail(site.user.email, {
                    userName: site.user.name ?? site.user.email.split("@")[0],
                    domain: site.domain,
                    gained: gainedList,
                    lost: lostList,
                    siteId,
                });

                const title = gainedList.length > 0 && lostList.length > 0
                    ? `+${gainedList.length} new, −${lostList.length} lost backlinks`
                    : gainedList.length > 0
                        ? `+${gainedList.length} new backlink${gainedList.length !== 1 ? "s" : ""} detected`
                        : `${lostList.length} backlink${lostList.length !== 1 ? "s" : ""} lost`;

                const topDomain = gainedList[0]?.domain ?? lostList[0]?.domain ?? "";

                await prisma.notification.create({
                    data: {
                        userId: site.userId,
                        type: "backlink_change",
                        title,
                        body: topDomain
                            ? `${topDomain}${gainedList.length + lostList.length > 1 ? ` and ${gainedList.length + lostList.length - 1} more` : ""}`
                            : `Backlink changes detected for ${site.domain}`,
                        href: `/dashboard/backlinks?siteId=${siteId}`,
                        metadata: { gained: gainedList.length, lost: lostList.length },
                    },
                });
            });
        }

        logger.info("[Inngest/Backlinks] Site check complete", {
            siteId, domain, gained, lost,
        });

        return { siteId, domain, gained, lost };
    }
);
