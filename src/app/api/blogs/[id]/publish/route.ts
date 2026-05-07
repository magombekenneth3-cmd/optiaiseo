export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth/get-auth-user";
async function checkOriginality(text: string): Promise<{ isOriginal: boolean, conflictingUrls: string[] }> {
    if (!process.env.SERPER_API_KEY) return { isOriginal: true, conflictingUrls: [] };
    const plainText = text
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const sentences = plainText.match(/[^.!?]+[.!?]+/g) || [plainText];
    const sample = sentences.sort((a, b) => b.length - a.length).slice(0, 3).join(' ');
    
    try {
        const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: `"${sample.trim()}"`, num: 3 }),
            signal: AbortSignal.timeout(6000)
        });
        const data = await res.json();
         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dupes = data.organic?.filter((r: any) => r.snippet?.includes(sample.trim().substring(0, 40))) || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { isOriginal: dupes.length === 0, conflictingUrls: dupes.map((d: any) => d.link) };
    } catch {
        return { isOriginal: true, conflictingUrls: [] };
    }
}

import { prisma } from "@/lib/prisma";
import { pingGoogleIndexingApi } from "@/lib/gsc/indexing";

// ── HASHNODE GRAPHQL HELPER ───────────────────────────────────────────────────

import { syndicateToHashnode } from "@/lib/blog/hashnode";

// Auto-discovers the first publication ID from a Hashnode token
const _HASHNODE_GQL = "https://gql.hashnode.com/";
async function resolvePublicationId(token: string): Promise<string | null> {
    try {
        const res = await fetch(_HASHNODE_GQL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify({
                query: `query { me { publications(first:1) { edges { node { id } } } } }`,
            }),
            signal: AbortSignal.timeout(8000),
        });
        const json = await res.json();
        return json.data?.me?.publications?.edges?.[0]?.node?.id ?? null;
    } catch {
        return null;
    }
}

async function publishToHashnode(
    token: string,
    publicationId: string,
    blog: {
        title: string;
        content: string;
        slug: string;
        metaDescription?: string | null;
        targetKeywords: string[];
        site: { domain: string };
    }
): Promise<{ url: string } | null> {
    try {
        // Hashnode expects Markdown, but our content is HTML.
        // First strip <script> blocks (JSON-LD schemas, inline JS) — Turndown converts
        // them to ugly code fences which pollute the Markdown on Hashnode.
        const cleanedHtml = blog.content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
        const TurndownService = (await import("turndown")).default;
        const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
        const contentMarkdown = turndownService.turndown(cleanedHtml);

        const result = await syndicateToHashnode({
            publicationId,
            token,
            draft: {
                title: blog.title,
                slug: blog.slug,
                content: contentMarkdown, // Use turndown output
                contentMarkdown: contentMarkdown,
                excerpt: blog.metaDescription || `An expert guide to ${blog.title}`,
                metaDescription: blog.metaDescription || "",
                targetKeywords: blog.targetKeywords,
                validationErrors: [],
                validationWarnings: [],
                validationScore: 100,
            }
        });

        if (!result.success || !result.postUrl) {
            logger.error("[Hashnode] Syndication failed:", { error: result.error });
            return null;
        }
  

        return { url: result.postUrl };
     
    } catch (err: unknown) {
        logger.error("[Hashnode] Error during publish:", { error: (err as Error)?.message || String(err) });
        return null;
    }
}

