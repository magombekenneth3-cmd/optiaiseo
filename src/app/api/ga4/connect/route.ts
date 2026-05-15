import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { siteId, propertyId } = body as { siteId: string; propertyId: string | null };

    if (!siteId) {
        return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: session.user.id },
        select: { id: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    await prisma.site.update({
        where: { id: site.id },
        data: { ga4PropertyId: propertyId },
    });

    return NextResponse.json({ success: true });
}
