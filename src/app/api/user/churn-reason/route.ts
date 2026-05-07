/**
 * POST /api/user/churn-reason
 * ─────────────────────────────────────────────────────────────────────────────
 * Records the reason a user gave before downgrading. Stored on the User record
 * as a JSON preference key so it can be used for product analytics and targeted
 * win-back campaigns without a schema migration.
 *
 * Authenticated via JWT (same pattern as all other dashboard API routes).
 * Fire-and-forget from the client — failure is silently ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";

const VALID_REASONS = [
    "too_expensive",
    "no_results",
    "missing_feature",
    "using_competitor",
    "need_break",
] as const;

type ValidReason = typeof VALID_REASONS[number];

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    let body: unknown;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const reason = (body as { reason?: unknown }).reason;
    if (!reason || !VALID_REASONS.includes(reason as ValidReason)) {
        return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }

    try {
        // Store as a preference key — no schema migration needed
        const existing = await prisma.user.findUnique({
            where: { id: user.id },
            select: { preferences: true },
        });

        const prefs = (existing?.preferences as Record<string, unknown>) ?? {};
        prefs.churnReason = reason;
        prefs.churnReasonAt = new Date().toISOString();

        await prisma.user.update({
            where: { id: user.id },
            data: { preferences: prefs as Record<string, unknown> & object },
        });

        return NextResponse.json({ ok: true });
    } catch {
        // Non-critical — don't fail the downgrade flow
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
