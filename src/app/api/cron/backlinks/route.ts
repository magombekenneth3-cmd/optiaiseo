export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Kept as a harmless compatibility endpoint for an already-deployed Vercel
    // cron configuration. Inngest's cronWeeklyBacklinks is now the one and only
    // scheduler; executing both used to duplicate provider spend and alerts.
    logger.info("[Cron/Backlinks] Ignored legacy trigger; scheduled by Inngest");
    return NextResponse.json({ success: true, skipped: true, reason: "managed_by_inngest" });
}
