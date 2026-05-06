import { NextResponse } from "next/server";

/**
 * GET /api/indexnow-key
 *
 * Serves the IndexNow validation key as a plain-text response.
 * IndexNow verifies domain ownership by fetching:
 *   https://<domain>/<INDEXNOW_KEY>/<INDEXNOW_KEY>.txt
 *
 * Your vercel.json or next.config.ts should rewrite those paths here.
 * Set INDEXNOW_KEY to a 32+ char hex string in your environment variables.
 */
export async function GET() {
    const key = process.env.INDEXNOW_KEY;

    if (!key || key === "your-32-char-hex-key") {
        return new NextResponse("IndexNow key not configured", { status: 404 });
    }

    return new NextResponse(key, {
        status: 200,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
        },
    });
}
