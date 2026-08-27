import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserGa4Token } from "@/lib/ga4/token";
import { listGa4Properties } from "@/lib/ga4";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId) {
        return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: session.user.id },
        select: { userId: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    try {
        const accessToken = await getUserGa4Token(site.userId);
        const properties = await listGa4Properties(accessToken);
        return NextResponse.json({ properties });
    } catch (err) {
        const msg = (err as Error)?.message ?? '';
        if (msg.includes('GA4_PERMISSION_DENIED')) {
            return NextResponse.json(
                { error: "Missing analytics permission. Please connect Google Analytics to grant GA4 access." },
                { status: 403 }
            );
        }
        return NextResponse.json(
            { error: "Failed to list GA4 properties. Ensure Google is connected." },
            { status: 500 }
        );
    }
}
