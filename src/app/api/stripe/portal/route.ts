export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPortalSession } from "@/lib/stripe/client";
import prisma from "@/lib/prisma";

export async function POST(_req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const dbUser = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { subscription: true },
        });

        if (!dbUser?.subscription?.stripeCustomerId) {
            return NextResponse.json(
                { error: "No active subscription found" },
                { status: 404 }
            );
        }

        if (!process.env.NEXTAUTH_URL) {
            throw new Error("NEXTAUTH_URL is not configured");
        }
        const baseUrl = process.env.NEXTAUTH_URL;

        const portalSession = await createPortalSession({
            stripeCustomerId: dbUser.subscription.stripeCustomerId,
            returnUrl: `${baseUrl}/dashboard/billing`,
        });

        return NextResponse.json({ url: portalSession.url });

    } catch (err: unknown) {
        logger.error("[Portal] Error:", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Failed to open billing portal" }, { status: 500 });
    }
}
