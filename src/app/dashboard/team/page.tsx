import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { TeamManagementClient } from "@/components/dashboard/TeamManagement";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
    title: "Team | OptiAISEO",
    description: "Manage your team members and invitations.",
};

export default async function TeamPage() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { subscriptionTier: true, name: true },
    });

    const [members, invitations] = await Promise.all([
        prisma.teamMember.findMany({
            where: { ownerId: session.user.id },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { createdAt: "asc" },
        }),
        prisma.teamInvitation.findMany({
            where: { ownerId: session.user.id, expiresAt: { gt: new Date() } },
            select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, token: true },
            orderBy: { createdAt: "desc" },
        }),
    ]);

    return (
        <TeamManagementClient
            members={members.map(m => ({
                id: m.id,
                name: m.user.name ?? m.user.email ?? "Unknown",
                email: m.user.email ?? "",
                image: m.user.image ?? null,
                role: m.role,
                joinedAt: m.createdAt.toISOString(),
            }))}
            invitations={invitations.map(i => ({
                id: i.id,
                email: i.email,
                role: i.role,
                sentAt: i.createdAt.toISOString(),
                expiresAt: i.expiresAt.toISOString(),
                token: i.token,
            }))}
            plan={user?.subscriptionTier ?? "FREE"}
        />
    );
}
