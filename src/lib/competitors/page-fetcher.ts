import { logger } from "@/lib/logger";
import { isSafeUrl } from "@/lib/security/safe-url";

export type FetchSource = "serper_cache" | "direct_fetch" | "playwright";

export interface FetchResult {
    html: string;
    source: FetchSource;
    statusCode?: number;
}

const CHROME_HEADERS: Record<string, string> = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
};

const CF_CHALLENGE_SIGNALS = [
    "cf-browser-verification",
    "cf_clearance",
    "challenges.cloudflare.com",
    "Just a moment",
];

async function fetchViaSerper(url: string): Promise<FetchResult | null> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return null;

    try {
        const res = await fetch("https://scrape.serper.dev", {
            method: "POST",
            headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(20_000),
        });

        if (!res.ok) {
            logger.debug(`[PageFetcher] Serper scrape HTTP ${res.status} for ${url}`);
            return null;
        }

        const data = (await res.json()) as { html?: string; text?: string };
        const html = data.html ?? data.text ?? "";

        if (html.length < 500) {
            logger.debug(`[PageFetcher] Serper thin content (${html.length} chars) for ${url}`);
            return null;
        }

        logger.debug(`[PageFetcher] Serper hit: ${html.length} chars for ${url}`);
        return { html, source: "serper_cache" };
    } catch (e: unknown) {
        logger.warn(`[PageFetcher] Serper error for ${url}:`, { error: (e as Error)?.message });
        return null;
    }
}

async function fetchDirect(url: string): Promise<FetchResult | null> {
    try {
        const res = await fetch(url, {
            headers: CHROME_HEADERS,
            redirect: "follow",
            signal: AbortSignal.timeout(15_000),
        });

        const guard = isSafeUrl(res.url);
        if (!guard.ok) {
            logger.warn(`[PageFetcher] Redirect to private host blocked: ${url} → ${res.url}`);
            return null;
        }

        if (!res.ok) {
            logger.debug(`[PageFetcher] Direct fetch HTTP ${res.status} for ${url}`);
            return null;
        }

        const html = await res.text();

        const isChallenged =
            CF_CHALLENGE_SIGNALS.some((s) => html.includes(s)) ||
            (html.length < 2000 && html.toLowerCase().includes("cloudflare"));

        if (isChallenged) {
            logger.debug(`[PageFetcher] Cloudflare challenge detected for ${url}`);
            return null;
        }

        if (html.length < 500) {
            logger.debug(`[PageFetcher] Direct fetch thin content for ${url}`);
            return null;
        }

        logger.debug(`[PageFetcher] Direct fetch success: ${html.length} chars for ${url}`);
        return { html, source: "direct_fetch", statusCode: res.status };
    } catch (e: unknown) {
        logger.warn(`[PageFetcher] Direct fetch error for ${url}:`, { error: (e as Error)?.message });
        return null;
    }
}

async function fetchViaPlaywright(url: string): Promise<FetchResult | null> {
    try {
        const { fetchRenderedHtml } = await import("@/lib/crawler/browser");
        const result = await fetchRenderedHtml(url, 25_000);

        if (!result.html || result.html.length < 500) {
            logger.debug(`[PageFetcher] Playwright thin content for ${url}`);
            return null;
        }

        logger.debug(
            `[PageFetcher] Playwright success: ${result.html.length} chars, ${result.jsRenderTimeMs}ms for ${url}`,
        );
        return { html: result.html, source: "playwright" };
    } catch (e: unknown) {
        logger.warn(`[PageFetcher] Playwright error for ${url}:`, { error: (e as Error)?.message });
        return null;
    }
}

export async function fetchCompetitorPageHtml(url: string): Promise<FetchResult | null> {
    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            logger.warn(`[PageFetcher] Non-HTTP URL skipped: ${url}`);
            return null;
        }
    } catch {
        logger.warn(`[PageFetcher] Invalid URL skipped: ${url}`);
        return null;
    }

    logger.debug(`[PageFetcher] Fetching ${url}`);

    const serperResult = await fetchViaSerper(url);
    if (serperResult) return serperResult;

    const directResult = await fetchDirect(url);
    if (directResult) return directResult;

    const playwrightEnabled =
        process.env.BROWSERLESS_URL || process.env.PLAYWRIGHT_ENABLED === "true";

    if (playwrightEnabled) {
        const playwrightResult = await fetchViaPlaywright(url);
        if (playwrightResult) return playwrightResult;
    }

    logger.warn(`[PageFetcher] All layers failed for ${url}`);
    return null;
}
