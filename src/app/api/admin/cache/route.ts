export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { getCacheStats, bustDomainCache } from "@/lib/aeo/response-cache";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin-guard";


// ── GET /api/admin/cache ──────────────────────────────────────────────────────
// Critical fix: GET had NO admin check — any authenticated user could read AEO
// cache stats. Now gated behind requireAdminApi() (SUPER_ADMIN only).

export async function GET(req: NextRequest) {
    void req;
    const guard = await requireAdminApi();
    if (guard instanceof NextResponse) return guard;


    try {
        const stats = await getCacheStats();
        return NextResponse.json(stats);
    } catch (err: unknown) {
        logger.error("[CacheAPI] Stats failed", { error: (err as Error)?.message });
        return NextResponse.json({ error: "Failed to fetch cache stats" }, { status: 500 });
    }
}

// ── DELETE /api/admin/cache ───────────────────────────────────────────────────
// Domain-scoped bust is allowed for any authenticated user (their own domain).
// Full cache flush is admin-only — now uses requireAdminApi() instead of the
// ad-hoc isAdmin() helper that checked the incorrect "AGENCY_ADMIN" role.

export async function DELETE(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const domain = req.nextUrl.searchParams.get("domain");

    if (domain) {
        // Domain-scoped bust — allowed for any authenticated owner of that site
        const site = await prisma.site.findFirst({
            where: { domain, user: { email: user.email } },
            select: { id: true, coreServices: true },
        });
        if (!site) {
            return NextResponse.json(
                { error: "Domain not found or not owned by you" },
                { status: 404 }
            );
        }
        await bustDomainCache(domain, site.coreServices);
        return NextResponse.json({ success: true, busted: domain });
    }

    // Global flush — SUPER_ADMIN only
    const guard2 = await requireAdminApi();
    if (guard2 instanceof NextResponse) return guard2;


    logger.info("[CacheAPI] Admin cache clear requested", { admin: user.email });
    return NextResponse.json({
        success: true,
        note: "Use domain-specific busting for targeted clears. Full flush requires Upstash console.",
    });
}
