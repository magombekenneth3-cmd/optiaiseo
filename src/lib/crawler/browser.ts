import { logger } from "@/lib/logger";
import type { Browser, Page } from "playwright";

/**
 * Advanced JS-Rendering Crawler Agent Logic
 * Connects to a robust browserless configuration or local Chromium to execute JS and hydrate SPA applications (React, Angular, Vue)
 * before extracting the DOM for SEO/AEO analysis.
 */

const BROWSER_POOL_SIZE = process.env.BROWSER_POOL_SIZE ? parseInt(process.env.BROWSER_POOL_SIZE) : 3;
const browserPool: Browser[] = [];
let poolIndex = 0;

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Close all pooled Chromium instances when the Node process exits so they are
// never orphaned.  Runs on SIGTERM (container stop), SIGINT (Ctrl-C) and the
// normal 'exit' event.
async function closeAllBrowsers() {
    const closing = browserPool.splice(0).map((b: Browser) =>
        b.close().catch(() => { /* ignore errors on shutdown */ })
    );
    await Promise.all(closing);
}

for (const sig of ["exit", "SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
        closeAllBrowsers().catch(() => { /* best-effort */ });
    });
}

export async function getBrowser(): Promise<Browser> {
    const browserlessUrl = process.env.BROWSERLESS_URL;

    // In production Docker the nextjs system user has HOME=/nonexistent, so
    // Playwright cannot find/download its browser cache and throws a confusing
    // "/nonexistent/.cache/ms-playwright/..." error.
    // Require BROWSERLESS_URL in production so callers get a clear actionable error.
    if (!browserlessUrl && process.env.NODE_ENV === "production") {
        throw new Error(
            "[Crawler] BROWSERLESS_URL is not set. " +
            "Add it in Railway → Variables (e.g. wss://your-browserless.up.railway.app). " +
            "Without it, JS-rendered crawling is disabled in production."
        );
    }

    const pw = await import("playwright");
    const chromium = pw.chromium;

    // Clean up disconnected browsers from the pool
    for (let i = browserPool.length - 1; i >= 0; i--) {
        if (!browserPool[i].isConnected()) {
            browserPool.splice(i, 1);
        }
    }

    // Fill pool if there's room
    if (browserPool.length < BROWSER_POOL_SIZE) {
        let newBrowser: Browser;
        if (browserlessUrl) {
            // Retry with exponential backoff — handles transient Browserless restarts
            // and network blips that would otherwise throw immediately.
            let lastErr: unknown;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    logger.debug(`[Crawler Pool] Connecting to Browserless (attempt ${attempt}/3). Pool: ${browserPool.length + 1}/${BROWSER_POOL_SIZE}`);
                    newBrowser = await chromium.connect({ wsEndpoint: browserlessUrl });
                    break;
                } catch (e) {
                    lastErr = e;
                    if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
            if (!newBrowser!) throw lastErr;
        } else {
            logger.debug(`[Crawler Pool] Launching local Chromium. Pool: ${browserPool.length + 1}/${BROWSER_POOL_SIZE}`);
            newBrowser = await chromium.launch({
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
        }
        browserPool.push(newBrowser);
        // Evict idle connections after 10 minutes to prevent stale WebSockets.
        setTimeout(() => {
            const idx = browserPool.indexOf(newBrowser);
            if (idx !== -1) {
                browserPool.splice(idx, 1);
                newBrowser.close().catch(() => {});
                logger.debug("[Crawler Pool] Idle browser evicted.");
            }
        }, 10 * 60 * 1000);
        return newBrowser;
    }

    // Round-robin selection if pool is full
    poolIndex = (poolIndex + 1) % browserPool.length;
    return browserPool[poolIndex];
}

export interface RenderResult {
    html: string;
    jsRenderTimeMs: number;
    networkResources: number;
    consoleErrors: number;
}

/**
 * Fetches a URL, executes JavaScript until network idle, and returns the fully hydrated HTML.
 */
export async function fetchRenderedHtml(url: string, timeoutMs: number = 15000): Promise<RenderResult> {
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
        browser = await getBrowser();
        page = await browser.newPage();

        let networkResources = 0;
        let consoleErrors = 0;

        page.on('response', () => networkResources++);
         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page.on('console', (msg: any) => {
            if (msg.type() === 'error') consoleErrors++;
        });
        page.on('pageerror', () => consoleErrors++);

        const startTime = Date.now();

        // domcontentloaded is reliable on analytics-heavy sites that never reach
        // networkidle (Google Analytics, Hotjar, polling scripts, etc.).
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

        const html = await page.content();
        const jsRenderTimeMs = Date.now() - startTime;

        return { html, jsRenderTimeMs, networkResources, consoleErrors };

    } catch (e: unknown) {
        logger.error(`[Crawler Agent] Failed to render ${url}:`, { error: (e as Error)?.message || String(e) });
        throw e;
    } finally {
        // Always close the page — keeps the browser healthy in the pool
        // even when goto() times out or navigation throws.
        if (page) {
            try { await page.close(); } catch { /* ignore close errors */ }
        }
    }
}
