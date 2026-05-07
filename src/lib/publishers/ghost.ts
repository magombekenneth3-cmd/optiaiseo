import { logger } from "@/lib/logger";
import { isSafeUrl } from "@/lib/security/safe-url";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";


interface GhostConfig {
    ghostUrl: string;
    ghostAdminKey: string;
}

interface Blog {
    id: string;
    title: string;
    content: string;
    slug: string;
    metaDescription: string | null;
    targetKeywords: string[];
}

function buildGhostJwt(adminKey: string): string {
    const [id, secret] = adminKey.split(":");
    if (!id || !secret) throw new Error("Invalid Ghost Admin API key format — expected {id}:{secret}");

    const header = Buffer.from(JSON.stringify({ alg: "HS256", kid: id, typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })).toString("base64url");

    const signature = crypto
        .createHmac("sha256", Buffer.from(secret, "hex"))
        .update(`${header}.${payload}`)
        .digest("base64url");

    return `${header}.${payload}.${signature}`;
}

export async function publishToGhost(blog: Blog, site: { ghostConfig: unknown }): Promise<void> {
    const { ghostUrl, ghostAdminKey } = site.ghostConfig as GhostConfig;

    // SSRF guard: validate user-supplied Ghost URL before issuing outbound request
    const urlCheck = isSafeUrl(ghostUrl);
    if (!urlCheck.ok) {
        throw new Error(`Ghost publish blocked: unsafe URL — ${urlCheck.error}`);
    }

    const jwt = buildGhostJwt(ghostAdminKey);

    const res = await fetch(`${ghostUrl}/ghost/api/admin/posts/`, {
        method: "POST",
        headers: {
            Authorization: `Ghost ${jwt}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            posts: [
                {
                    title: blog.title,
                    html: blog.content,
                    slug: blog.slug,
                    custom_excerpt: blog.metaDescription ?? "",
                    status: "published",
                    tags: blog.targetKeywords.map((k) => ({ name: k })),
                },
            ],
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
        throw new Error(`Ghost publish failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const postUrl: string = data.posts?.[0]?.url ?? "";

    await prisma.blog.update({
        where: { id: blog.id },
        data: { ghostUrl: postUrl, status: "PUBLISHED", publishedAt: new Date() },
    });

    logger.info("[Publishers/Ghost] Published blog", { blogId: blog.id, url: postUrl });
}
