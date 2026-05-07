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
                    where:  { user: { subscriptionTier: { in: ["PRO", "AGENCY", "ENTERPRISE"] } } },
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

        logger.info("[Inngest/Backlinks] Site check complete", {
            siteId, domain, gained, lost,
        });

        return { siteId, domain, gained, lost };
    }
);
