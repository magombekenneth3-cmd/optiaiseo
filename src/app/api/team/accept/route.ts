export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit/monthly";
import { headers } from "next/headers";

export async function POST(req: Request) {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const rl = await checkRateLimit(`team-accept:${ip}`, 5, 15 * 60);
    if (!rl.allowed) return new NextResponse("Too many requests", { status: 429 });

    const user = await getAuthUser(req as import('next/server').NextRequest);
    if (!user!.id) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const body = await req.json();
        const { token } = body;

        const invite = await prisma.teamInvitation.findUnique({ where: { token } });
        if (!invite) return new NextResponse("Invalid or expired token", { status: 404 });
        if (invite.expiresAt < new Date()) {
            await prisma.teamInvitation.delete({ where: { token } });
            return new NextResponse("Token expired", { status: 400 });
        }

        await prisma.teamMember.create({
            data: {
                userId: user!.id,
                ownerId: invite.ownerId,
                role: invite.role,
            },
        });

        await prisma.teamInvitation.delete({ where: { token } });

        return NextResponse.json({ success: true });
     
     
    } catch (e: unknown) {
        if ((e as { code?: string }).code === "P2002") {
            return new NextResponse("Already a team member", { status: 400 });
        }
        return new NextResponse("Internal Error", { status: 500 });
    }
}
