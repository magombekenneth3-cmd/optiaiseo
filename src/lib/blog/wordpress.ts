/**
 * WordPress REST API v2 syndication client.
 *
 * Lifecycle:
 *   validate draft → resolve existing post (by slug) → resolve tags → resolve media → create post
 *
 * Idempotency: deterministic slug derived from draft. Before POST, we GET by slug.
 * If the post already exists, we return { outcome: "already_exists" } without creating a duplicate.
 *
 * Tag resolution is race-safe: GET first, create only if missing, handle 400 "term_exists" gracefully.
 * Media upload is optional: failure logs a warning but does not block article publication.
 * Credentials are never included in error messages or logs.
 */

import { logger } from "@/lib/logger";
import type { BlogPostDraft } from "./index";
import {
    type SyndicationResult,
    deriveSyndicationSlug,
    validateDraftForSyndication,
    normalizeKeywordsForTags,
    sanitizeError,
    buildSyndicationIdentity,
    logSyndication,
} from "./syndication";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WordPressPublishOptions {
    /** WordPress site URL, e.g. "https://example.com" */
    siteUrl: string;
    /** WordPress application password username */
    username: string;
    /** WordPress application password */
    appPassword: string;
    /** The blog post draft to publish */
    draft: BlogPostDraft;
    /** Post status (default: "draft") */
    status?: "publish" | "draft" | "pending";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15_000;
const CMS_NAME = "WordPress";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildAuthHeader(username: string, appPassword: string): string {
    const encoded = Buffer.from(`${username}:${appPassword}`).toString("base64");
    return `Basic ${encoded}`;
}

function buildApiUrl(siteUrl: string, path: string): string {
    const base = siteUrl.replace(/\/+$/, "");
    return `${base}/wp-json/wp/v2${path}`;
}

async function wpFetch(
    url: string,
    auth: string,
    options: RequestInit = {},
): Promise<Response> {
    return fetch(url, {
        ...options,
        headers: {
            Authorization: auth,
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
}

// ─── Tag resolution (race-safe) ───────────────────────────────────────────────

async function resolveTagId(
    siteUrl: string,
    auth: string,
    tagName: string,
): Promise<number | null> {
    const encoded = encodeURIComponent(tagName);

    // Step 1: Search for existing tag
    try {
        const searchUrl = buildApiUrl(siteUrl, `/tags?search=${encoded}&per_page=10`);
        const res = await wpFetch(searchUrl, auth, { method: "GET" });

        if (res.ok) {
            const tags = await res.json() as { id: number; name: string }[];
            const match = tags.find(
                (t) => t.name.toLowerCase() === tagName.toLowerCase(),
            );
            if (match) return match.id;
        }
    } catch {
        // Search failed — try creating
    }

    // Step 2: Create new tag
    try {
        const createUrl = buildApiUrl(siteUrl, "/tags");
        const res = await wpFetch(createUrl, auth, {
            method: "POST",
            body: JSON.stringify({ name: tagName }),
        });

        if (res.ok) {
            const tag = await res.json() as { id: number };
            return tag.id;
        }

        // Handle "term_exists" — the tag was created between our GET and POST
        if (res.status === 400) {
            const body = await res.json().catch(() => null) as { code?: string; data?: { term_id?: number } } | null;
            if (body?.code === "term_exists" && body?.data?.term_id) {
                return body.data.term_id;
            }
            // Re-search as fallback
            const retryUrl = buildApiUrl(siteUrl, `/tags?search=${encoded}&per_page=10`);
            const retryRes = await wpFetch(retryUrl, auth, { method: "GET" });
            if (retryRes.ok) {
                const tags = await retryRes.json() as { id: number; name: string }[];
                const match = tags.find(
                    (t) => t.name.toLowerCase() === tagName.toLowerCase(),
                );
                if (match) return match.id;
            }
        }
    } catch {
        // Tag creation failed — non-fatal
    }

    logger.warn(`[Syndication/WordPress] Could not resolve tag: "${tagName}"`);
    return null;
}

async function resolveTagIds(
    siteUrl: string,
    auth: string,
    keywords: string[],
): Promise<number[]> {
    const normalized = normalizeKeywordsForTags(keywords);
    const results = await Promise.all(
        normalized.map((kw) => resolveTagId(siteUrl, auth, kw)),
    );
    return results.filter((id): id is number => id !== null);
}

// ─── Media upload (optional) ──────────────────────────────────────────────────

async function uploadFeaturedImage(
    siteUrl: string,
    auth: string,
    imageUrl: string,
    altText: string,
): Promise<number | null> {
    try {
        // Fetch the image
        const imgRes = await fetch(imageUrl, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!imgRes.ok) {
            logger.warn(`[Syndication/WordPress] Failed to fetch hero image: HTTP ${imgRes.status}`);
            return null;
        }

        const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
        const buffer = Buffer.from(await imgRes.arrayBuffer());

        // Derive filename from URL
        const urlPath = new URL(imageUrl).pathname;
        const filename = urlPath.split("/").pop() ?? "hero-image.jpg";

        const uploadUrl = buildApiUrl(siteUrl, "/media");
        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                Authorization: auth,
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
            body: buffer,
            signal: AbortSignal.timeout(30_000), // images can be large
        });

        if (!uploadRes.ok) {
            logger.warn(`[Syndication/WordPress] Media upload failed: HTTP ${uploadRes.status}`);
            return null;
        }

        const media = await uploadRes.json() as { id: number };

        // Set alt text
        if (media.id && altText) {
            await wpFetch(buildApiUrl(siteUrl, `/media/${media.id}`), auth, {
                method: "POST",
                body: JSON.stringify({ alt_text: altText }),
            }).catch(() => null); // non-fatal
        }

        return media.id;
    } catch (e) {
        logger.warn("[Syndication/WordPress] Media upload error (non-fatal)", {
            error: (e as Error)?.message,
        });
        return null;
    }
}

// ─── Main syndication function ────────────────────────────────────────────────

export async function syndicateToWordPress(
    options: WordPressPublishOptions,
): Promise<SyndicationResult> {
    const { siteUrl, username, appPassword, draft, status = "draft" } = options;
    const sensitiveValues = [appPassword, username];

    // ── Step 0: Validate credentials
    if (!siteUrl || !username || !appPassword) {
        return {
            success: false,
            outcome: "failed",
            error: "Missing WordPress credentials (siteUrl, username, or appPassword)",
        };
    }

    // ── Step 1: Validate draft
    const validation = validateDraftForSyndication(draft);
    if (!validation.valid) {
        return {
            success: false,
            outcome: "failed",
            error: `Draft validation failed: ${validation.errors.join("; ")}`,
        };
    }

    const identity = buildSyndicationIdentity("wordpress", siteUrl, draft);
    const auth = buildAuthHeader(username, appPassword);
    logSyndication(CMS_NAME, "Starting publication", {
        operationId: identity.operationId,
        slug: identity.slug,
        status,
    });

    try {
        // ── Step 2: Check for existing post (idempotency)
        const existingUrl = buildApiUrl(
            siteUrl,
            `/posts?slug=${encodeURIComponent(identity.slug)}&status=any&per_page=1`,
        );
        const existingRes = await wpFetch(existingUrl, auth, { method: "GET" });

        if (existingRes.ok) {
            const existing = await existingRes.json() as { id: number; link: string }[];
            if (existing.length > 0) {
                logSyndication(CMS_NAME, "Post already exists", {
                    operationId: identity.operationId,
                    postId: existing[0].id,
                    postUrl: existing[0].link,
                });
                return {
                    success: true,
                    outcome: "already_exists",
                    postUrl: existing[0].link,
                    postId: existing[0].id,
                };
            }
        }

        // ── Step 3: Resolve tags
        const tagIds = await resolveTagIds(siteUrl, auth, draft.targetKeywords);

        // ── Step 4: Resolve media (optional)
        let featuredMediaId: number | null = null;
        if (draft.heroImage?.url) {
            featuredMediaId = await uploadFeaturedImage(
                siteUrl,
                auth,
                draft.heroImage.url,
                draft.heroImage.alt ?? draft.title,
            );
        }

        // ── Step 5: Create post
        const postBody: Record<string, unknown> = {
            title: draft.title,
            slug: identity.slug,
            content: draft.content,
            excerpt: draft.metaDescription || draft.excerpt,
            status,
            tags: tagIds,
        };

        if (featuredMediaId) {
            postBody.featured_media = featuredMediaId;
        }

        const createUrl = buildApiUrl(siteUrl, "/posts");
        const createRes = await wpFetch(createUrl, auth, {
            method: "POST",
            body: JSON.stringify(postBody),
        });

        if (!createRes.ok) {
            const errorBody = await createRes.text().catch(() => "");
            const sanitized = sanitizeError(errorBody, sensitiveValues);
            logger.error(`[Syndication/WordPress] POST failed: HTTP ${createRes.status}`, {
                error: sanitized,
            });
            return {
                success: false,
                outcome: "failed",
                error: `WordPress API error (HTTP ${createRes.status}): ${sanitized}`,
            };
        }

        const created = await createRes.json() as { id: number; link: string };
        logSyndication(CMS_NAME, "Post created", {
            operationId: identity.operationId,
            postId: created.id,
            postUrl: created.link,
            tagCount: tagIds.length,
            hasFeaturedImage: !!featuredMediaId,
        });

        return {
            success: true,
            outcome: "created",
            postUrl: created.link,
            postId: created.id,
        };
    } catch (error) {
        const sanitized = sanitizeError(error, sensitiveValues);
        logger.error("[Syndication/WordPress] Publication failed", { error: sanitized });
        return {
            success: false,
            outcome: "failed",
            error: sanitized,
        };
    }
}
