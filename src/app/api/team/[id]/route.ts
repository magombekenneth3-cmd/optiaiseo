// DELETE /api/team/[id] — remove a team member
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const member = await prisma.teamMember.findFirst({
        where: { id, ownerId: user!.id },
    });

    if (!member)
        return NextResponse.json({ error: "Team member not found" }, { status: 404 });

    await prisma.teamMember.delete({ where: { id } });

    return NextResponse.json({ success: true });
}
