import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
    const user = await getAuthUser(req as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await prisma.account.deleteMany({
        where: { userId: user.id, provider: "google-gsc" },
    });

    await prisma.user.update({
        where: { id: user.id },
        data: { gscConnected: false },
    });

    return NextResponse.json({ ok: true });
}
