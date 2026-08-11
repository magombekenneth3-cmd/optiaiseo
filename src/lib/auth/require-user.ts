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
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";


export type ActionError = { success: false; error: string; code: string };


type AuthOk = { ok: true; user: User };
type AuthFail = { ok: false; error: ActionError };
type AuthResult = AuthOk | AuthFail;


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


export type PermissionLevel = "VIEW" | "EDIT" | "MANAGE";

/**
 * assertSiteAccess(siteId, userId, permission)
 *
 * Enforces role-based permissions across Site resources:
 * - MANAGE: Delete site, change API keys/tokens, billing settings (Owner, Team ADMIN, Super Admin)
 * - EDIT:   Generate blogs, run audits, trigger auto-fixes (Owner, Team ADMIN/EDITOR, Super Admin)
 * - VIEW:   Read reports, view dashboard metrics (Owner, Team Member, Shared Viewer, Super Admin)
 */
export async function assertSiteAccess(
    siteId: string,
    userId: string,
    permission: PermissionLevel = "VIEW"
) {
    if (!siteId || siteId.length > 50) return null;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
    });

    if (user?.role === "SUPER_ADMIN") {
        return prisma.site.findUnique({ where: { id: siteId } });
    }

    const site = await prisma.site.findUnique({
        where: { id: siteId },
        include: {
            user: {
                include: {
                    ownedTeamMembers: { where: { userId } }
                }
            }
        }
    });

    if (!site) return null;

    const isOwner = site.userId === userId;
    const isViewer = site.viewerId === userId;
    const teamMember = site.user?.ownedTeamMembers?.[0];
    const teamRole = teamMember?.role ?? null; // "ADMIN", "EDITOR", "VIEWER"

    if (permission === "MANAGE") {
        if (isOwner || teamRole === "ADMIN") return site;
        return null;
    }

    if (permission === "EDIT") {
        if (isOwner || teamRole === "ADMIN" || teamRole === "EDITOR") return site;
        return null;
    }

    if (permission === "VIEW") {
        if (isOwner || isViewer || teamMember) return site;
        return null;
    }

    return null;
}

/**
 * assertSiteOwnership(siteId, userId)
 *
 * Backwards-compatible site ownership helper (requires MANAGE permission).
 */
export async function assertSiteOwnership(siteId: string, userId: string) {
    return assertSiteAccess(siteId, userId, "MANAGE");
}

