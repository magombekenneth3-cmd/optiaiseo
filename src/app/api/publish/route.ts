import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { dispatchMultiCmsPublish } from "@/lib/publishers";
import { CMS_PLATFORMS, resolveStoredConnection } from "@/lib/publishers/stored-connection";
import { MutationBlockedError } from "@/lib/mutations";

/**
 * Legacy multi-CMS publish endpoint.
 *
 * Security contract:
 *   1. The caller must be authenticated (401 otherwise).
 *   2. The blog lookup is scoped to sites owned by the caller — a foreign or
 *      nonexistent blogId yields the same 404, so ownership cannot be probed
 *      or bypassed by choosing a different id.
 *   3. Destination credentials are NEVER taken from the request body. They are
 *      loaded from the site's persisted, owner-managed connection
 *      (`/api/sites/[siteId]/cms-config`). Platforms without persisted
 *      connection storage are rejected with 422.
 *   4. `siteId` is always passed to the dispatcher so the per-site CMS kill
 *      switch is enforced.
 */

const PublishRequestSchema = z.object({
    blogId: z.string().trim().min(1).max(64),
    platform: z.enum(CMS_PLATFORMS),
    // Client-supplied destination config is no longer accepted (see contract #3).
    config: z
        .undefined({ error: "Client-supplied CMS config is not accepted; configure the connection in site settings." })
        .optional(),
});

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    let raw: unknown;
    try {
        raw = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = PublishRequestSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            {
                error: "Invalid request",
                issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
            },
            { status: 400 },
        );
    }
    const { blogId, platform } = parsed.data;

    const blog = await prisma.blog.findFirst({
        where: {
            id: blogId,
            site: { userId },
        },
        include: {
            site: { select: { id: true, wordPressConfig: true, ghostConfig: true } },
        },
    });

    if (!blog) {
        return NextResponse.json({ error: "Blog not found or unauthorized" }, { status: 404 });
    }

    const connection = resolveStoredConnection(platform, blog.site);
    if (!connection.ok) {
        return NextResponse.json({ error: connection.error, code: connection.reason }, { status: 422 });
    }

    try {
        const result = await dispatchMultiCmsPublish(
            {
                id: blog.id,
                title: blog.title,
                content: blog.content,
                slug: blog.slug,
                metaDescription: blog.metaDescription,
                targetKeywords: blog.targetKeywords || [],
            },
            connection.config,
        );

        return NextResponse.json({
            success: true,
            platform: result.platform,
            publishedUrl: result.publishedUrl,
        });
    } catch (err: unknown) {
        if (err instanceof MutationBlockedError) {
            return NextResponse.json({ error: "CMS publishing is paused for this site." }, { status: 409 });
        }
        const correlationId = crypto.randomUUID();
        logger.error("[api/publish] Multi-CMS publish failed", {
            correlationId,
            blogId: blog.id,
            siteId: blog.site.id,
            platform,
            error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: "Multi-CMS publishing failed", correlationId }, { status: 502 });
    }
}
