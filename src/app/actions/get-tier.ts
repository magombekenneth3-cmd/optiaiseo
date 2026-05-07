"use server";


import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { resolveEffectiveTier } from "@/lib/stripe/resolveEffectiveTier";

export const getUserBillingTier = async (): Promise<string> => {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return "FREE";

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true, subscriptionTier: true },
        });

        if (!user) return "FREE";

        return await resolveEffectiveTier(user.id, user.subscriptionTier ?? "FREE");
    } catch (error: unknown) {
        logger.error("Failed to fetch billing tier", { error });
        return "UNKNOWN";
    }
};