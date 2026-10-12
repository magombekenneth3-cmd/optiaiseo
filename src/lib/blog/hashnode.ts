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

    const tags = [...new Set((draft.targetKeywords ?? [])
        .map(keyword => keyword.trim())
        .filter(Boolean)
        .map(name => ({
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60),
            name: name.slice(0, 100),
        }))
        .filter(tag => tag.slug))]
        .slice(0, 5);

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

    let retries = 3;
    let fallbackError = "Unknown error";

    while (retries > 0) {
        try {
            const res = await fetch("https://gql.hashnode.com/", {
                method: "POST",
                headers: {
                    Authorization: token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(15000),
            });

            if (!res.ok) {
                const errorBody = (await res.text()).slice(0, 1000);
                fallbackError = `Hashnode HTTP ${res.status}: ${errorBody}`;
                logger.error("[Hashnode API] HTTP error", { status: res.status, retriesLeft: retries - 1, error: errorBody });
            } else {
                const data = await res.json() as {
                    errors?: Array<{ message?: string }>;
                    data?: { publishPost?: { post?: { url?: string } | null } };
                };

                if (data.errors?.length) {
                    const message = data.errors.map(error => error.message).filter(Boolean).join("; ") || "GraphQL mutation failed";
                    logger.error("[Hashnode API] GraphQL errors", { error: message });
                    return { success: false, error: message };
                }

                const postUrl = data.data?.publishPost?.post?.url;
                if (!postUrl) {
                    return { success: false, error: "Hashnode did not return a published post URL" };
                }

                return { success: true, postUrl };
            }
        } catch (error: unknown) {
            fallbackError = error instanceof Error ? error.message : "Network error communicating with Hashnode";
            logger.error("[Hashnode Syndication] Request failed", { retriesLeft: retries - 1, error: fallbackError });
        }

        retries--;
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return { success: false, error: fallbackError };
}
