import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as { mozApiToken?: string };
    const token = (body.mozApiToken ?? "").trim();

    const dbUser = await prisma.user.findUnique({
        where:  { email: session.user.email },
        select: { id: true, preferences: true },
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const existing = (dbUser.preferences as Record<string, unknown>) ?? {};

    await prisma.user.update({
        where: { id: dbUser.id },
        data:  {
            preferences: {
                ...existing,
                mozApiToken: token || undefined,
            },
        },
    });

    return NextResponse.json({ saved: true });
}
