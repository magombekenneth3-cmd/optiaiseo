import { logger } from "@/lib/logger";
import { PublishableBlog } from "./shopify";

export interface NextJsConfig {
    apiEndpoint: string;
    secretToken: string;
}

export async function publishToNextJs(blog: PublishableBlog, config: NextJsConfig): Promise<{ status: string; path: string }> {
    const res = await fetch(config.apiEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-optiaiseo-secret": config.secretToken,
        },
        body: JSON.stringify({
            action: "UPSERT_PAGE",
            slug: blog.slug,
            metadata: {
                title: blog.title,
                description: blog.metaDescription,
                keywords: blog.targetKeywords,
            },
            contentHtml: blog.content,
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        throw new Error(`Next.js publish webhook failed: ${res.status} ${await res.text()}`);
    }

    logger.info("[Publishers/NextJS] Page synced to Next.js route", { blogId: blog.id, slug: blog.slug });
    return { status: "success", path: `/blog/${blog.slug}` };
}
