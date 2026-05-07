export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const user = await getAuthUser(_req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const record = await prisma.competitorPageAnalysis.findFirst({
        where: { id, userId: user!.id },
        select: { status: true, result: true, error: true, createdAt: true },
    });

    if (!record)
        return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(record);
}
