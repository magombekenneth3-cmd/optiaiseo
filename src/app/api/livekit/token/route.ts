import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { rateLimit } from "@/lib/rate-limit/check";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await rateLimit("voiceSession", user!.id);
    if (limited) return limited;

    const apiKey    = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl     = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
        return NextResponse.json({ error: "LiveKit not configured" }, { status: 500 });
    }

    const siteId = req.nextUrl.searchParams.get("siteId") ?? "";
    const domain = req.nextUrl.searchParams.get("domain") ?? "";

    const userId   = user!.id;
    const roomName = `voice-${userId}`;

    const at = new AccessToken(apiKey, apiSecret, {
        identity: userId,
        name:     user!.email || "User",
        ttl:      "1h",
        metadata: JSON.stringify({ siteId, domain }),
    });

    at.addGrant({
        roomJoin:     true,
        room:         roomName,
        canPublish:   true,
        canSubscribe: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({ token, url: wsUrl, room: roomName });
}
