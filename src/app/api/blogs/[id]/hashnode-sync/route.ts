export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { syndicateToHashnode } from "@/lib/blog/hashnode";

/**
 * POST /api/blogs/[id]/hashnode-sync
 * Re-syndicates an already-published blog to Hashnode.
 * Useful when a blog was published before HASHNODE_TOKEN was configured.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const user = await getAuthUser(req);
    if (!user?.id || !user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const blog = await prisma.blog.findFirst({
        where: { id, site: { userId: user!.id } },
        include: { site: true },
    });

    if (!blog) {
        return NextResponse.json({ error: "Blog not found or unauthorized" }, { status: 404 });
    }

    if (blog.status !== "PUBLISHED") {
        return NextResponse.json(
            { error: "Publish the article on your website before syndicating it to Hashnode." },
            { status: 409 }
        );
    }

    if (blog.hashnodeUrl) {
        return NextResponse.json({ success: true, hashnodeUrl: blog.hashnodeUrl, alreadySynced: true });
    }

    const hashnodeToken = blog.site.hashnodeToken;
    const publicationId = blog.site.hashnodePublicationId;
    if (!hashnodeToken || !publicationId) {
        return NextResponse.json(
            { error: "Connect Hashnode for this site by saving both a personal access token and publication ID in Site Settings." },
            { status: 400 }
        );
    }

    try {
        // Convert HTML → Markdown (strip <script> blocks first)
        const cleanedHtml = blog.content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
        const TurndownService = (await import("turndown")).default;
        const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
        const contentMarkdown = td.turndown(cleanedHtml);

        const result = await syndicateToHashnode({
            publicationId,
            token: hashnodeToken,
            canonicalUrl: `https://${blog.site.domain}/blog/${blog.slug}`,
            draft: {
                title: blog.title,
                content: contentMarkdown,
                excerpt: blog.metaDescription || `An expert guide to ${blog.title}`,
                metaDescription: blog.metaDescription || "",
                targetKeywords: blog.targetKeywords as string[],
            },
        });

        if (!result.success || !result.postUrl) {
            return NextResponse.json(
                { error: result.error || "Hashnode syndication failed" },
                { status: 502 }
            );
        }

        // Persist the Hashnode URL
        await prisma.blog.update({
            where: { id: blog.id },
            data: { hashnodeUrl: result.postUrl },
        });

        revalidatePath("/dashboard/blogs");

        return NextResponse.json({ success: true, hashnodeUrl: result.postUrl });
     
     
    } catch (err: unknown) {
        logger.error("[Hashnode Sync] Error:", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: (err as Error).message || "Internal error" }, { status: 500 });
    }
}
