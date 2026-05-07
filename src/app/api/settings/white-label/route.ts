export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { isSafeUrl } from "@/lib/security/safe-url";
import { logger } from "@/lib/logger";
import { z } from "zod";

const WhiteLabelSchema = z.object({
    headline:    z.string().max(120).optional(),
    buttonLabel: z.string().max(60).optional(),
    logoUrl:     z.string().url().max(500).optional().or(z.literal("")),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    webhookUrl:  z.string().url().max(500).optional().or(z.literal("")),
});

export async function POST(req: Request) {
    const user = await getAuthUser(req as import('next/server').NextRequest);
    if (!user!.id) return new NextResponse("Unauthorized", { status: 401 });

    const dbUser = await prisma.user.findUnique({
        where: { id: user!.id },
        select: { subscriptionTier: true },
    });

    if (user?.subscriptionTier !== "AGENCY") {
        return new NextResponse("Requires AGENCY tier", { status: 403 });
    }

    let rawBody: unknown;
    try {
        rawBody = await req.json();
    } catch {
        return new NextResponse("Invalid JSON", { status: 400 });
    }

    const parsed = WhiteLabelSchema.safeParse(rawBody);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Validation failed", details: parsed.error.flatten() },
            { status: 422 }
        );
    }

    const data = parsed.data;

    if (data.webhookUrl && data.webhookUrl !== "") {
        const guard = isSafeUrl(data.webhookUrl);
        if (!guard.ok) {
            return NextResponse.json(
                { error: `Webhook URL rejected: ${guard.error}` },
                { status: 422 }
            );
        }
    }

    if (data.logoUrl && data.logoUrl !== "") {
        const guard = isSafeUrl(data.logoUrl);
        if (!guard.ok) {
            return NextResponse.json(
                { error: `Logo URL rejected: ${guard.error}` },
                { status: 422 }
            );
        }
    }

    try {
        await prisma.user.update({
            where: { id: user!.id },
            data: { whiteLabel: data as Record<string, string> },
        });

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        logger.error("[WhiteLabel] Save failed", {
            error: err instanceof Error ? err.message : String(err),
            userId: user!.id,
        });
        return new NextResponse("Internal Error", { status: 500 });
    }
}
