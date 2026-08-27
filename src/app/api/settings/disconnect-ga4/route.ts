import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { invalidateGa4CachedToken } from "@/lib/ga4/token";

export async function POST(req: Request) {
    const user = await getAuthUser(req as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await invalidateGa4CachedToken(user.id);

    await prisma.account.deleteMany({
        where: { userId: user.id, provider: "google-ga4" },
    });

    // Clear GA4 property IDs — the GA4 OAuth token is now gone.
    await prisma.site.updateMany({
        where: { userId: user.id, ga4PropertyId: { not: null } },
        data: { ga4PropertyId: null },
    });

    return NextResponse.json({ ok: true });
}
