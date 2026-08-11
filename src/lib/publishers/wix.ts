import { logger } from "@/lib/logger";
import { PublishableBlog } from "./shopify";

export interface WixConfig {
    siteId: string;
    apiKey: string;
}

export async function publishToWix(blog: PublishableBlog, config: WixConfig): Promise<{ postId: string; url: string }> {
    const endpoint = `https://www.wixapis.com/blog/v3/posts`;

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: config.apiKey,
            "wix-site-id": config.siteId,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            post: {
                title: blog.title,
                slug: blog.slug,
                richContent: {
                    nodes: [
                        {
                            type: "PARAGRAPH",
                            nodes: [
                                {
                                    type: "TEXT",
                                    textData: {
                                        text: blog.content,
                                    },
                                },
                            ],
                        },
                    ],
                },
                excerpt: blog.metaDescription || "",
                seoData: {
                    tags: [
                        {
                            type: "title",
                            children: blog.title,
                        },
                        {
                            type: "meta",
                            props: {
                                name: "description",
                                content: blog.metaDescription || "",
                            },
                        },
                    ],
                },
            },
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        throw new Error(`Wix publish failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    logger.info("[Publishers/Wix] Post created successfully", { blogId: blog.id, postId: data.post?.id });
    return { postId: data.post?.id || "", url: data.post?.url || "" };
}
