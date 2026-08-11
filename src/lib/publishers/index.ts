import { publishToWordPress } from "./wordpress";
import { publishToGhost } from "./ghost";
import { publishToShopify, ShopifyConfig } from "./shopify";
import { publishToWebflow, WebflowConfig } from "./webflow";
import { publishToFramer, FramerConfig } from "./framer";
import { publishToNextJs, NextJsConfig } from "./nextjs";
import { publishToWix, WixConfig } from "./wix";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

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
    wordPressConfig?: unknown;
    ghostConfig?: unknown;
    shopifyConfig?: ShopifyConfig;
    webflowConfig?: WebflowConfig;
    framerConfig?: FramerConfig;
    nextJsConfig?: NextJsConfig;
    wixConfig?: WixConfig;
}

export async function dispatchMultiCmsPublish(blog: PublishableBlogItem, site: SitePlatformConfig): Promise<{ platform: CmsPlatform; publishedUrl: string }> {
    logger.info("[Publishers/Dispatcher] Starting multi-CMS publish", { blogId: blog.id, platform: site.platform });

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

    return { platform: site.platform, publishedUrl };
}

export { publishToShopify, publishToWebflow, publishToFramer, publishToNextJs, publishToWix, publishToWordPress, publishToGhost };
