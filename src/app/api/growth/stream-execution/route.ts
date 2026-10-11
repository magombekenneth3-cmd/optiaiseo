import { NextRequest, NextResponse } from "next/server";
import { executeGrowthDecision } from "@/lib/growth/execution-engine";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { assertSiteAccess } from "@/lib/auth/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/growth/stream-execution?decisionId=...
 *
 * Security: previously unauthenticated with demo defaults — anyone could
 * execute any growth decision against any site. Now requires an authenticated
 * user with EDIT access to the decision's site. The siteId is derived from the
 * decision record, never trusted from the query string.
 */
export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decisionId = req.nextUrl.searchParams.get("decisionId");
    if (!decisionId || decisionId.length > 64) {
        return NextResponse.json({ error: "decisionId required" }, { status: 400 });
    }

    const decision = await prisma.growthDecision.findUnique({
        where: { id: decisionId },
        select: { id: true, siteId: true },
    });
    const requestedSiteId = req.nextUrl.searchParams.get("siteId");
    if (!decision || (requestedSiteId && requestedSiteId !== decision.siteId)) {
        return NextResponse.json({ error: "Decision not found or unauthorized" }, { status: 404 });
    }

    const site = await assertSiteAccess(decision.siteId, user.id, "EDIT");
    if (!site) {
        return NextResponse.json({ error: "Decision not found or unauthorized" }, { status: 404 });
    }
    const siteId = decision.siteId;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            function sendEvent(phase: number, label: string, details?: string) {
                const data = JSON.stringify({ phase, label, details, timestamp: new Date() });
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }

            try {
                sendEvent(1, "Vector Linker Analysis", "Scanning pillar articles for contextual interlinking...");
                await new Promise((r) => setTimeout(r, 200));

                sendEvent(2, "FAQ Schema Injection", "Building FAQPage JSON-LD & structural HTML tags...");
                await new Promise((r) => setTimeout(r, 200));

                sendEvent(3, "Instant IndexNow Ping", "Pinging Bing & Google Indexing API endpoints...");
                await new Promise((r) => setTimeout(r, 200));

                const result = await executeGrowthDecision(decision.id, siteId);

                sendEvent(4, result.success ? "28-Day Baseline Lock" : "Execution Not Completed", result.details || "Locked in T0 metrics.");
                controller.close();
            } catch {
                sendEvent(4, "Execution Failed", "Execution failed. Check the dashboard for details.");
                controller.close();
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
