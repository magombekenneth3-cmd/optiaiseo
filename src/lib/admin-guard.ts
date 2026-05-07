/**
 * Admin guard — server-side only.
 * Access is determined exclusively by the SUPER_ADMIN database role.
 * No email-based fallbacks — role revocation via the database is the
 * single source of truth.
 *
 * To bootstrap the first admin, run:
 *   pnpm tsx scripts/bootstrap-admin.ts your@email.com
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse, NextRequest } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit/monthly";

function getClientIp(): Promise<string> {
    return headers().then((h) => {
        const fwd = h.get("x-forwarded-for");
        return fwd ? fwd.split(",")[0].trim() : "unknown";
    });
}

/** Returns the admin user or a 401/403/429 NextResponse (for API routes). */
export async function requireAdminApi(
    req?: NextRequest
): Promise<{ userId: string; email: string } | NextResponse> {
    // ── Rate limit: 30 req/min per IP ─────────────────────────────────────────
    try {
        const ip = req
            ? (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim()
            : await getClientIp();

        const rl = await checkRateLimit(`admin-api:${ip}`, 30, 60);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Too many requests. Slow down." },
                {
                    status: 429,
                    headers: {
                        "Retry-After":       "60",
                        "X-RateLimit-Reset": rl.resetAt.toISOString(),
                    },
                }
            );
        }
    } catch {
        return NextResponse.json(
            { error: "Rate limit service unavailable. Try again shortly." },
            { status: 503 }
        );
    }

    // ── Auth check ────────────────────────────────────────────────────────────
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Role check — read from session (JWT-sourced, same trust level as middleware) ────
    // role is set in the session callback from token.role — no DB round-trip needed.
    if ((session.user as { role?: string }).role !== "SUPER_ADMIN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return { userId: (session.user as { id?: string }).id ?? "", email: session.user.email! };
}

/** Returns true if current session is a SUPER_ADMIN (for page-level checks). */
export async function isAdminSession(): Promise<boolean> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return false;

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { role: true },
    });

    return user?.role === "SUPER_ADMIN";
}

/**
 * Grants SUPER_ADMIN role to the specified email (idempotent).
 * Called by scripts/bootstrap-admin.ts — not for use in request handlers.
 */
export async function ensureAdminRole(email: string): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "User" SET role = 'SUPER_ADMIN'::"Role"
        WHERE email = ${email}
    `;
}
