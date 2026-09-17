/**
 * Canonical scheduled backlink worker.
 *
 * `cronWeeklyBacklinks` is the sole scheduler; this function only consumes a
 * site event. Keeping fan-out and execution separate prevents duplicate API
 * requests, alert writes, and email deliveries.
 */

import { inngest } from "@/lib/inngest/client";
import { isConfigured } from "@/lib/backlinks/client";
import { syncBacklinkProfile } from "@/lib/backlinks/sync";
import { logger } from "@/lib/logger";
import { fireWhiteLabelWebhook } from "@/lib/webhooks/white-label";

const BACKLINK_TIERS = new Set(["PRO", "AGENCY"]);

export const backlinkCheckSite = inngest.createFunction(
    {
        id: "backlinks-check-site",
        name: "Backlinks: check site",
        concurrency: { limit: 5, key: "event.data.siteId" },
        retries: 2,
        triggers: [{ event: "backlinks.check.site" }],
    },
    async ({ event, step }) => {
        const siteId = typeof (event.data as Record<string, unknown>)?.siteId === "string"
            ? (event.data as { siteId: string }).siteId
            : "";
        if (!siteId) return { skipped: true, reason: "missing_site_id" };

        // Never trust a domain or user ID attached to an event. Loading the
        // current record prevents a stale/manual event from spending provider
        // credits for a deleted, downgraded, or different site.
        const site = await step.run("load-eligible-site", async () => {
            const { prisma } = await import("@/lib/prisma");
            return prisma.site.findUnique({
                where: { id: siteId },
                select: {
                    id: true,
                    domain: true,
                    targetKeyword: true,
                    userId: true,
                    user: {
                        select: {
                            email: true,
                            name: true,
                            preferences: true,
                            subscriptionTier: true,
                        },
                    },
                },
            });
        });

        if (!site || !BACKLINK_TIERS.has(site.user.subscriptionTier)) {
            return { skipped: true, reason: "site_not_backlink_eligible" };
        }
        if (!isConfigured()) return { skipped: true, reason: "provider_not_configured" };

        const sync = await step.run("sync-backlink-profile", () =>
            syncBacklinkProfile(site.id, site.domain, {
                targetKeyword: site.targetKeyword,
            }),
        );

        if (sync.alerts.gained === 0 && sync.alerts.lost === 0) {
            logger.info("[Inngest/Backlinks] Site sync completed without new transitions", {
                siteId: site.id,
                domain: site.domain,
                baseline: sync.alerts.baseline,
                partial: sync.alerts.partial,
            });
            return {
                siteId: site.id,
                domain: site.domain,
                gained: 0,
                lost: 0,
                baseline: sync.alerts.baseline,
                partial: sync.alerts.partial,
            };
        }

        await step.run("fire-webhook", () =>
            fireWhiteLabelWebhook(site.userId, {
                event: "backlinks.alerts_detected",
                siteId: site.id,
                domain: site.domain,
                timestamp: new Date().toISOString(),
                data: {
                    gained: sync.alerts.gained,
                    lost: sync.alerts.lost,
                    gainedDomains: sync.alerts.gainedDomains,
                    lostDomains: sync.alerts.lostDomains,
                },
            }),
        );

        await step.run("deliver-alerts", async () => {
            const preferences = site.user.preferences as Record<string, unknown> | null;
            if (preferences?.backlinkAlerts === false) return;

            if (site.user.email) {
                const { sendBacklinkAlertEmail } = await import("@/lib/email/backlink-alert");
                await sendBacklinkAlertEmail(site.user.email, {
                    userName: site.user.name ?? site.user.email.split("@")[0],
                    domain: site.domain,
                    gained: sync.alerts.gainedDomains,
                    lost: sync.alerts.lostDomains,
                    siteId: site.id,
                });
            }

            const { prisma } = await import("@/lib/prisma");
            const title = sync.alerts.gained > 0 && sync.alerts.lost > 0
                ? `+${sync.alerts.gained} new, −${sync.alerts.lost} lost referring domains`
                : sync.alerts.gained > 0
                    ? `+${sync.alerts.gained} new referring domain${sync.alerts.gained === 1 ? "" : "s"}`
                    : `${sync.alerts.lost} referring domain${sync.alerts.lost === 1 ? "" : "s"} lost`;
            const topDomain = sync.alerts.gainedDomains[0]?.domain
                ?? sync.alerts.lostDomains[0]?.domain
                ?? "";

            await prisma.notification.create({
                data: {
                    userId: site.userId,
                    type: "backlink_change",
                    title,
                    body: topDomain
                        ? `${topDomain}${sync.alerts.gained + sync.alerts.lost > 1 ? ` and ${sync.alerts.gained + sync.alerts.lost - 1} more` : ""}`
                        : `Backlink changes detected for ${site.domain}`,
                    href: `/dashboard/backlinks?siteId=${site.id}`,
                    metadata: { gained: sync.alerts.gained, lost: sync.alerts.lost },
                },
            });
        });

        logger.info("[Inngest/Backlinks] Site sync complete", {
            siteId: site.id,
            domain: site.domain,
            gained: sync.alerts.gained,
            lost: sync.alerts.lost,
        });
        return {
            siteId: site.id,
            domain: site.domain,
            gained: sync.alerts.gained,
            lost: sync.alerts.lost,
            baseline: false,
            partial: false,
        };
    },
);
