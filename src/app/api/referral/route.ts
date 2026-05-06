import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/referral
 * Returns the current user's referral programme data:
 *  - referral code + share link
 *  - lifetime stats (signups, conversions)
 *  - commission history (per-invoice)
 *
 * POST /api/referral
 * Idempotently creates a Referral record for the current user
 * if one doesn't exist yet (handles race conditions at signup).
 */

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const referral = await prisma.referral.findUnique({
        where: { ownerId: session.user.id },
        include: {
            commissions: {
                orderBy: { createdAt: "desc" },
                take: 50,
            },
        },
    });

    if (!referral) {
        return NextResponse.json({ referral: null });
    }

    const appUrl = (process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
    const shareLink = `${appUrl}/register?ref=${referral.code}`;

    const totalEarnedCents = referral.commissions
        .filter((c) => c.status === "paid")
        .reduce((sum, c) => sum + c.amountCents, 0);

    const pendingCents = referral.commissions
        .filter((c) => c.status === "pending")
        .reduce((sum, c) => sum + c.amountCents, 0);

    return NextResponse.json({
        referral: {
            code: referral.code,
            shareLink,
            signups: referral.signups,
            conversions: referral.conversions,
            totalEarnedCents,
            pendingCents,
            commissions: referral.commissions.map((c) => ({
                id: c.id,
                month: c.month,
                amountCents: c.amountCents,
                status: c.status,
                createdAt: c.createdAt,
            })),
        },
    });
}

export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.referral.findUnique({
        where: { ownerId: session.user.id },
    });

    if (existing) {
        const appUrl = (process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
        return NextResponse.json({
            code: existing.code,
            shareLink: `${appUrl}/register?ref=${existing.code}`,
        });
    }

    // Generate a unique 8-char code using user id prefix
    const code = session.user.id.slice(-6).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();

    const referral = await prisma.referral.create({
        data: { ownerId: session.user.id, code },
    });

    const appUrl = (process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
    return NextResponse.json({
        code: referral.code,
        shareLink: `${appUrl}/register?ref=${referral.code}`,
    });
}
