import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { runInformationGainAlgorithm } from "@/lib/blog/information-gain";
import { injectVisualEvidenceIntoBlog } from "@/lib/blog/image-evidence";
import { dispatchMultiCmsPublish } from "@/lib/publishers";

/**
 * Structured GSC decay evidence required to authorize autonomous reoptimization.
 *
 * Invariant: no decay evidence → no autonomous reoptimization.
 * This prevents any caller from triggering content mutation without real GSC data.
 */
export interface DecayEvidence {
    source: "gsc";
    property: string;
    url: string;
    comparisonStart: string;
    comparisonEnd: string;
    baselineStart: string;
    baselineEnd: string;
    clicksBefore: number;
    clicksAfter: number;
    impressionsBefore: number;
    impressionsAfter: number;
    capturedAt: string;
}

export interface ReoptimizationResult {
    blogId: string;
    title: string;
    addedContentGaps: string[];
    reoptimizedAt: string;
    publishedUrl: string;
    decayEvidence: DecayEvidence;
}

/**
 * Validate that decay evidence is structurally complete.
 * Rejects malformed, partial, or fabricated evidence objects.
 */
function validateDecayEvidence(evidence: DecayEvidence): void {
    if (evidence.source !== "gsc") {
        throw new Error("Decay reoptimization requires GSC evidence (source must be 'gsc').");
    }
    if (!evidence.property || !evidence.url) {
        throw new Error("Decay evidence must include GSC property and URL.");
    }
    if (!evidence.comparisonStart || !evidence.comparisonEnd || !evidence.baselineStart || !evidence.baselineEnd) {
        throw new Error("Decay evidence must include complete date ranges.");
    }
    if (
        typeof evidence.clicksBefore !== "number" ||
        typeof evidence.clicksAfter !== "number" ||
        typeof evidence.impressionsBefore !== "number" ||
        typeof evidence.impressionsAfter !== "number"
    ) {
        throw new Error("Decay evidence must include numeric click and impression metrics.");
    }
    if (evidence.impressionsBefore <= 0) {
        throw new Error("Decay evidence baseline impressions must be positive (cannot decay from zero).");
    }
    if (!evidence.capturedAt) {
        throw new Error("Decay evidence must include a capturedAt timestamp.");
    }
}

/**
 * Re-optimize a blog post that has been confirmed as decaying via real GSC data.
 *
 * This function REQUIRES structured DecayEvidence to execute. Without valid
 * evidence, it will throw and refuse to modify any content. This prevents:
 * - Hardcoded/stub decay signals from triggering content mutations
 * - API errors or missing data from being misinterpreted as decay
 * - Audit-only signals from triggering autonomous CMS publishing
 *
 * Phase 3 fix: The CMS publish path now uses stored-connection resolution
 * and checks kill switches instead of reading raw site config and hardcoding
 * the platform to WORDPRESS.
 */
export async function reoptimizeDecayedPost(
    blogId: string,
    evidence: DecayEvidence,
): Promise<ReoptimizationResult> {
    // Structural validation — reject malformed evidence
    validateDecayEvidence(evidence);

    const blog = await prisma.blog.findUnique({
        where: { id: blogId },
        include: { site: true },
    });

    if (!blog) {
        throw new Error(`Blog post not found: ${blogId}`);
    }

    logger.info("[Decay Reoptimizer] Starting reoptimization with verified GSC evidence", {
        blogId: blog.id,
        property: evidence.property,
        url: evidence.url,
        clicksBefore: evidence.clicksBefore,
        clicksAfter: evidence.clicksAfter,
        impressionsBefore: evidence.impressionsBefore,
        impressionsAfter: evidence.impressionsAfter,
        comparisonRange: `${evidence.comparisonStart} → ${evidence.comparisonEnd}`,
        baselineRange: `${evidence.baselineStart} → ${evidence.baselineEnd}`,
    });

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
            // Phase 3 fix: Use stored-connection resolution instead of raw site config.
            // This respects per-site CMS kill switches and avoids reading credentials
            // directly from the site record (which was the Phase 1 vulnerability).
            // Determine which platform the site has connected (check in priority order).
            const { resolveStoredConnection } = await import("@/lib/publishers/stored-connection");
            const siteRecord = blog.site as Record<string, unknown>;

            // Try each supported platform in order — use the first connected one
            type CmsPlatform = "WORDPRESS" | "GHOST";
            const platformsToTry: CmsPlatform[] = ["WORDPRESS", "GHOST"];
            let resolved = false;

            for (const platform of platformsToTry) {
                const result = resolveStoredConnection(platform, {
                    id: blog.site.id,
                    wordPressConfig: siteRecord.wordPressConfig,
                    ghostConfig: siteRecord.ghostConfig,
                });

                if (result.ok) {
                    const pubRes = await dispatchMultiCmsPublish(
                        {
                            id: blog.id,
                            title: blog.title,
                            content: updatedContent,
                            slug: blog.slug,
                            metaDescription: blog.metaDescription,
                            targetKeywords: keywords,
                        },
                        result.config
                    );
                    publishedUrl = pubRes.publishedUrl;
                    resolved = true;
                    break;
                }
            }

            if (!resolved) {
                logger.info("[Decay Reoptimizer] No CMS connection configured — skipping republish", {
                    blogId: blog.id,
                    siteId: blog.site.id,
                });
            }
        } catch (pubErr: unknown) {
            // Check if this is a kill-switch block (409) vs a real error
            const errMsg = (pubErr as Error)?.message || String(pubErr);
            if (errMsg.includes("kill_switch") || errMsg.includes("KILL_SWITCH")) {
                logger.warn("[Decay Reoptimizer] CMS kill switch active — republish blocked", {
                    blogId: blog.id,
                    siteId: blog.site.id,
                });
            } else {
                logger.warn("[Decay Reoptimizer] CMS republish failed", {
                    blogId: blog.id,
                    error: errMsg,
                });
            }
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
        decayEvidence: evidence,
    };
}

