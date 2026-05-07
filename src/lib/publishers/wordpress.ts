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
