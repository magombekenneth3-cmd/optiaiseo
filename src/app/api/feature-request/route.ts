/**
 * POST /api/feature-request
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepts a plain-text feature request from the CancelRetentionModal.
 * Stores it in User.preferences under `featureRequests` (array of strings).
 * Also logs to the server console for immediate visibility.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    let body: unknown;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const request = ((body as { request?: unknown }).request as string | undefined)?.slice(0, 2000)?.trim();
    if (!request) return NextResponse.json({ error: "Empty request" }, { status: 400 });

    try {
        const existing = await prisma.user.findUnique({
            where: { id: user.id },
            select: { preferences: true, email: true },
        });

        const prefs = (existing?.preferences as Record<string, unknown>) ?? {};
        const existing_reqs = Array.isArray(prefs.featureRequests)
            ? (prefs.featureRequests as string[])
            : [];

        prefs.featureRequests = [
            { text: request, at: new Date().toISOString() },
            ...existing_reqs.slice(0, 9), // keep last 10
        ];

        await prisma.user.update({
            where: { id: user.id },
            data: { preferences: prefs as Record<string, unknown> & object },
        });

        // Log for immediate dev/ops visibility
        console.log(`[FeatureRequest] ${existing?.email ?? user.id}: ${request}`);

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
