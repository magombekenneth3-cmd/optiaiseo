import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";

/**
 * PATCH /api/settings/preferences
 * Merge-updates the dbUser?.preferences JSON field.
 * Used by onboarding to track progress (onboardingStep) and
 * email settings (emailDigest).
 */
export async function PATCH(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Allowlist of fields users may update via this route
    const ALLOWED = ["onboardingStep", "emailDigest", "lastDigestSentAt"] as const;
    const update: Record<string, unknown> = {};
    for (const key of ALLOWED) {
        if (key in body) update[key] = body[key];
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: user!.email },
        select: { id: true, preferences: true },
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const existing = (dbUser?.preferences as Record<string, unknown>) ?? {};
    const merged = { ...existing, ...update };

    await prisma.user.update({
        where: { id: user!.id },
        data: { preferences: merged as unknown as import("@prisma/client").Prisma.InputJsonValue },
    });

    return NextResponse.json({ success: true, preferences: merged });
}

export async function GET(req: import('next/server').NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: user!.email },
        select: { preferences: true },
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json(dbUser?.preferences ?? {});
}
