import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parse } from "node-html-parser";
import { isSafeUrl } from "@/lib/security/safe-url";
import { repurposeRssToSocial } from "@/lib/publishers/social-repurpose";

export const socialRepurposeJob = inngest.createFunction(
    {
        id: "social-repurpose-job",
        name: "RSS Social Repurposing Job",
        retries: 3,
        triggers: [
            { cron: "0 9 * * 1" }, // Weekly Monday morning
            { event: "social/repurpose-feed" },
        ],
    },
    async ({ event, step }) => {
        const targetSiteId = (event.data as { siteId?: string })?.siteId;

        // Step 1: Fetch candidate sites
        const sites = await step.run("fetch-repurpose-sites", async () => {
            if (targetSiteId) {
                const site = await prisma.site.findUnique({
                    where: { id: targetSiteId },
                    select: {
                        id: true,
                        rssFeedUrl: true,
                        brandName: true,
                        domain: true,
                        socialRepurposeEnabled: true,
                    },
                });
                return site && site.socialRepurposeEnabled && site.rssFeedUrl ? [site] : [];
            }

            return prisma.site.findMany({
                where: {
                    socialRepurposeEnabled: true,
                    rssFeedUrl: {
                        not: null,
                    },
                },
                select: {
                    id: true,
                    rssFeedUrl: true,
                    brandName: true,
                    domain: true,
                    socialRepurposeEnabled: true,
                },
            });
        });

        if (sites.length === 0) {
            logger.info("[socialRepurposeJob] No sites to process");
            return { processed: 0 };
        }

        let totalRepurposed = 0;

        for (const site of sites) {
            if (!site.rssFeedUrl) continue;

            const safeCheck = isSafeUrl(site.rssFeedUrl);
            if (!safeCheck.ok) {
                logger.warn(`[socialRepurposeJob] RSS URL unsafe/invalid for site ${site.id}: ${site.rssFeedUrl}`, { error: safeCheck.error });
                continue;
            }

            // Step 2: Fetch and parse feed
            const feedItems = await step.run(`fetch-feed-${site.id}`, async () => {
                try {
                    const res = await fetch(site.rssFeedUrl!, {
                        signal: AbortSignal.timeout(15_000),
                    });
                    if (!res.ok) {
                        logger.error(`[socialRepurposeJob] Failed to fetch feed for site ${site.id}, status: ${res.status}`);
                        return [];
                    }
                    const text = await res.text();
                    const root = parse(text);

                    // Try RSS <item> first, then Atom <entry>
                    let items = root.querySelectorAll("item");
                    if (items.length === 0) {
                        items = root.querySelectorAll("entry");
                    }

                    const parsed = [];
                    for (const item of items) {
                        const title = item.querySelector("title")?.text?.trim() || "";

                        let link = "";
                        const linkEl = item.querySelector("link");
                        if (linkEl) {
                            link = linkEl.getAttribute("href")?.trim() || linkEl.text?.trim() || "";
                        }

                        if (!link) {
                            const guidEl = item.querySelector("guid") || item.querySelector("id");
                            const guidText = guidEl?.text?.trim() || "";
                            if (guidText.startsWith("http://") || guidText.startsWith("https://")) {
                                link = guidText;
                            }
                        }

                        let contentSnippet = "";
                        const descEl = item.querySelector("description") || item.querySelector("summary") || item.querySelector("content");
                        if (descEl) {
                            contentSnippet = descEl.text?.trim() || "";
                        }
                        for (const child of item.childNodes) {
                            if ('rawTagName' in child && (child.rawTagName === 'content:encoded' || child.rawTagName === 'content')) {
                                contentSnippet = child.text?.trim() || contentSnippet;
                            }
                        }

                        if (title && link) {
                            parsed.push({ title, link, contentSnippet });
                        }
                    }
                    return parsed;
                } catch (err) {
                    logger.error(`[socialRepurposeJob] Error reading feed for site ${site.id}`, { error: String(err) });
                    return [];
                }
            });

            if (feedItems.length === 0) {
                logger.info(`[socialRepurposeJob] No items parsed from feed for site ${site.id}`);
                continue;
            }

            // Step 3: Filter out already repurposed articles by URL
            const newFeedItems = await step.run(`filter-new-items-${site.id}`, async () => {
                const urls = feedItems.map((item) => item.link);
                const existingPosts = await prisma.rssSocialPost.findMany({
                    where: {
                        siteId: site.id,
                        articleUrl: { in: urls },
                    },
                    select: {
                        articleUrl: true,
                    },
                });
                const existingUrls = new Set(existingPosts.map((p) => p.articleUrl));
                return feedItems.filter((item) => !existingUrls.has(item.link));
            });

            if (newFeedItems.length === 0) {
                logger.info(`[socialRepurposeJob] No new articles to repurpose for site ${site.id}`);
                continue;
            }

            // Step 4: Run repurposing for up to 5 items
            const repurposeResults = await step.run(`repurpose-articles-${site.id}`, async () => {
                const brandName = site.brandName || site.domain || "Local Business";
                return repurposeRssToSocial(newFeedItems, brandName, 5);
            });

            // Step 5: Save results
            await step.run(`save-results-${site.id}`, async () => {
                for (const result of repurposeResults) {
                    if (result.error || result.posts.length === 0) {
                        logger.warn(`[socialRepurposeJob] Repurposing failed or empty for article: ${result.articleUrl}`, { error: result.error });
                        continue;
                    }

                    await prisma.rssSocialPost.upsert({
                        where: {
                            siteId_articleUrl: {
                                siteId: site.id,
                                articleUrl: result.articleUrl,
                            },
                        },
                        create: {
                            siteId: site.id,
                            articleUrl: result.articleUrl,
                            articleTitle: result.articleTitle,
                            posts: result.posts as any,
                        },
                        update: {
                            articleTitle: result.articleTitle,
                            posts: result.posts as any,
                        },
                    });
                    totalRepurposed++;
                }
            });
        }

        return { processed: sites.length, repurposed: totalRepurposed };
    }
);
