export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { revalidateAndPersistBlog } from "@/lib/blog/revalidate-post";

/**
 * Re-runs deterministic quality, citation, evidence, and publication gates
 * on the persisted blog post content and returns the refreshed state snapshot.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    try {
        const user = await getAuthUser(req);
        if (!user?.id || !user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const ownedBlog = await prisma.blog.findFirst({
            where: { id, site: { userId: user.id } },
            select: { id: true },
        });

        if (!ownedBlog) {
            return NextResponse.json({ error: "Blog not found or unauthorized" }, { status: 404 });
        }

        const updatedBlog = await revalidateAndPersistBlog({ blogId: ownedBlog.id });
        if (!updatedBlog) {
            return NextResponse.json({ error: "Blog not found" }, { status: 404 });
        }

        revalidatePath("/dashboard/blogs");

        return NextResponse.json({ success: true, blog: updatedBlog });
    } catch (error) {
        logger.error("[Blog/Revalidate] Failed to revalidate blog post", {
            blogId: id,
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
            { error: "Failed to revalidate blog post" },
            { status: 500 },
        );
    }
}

