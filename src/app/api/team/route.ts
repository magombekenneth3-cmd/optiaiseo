export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import { z } from "zod";
import { logger } from "@/lib/logger";

// GET — list team members
export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [members, invitations] = await Promise.all([
        prisma.teamMember.findMany({
            where: { ownerId: user!.id },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { createdAt: "asc" },
        }),
        prisma.teamInvitation.findMany({
            where: { ownerId: user!.id, expiresAt: { gt: new Date() } },
            select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, token: true },
            orderBy: { createdAt: "desc" },
        }),
    ]);

    return NextResponse.json({ members, invitations });
}

// POST — invite by email
const InviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(["VIEWER", "EDITOR", "ADMIN"]).default("VIEWER"),
});

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Check plan allows team members
    const owner = await prisma.user.findUnique({
        where: { id: user!.id },
        select: { subscriptionTier: true, email: true, name: true },
    });
    if (owner?.subscriptionTier === "FREE")
        return NextResponse.json({ error: "Team features require a Pro or Agency plan" }, { status: 403 });

    const body = await req.json();
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success)
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const { email, role } = parsed.data;

    // Check not already a member
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        const alreadyMember = await prisma.teamMember.findFirst({
            where: { userId: existing.id, ownerId: user!.id },
        });
        if (alreadyMember)
            return NextResponse.json({ error: "This user is already a team member" }, { status: 409 });
    }

    // Check for pending invite
    const pendingInvite = await prisma.teamInvitation.findFirst({
        where: { email, ownerId: user!.id, expiresAt: { gt: new Date() } },
    });
    if (pendingInvite)
        return NextResponse.json({ error: "An invitation has already been sent to this email" }, { status: 409 });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await prisma.teamInvitation.create({
        data: { email, ownerId: user!.id, role, expiresAt },
    });

    // Send email
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
        try {
            const resend = new Resend(resendKey);
            const acceptUrl = `${process.env.NEXTAUTH_URL}/invite/accept?token=${invitation.token}`;
            await resend.emails.send({
                from: `OptiAISEO <notifications@${process.env.RESEND_FROM_DOMAIN}>`,
                to: email,
                subject: `${owner?.name ?? "Someone"} invited you to join their OptiAISEO workspace`,
                html: `
                <p>Hi there,</p>
                <p><strong>${owner?.name ?? owner?.email}</strong> has invited you to join their OptiAISEO workspace as a <strong>${role}</strong>.</p>
                <p><a href="${acceptUrl}" style="background:#10b981;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Accept Invitation</a></p>
                <p style="color:#6b7280;font-size:12px">This invitation expires in 7 days. If you don't have an OptiAISEO account, one will be created for you.</p>
                `.trim(),
            });
        } catch (err: unknown) {
            // Non-fatal — invitation still created even if email fails
            const resendErr = err instanceof Error ? err.message : String(err);
            logger.warn("[Team/Invite] Email send failed — invitation created but email not sent", {
                error: resendErr, toEmail: email,
            });
        }
    }

    return NextResponse.json({ invitation }, { status: 201 });
}
