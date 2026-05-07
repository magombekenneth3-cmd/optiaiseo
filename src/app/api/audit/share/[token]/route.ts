export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { limiters } from "@/lib/rate-limit";

function ipFrom(req: NextRequest): string {
    return (
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        "unknown"
    );
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    const ip = ipFrom(req);
    const rl = await limiters.shareView.limit(ip);
    if (!rl.success) {
        return NextResponse.json(
            { error: "Too many requests" },
            {
                status: 429,
                headers: { "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)) },
            }
        );
    }

    const { token } = await params;

    if (!/^[0-9a-f]{64}$/.test(token)) {
        return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const share = await prisma.auditShare.findUnique({
        where: { token },
        select: {
            expiresAt: true,
            viewCount: true,
            audit: {
                select: {
                    id: true,
                    categoryScores: true,
                    issueList: true,
                    lcp: true,
                    cls: true,
                    inp: true,
                    runTimestamp: true,
                    site: {
                        select: { domain: true },
                    },
                },
            },
        },
    });

    if (!share) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (share.expiresAt < new Date()) {
        return NextResponse.json({ error: "Share link has expired" }, { status: 410 });
    }

    await prisma.auditShare.update({
        where: { token },
        data: { viewCount: { increment: 1 } },
    });

    return NextResponse.json(
        {
            domain: share.audit.site.domain,
            runTimestamp: share.audit.runTimestamp,
            categoryScores: share.audit.categoryScores,
            issueList: share.audit.issueList,
            lcp: share.audit.lcp,
            cls: share.audit.cls,
            inp: share.audit.inp,
            expiresAt: share.expiresAt,
        },
        {
            headers: {
                "Cache-Control": "private, no-store",
                "X-Robots-Tag": "noindex",
            },
        }
    );
}
