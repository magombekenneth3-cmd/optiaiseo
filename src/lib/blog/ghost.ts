/**
 * Ghost Admin API syndication client.
 *
 * Lifecycle:
 *   validate draft → generate JWT → resolve existing post (by slug) → create post
 *
 * Idempotency: deterministic slug derived from draft. Before POST, we GET by slug.
 * If the post already exists, we return { outcome: "already_exists" }.
 *
 * Content strategy: HTML-first (draft.content → html). No mobiledoc.
 * Tags are passed inline in the POST body — Ghost creates them if missing.
 *
 * JWT is generated from the Ghost Admin API key ("id:secret" format) using jose (HS256).
 * The token is short-lived (5 minutes) with audience "/admin/".
 *
 * Credentials are never included in error messages or logs.
 */

import { SignJWT } from "jose";
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

export interface GhostPublishOptions {
    /** Ghost site URL, e.g. "https://myblog.ghost.io" */
    ghostUrl: string;
    /** Ghost Admin API key in "id:secret" format */
    adminApiKey: string;
    /** The blog post draft to publish */
    draft: BlogPostDraft;
    /** Post status (default: "draft") */
    status?: "published" | "draft";
    /** Canonical URL for SEO value */
    canonicalUrl?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15_000;
const JWT_EXPIRY_SECONDS = 300; // 5 minutes
const CMS_NAME = "Ghost";

// ─── JWT generation ───────────────────────────────────────────────────────────

/**
 * Parses a Ghost Admin API key into its id and secret components.
 * Format: "id:secret" where secret is a hex string.
 */
function parseAdminApiKey(apiKey: string): { id: string; secret: string } | null {
    if (!apiKey || typeof apiKey !== "string") return null;

    const colonIndex = apiKey.indexOf(":");
    if (colonIndex === -1) return null;

    const id = apiKey.slice(0, colonIndex);
    const secret = apiKey.slice(colonIndex + 1);

    if (!id || id.length < 1) return null;
    if (!secret || secret.length < 8) return null;

    // Secret should be valid hex
    if (!/^[a-f0-9]+$/i.test(secret)) return null;

    return { id, secret };
}

/**
 * Generates a short-lived JWT for Ghost Admin API authentication.
 */
async function generateGhostJwt(apiKey: string): Promise<string | null> {
    const parsed = parseAdminApiKey(apiKey);
    if (!parsed) return null;

    const { id, secret } = parsed;

    // Convert hex secret to Uint8Array for jose
    const secretBytes = new Uint8Array(
        secret.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );

    const now = Math.floor(Date.now() / 1000);

    const token = await new SignJWT({})
        .setProtectedHeader({
            alg: "HS256",
            kid: id,
            typ: "JWT",
        })
        .setIssuedAt(now)
        .setExpirationTime(now + JWT_EXPIRY_SECONDS)
        .setAudience("/admin/")
        .sign(secretBytes);

    return token;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildGhostApiUrl(ghostUrl: string, path: string): string {
    const base = ghostUrl.replace(/\/+$/, "");
    return `${base}/ghost/api/admin${path}`;
}

async function ghostFetch(
    url: string,
    token: string,
    options: RequestInit = {},
): Promise<Response> {
    return fetch(url, {
        ...options,
        headers: {
            Authorization: `Ghost ${token}`,
            "Content-Type": "application/json",
            "Accept-Version": "v5.0",
            ...(options.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
}

// ─── Main syndication function ────────────────────────────────────────────────

export async function syndicateToGhost(
    options: GhostPublishOptions,
): Promise<SyndicationResult> {
    const { ghostUrl, adminApiKey, draft, status = "draft", canonicalUrl } = options;
    const sensitiveValues = [adminApiKey];

    // ── Step 0: Validate credentials
    if (!ghostUrl || !adminApiKey) {
        return {
            success: false,
            outcome: "failed",
            error: "Missing Ghost credentials (ghostUrl or adminApiKey)",
        };
    }

    const parsed = parseAdminApiKey(adminApiKey);
    if (!parsed) {
        return {
            success: false,
            outcome: "failed",
            error: "Invalid Ghost Admin API key format. Expected 'id:secret' where secret is a hex string.",
        };
    }

    // Add secret to sensitive values for sanitization
    sensitiveValues.push(parsed.secret);

    // ── Step 1: Validate draft
    const validation = validateDraftForSyndication(draft);
    if (!validation.valid) {
        return {
            success: false,
            outcome: "failed",
            error: `Draft validation failed: ${validation.errors.join("; ")}`,
        };
    }

    const identity = buildSyndicationIdentity("ghost", ghostUrl, draft);
    logSyndication(CMS_NAME, "Starting publication", {
        operationId: identity.operationId,
        slug: identity.slug,
        status,
    });

    // ── Step 2: Generate JWT
    let token: string;
    try {
        const jwt = await generateGhostJwt(adminApiKey);
        if (!jwt) {
            return {
                success: false,
                outcome: "failed",
                error: "Failed to generate Ghost JWT — check admin API key format",
            };
        }
        token = jwt;
    } catch (error) {
        const sanitized = sanitizeError(error, sensitiveValues);
        logger.error("[Syndication/Ghost] JWT generation failed", { error: sanitized });
        return {
            success: false,
            outcome: "failed",
            error: `JWT generation failed: ${sanitized}`,
        };
    }

    try {
        // ── Step 3: Check for existing post (idempotency)
        const existingUrl = buildGhostApiUrl(
            ghostUrl,
            `/posts/slug/${encodeURIComponent(identity.slug)}/`,
        );

        try {
            const existingRes = await ghostFetch(existingUrl, token, { method: "GET" });

            if (existingRes.ok) {
                const data = await existingRes.json() as {
                    posts?: { id: string; url: string }[];
                };
                if (data.posts && data.posts.length > 0) {
                    logSyndication(CMS_NAME, "Post already exists", {
                        operationId: identity.operationId,
                        postId: data.posts[0].id,
                        postUrl: data.posts[0].url,
                    });
                    return {
                        success: true,
                        outcome: "already_exists",
                        postUrl: data.posts[0].url,
                        postId: data.posts[0].id,
                    };
                }
            }
            // 404 = post doesn't exist → proceed to create
        } catch {
            // Slug lookup failed — proceed to create (best effort idempotency)
            logger.warn("[Syndication/Ghost] Slug lookup failed — proceeding to create");
        }

        // ── Step 4: Build post body
        const tags = normalizeKeywordsForTags(draft.targetKeywords).map((name) => ({
            name,
        }));

        const postBody: Record<string, unknown> = {
            title: draft.title,
            slug: identity.slug,
            html: draft.content,
            status,
            tags,
            meta_title: draft.title,
            meta_description: draft.metaDescription || undefined,
            excerpt: draft.excerpt || undefined,
        };

        if (canonicalUrl) {
            postBody.canonical_url = canonicalUrl;
        }

        // ── Step 5: Create post
        const createUrl = buildGhostApiUrl(ghostUrl, "/posts/");
        const createRes = await ghostFetch(createUrl, token, {
            method: "POST",
            body: JSON.stringify({ posts: [postBody] }),
        });

        if (!createRes.ok) {
            const errorBody = await createRes.text().catch(() => "");
            const sanitized = sanitizeError(errorBody, sensitiveValues);
            logger.error(`[Syndication/Ghost] POST failed: HTTP ${createRes.status}`, {
                error: sanitized,
            });
            return {
                success: false,
                outcome: "failed",
                error: `Ghost API error (HTTP ${createRes.status}): ${sanitized}`,
            };
        }

        const created = await createRes.json() as {
            posts?: { id: string; url: string }[];
        };
        const post = created.posts?.[0];

        if (!post) {
            return {
                success: false,
                outcome: "failed",
                error: "Ghost API returned success but no post data",
            };
        }

        logSyndication(CMS_NAME, "Post created", {
            operationId: identity.operationId,
            postId: post.id,
            postUrl: post.url,
            tagCount: tags.length,
            hasCanonicalUrl: !!canonicalUrl,
        });

        return {
            success: true,
            outcome: "created",
            postUrl: post.url,
            postId: post.id,
        };
    } catch (error) {
        const sanitized = sanitizeError(error, sensitiveValues);
        logger.error("[Syndication/Ghost] Publication failed", { error: sanitized });
        return {
            success: false,
            outcome: "failed",
            error: sanitized,
        };
    }
}
