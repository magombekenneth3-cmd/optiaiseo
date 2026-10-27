import { logger } from "@/lib/logger";
import { isSafeUrl } from "@/lib/security/safe-url";
import { prisma } from "@/lib/prisma";

interface WPConfig {
    wpUrl: string;
    wpUser: string;
    wpAppPassword: string;
}

interface Blog {
    id: string;
    title: string;
    content: string;
    slug: string;
    metaDescription: string | null;
    targetKeywords: string[];
}

export async function publishToWordPress(blog: Blog, site: { wordPressConfig: unknown }): Promise<void> {
    const { wpUrl, wpUser, wpAppPassword } = site.wordPressConfig as WPConfig;

    // SSRF guard: validate user-supplied WordPress URL before issuing outbound request
    const urlCheck = isSafeUrl(wpUrl);
    if (!urlCheck.ok) {
        throw new Error(`WordPress publish blocked: unsafe URL — ${urlCheck.error}`);
    }

    const auth = Buffer.from(`${wpUser}:${wpAppPassword}`).toString("base64");

    const res = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            title: blog.title,
            content: blog.content,
            slug: blog.slug,
            status: "publish",
            excerpt: blog.metaDescription ?? "",
            meta: {
                _yoast_wpseo_focuskw: blog.targetKeywords[0] ?? "",
            },
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
        throw new Error(`WordPress publish failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();

    await prisma.blog.update({
        where: { id: blog.id },
        data: { wordPressUrl: data.link, status: "PUBLISHED", publishedAt: new Date() },
    });

    logger.info("[Publishers/WordPress] Published blog", { blogId: blog.id, url: data.link });
}

export interface WordPressFixPayload {
    postId?: number;
    schemaMarkup?: string;
    title?: string;
    metaDescription?: string;
    focusKeyword?: string;
}

export async function applyWordPressSeoFix(
    payload: WordPressFixPayload,
    site: { wordPressConfig: unknown },
): Promise<{ success: boolean; postId?: number; error?: string }> {
    const config = site.wordPressConfig as WPConfig | null | undefined;
    if (!config?.wpUrl || !config.wpUser || !config.wpAppPassword) {
        return { success: false, error: "WordPress configuration incomplete." };
    }

    const urlCheck = isSafeUrl(config.wpUrl);
    if (!urlCheck.ok) {
        return { success: false, error: `WordPress fix blocked: unsafe URL — ${urlCheck.error}` };
    }

    const auth = Buffer.from(`${config.wpUser}:${config.wpAppPassword}`).toString("base64");
    const meta: Record<string, string> = {};

    if (payload.schemaMarkup) {
        meta._optiaiseo_injected_schema = payload.schemaMarkup;
    }
    if (payload.metaDescription) {
        meta._yoast_wpseo_metadesc = payload.metaDescription;
    }
    if (payload.title) {
        meta._yoast_wpseo_title = payload.title;
    }
    if (payload.focusKeyword) {
        meta._yoast_wpseo_focuskw = payload.focusKeyword;
    }

    try {
        let targetPostId = payload.postId;
        if (!targetPostId) {
            const listRes = await fetch(`${config.wpUrl}/wp-json/wp/v2/posts?per_page=1`, {
                headers: { Authorization: `Basic ${auth}` },
                signal: AbortSignal.timeout(15_000),
            });
            if (listRes.ok) {
                const list = (await listRes.json()) as Array<{ id: number }>;
                if (list.length > 0) {
                    targetPostId = list[0].id;
                }
            }
        }

        if (!targetPostId) {
            return { success: false, error: "No target post found to apply SEO fix." };
        }

        const res = await fetch(`${config.wpUrl}/wp-json/wp/v2/posts/${targetPostId}`, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ meta }),
            signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
            const errorText = await res.text().catch(() => "");
            return { success: false, error: `WordPress REST update failed (${res.status}): ${errorText}` };
        }

        logger.info("[Publishers/WordPress] Applied SEO fix via REST", {
            postId: targetPostId,
            metaKeys: Object.keys(meta),
        });

        return { success: true, postId: targetPostId };
    } catch (err: unknown) {
        const errorMsg = (err as Error)?.message || String(err);
        logger.error("[Publishers/WordPress] Exception applying SEO fix", { error: errorMsg });
        return { success: false, error: errorMsg };
    }
}
