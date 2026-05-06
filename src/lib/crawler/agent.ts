import { logger } from "@/lib/logger";
import { fetchRenderedHtml } from "./browser";
import { fetchHtml } from "../seo-audit/utils/fetch-html";
import { parse } from "node-html-parser";

export interface CrawlerAgentResult {
    url: string;
    isJavaScriptHeavy: boolean;
    hydrationTimeMs: number;
    frameworkDetected: "React" | "Next.js" | "Vue" | "Nuxt" | "Angular" | "Unknown";
    crawlerRisks: string[];
    rawHtmlLength: number;
    renderedHtmlLength: number;
}

/**
 * Checks a URL both with a standard fetch (raw) and a headless browser (rendered).
 * Compares the two to find JS-rendering issues, typical in Next.js/React apps.
 *
 * @param url      URL to profile
 * @param rawHtml  Optional pre-fetched HTML — pass this to avoid a redundant
 *                 cold-start-prone fetch (engine.ts pre-fetches once and shares).
 */
export async function runCrawlerAgent(url: string, rawHtml?: string): Promise<CrawlerAgentResult> {
    const result: CrawlerAgentResult = {
        url,
        isJavaScriptHeavy: false,
        hydrationTimeMs: 0,
        frameworkDetected: "Unknown",
        crawlerRisks: [],
        rawHtmlLength: 0,
        renderedHtmlLength: 0
    };

    try {
        // 1. Use pre-fetched HTML if provided; otherwise fetch with retry
        let html = rawHtml || '';
        if (!html) {
            html = await fetchHtml(url);
        }

        if (!html) {
            result.crawlerRisks.push("Could not fetch page HTML. Server may be down or blocking crawlers.");
            return result;
        }

        result.rawHtmlLength = html.length;

        // 2. Detect Framework from raw signature
        if (html.includes("_next/static") || html.includes('id="__next"') || html.includes('__NEXT_DATA__')) {
            result.frameworkDetected = "Next.js";
        } else if (html.includes('data-reactroot')) {
            result.frameworkDetected = "React";
        } else if (html.includes('data-v-') || html.includes('__NUXT__')) {
            result.frameworkDetected = "Nuxt";
        } else if (html.includes('ng-version')) {
            result.frameworkDetected = "Angular";
        }

        // 3. Fetch RENDERED HTML (headless browser)
        const renderRes = await fetchRenderedHtml(url);
        result.renderedHtmlLength = renderRes.html.length;
        result.hydrationTimeMs = renderRes.jsRenderTimeMs;

        // 4. Compare DOMs
        const rawDom = parse(html);
        const renderedDom = parse(renderRes.html);

        const rawLinks = rawDom.querySelectorAll('a').length;
        const renderedLinks = renderedDom.querySelectorAll('a').length;

        const htmlDiffPct = result.rawHtmlLength > 0
            ? Math.abs(result.renderedHtmlLength - result.rawHtmlLength) / result.rawHtmlLength
            : 0;

        if (htmlDiffPct > 0.4 || renderRes.networkResources > 50) {
            result.isJavaScriptHeavy = true;
        }

        if (renderedLinks > rawLinks + 10) {
            result.crawlerRisks.push(
                "Critical navigation links are generated client-side. Convert these components to React Server Components (RSC) to ensure Googlebot crawls them immediately."
            );
        }

        if (result.hydrationTimeMs > 4000) {
            result.crawlerRisks.push(
                `JavaScript hydration is blocking rendering for ${Math.round(result.hydrationTimeMs / 1000)}s. This severely damages your Largest Contentful Paint (LCP) score.`
            );
        }

        if (result.frameworkDetected === "Next.js" && (
            renderRes.html.includes('__NEXT_HYDRATION__') ||
            renderRes.html.includes('data-nextjs-scroll-focus-boundary') ||
            renderRes.html.includes('__next_error__')
        )) {
            result.crawlerRisks.push(
                "Detected Next.js hydration markers in rendered DOM. Excessive 'use client' boundaries may be causing hydration mismatches — push client boundaries deeper into leaf components."
            );
        }

        if (renderRes.consoleErrors > 0) {
            result.crawlerRisks.push(`Hydration failed with ${renderRes.consoleErrors} console errors. This often causes search engines to abandon indexing the page.`);
        }

        return result;

     
     
    } catch (e: unknown) {
        logger.error(`[Crawler Agent] Error profiling ${url}`, { error: (e as Error)?.message || String(e) });
        result.crawlerRisks.push("Fatal error resolving page. Server might be down or blocking scrapers.");
        return result;
    }
}
