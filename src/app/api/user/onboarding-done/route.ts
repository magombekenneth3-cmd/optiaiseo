import { getAuthUser } from "@/lib/auth/get-auth-user";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bumpSessionVersion } from "@/lib/session-version";

export async function POST(req: import('next/server').NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.user.update({
        where: { email: user!.email },
        data: { onboardingDone: true },
    });

    // Bust the JWT session cache so the flag is reflected immediately
    const userId = (user as { id?: string }).id;
    if (userId) {
        await bumpSessionVersion(userId).catch(() => null);
    }

    return NextResponse.json({ ok: true });
}
