import { logger } from "@/lib/logger";


import { prisma } from "@/lib/prisma";
import { parse } from "node-html-parser";

export async function injectInternalLinks(
    htmlContent: string,
    siteId: string,
    currentSlug: string,
    siteDomain?: string | null
): Promise<string> {
    try {
        // Fetch up to 5 other published blogs to potentially link to
        const otherBlogs = await prisma.blog.findMany({
            where: {
                siteId,
                status: "PUBLISHED",
                slug: { not: currentSlug } // Don't link to ourselves
            },
            take: 10, // Fetch more to increase matching chances
            select: { slug: true, title: true, targetKeywords: true }
        });

        if (otherBlogs.length === 0) return htmlContent;

        const root = parse(htmlContent);
        let linksAdded = 0;
        const maxLinks = 3;

        // Traverse only <p>, <li>, and <blockquote> nodes for link injection
        // This ensures links are only placed in natural text flows.
        const textPassages = root.querySelectorAll('p, li, blockquote');

        for (const blog of otherBlogs) {
            if (linksAdded >= maxLinks) break;

            // FIX #15: prioritise primary keyword first (strongest on-page anchor signal),
            // then a single-word stem of the primary keyword, then remaining keywords, then title last.
            const [primaryKw, ...otherKws] = (blog.targetKeywords || []).filter(kw => kw && kw.length >= 4);
            const stem = primaryKw ? primaryKw.split(/\s+/)[0] : null;
            const keywordsToTry = [
                primaryKw,
                stem && stem !== primaryKw ? stem : null,
                ...otherKws,
                blog.title,
            ].filter((kw): kw is string => !!kw && kw.length >= 4);

            for (const kw of keywordsToTry) {
                let matched = false;

                // Search through text passages
                for (const passage of textPassages) {
                    // Skip if the passage already contains a link
                    if (passage.querySelector('a')) continue;

                    const text = passage.text;
                    const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b(${escapedKw})\\b`, 'i');

                    if (regex.test(text)) {
                        const cleanDomain = siteDomain
                            ? siteDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")
                            : null;
                        const href = cleanDomain
                            ? `https://${cleanDomain}/blog/${blog.slug}`
                            : `/blog/${blog.slug}`;

                        const escHref = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                        const newHtml = passage.innerHTML.replace(
                            regex,
                            (match) => {
                                const escMatch = match.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                                return `<a href="${escHref}" class="text-primary hover:underline font-medium" title="${escMatch}">${escMatch}</a>`;
                            }
                        );
                        passage.set_content(newHtml);
                        linksAdded++;
                        matched = true;
                        break;
                    }
                }

                if (matched) break; // Move to the next target blog
            }
        }

        return root.toString();
     
     
    } catch (error: unknown) {
        logger.error("[Internal Links] DOM-aware injection failed:", { error: (error as Error)?.message || String(error) });
        return htmlContent;
    }
}

/**
 * suggestEntityLinks
 *
 * Entity-aware linking: scores published ENTITY_PAGE blogs by keyword overlap
 * with the current blog content and returns up to 5 ranked candidates.
 *
 * Rule: informational content should always link to the relevant primary service
 * entity page. Primary service entities link to each other only if services are
 * related (overlap score > 0).
 *
 * Returns /services/{slug} paths — not /blog/{slug} — so link equity flows to
 * the high-value dedicated service pages.
 */
export async function suggestEntityLinks(
    currentBlogContent: string,
    currentBlogKeywords: string[],
    siteId: string,
    siteDomain?: string | null
): Promise<{ anchorText: string; targetSlug: string; reason: string }[]> {
    try {
        const entityPages = await prisma.blog.findMany({
            where: { siteId, pipelineType: "ENTITY_PAGE", status: "PUBLISHED" },
            select: { title: true, slug: true, targetKeywords: true },
        });

        if (entityPages.length === 0) return [];

        const contentLower = currentBlogContent.toLowerCase();
        const suggestions: { anchorText: string; targetSlug: string; reason: string; score: number }[] = [];

        const cleanDomain = siteDomain
            ? siteDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")
            : null;

        for (const entityPage of entityPages) {
            const overlap = entityPage.targetKeywords.filter(kw =>
                contentLower.includes(kw.toLowerCase()) ||
                currentBlogKeywords.some(ck => ck.toLowerCase().includes(kw.toLowerCase()))
            );

            if (overlap.length > 0) {
                // Use absolute URL when domain is known — same as injectInternalLinks fix
                const targetSlug = cleanDomain
                    ? `https://${cleanDomain}/services/${entityPage.slug}`
                    : `/services/${entityPage.slug}`;

                suggestions.push({
                    anchorText: entityPage.title.replace(/\|.*$/, "").trim(),
                    targetSlug,
                    reason: `Matches keywords: ${overlap.slice(0, 2).join(", ")}`,
                    score: overlap.length,
                });
            }
        }

        return suggestions
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(({ anchorText, targetSlug, reason }) => ({ anchorText, targetSlug, reason }));

    } catch (error: unknown) {
        logger.error("[Entity Links] suggestEntityLinks failed:", { error: (error as Error)?.message || String(error) });
        return [];
    }
}
