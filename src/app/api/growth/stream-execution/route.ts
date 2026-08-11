import { NextRequest, NextResponse } from "next/server";
import { executeGrowthDecision } from "@/lib/growth/execution-engine";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const decisionId = searchParams.get("decisionId") || "dec-stream-1";
    const siteId = searchParams.get("siteId") || "site-stream-1";

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

                const result = await executeGrowthDecision(decisionId, siteId);

                sendEvent(4, "28-Day Baseline Lock", result.details || "Locked in T0 metrics.");
                controller.close();
            } catch (err: unknown) {
                sendEvent(4, "Execution Failed", (err as Error)?.message || String(err));
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
