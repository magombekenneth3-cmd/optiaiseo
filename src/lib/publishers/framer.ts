import { logger } from "@/lib/logger";
import { PublishableBlog } from "./shopify";

export interface FramerConfig {
    webhookUrl: string;
    apiKey?: string;
}

export async function publishToFramer(blog: PublishableBlog, config: FramerConfig): Promise<{ status: string; payload: Record<string, unknown> }> {
    const payload = {
        title: blog.title,
        slug: blog.slug,
        content: blog.content,
        metaDescription: blog.metaDescription,
        keywords: blog.targetKeywords,
        publishedAt: new Date().toISOString(),
    };

    const res = await fetch(config.webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        throw new Error(`Framer publish failed: ${res.status} ${await res.text()}`);
    }

    logger.info("[Publishers/Framer] Sync completed", { blogId: blog.id });
    return { status: "success", payload };
}
