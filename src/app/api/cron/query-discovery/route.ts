export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sites = await prisma.site.findMany({
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

    await inngest.send(
        sites.map((site) => ({
            name: "query.discovery.site" as const,
            data: { siteId: site.id, domain: site.domain, skipGsc: !site.user.gscConnected },
        }))
    );

    logger.info("[QueryDiscovery/Cron] Fan-out dispatched", { siteCount: sites.length });
    return NextResponse.json({ dispatched: sites.length });
}
