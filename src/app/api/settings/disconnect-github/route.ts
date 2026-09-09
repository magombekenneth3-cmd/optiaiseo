import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
    const user = await getAuthUser(req as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await prisma.account.deleteMany({
        where: { userId: user.id, provider: "github" },
    });

    logger.info("[disconnect-github] GitHub account disconnected", { userId: user.id });

    return NextResponse.json({ ok: true });
}
