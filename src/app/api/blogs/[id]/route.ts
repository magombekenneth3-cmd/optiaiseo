export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { sanitizeHtml } from "@/lib/sanitize-html";

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const user = await getAuthUser(req as import('next/server').NextRequest);
        if (!user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const dbUser = await prisma.user.findUnique({ where: { email: user!.email } });
        if (!dbUser) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const blog = await prisma.blog.findUnique({
            where: { id },
            include: { site: true },
        });

        if (!blog) {
            return NextResponse.json({ error: "Blog not found" }, { status: 404 });
        }

        if (blog.site.userId !== user!.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await req.json();
        const { content } = body as { content?: string };

        if (typeof content !== "string" || content.length === 0) {
            return NextResponse.json({ error: "content is required" }, { status: 400 });
        }

        if (content.length > 500_000) {
            return NextResponse.json({ error: "content too large" }, { status: 400 });
        }

        const safeContent = sanitizeHtml(content);

        await prisma.blog.update({
            where: { id },
            data: { content: safeContent, updatedAt: new Date() },
        });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        logger.error("[PATCH /api/blogs/[id]] Error:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Failed to save edits" }, { status: 500 });
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
        const user = await getAuthUser(req as import('next/server').NextRequest);
    try {
        const { id } = await params;

                if (!user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const dbUser = await prisma.user.findUnique({ where: { email: user!.email } });
        if (!dbUser) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const blog = await prisma.blog.findUnique({
            where: { id },
            include: { site: true },
        });

        if (!blog) {
            return NextResponse.json({ error: "Blog not found" }, { status: 404 });
        }

        if (blog.site.userId !== user!.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        await prisma.blog.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        logger.error("[DELETE /api/blogs/[id]] Error:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Failed to delete blog" }, { status: 500 });
    }
}
