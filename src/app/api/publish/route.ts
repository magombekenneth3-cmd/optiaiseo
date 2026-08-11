import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dispatchMultiCmsPublish, CmsPlatform } from "@/lib/publishers";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { blogId, platform, config } = body as {
            blogId: string;
            platform: CmsPlatform;
            config: Record<string, unknown>;
        };

        if (!blogId || !platform) {
            return NextResponse.json({ error: "Missing blogId or platform" }, { status: 400 });
        }

        const blog = await prisma.blog.findUnique({
            where: { id: blogId },
        });

        if (!blog) {
            return NextResponse.json({ error: "Blog post not found" }, { status: 404 });
        }

        const sitePlatformConfig = {
            platform,
            wordPressConfig: platform === "WORDPRESS" ? config : undefined,
            ghostConfig: platform === "GHOST" ? config : undefined,
            shopifyConfig: platform === "SHOPIFY" ? (config as any) : undefined,
            webflowConfig: platform === "WEBFLOW" ? (config as any) : undefined,
            framerConfig: platform === "FRAMER" ? (config as any) : undefined,
            nextJsConfig: platform === "NEXTJS" ? (config as any) : undefined,
            wixConfig: platform === "WIX" ? (config as any) : undefined,
        };

        const result = await dispatchMultiCmsPublish(
            {
                id: blog.id,
                title: blog.title,
                content: blog.content,
                slug: blog.slug,
                metaDescription: blog.metaDescription,
                targetKeywords: blog.targetKeywords || [],
            },
            sitePlatformConfig
        );

        return NextResponse.json({
            success: true,
            platform: result.platform,
            publishedUrl: result.publishedUrl,
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "Multi-CMS publishing failed";
        return NextResponse.json({ error }, { status: 500 });
    }
}
