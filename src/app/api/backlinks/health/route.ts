export const dynamic = "force-dynamic";

/**
 * GET /api/backlinks/health?siteId=...
 *
 * Returns the current DataForSEO circuit breaker state so the UI can show
 * a warning banner when the circuit is OPEN (all requests are being rejected
 * to protect DataForSEO credits).
 *
 * Response shape:
 *   { state: "CLOSED" | "OPEN" | "HALF" }
 *
 * No DataForSEO call is made — reads directly from Redis.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";

const CB_KEY     = "cb:dataforseo:state";
const CB_OPEN_AT = "cb:dataforseo:openedAt";

const CB_RESET_MS = Number(process.env.DATAFORSEO_CB_RESET_MS ?? 120_000);

async function getCBState(): Promise<"CLOSED" | "OPEN" | "HALF"> {
    try {
        const { redis } = await import("@/lib/redis");
        const state = await redis.get<string>(CB_KEY);
        if (state !== "OPEN") return "CLOSED";

        // Check if we've elapsed the cool-down (half-open window)
        const openedAt = await redis.get<number>(CB_OPEN_AT);
        if (openedAt && Date.now() - openedAt >= CB_RESET_MS) {
            return "HALF";
        }
        return "OPEN";
    } catch {
        return "CLOSED"; // fail open — don't surface Redis errors to UI
    }
}

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const state = await getCBState();
    return NextResponse.json({ state }, {
        headers: {
            // Cache for 30 s — short enough to reflect a recovery quickly,
            // long enough not to spam Redis on every page focus event.
            "Cache-Control": "private, max-age=30",
        },
    });
}
