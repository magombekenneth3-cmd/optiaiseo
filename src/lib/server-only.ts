/**
 * Server-only auth utilities.
 *
 * Provides a single `getAuthenticatedUser` helper used by all Server Actions
 * so they don't each re-implement the same session + DB lookup boilerplate.
 *
 * ⚠️  This file must NEVER be imported from client components — it has no
 *     "use client" boundary and calls `getServerSession` directly.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type DbUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

// ── Result types ──────────────────────────────────────────────────────────────

export type AuthOk = { ok: true; user: DbUser };
export type AuthFail = { ok: false; response: { success: false; error: string } };
export type AuthResult = AuthOk | AuthFail;

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Resolves the current session and fetches the matching User row.
 *
 * @example
 * ```ts
 * const auth = await getAuthenticatedUser();
 * if (!auth.ok) return auth.response;
 * const { user } = auth;
 * ```
 */
export async function getAuthenticatedUser(): Promise<AuthResult> {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return { ok: false, response: { success: false, error: "Unauthorized" } };
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
    });

    if (!user) {
        return { ok: false, response: { success: false, error: "User not found" } };
    }

    return { ok: true, user };
}
