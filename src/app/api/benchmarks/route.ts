import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { getSiteBenchmarkContext } from "@/app/actions/benchmarks";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    // 1. Auth check
    const user = await getAuthUser(req);
    if (!user!.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Input validation
    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId) {
        return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
    }

    // 3. Ownership check — confirm this site belongs to the requesting user
    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { userId: true, viewerId: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isOwner  = site.userId   === user!.id;
    const isViewer = site.viewerId === user!.id;

    if (!isOwner && !isViewer) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 4. Safe to proceed
    const context = await getSiteBenchmarkContext(siteId);
    return NextResponse.json(context);
}
