import { logger } from "@/lib/logger";
import { BlogPostDraft } from "./index";

export interface HashnodePublishOptions {
    publicationId: string;
    token: string;
    draft: BlogPostDraft;
}

export interface HashnodeResult {
    success: boolean;
    postUrl?: string;
    error?: string;
}

/**
 * Pushes a generated blog post to a Hashnode publication using the Hashnode GraphQL API.
 * Requirements: Valid PAT (Personal Access Token) and an active Publication ID.
 */
export async function syndicateToHashnode(options: HashnodePublishOptions): Promise<HashnodeResult> {
    const { publicationId, token, draft } = options;

    if (!publicationId || !token) {
        return { success: false, error: "Missing Hashnode publication ID or token" };
    }

    // GraphQL Mutation for Publishing a Post to Hashnode
    // Ref: https://api.hashnode.com/
    const query = `
        mutation PublishPost($input: PublishPostInput!) {
            publishPost(input: $input) {
                post {
                    url
                }
            }
        }
    `;

    // Map BlogPostDraft to Hashnode's required structure.
    // Hashnode API v2: tags accept { slug, name } only — no arbitrary "id" field.
    // Passing an "id" causes a GraphQL validation error and silently fails the whole mutation.
    //
    // subtitle hard limit: 250 chars (Hashnode enforces this strictly).
    // Strip markdown bold/italic first so **words** don't eat into the character budget.
    const cleanSubtitle = (draft.excerpt ?? "")
        .replace(/\*\*(.+?)\*\*/g, "$1") // **bold** → bold
        .replace(/\*(.+?)\*/g, "$1")     // *italic* → italic
        .slice(0, 250);

    const variables = {
        input: {
            title: draft.title,
            publicationId: publicationId,
            contentMarkdown: draft.content,
            subtitle: cleanSubtitle,
            tags: draft.targetKeywords.slice(0, 5).map(kw => ({
                slug: kw.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
                name: kw.slice(0, 100),
            })),
            coverImageOptions: draft.heroImage ? {
                coverImageURL: draft.heroImage.url,
                isCoverAttributionHidden: false,
                coverImagePhotographer: draft.heroImage.photographer,
                coverImageAttribution: `Photo by ${draft.heroImage.photographer} on Unsplash`
            } : null,
            // originalArticleURL omitted — BlogPostDraft has no articleSchema field
            metaTags: {
                title: draft.title,
                description: draft.metaDescription || draft.excerpt,
            }
        }
    };

    let retries = 3;
    let fallbackError = "Unknown error";

    while (retries > 0) {
        try {
            const res = await fetch('https://gql.hashnode.com/', {
                method: 'POST',
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(15000)
            });

            if (!res.ok) {
                const err = await res.text();
                logger.error(`[Hashnode API] HTTP Error (Retries left: ${retries - 1}):`, { error: err });
                fallbackError = `Hashnode HTTP ${res.status}: ${err}`;
            } else {
                const data = await res.json();

                if (data.errors) {
                    logger.error("[Hashnode API] GraphQL Errors:", { error: data.errors?.message || data.errors });
                    return { success: false, error: data.errors[0]?.message || "GraphQL mutation failed" };
                }

                const postUrl = data.data?.publishPost?.post?.url;
                if (!postUrl) {
                    return { success: false, error: "Post published but no URL returned from Hashnode" };
                }

                return { success: true, postUrl };
            }
         
         
        } catch (e: unknown) {
        logger.error(`[Hashnode Syndication Failed] (Retries left: ${retries - 1}):`, { error: (e as Error)?.message || String(e) });
            fallbackError = (e as Error).message || "Network error communicating with Hashnode";
        }

        retries--;
        if (retries > 0) {
            // Wait 2 seconds before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return { success: false, error: fallbackError };
}
