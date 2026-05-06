export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { isCronAuthorized } from "@/lib/cron-auth";

export async function GET(request: Request) {
    if (!isCronAuthorized(request)) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { default: prisma } = await import("@/lib/prisma");

    const sites = await prisma.site.findMany({
        select: { id: true, domain: true, userId: true },
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
    });

    if (sites.length > 0) {
        await inngest.send(
            sites.map((site) => ({
                name: "aeo.tracker.check.site" as const,
                data: { siteId: site.id, domain: site.domain, userId: site.userId },
            }))
        );
    }

    return NextResponse.json({ success: true, queued: sites.length });
}