// ── ROUTE HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const user = await getAuthUser(req);
        if (!user?.id || !user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Fetch blog + its parent site (for tokens, domain, etc.)
        const blog = await prisma.blog.findFirst({
            where: { id, site: { userId: user!.id } },
            include: { site: true },
        });

        if (!blog) {
            return NextResponse.json({ error: "Blog not found or unauthorized" }, { status: 404 });
        }

        // FIX #5: Pre-publish Duplicate Check
        const originality = await checkOriginality(blog.content);
        if (!originality.isOriginal) {
            return NextResponse.json({ 
                error: 'Duplicate content detected. Rewrite the flagged sections before publishing.', 
                conflictingUrls: originality.conflictingUrls, 
                hint: 'Your content closely matches existing pages. Add original insight before publishing.' 
            }, { status: 409 });
        }

        // ── SYNDICATION & INDEXING ─────────────────────────────────────────────

        const canonicalUrl = `https://${blog.site.domain}/blog/${blog.slug}`;

        // 1. Ping Google Indexing API instantly (fire-and-forget)
        try {
            const idxResult = await pingGoogleIndexingApi(canonicalUrl, "URL_UPDATED", user!.id);
             
            if (!idxResult.success) {
                logger.warn(`[Indexing API] Ping failed (${idxResult.code}): ${idxResult.message}`);
            }
         
        } catch (idxErr: unknown) {
            logger.error("[Indexing API] Failed to ping Google:", { error: (idxErr as Error)?.message || String(idxErr) });
        }

        // 1b. IndexNow — notify Bing, Yandex & Naver simultaneously (fire-and-forget).
        //     Only fires if INDEXNOW_KEY env var is configured.
        if (process.env.INDEXNOW_KEY) {
            const indexNowKey = process.env.INDEXNOW_KEY;
            const host = blog.site.domain.replace(/^https?:\/\//, "");
            import("@/lib/indexnow")
                .then(({ submitToAllIndexNow }) =>
                    submitToAllIndexNow(host, indexNowKey, [canonicalUrl])
                )
                .then((results) => {
                    const succeeded = results.filter((r) => r.success).map((r) => r.engine);
                    if (succeeded.length > 0) {
                        logger.info("[IndexNow] Notified engines:", { engines: succeeded, url: canonicalUrl });
                    }
                })
                .catch((err: unknown) => {
                    logger.error("[IndexNow] Submission error:", { error: (err as Error)?.message });
                });
        }

        let mediumUrl: string | undefined;
        let hashnodeUrl: string | undefined;

        // 2a. Medium
        if (blog.site.mediumToken) {
            try {
                const meRes = await fetch("https://api.medium.com/v1/me", {
                    headers: {
                        Authorization: `Bearer ${blog.site.mediumToken}`,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                });

                if (meRes.ok) {
                    const meData = await meRes.json();
                    const authorId = meData.data.id;
                    const tags = blog.targetKeywords?.slice(0, 5) || ["seo", "marketing", "growth"];

                    const postRes = await fetch(`https://api.medium.com/v1/users/${authorId}/posts`, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${blog.site.mediumToken}`,
                            "Content-Type": "application/json",
                            Accept: "application/json",
                        },
                        body: JSON.stringify({
                            title: blog.title,
                            contentFormat: "html",
                            content: blog.content,
                            canonicalUrl,
                            tags,
                            publishStatus: "public",
                            notifyFollowers: true,
                        }),
                    });

                    if (postRes.ok) {
                        const postData = await postRes.json();
                        mediumUrl = postData.data.url;
                        logger.debug(`[Medium] Cross-posted blog ${blog.id} → ${mediumUrl}`);
                    } else {
                        logger.error(`[Medium] Failed to create post:`, { error: await postRes.text() });
                     
                    }
                } else {
                    logger.error(`[Medium] Failed to fetch profile. Token may be invalid.`);
                }
             
            } catch (mediumErr: unknown) {
                logger.error("[Medium] Error during cross-posting:", { error: (mediumErr as Error)?.message || String(mediumErr) });
            }
        }

        // 2b. Hashnode — prefer site-level override, fall back to central dev account.
        //     Publication ID is auto-discovered from the token if not explicitly set.
        const hashnodeToken = blog.site.hashnodeToken || process.env.HASHNODE_TOKEN;

        if (hashnodeToken) {
            try {
                // Resolve publication ID: explicit override → env var → auto-discovery from token
                const hashnodePublicationId =
                    blog.site.hashnodePublicationId ||
                    process.env.HASHNODE_PUBLICATION_ID ||
                    await resolvePublicationId(hashnodeToken);

                if (hashnodePublicationId) {
                    const result = await publishToHashnode(hashnodeToken, hashnodePublicationId, blog);
                    if (result) {
                        hashnodeUrl = result.url;
                        logger.debug(`[Hashnode] Cross-posted blog ${blog.id} → ${hashnodeUrl}`);
                    }
                } else {
                    logger.warn("[Hashnode] Could not resolve a publication ID — skipping.");
                }
             
            } catch (hashnodeErr: unknown) {
                logger.error("[Hashnode] Error during syndication:", { error: (hashnodeErr as Error)?.message || String(hashnodeErr) });
            }
        } else {
            logger.debug("[Hashnode] No token configured — skipping syndication.");
         
        }

        // 3. Mark as PUBLISHED now that syndication has completed (success or not).
        // The blog is always published to the user's own site regardless of syndication outcome.
        // We persist syndication URLs in the same update so they appear immediately in the UI.
        await prisma.blog.update({
            where: { id: blog.id },
            data: {
                status: "PUBLISHED",
                publishedAt: new Date(),
                ...(mediumUrl ? { mediumUrl } : {}),
                ...(hashnodeUrl ? { hashnodeUrl } : {}),
            },
        });

        revalidatePath("/dashboard/blogs");
        revalidatePath(`/dashboard/blogs/${blog.id}`);

        // 4. Fire CMS auto-publish to WordPress / Ghost (async — never blocks the response).
        //    Redis NX guard prevents duplicate posts if Inngest retries the event.
        if (blog.site.wordPressConfig || blog.site.ghostConfig) {
            try {
                const { inngest } = await import("@/lib/inngest/client");
                const { redis } = await import("@/lib/redis");

                // SET NX (only if not exists) with 7-day TTL — prevents duplicate CMS posts on Inngest retries
                const cmsKey = `cms-publish:${blog.id}`;
                const dispatched = await redis.set(cmsKey, "1", { ex: 60 * 60 * 24 * 7, nx: true });

                if (dispatched) {
                    await inngest.send({
                        name: "blog.publish.cms",
                        data: { blogId: blog.id, siteId: blog.siteId },
                    });
                    logger.info("[Publish] Fired blog.publish.cms event", { blogId: blog.id });
                } else {
                    logger.info("[Publish] blog.publish.cms already dispatched — skipping (idempotency)", { blogId: blog.id });
                }
            } catch (cmsErr: unknown) {
                // Non-fatal — CMS publish failure must not roll back the primary publish.
                logger.error("[Publish] Failed to queue CMS publish:", { error: (cmsErr as Error)?.message || String(cmsErr) });
            }
        }

        // Report syndication status so the UI can show accurate per-platform feedback
        const syndicationPartial =
            (blog.site.mediumToken && !mediumUrl) ||
            ((blog.site.hashnodeToken || process.env.HASHNODE_TOKEN) && !hashnodeUrl);

        return NextResponse.json({ success: true, mediumUrl, hashnodeUrl, syndicationPartial: !!syndicationPartial });
     
    } catch (error: unknown) {
        logger.error("Failed to publish blog:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
