import { getAuthUser } from "@/lib/auth/get-auth-user";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redis, isRedisConfigured } from "@/lib/redis";
import { logger } from "@/lib/logger";
import "@/lib/server-only";

export const dynamic = "force-dynamic";

const CACHE_TTL_S = 60;
const HTTP_MAX_AGE = 30;
const PRIVATE_CACHE = `private, max-age=${HTTP_MAX_AGE}`;

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 401 });
    }

    const email = session!.user!.email!;
    const cacheKey = `notif:${email}`;

    if (isRedisConfigured) {
        try {
            const hit = await redis.get<string>(cacheKey);
            if (hit) {
                const parsed = JSON.parse(hit);
                return NextResponse.json(
                    parsed,
                    { headers: { "Cache-Control": PRIVATE_CACHE, "X-Cache": "HIT" } }
                );
            }
        } catch (err: unknown) {
            logger.warn("[Notifications] Redis read failed — falling through to DB", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const dbUser = await prisma.user.findUnique({
        where: { email },
        include: { sites: { select: { id: true, domain: true } } },
    });

    if (!dbUser) return NextResponse.json({ notifications: [], unreadCount: 0 });

    const siteIds: string[] = dbUser.sites.map((s) => s.id);
    const notifications: Array<{
        id: string;
        type: string;
        title: string;
        body: string;
        href?: string;
        read?: boolean;
        createdAt: string;
    }> = [];

    const persistedNotifs = await prisma.notification.findMany({
        where: { userId: dbUser.id, dismissed: false },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, type: true, title: true, body: true, href: true, read: true, createdAt: true },
    });

    for (const n of persistedNotifs) {
        notifications.push({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            href: n.href ?? undefined,
            read: n.read,
            createdAt: n.createdAt.toISOString(),
        });
    }

    if (siteIds.length > 0) {
        const recentAudits = await prisma.audit.findMany({
            where: {
                siteId: { in: siteIds },
                runTimestamp: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
            },
            orderBy: { runTimestamp: "desc" },
            take: 3,
            include: { site: { select: { domain: true } } },
        });

        for (const audit of recentAudits) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const issueList = audit.issueList as any;
            const issueCount = Array.isArray(issueList)
                ? issueList.length
                : Array.isArray(issueList?.recommendations)
                    ? issueList.recommendations.length
                    : 0;
            notifications.push({
                id: `audit-${audit.id}`,
                type: issueCount > 10 ? "warning" : "success",
                title: `Audit complete — ${audit.site.domain}`,
                body: issueCount > 0
                    ? `Found ${issueCount} issue${issueCount !== 1 ? "s" : ""} to review.`
                    : "No critical issues found. Site is healthy.",
                href: `/dashboard/audits/${audit.id}`,
                createdAt: audit.runTimestamp.toISOString(),
            });
        }

        const pendingBlogs = await prisma.blog.findMany({
            where: {
                siteId: { in: siteIds },
                status: { in: ["DRAFT", "PENDING_APPROVAL"] },
            },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true, title: true, createdAt: true },
        });

        if (pendingBlogs.length > 0) {
            notifications.push({
                id: `blogs-pending-${pendingBlogs[0].id}`,
                type: "info",
                title: `${pendingBlogs.length} post${pendingBlogs.length !== 1 ? "s" : ""} awaiting review`,
                body: pendingBlogs.length === 1
                    ? `"${pendingBlogs[0].title}" is ready to publish.`
                    : `Latest: "${pendingBlogs[0].title}"`,
                href: `/dashboard/blogs?review=${pendingBlogs[0].id}`,
                createdAt: pendingBlogs[0].createdAt.toISOString(),
            });
        }
    }

    if (siteIds.length === 0 && persistedNotifs.length === 0) {
        notifications.push({
            id: "welcome",
            type: "info",
            title: "Welcome to OptiAISEO",
            body: "Add your first site and run an audit to get started.",
            href: "/dashboard/sites/new",
            createdAt: new Date().toISOString(),
        });
    }

    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const result = notifications.slice(0, 15);
    const unreadCount = result.filter(n => !n.read && !n.id.startsWith("audit-") && !n.id.startsWith("blogs-") && n.id !== "welcome").length;

    const payload = { notifications: result, unreadCount };

    if (isRedisConfigured) {
        try {
            await redis.set(cacheKey, JSON.stringify(payload), { ex: CACHE_TTL_S });
        } catch (err: unknown) {
            logger.warn("[Notifications] Redis write failed — response served without caching", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return NextResponse.json(
        payload,
        { headers: { "Cache-Control": PRIVATE_CACHE, "X-Cache": "MISS" } }
    );
}

export async function PATCH(req: Request) {
    const user = await getAuthUser(req as import("next/server").NextRequest);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, id } = body as { action: string; id?: string };

    if (action === "read-all") {
        await prisma.notification.updateMany({
            where: { userId: user.id, read: false },
            data: { read: true },
        });
        if (isRedisConfigured) {
            try { await redis.del(`notif:${user.email}`); } catch { /* non-fatal */ }
        }
        return NextResponse.json({ ok: true });
    }

    if (action === "dismiss" && id) {
        await prisma.notification.updateMany({
            where: { id, userId: user.id },
            data: { dismissed: true },
        });
        if (isRedisConfigured) {
            try { await redis.del(`notif:${user.email}`); } catch { /* non-fatal */ }
        }
        return NextResponse.json({ ok: true });
    }

    if (action === "read" && id) {
        await prisma.notification.updateMany({
            where: { id, userId: user.id },
            data: { read: true },
        });
        if (isRedisConfigured) {
            try { await redis.del(`notif:${user.email}`); } catch { /* non-fatal */ }
        }
        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
