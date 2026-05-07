export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
    const user = await getAuthUser(req as import('next/server').NextRequest);
    if (!user!.id) return new NextResponse("Unauthorized", { status: 401 });

    const dbUser = await prisma.user.findUnique({
        where: { id: user!.id },
        select: { subscriptionTier: true, name: true, email: true },
    });

    if (user?.subscriptionTier !== "AGENCY") {
        return new NextResponse("Requires AGENCY tier", { status: 403 });
    }

    try {
        const body = await req.json();
        const { email, role } = body;

        if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return new NextResponse("Invalid email address", { status: 400 });
        }

        const count = await prisma.teamMember.count({ where: { ownerId: user!.id } });
        if (count >= 10) {
            return new NextResponse("Team size limit reached (max 10)", { status: 403 });
        }

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        const invite = await prisma.teamInvitation.create({
            data: { email, role, ownerId: user!.id, expiresAt },
        });

        // Log at debug level only — never log the raw token at info/warn level
        logger.debug("[Team/Invite] Invitation created", { inviteId: invite.id, recipientEmail: email });

        // Send invite email if Resend is configured
        if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_DOMAIN) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                const acceptUrl = `${process.env.NEXTAUTH_URL}/invite/accept?token=${invite.token}`;
                await resend.emails.send({
                    from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
                    to: email,
                    subject: `${user!.email ?? "Someone"} invited you to their OptiAISEO team`,
                    html: `<p>You've been invited to join a team on OptiAISEO.</p>
                           <p><a href="${acceptUrl}">Accept invitation</a> (expires in 7 days)</p>`,
                });
             
             
            } catch (emailErr: unknown) {
                // Non-fatal — invitation is created, email delivery failed
                logger.warn("[Team/Invite] Failed to send invitation email:", { error: (emailErr as Error)?.message || String(emailErr) });
            }
        } else {
            // Dev fallback — log accept URL so dev can test without Resend
            logger.debug(`[Team/Invite] Accept URL (dev only): ${process.env.NEXTAUTH_URL}/invite/accept?token=${invite.token}`);
        }

        // Never return the raw token to the caller — it should travel only via email
         
        return NextResponse.json({ success: true, inviteId: invite.id });
     
    } catch (e: unknown) {
        logger.error("[Team/Invite] Error:", { error: (e as Error)?.message || String(e) });
        return new NextResponse("Internal Error", { status: 500 });
    }
}
