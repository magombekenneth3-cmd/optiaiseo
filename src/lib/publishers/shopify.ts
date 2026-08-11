import { logger } from "@/lib/logger";
import { isSafeUrl } from "@/lib/security/safe-url";

export interface ShopifyConfig {
    shopDomain: string;
    accessToken: string;
    blogId: string;
}

export interface PublishableBlog {
    id: string;
    title: string;
    content: string;
    slug: string;
    metaDescription: string | null;
    targetKeywords: string[];
}

export async function publishToShopify(blog: PublishableBlog, config: ShopifyConfig): Promise<{ articleId: string; url: string }> {
    const shopUrl = `https://${config.shopDomain.replace(/^https?:\/\//, "")}`;
    const urlCheck = isSafeUrl(shopUrl);
    if (!urlCheck.ok) {
        throw new Error(`Shopify publish blocked: unsafe domain — ${urlCheck.error}`);
    }

    const endpoint = `${shopUrl}/admin/api/2024-01/blogs/${config.blogId}/articles.json`;

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            "X-Shopify-Access-Token": config.accessToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            article: {
                title: blog.title,
                body_html: blog.content,
                handle: blog.slug,
                summary_html: blog.metaDescription || "",
                tags: blog.targetKeywords.join(", "),
                published: true,
            },
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        throw new Error(`Shopify publish failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const article = data.article;
    const articleUrl = `${shopUrl}/blogs/news/${article.handle}`;

    logger.info("[Publishers/Shopify] Article created successfully", { blogId: blog.id, articleId: article.id });
    return { articleId: String(article.id), url: articleUrl };
}
