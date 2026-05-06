// GET  /api/credits         — return current credit balance
// POST /api/credits/consume  — consume credits for an action (server-to-server)
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { consumeCredits, CREDIT_COSTS, type CreditAction } from "@/lib/credits";
import { rateLimit } from "@/lib/rate-limit/check";

// FIX #4: explicit allowlist — don't trust client to send valid actions
const ALLOWED_ACTIONS: CreditAction[] = Object.keys(CREDIT_COSTS) as CreditAction[];

export async function GET(req: import("next/server").NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await prisma.user.findUnique({
        where: { id: user!.id },
        select: { credits: true, subscriptionTier: true },
    });

    return NextResponse.json({
        credits: dbUser?.credits ?? 0,
        tier: dbUser?.subscriptionTier ?? user!.subscriptionTier,
    });
}

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // FIX #3: rate limit — prevent credit drain via spam
    const limited = await rateLimit("creditsConsume", user!.id);
    if (limited) {
        const body = await limited.json();
        return NextResponse.json(
            { error: body.error ?? "Too many requests." },
            { status: 429 },
        );
    }

    // FIX #5: guard against malformed / oversized bodies
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { action, multiplier: rawMultiplier } = body as Record<string, unknown>;

    // FIX #4: validate action against explicit allowlist
    if (typeof action !== "string" || !ALLOWED_ACTIONS.includes(action as CreditAction)) {
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // FIX #1: clamp and validate multiplier — prevent negative/zero/huge values
    const multiplierNum = Number(rawMultiplier ?? 1);
    if (!Number.isFinite(multiplierNum) || multiplierNum <= 0 || multiplierNum > 100) {
        return NextResponse.json({ error: "Invalid multiplier" }, { status: 400 });
    }
    const multiplier = Math.floor(multiplierNum);

    const result = await consumeCredits(user!.id, action as CreditAction, multiplier);

    if (!result.allowed) {
        // FIX #7: 429 is more appropriate than 402 for quota exhaustion
        return NextResponse.json(
            {
                allowed: false,
                remaining: result.remaining,
                cost: result.cost,
                reason: result.reason,
            },
            { status: 429 },
        );
    }

    return NextResponse.json({ allowed: true, remaining: result.remaining, cost: result.cost });
}
