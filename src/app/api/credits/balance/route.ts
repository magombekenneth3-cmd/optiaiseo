import { getAuthUser } from "@/lib/auth/get-auth-user";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: import("next/server").NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const dbUser = await prisma.user.findUnique({
        where: { email: user!.email },
        select: { credits: true, subscriptionTier: true },
    });
    return NextResponse.json({
        credits: dbUser?.credits ?? 0,
        subscriptionTier: dbUser?.subscriptionTier ?? "FREE",
    });
}
