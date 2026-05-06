import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import prisma from "@/lib/prisma";
import { callGemini } from "@/lib/gemini/client";

// ── Planner Brief Generator ───────────────────────────────────────────────────

export const generatePlannerBriefJob = inngest.createFunction(
    {
        id: "generate-planner-brief",
        name: "Generate Content Brief",
        onFailure: async ({ event }) => {
            const { itemId } = (event.data?.event?.data ?? {}) as { itemId?: string };
            if (!itemId) return;
            // Reset stuck "Writing..." status so the user sees "failed" and can retry
            await prisma.plannerItem.update({
                where: { id: itemId },
                data: { status: "failed" },
            }).catch((err: unknown) => {
                logger.warn("[Inngest/PlannerCMS] Failed to reset stuck item status", {
                    itemId,
                    error: (err as Error)?.message ?? String(err),
                });
            });
        },
    
        triggers: [{ event: "planner/brief.generate" }],
    },
    async ({ event, step }) => {
        const { siteId, itemId, keyword, topic } = event.data;

        const briefHtml = await step.run("call-llm", async () => {
            const prompt = `Write a comprehensive SEO content brief for the keyword "${keyword}" in the topic "${topic}".
      Return ONLY raw HTML (using h2, h3, ul, p) covering:
      - Title ideas
      - Search intent
      - Target audience
      - Full outline with H2s and H3s
      - Internal linking targets
      No markdown code blocks, just HTML.`;
            const res = await callGemini(prompt);
            return res.replace(/```html|```/g, "").trim();
        });

        await step.run("save-brief", async () => {
            // Verify the item actually belongs to the right site before updating
            const item = await prisma.plannerItem.findFirst({ where: { id: itemId, siteId } });
            if (!item) throw new NonRetriableError(`PlannerItem ${itemId} not found for site ${siteId}`);

            await prisma.plannerItem.update({
                where: { id: itemId },
                data: {
                    status: "Done",
                    // Store the brief HTML as a data-URI on briefId so existing UI preview links continue to work
                    briefId: `data:text/html;charset=utf-8,${encodeURIComponent(briefHtml)}`,
                },
            });
        });

        return { success: true, itemId };
    }
);



// ── CMS Auto-Publish (WordPress / Ghost / Hashnode) ──────────────────────────

export const publishBlogToCmsJob = inngest.createFunction(
    {
        id: "publish-blog-to-cms",
        name: "Auto-Publish Blog to CMS",
        concurrency: { limit: 5 },
        onFailure: async ({ event, error }) => {
            const blogId = (event.data?.event?.data as Record<string, unknown>)?.blogId as string | undefined;
            logger.error(`[Inngest/CMS] Publish failed for blog ${blogId}:`, { error: error?.message || error });
        },
    
        triggers: [{ event: "blog.publish.cms" }],
    },
    async ({ event, step }) => {
        const { blogId, siteId } = event.data as { blogId: string; siteId: string };

        const { blog, site } = await step.run("fetch-blog-and-site", async () => {
            const [b, s] = await Promise.all([
                prisma.blog.findUnique({
                    where: { id: blogId },
                    select: {
                        id: true, title: true, slug: true, content: true,
                        metaDescription: true, targetKeywords: true, status: true,
                        wordPressUrl: true, ghostUrl: true, hashnodeUrl: true,
                        ogImage: true,   // used as Hashnode cover image URL
                    },
                }),
                prisma.site.findUnique({
                    where: { id: siteId },
                    select: {
                        wordPressConfig: true,
                        ghostConfig: true,
                        hashnodeToken: true,
                        hashnodePublicationId: true,
                    },
                }),
            ]);
            if (!b) throw new NonRetriableError(`Blog ${blogId} not found`);
            if (!s) throw new NonRetriableError(`Site ${siteId} not found`);
            return { blog: b, site: s };
        });

        const results: { wordpress?: string; ghost?: string; hashnode?: string } = {};

        // ── Hashnode (primary platform) ───────────────────────────────────────
        if (site.hashnodeToken && site.hashnodePublicationId && !blog.hashnodeUrl) {
            await step.run("publish-to-hashnode", async () => {
                const { syndicateToHashnode } = await import("@/lib/blog/hashnode");

                const result = await syndicateToHashnode({
                    publicationId: site.hashnodePublicationId!,
                    token: site.hashnodeToken!,
                    draft: {
                        title: blog.title,
                        slug: blog.slug,
                        content: blog.content,
                        contentMarkdown: blog.content,
                        metaDescription: blog.metaDescription ?? "",
                        targetKeywords: blog.targetKeywords ?? [],
                        excerpt: blog.metaDescription ?? "",
                        heroImage: blog.ogImage
                            ? { url: blog.ogImage, thumb: blog.ogImage, alt: blog.title, photographer: "—", photographerUrl: "", unsplashUrl: "" }
                            : undefined,
                        validationErrors: [],
                        validationWarnings: [],
                        validationScore: 100,
                    },
                });

                if (!result.success) {
                    throw new Error(`Hashnode publish failed: ${result.error}`);
                }

                await prisma.blog.update({
                    where: { id: blogId },
                    data: { hashnodeUrl: result.postUrl },
                });

                logger.info(`[CMS] Hashnode publish complete`, { blogId, url: result.postUrl });
                return result.postUrl;
            });
            results.hashnode = "published";
        }

        // ── WordPress ─────────────────────────────────────────────────────────
        if (site.wordPressConfig && !blog.wordPressUrl) {
            await step.run("publish-to-wordpress", async () => {
                const { publishToWordPress } = await import("@/lib/publishers/wordpress");
                await publishToWordPress(
                    {
                        id: blog.id, title: blog.title, content: blog.content,
                        slug: blog.slug, metaDescription: blog.metaDescription,
                        targetKeywords: blog.targetKeywords,
                    },
                    { wordPressConfig: site.wordPressConfig }
                );
            });
            results.wordpress = "published";
            logger.info(`[CMS] WordPress publish complete`, { blogId });
        }

        // ── Ghost ─────────────────────────────────────────────────────────────
        if (site.ghostConfig && !blog.ghostUrl) {
            await step.run("publish-to-ghost", async () => {
                const { publishToGhost } = await import("@/lib/publishers/ghost");
                await publishToGhost(
                    {
                        id: blog.id, title: blog.title, content: blog.content,
                        slug: blog.slug, metaDescription: blog.metaDescription,
                        targetKeywords: blog.targetKeywords,
                    },
                    { ghostConfig: site.ghostConfig }
                );
            });
            results.ghost = "published";
            logger.info(`[CMS] Ghost publish complete`, { blogId });
        }

        if (!results.wordpress && !results.ghost && !results.hashnode) {
            logger.info(`[CMS] No CMS configured for site ${siteId} — skipping`, { blogId });
            return { skipped: true, reason: "no_cms_configured" };
        }

        return { success: true, ...results };
    }
);
