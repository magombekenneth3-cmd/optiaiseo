import { getAuthUser } from "@/lib/auth/get-auth-user";
// GET /api/notifications
// Returns real-time activity notifications for the authenticated user.
// Pulls from: recent audits, pending PRs, pending blogs, AEO reports.
// Redis read-through cache (60 s TTL) — keyed by user email.
// Cache is busted by Inngest save-report/save-blog steps via redis.del().

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { redis, isRedisConfigured } from "@/lib/redis"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"

const CACHE_TTL_S = 60
const HTTP_MAX_AGE = 30
const PRIVATE_CACHE = `private, max-age=${HTTP_MAX_AGE}`

export async function GET() {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        return NextResponse.json({ notifications: [] }, { status: 401 })
    }

    const email = session!.user!.email!
    const cacheKey = `notif:${email}`

    if (isRedisConfigured) {
        try {
            const hit = await redis.get<string>(cacheKey)
            if (hit) {
                return NextResponse.json(
                    { notifications: JSON.parse(hit) },
                    { headers: { "Cache-Control": PRIVATE_CACHE, "X-Cache": "HIT" } }
                )
            }
        } catch (err: unknown) {
            logger.warn("[Notifications] Redis read failed — falling through to DB", {
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }

    // ── DB queries ──────────────────────────────────────────────────────────────
    const dbUser = await prisma.user.findUnique({
        where: { email },
        include: { sites: { select: { id: true, domain: true } } },
    })

    if (!dbUser) return NextResponse.json({ notifications: [] })

    const siteIds: string[] = dbUser.sites.map((s) => s.id)
    const notifications: Array<{
        id: string
        type: "info" | "success" | "warning"
        title: string
        body: string
        href?: string
        createdAt: string
    }> = []

    if (siteIds.length > 0) {
        // Recent completed audits (last 48h)
        const recentAudits = await prisma.audit.findMany({
            where: {
                siteId: { in: siteIds },
                runTimestamp: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
            },
            orderBy: { runTimestamp: "desc" },
            take: 3,
            include: { site: { select: { domain: true } } },
        })

        for (const audit of recentAudits) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const issueList = audit.issueList as any
            const issueCount = Array.isArray(issueList)
                ? issueList.length
                : Array.isArray(issueList?.recommendations)
                    ? issueList.recommendations.length
                    : 0
            notifications.push({
                id: `audit-${audit.id}`,
                type: issueCount > 10 ? "warning" : "success",
                title: `Audit complete — ${audit.site.domain}`,
                body: issueCount > 0
                    ? `Found ${issueCount} issue${issueCount !== 1 ? "s" : ""} to review.`
                    : "No critical issues found. Site is healthy.",
                href: `/dashboard/audits/${audit.id}`,
                createdAt: audit.runTimestamp.toISOString(),
            })
        }

        // Pending blog posts awaiting review
        const pendingBlogs = await prisma.blog.findMany({
            where: {
                siteId: { in: siteIds },
                status: { in: ["DRAFT", "PENDING_APPROVAL"] },
            },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true, title: true, createdAt: true },
        })

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
            })
        }
    }

    // New user welcome (no sites yet)
    if (siteIds.length === 0) {
        notifications.push({
            id: "welcome",
            type: "info",
            title: "Welcome to OptiAISEO",
            body: "Add your first site and run an audit to get started.",
            href: "/dashboard/sites/new",
            createdAt: new Date().toISOString(),
        })
    }

    // Sort by most recent first
    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const result = notifications.slice(0, 10)

    if (isRedisConfigured) {
        try {
            await redis.set(cacheKey, JSON.stringify(result), { ex: CACHE_TTL_S })
        } catch (err: unknown) {
            logger.warn("[Notifications] Redis write failed — response served without caching", {
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }

    return NextResponse.json(
        { notifications: result },
        { headers: { "Cache-Control": PRIVATE_CACHE, "X-Cache": "MISS" } }
    )
}
