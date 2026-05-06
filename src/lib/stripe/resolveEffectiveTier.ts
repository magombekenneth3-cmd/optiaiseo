import prisma from "@/lib/prisma"

export async function resolveEffectiveTier(userId: string, rawTier: string): Promise<string> {
    if (rawTier !== "FREE") return rawTier

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { trialEndsAt: true },
    })

    return user?.trialEndsAt && user.trialEndsAt > new Date() ? "PRO" : "FREE"
}