/**
 * src/lib/auth/require-user.ts
 *
 * Single source of truth for server-action authentication.
 *
 * USAGE — replaces the repeated 4-line pattern in every action:
 *
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.error;      // already typed as ActionError
 *   const { user } = auth;               // fully typed User from Prisma
 *
 * The old pattern (kept working in parallel during migration):
 *   const session = await getServerSession(authOptions);
 *   if (!session?.user?.email) return { success: false, error: "Unauthorized" };
 *   const user = await prisma.user.findUnique({ where: { email: session.user.email } });
 *   if (!user) return { success: false, error: "User not found" };
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { User } from "@prisma/client";

// ── Shared action error shape ─────────────────────────────────────────────────

export type ActionError = { success: false; error: string; code: string };

// ── Success / failure discriminated union ─────────────────────────────────────

type AuthOk = { ok: true; user: User };
type AuthFail = { ok: false; error: ActionError };
type AuthResult = AuthOk | AuthFail;

// ── Core helper ───────────────────────────────────────────────────────────────

/**
 * requireUser()
 *
 * Validates the current session and returns the full Prisma User record.
 * Returns a typed failure object when the session is missing or the user
 * doesn't exist in the database — callers can early-return it directly.
 *
 * @example
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.error;
 *   const { user } = auth;
 */
export async function requireUser(): Promise<AuthResult> {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return {
            ok: false,
            error: { success: false, error: "Unauthorized", code: "unauthorized" },
        };
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
    });

    if (!user) {
        return {
            ok: false,
            error: { success: false, error: "User not found", code: "unauthorized" },
        };
    }

    return { ok: true, user };
}

// ── Site ownership assertion ──────────────────────────────────────────────────

/**
 * assertSiteOwnership(siteId, userId)
 *
 * Returns the site if the given user owns it, or null.
 * Centralised here so every action enforces the same length guard.
 */
export async function assertSiteOwnership(siteId: string, userId: string) {
    if (!siteId || siteId.length > 50) return null;
    return prisma.site.findFirst({ where: { id: siteId, userId } });
}
