import { publishToWordPress } from "./wordpress";
import { publishToGhost } from "./ghost";
import { publishToShopify, ShopifyConfig } from "./shopify";
import { publishToWebflow, WebflowConfig } from "./webflow";
import { publishToFramer, FramerConfig } from "./framer";
import { publishToNextJs, NextJsConfig } from "./nextjs";
import { publishToWix, WixConfig } from "./wix";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
    registerEffect,
    assertEffectChannelEnabled,
    MutationBlockedError,
} from "@/lib/mutations";

export type CmsPlatform = "WORDPRESS" | "SHOPIFY" | "WEBFLOW" | "FRAMER" | "NEXTJS" | "WIX" | "GHOST";

export interface PublishableBlogItem {
    id: string;
    title: string;
    content: string;
    slug: string;
    metaDescription: string | null;
    targetKeywords: string[];
}

export interface SitePlatformConfig {
    platform: CmsPlatform;
    siteId?: string;
    wordPressConfig?: unknown;
    ghostConfig?: unknown;
    shopifyConfig?: ShopifyConfig;
    webflowConfig?: WebflowConfig;
    framerConfig?: FramerConfig;
    nextJsConfig?: NextJsConfig;
    wixConfig?: WixConfig;
}

/**
 * Dispatches a CMS publish as a MutationEffect when an operationId is provided.
 * Falls back to direct dispatch when no operationId is given (backward compat).
 *
 * When routed through the mutation lifecycle:
 *   1. Checks CMS channel kill switch
 *   2. Registers a CMS_PUBLISH MutationEffect
 *   3. Dispatches the actual CMS API call
 *   4. Marks blog as PUBLISHED on success
 *
 * @param blog - The blog item to publish
 * @param site - Platform configuration (must include siteId for mutation tracking)
 * @param operationId - Optional: links this publish to a MutationOperation
 */
export async function dispatchMultiCmsPublish(
    blog: PublishableBlogItem,
    site: SitePlatformConfig,
    operationId?: string,
): Promise<{ platform: CmsPlatform; publishedUrl: string }> {
    logger.info("[Publishers/Dispatcher] Starting multi-CMS publish", { blogId: blog.id, platform: site.platform, operationId });

    // ── Kill switch check ────────────────────────────────────────────────
    if (site.siteId) {
        try {
            await assertEffectChannelEnabled(site.siteId, "CMS");
        } catch (err) {
            if (err instanceof MutationBlockedError) {
                logger.warn("[Publishers/Dispatcher] CMS channel blocked by kill switch", {
                    blogId: blog.id,
                    siteId: site.siteId,
                    platform: site.platform,
                });
                throw err;
            }
            throw err;
        }
    }

    // ── Register MutationEffect if we have an operation ──────────────────
    let effectId: string | undefined;
    if (operationId) {
        try {
            effectId = await registerEffect({
                operationId,
                effectType: "CMS_PUBLISH",
                platform: site.platform,
                payload: {
                    blogId: blog.id,
                    slug: blog.slug,
                    platform: site.platform,
                    title: blog.title,
                },
                confirmationMode: "POLL",
                compensationPolicy: getCompensationPolicy(site.platform),
                idempotencyParams: {
                    blogId: blog.id,
                    platform: site.platform,
                },
            });
        } catch (effectErr) {
            logger.warn("[Publishers/Dispatcher] Effect registration failed — continuing with direct dispatch", {
                operationId,
                error: (effectErr as Error)?.message,
            });
        }
    }

    // ── Dispatch to CMS platform ─────────────────────────────────────────
    let publishedUrl = "";

    switch (site.platform) {
        case "WORDPRESS":
            await publishToWordPress(blog, { wordPressConfig: site.wordPressConfig });
            publishedUrl = (site.wordPressConfig as { wpUrl?: string })?.wpUrl ? `${(site.wordPressConfig as { wpUrl: string }).wpUrl}/${blog.slug}` : "";
            break;

        case "GHOST":
            await publishToGhost(blog, { ghostConfig: site.ghostConfig });
            publishedUrl = (site.ghostConfig as { ghostUrl?: string })?.ghostUrl ? `${(site.ghostConfig as { ghostUrl: string }).ghostUrl}/${blog.slug}` : "";
            break;

        case "SHOPIFY":
            if (!site.shopifyConfig) throw new Error("Missing Shopify configuration");
            const shopifyRes = await publishToShopify(blog, site.shopifyConfig);
            publishedUrl = shopifyRes.url;
            break;

        case "WEBFLOW":
            if (!site.webflowConfig) throw new Error("Missing Webflow configuration");
            const webflowRes = await publishToWebflow(blog, site.webflowConfig);
            publishedUrl = webflowRes.url;
            break;

        case "FRAMER":
            if (!site.framerConfig) throw new Error("Missing Framer configuration");
            await publishToFramer(blog, site.framerConfig);
            publishedUrl = `https://framer.com/published/${blog.slug}`;
            break;

        case "NEXTJS":
            if (!site.nextJsConfig) throw new Error("Missing Next.js configuration");
            const nextRes = await publishToNextJs(blog, site.nextJsConfig);
            publishedUrl = nextRes.path;
            break;

        case "WIX":
            if (!site.wixConfig) throw new Error("Missing Wix configuration");
            const wixRes = await publishToWix(blog, site.wixConfig);
            publishedUrl = wixRes.url;
            break;

        default:
            throw new Error(`Unsupported CMS platform: ${site.platform}`);
    }

    await prisma.blog.update({
        where: { id: blog.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    // ── Update effect status on success ──────────────────────────────────
    if (effectId) {
        try {
            await (prisma as any).mutationEffect.update({
                where: { id: effectId },
                data: {
                    status: "DISPATCHED",
                    dispatchedAt: new Date(),
                    externalId: publishedUrl || undefined,
                    attempts: { increment: 1 },
                },
            });
        } catch (updateErr) {
            logger.warn("[Publishers/Dispatcher] Failed to update effect status", {
                effectId,
                error: (updateErr as Error)?.message,
            });
        }
    }

    return { platform: site.platform, publishedUrl };
}

/**
 * Returns the appropriate compensation policy for each CMS platform.
 * WordPress/Ghost/Shopify support full rollback (PUT previous content).
 * Others support partial rollback or are irreversible.
 */
function getCompensationPolicy(
    platform: CmsPlatform
): "ROLLBACK_SUPPORTED" | "ROLLBACK_PARTIAL" | "COMPENSATION_ONLY" | "IRREVERSIBLE" {
    switch (platform) {
        case "WORDPRESS":
        case "GHOST":
        case "SHOPIFY":
            return "ROLLBACK_SUPPORTED";
        case "WEBFLOW":
        case "NEXTJS":
            return "ROLLBACK_PARTIAL";
        case "FRAMER":
        case "WIX":
            return "COMPENSATION_ONLY";
        default:
            return "IRREVERSIBLE";
    }
}

export { publishToShopify, publishToWebflow, publishToFramer, publishToNextJs, publishToWix, publishToWordPress, publishToGhost };
