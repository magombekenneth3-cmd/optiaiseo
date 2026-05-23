import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId) {
        return NextResponse.json({ error: "siteId required" }, { status: 400 });
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, user: { email: user.email } },
        select: { id: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const queryParam = req.nextUrl.searchParams.get("query");

    const whereClause: any = { siteId };
    if (queryParam) {
        whereClause.query = queryParam;
    }

    const proofs = await prisma.aeoProof.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, proofs });
}
