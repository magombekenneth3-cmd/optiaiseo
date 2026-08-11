import { logger } from "@/lib/logger";
import { PublishableBlog } from "./shopify";

export interface WebflowConfig {
    apiToken: string;
    collectionId: string;
}

export async function publishToWebflow(blog: PublishableBlog, config: WebflowConfig): Promise<{ itemId: string; url: string }> {
    const endpoint = `https://api.webflow.com/v2/collections/${config.collectionId}/items`;

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.apiToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            isArchived: false,
            isDraft: false,
            fieldData: {
                name: blog.title,
                slug: blog.slug,
                "post-body": blog.content,
                "meta-description": blog.metaDescription || "",
            },
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        throw new Error(`Webflow publish failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    logger.info("[Publishers/Webflow] Item created successfully", { blogId: blog.id, itemId: data.id });
    return { itemId: data.id, url: `https://webflow.com/item/${data.id}` };
}
