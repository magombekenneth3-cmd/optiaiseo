import { cache } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export const getDashboardUser = cache(async () => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: {
            id: true,
            name: true,
            email: true,
            subscriptionTier: true,
            onboardingDone: true,
            trialEndsAt: true,
            role: true,
            credits: true,
            creditsLockedAt: true,
            sites: {
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    domain: true,
                    githubRepoUrl: true,
                    aeoReports: {
                        where: { status: "COMPLETED", NOT: { grade: { in: ["Pending", "-"] } } },
                        orderBy: { createdAt: "desc" },
                        take: 1,
                        select: { grade: true },
                    },
                },
            },
        },
    });
    if (!user) redirect("/login");
    return user;
});
