// GET /api/free/reddit-opportunities?keyword=... (no auth required — free tool)
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { googleCustomSearch, parseRedditResults } from "@/lib/reddit/free-reddit";
import { rateLimit, getClientIp } from "@/lib/rate-limit/check";

export async function GET(req: NextRequest) {
    const ip = getClientIp(req);
    const limited = await rateLimit("redditOpportunities", ip);
    if (limited) return limited;

    const keyword = req.nextUrl.searchParams.get("keyword")?.trim();
    if (!keyword)
        return NextResponse.json({ error: "keyword required" }, { status: 400 });

    if (keyword.length > 120)
        return NextResponse.json({ error: "Keyword too long" }, { status: 400 });

    try {
        const raw = await googleCustomSearch(`site:reddit.com ${keyword}`);
        const opportunities = parseRedditResults(raw, keyword);
        return NextResponse.json({ opportunities });
    } catch {
        return NextResponse.json({ error: "Search temporarily unavailable" }, { status: 503 });
    }
}
