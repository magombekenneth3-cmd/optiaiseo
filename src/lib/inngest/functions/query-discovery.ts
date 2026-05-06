import { inngest } from "../client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { discoverQueriesForSite } from "@/lib/aeo/query-discovery";

export const queryDiscoverySiteJob = inngest.createFunction(
    {
        id: "query-discovery-site",
        name: "Query Discovery — Per Site",
        retries: 2,
        concurrency: { limit: 5 },
        timeouts: { finish: "3m" },
    
        triggers: [{ event: "query.discovery.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain, skipGsc } = event.data as {
            siteId: string;
            domain: string;
            skipGsc: boolean;
        };

        const result = await step.run("discover-queries", async () => {
            return discoverQueriesForSite(siteId, { skipGsc });
        });

        if (result.warnings.length > 0) {
            logger.warn("[QueryDiscovery] Site warnings", { siteId, domain, warnings: result.warnings });
        }

        logger.info("[QueryDiscovery] Site complete", { siteId, domain, inserted: result.inserted.length });
        return { siteId, inserted: result.inserted.length };
    }
);

export const queryDiscoveryOrchestrator = inngest.createFunction(
    {
        id: "query-discovery-nightly",
        name: "Query Discovery — Nightly Orchestrator",
        retries: 1,
    
        triggers: [{ cron: "0 2 * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("load-sites", async () => {
            return prisma.site.findMany({
                where: {
                    audits: { some: {} },
                    user: {
                        subscription: { status: { in: ["active", "trialing"] } },
                    },
                },
                select: {
                    id: true,
                    domain: true,
                    user: { select: { gscConnected: true } },
                },
            });
        });

        await step.sendEvent(
            "fan-out-query-discovery",
            sites.map((site) => ({
                name: "query.discovery.site" as const,
                data: { siteId: site.id, domain: site.domain, skipGsc: !site.user.gscConnected },
            }))
        );

        return { dispatched: sites.length };
    }
);
