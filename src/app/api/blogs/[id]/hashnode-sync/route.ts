export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { syndicateToHashnode } from "@/lib/blog/hashnode";

const HASHNODE_GQL = "https://gql.hashnode.com/";

const ME_QUERY = `
  query {
    me {
      publications(first: 1) {
        edges {
          node { id }
        }
      }
    }
  }
`;

async function resolvePublicationId(token: string): Promise<string | null> {
    try {
        const res = await fetch(HASHNODE_GQL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify({ query: ME_QUERY }),
        });
        const json = await res.json();
        const id: string | undefined =
            json.data?.me?.publications?.edges?.[0]?.node?.id;
        return id ?? null;
    } catch {
        return null;
    }
}

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
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        return NextResponse.json({ error: "Blog not found or unauthorized" }, { status: 404 });
    }

    const hashnodeToken = blog.site.hashnodeToken || process.env.HASHNODE_TOKEN;
    if (!hashnodeToken) {
        return NextResponse.json(
            { error: "No Hashnode token configured. Add HASHNODE_TOKEN to your environment or set it in Site Settings." },
            { status: 400 }
        );
    }

    const publicationId =
        blog.site.hashnodePublicationId ||
        (await resolvePublicationId(hashnodeToken)) ||
        process.env.HASHNODE_PUBLICATION_ID;

    if (!publicationId) {
        return NextResponse.json(
            { error: "Could not resolve Hashnode publication ID. Check your token has access to a publication." },
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
            draft: {
                title: blog.title,
                slug: blog.slug,
                content: contentMarkdown,
                contentMarkdown: contentMarkdown,
                excerpt: blog.metaDescription || `An expert guide to ${blog.title}`,
                metaDescription: blog.metaDescription || "",
                targetKeywords: blog.targetKeywords as string[],
                validationErrors: [],
                validationWarnings: [],
                validationScore: 100,
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
