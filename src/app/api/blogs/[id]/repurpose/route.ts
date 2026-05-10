export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { repurposeBlog, type RepurposeFormat } from "@/lib/blog/repurpose";

const ALL_FORMATS: RepurposeFormat[] = ["linkedin", "thread", "youtube", "reddit", "podcast"];

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser(req);
        if (!user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        const limited = await rateLimit("blogRepurpose", `blog:${id}`);
        if (limited) return limited;

        const body = await req.json().catch(() => ({}));
        const { formats = ALL_FORMATS } = body as { formats?: RepurposeFormat[] };

        const validFormats = formats.filter((f): f is RepurposeFormat =>
            ALL_FORMATS.includes(f)
        );
        if (validFormats.length === 0) {
            return NextResponse.json(
                { error: "No valid formats requested" },
                { status: 400 }
            );
        }

        const dbUser = await prisma.user.findUnique({
            where: { email: user!.email },
        });
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const blog = await prisma.blog.findFirst({
            where: { id, site: { userId: user!.id } },
            include: { site: true },
        });
        if (!blog) {
            return NextResponse.json({ error: "Blog not found" }, { status: 404 });
        }

        logger.info("[Repurpose] Starting", {
            blogId: id,
            formats: validFormats,
            domain: blog.site.domain,
        });

        const result = await repurposeBlog(blog, validFormats);

        const succeeded = validFormats.filter((f) => !result.errors[f]);
        const failed = validFormats.filter((f) => !!result.errors[f]);

        logger.info("[Repurpose] Completed", {
            blogId: id,
            succeeded: succeeded.length,
            failed: failed.length,
        });

        return NextResponse.json({
            success: true,
            ...result,
            meta: {
                requested: validFormats,
                succeeded,
                failed,
                failedReasons: result.errors,
            },
        });
    } catch (err: unknown) {
        logger.error("[Repurpose] Unhandled error", {
            error: (err as Error)?.message ?? String(err),
        });
        return NextResponse.json(
            { error: (err as Error)?.message ?? "Repurpose failed" },
            { status: 500 }
        );
    }
}
