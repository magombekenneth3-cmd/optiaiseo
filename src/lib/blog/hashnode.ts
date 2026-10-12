import { logger } from "@/lib/logger";
import type { BlogPostDraft } from "./index";

export type HashnodeDraft = Pick<
    BlogPostDraft,
    "title" | "content" | "excerpt" | "metaDescription" | "targetKeywords" | "heroImage"
>;

export interface HashnodePublishOptions {
    publicationId: string;
    token: string;
    draft: HashnodeDraft;
    canonicalUrl?: string;
}

export interface HashnodeResult {
    success: boolean;
    postUrl?: string;
    error?: string;
}

export async function syndicateToHashnode(options: HashnodePublishOptions): Promise<HashnodeResult> {
    const { publicationId, token, draft, canonicalUrl } = options;

    if (!publicationId || !token) {
        return { success: false, error: "Missing Hashnode publication ID or token" };
    }
    if (!draft.title.trim() || !draft.content.trim()) {
        return { success: false, error: "A title and Markdown content are required to publish to Hashnode" };
    }

    const query = `
        mutation PublishPost($input: PublishPostInput!) {
            publishPost(input: $input) {
                post {
                    id
                    slug
                    url
                }
            }
        }
    `;

    const cleanSubtitle = (draft.excerpt ?? "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .slice(0, 250);

    const tagsBySlug = new Map<string, { slug: string; name: string }>();
    for (const keyword of draft.targetKeywords ?? []) {
        const name = keyword.trim();
        if (!name) continue;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
        if (slug && !tagsBySlug.has(slug)) {
            tagsBySlug.set(slug, { slug, name: name.slice(0, 100) });
        }
    }
    const tags = [...tagsBySlug.values()].slice(0, 5);

    const variables = {
        input: {
            title: draft.title,
            publicationId,
            contentMarkdown: draft.content,
            ...(cleanSubtitle ? { subtitle: cleanSubtitle } : {}),
            tags,
            ...(canonicalUrl ? { originalArticleURL: canonicalUrl } : {}),
            ...(draft.heroImage?.url ? {
                coverImage: draft.heroImage.url,
                ogImage: draft.heroImage.url,
            } : {}),
            metaTitle: draft.title,
            metaDescription: draft.metaDescription || draft.excerpt || "",
        },
    };

    try {
        const response = await fetch("https://gql.hashnode.com/", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            const errorBody = (await response.text()).slice(0, 1000);
            const error = `Hashnode HTTP ${response.status}: ${errorBody}`;
            logger.error("[Hashnode API] HTTP error", { status: response.status, error: errorBody });
            return { success: false, error };
        }

        const data = await response.json() as {
            errors?: Array<{ message?: string }>;
            data?: { publishPost?: { post?: { url?: string } | null } };
        };

        if (data.errors?.length) {
            const error = data.errors.map(item => item.message).filter(Boolean).join("; ") || "GraphQL mutation failed";
            logger.error("[Hashnode API] GraphQL errors", { error });
            return { success: false, error };
        }

        const postUrl = data.data?.publishPost?.post?.url;
        if (!postUrl) {
            return { success: false, error: "Hashnode did not return a published post URL" };
        }

        return { success: true, postUrl };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Network error communicating with Hashnode";
        logger.error("[Hashnode Syndication] Request failed", { error: message });
        return { success: false, error: message };
    }
}
