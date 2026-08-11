import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { runInformationGainAlgorithm } from "@/lib/blog/information-gain";
import { injectVisualEvidenceIntoBlog } from "@/lib/blog/image-evidence";
import { dispatchMultiCmsPublish } from "@/lib/publishers";

export interface ReoptimizationResult {
    blogId: string;
    title: string;
    addedContentGaps: string[];
    reoptimizedAt: string;
    publishedUrl: string;
}

export async function reoptimizeDecayedPost(blogId: string): Promise<ReoptimizationResult> {
    const blog = await prisma.blog.findUnique({
        where: { id: blogId },
        include: { site: true },
    });

    if (!blog) {
        throw new Error(`Blog post not found: ${blogId}`);
    }

    const keywords = blog.targetKeywords || [blog.slug.replace(/-/g, " ")];
    const infoGain = await runInformationGainAlgorithm(keywords[0] || blog.slug);

    const updatedParagraph = `\n\n### Updated Insights (${new Date().getFullYear()} Re-optimization)\n\nRecent search analysis indicates key content updates:\n` +
        infoGain.uniqueContentGaps.map((gap: string) => `- ${gap}`).join("\n");

    let updatedContent = blog.content + updatedParagraph;
    updatedContent = injectVisualEvidenceIntoBlog(updatedContent, keywords[0] || "Fresh Data Evidence");

    await prisma.blog.update({
        where: { id: blog.id },
        data: {
            content: updatedContent,
            updatedAt: new Date(),
        },
    });

    let publishedUrl = "";
    if (blog.site) {
        try {
            const pubRes = await dispatchMultiCmsPublish(
                {
                    id: blog.id,
                    title: blog.title,
                    content: updatedContent,
                    slug: blog.slug,
                    metaDescription: blog.metaDescription,
                    targetKeywords: keywords,
                },
                {
                    platform: "WORDPRESS",
                    wordPressConfig: (blog.site as Record<string, unknown>).wordPressConfig,
                }
            );
            publishedUrl = pubRes.publishedUrl;
        } catch {
            logger.warn("[Decay Reoptimizer] CMS republish deferred", { blogId: blog.id });
        }
    }

    logger.info("[Decay Reoptimizer] Successfully re-optimized decayed post", {
        blogId: blog.id,
        gapsAdded: infoGain.uniqueContentGaps.length,
    });

    return {
        blogId: blog.id,
        title: blog.title,
        addedContentGaps: infoGain.uniqueContentGaps,
        reoptimizedAt: new Date().toISOString(),
        publishedUrl,
    };
}

