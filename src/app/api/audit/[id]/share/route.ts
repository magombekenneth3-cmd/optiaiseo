export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { limiters } from "@/lib/rate-limit";
import { randomBytes } from "crypto";

const SHARE_TTL_DAYS = 30;

function ipFrom(req: NextRequest): string {
    return (
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        "unknown"
    );
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: auditId } = await params;

    const rl = await limiters.shareCreate.limit(user!.email);
    if (!rl.success) {
        return NextResponse.json(
            { error: "Too many share requests. Try again later." },
            {
                status: 429,
                headers: { "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)) },
            }
        );
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: user!.email },
        select: { id: true },
    });
    if (!dbUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const audit = await prisma.audit.findFirst({
        where: { id: auditId, site: { userId: dbUser.id } },
        select: { id: true },
    });
    if (!audit) {
        return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    const existing = await prisma.auditShare.findFirst({
        where: { auditId, expiresAt: { gt: new Date() } },
        select: { token: true, expiresAt: true },
    });
    if (existing) {
        return NextResponse.json({ token: existing.token, expiresAt: existing.expiresAt });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86_400_000);

    const share = await prisma.auditShare.create({
        data: { token, auditId, expiresAt },
        select: { token: true, expiresAt: true },
    });

    return NextResponse.json({ token: share.token, expiresAt: share.expiresAt });
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: auditId } = await params;

    const ip = ipFrom(req);
    const rl = await limiters.api.limit(`${user.email}:${ip}`);
    if (!rl.success) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const dbUser2 = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true },
    });
    if (!dbUser2) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const audit = await prisma.audit.findFirst({
        where: { id: auditId, site: { userId: dbUser2.id } },
        select: { id: true },
    });
    if (!audit) {
        return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    await prisma.auditShare.deleteMany({ where: { auditId } });

    return NextResponse.json({ success: true });
}
