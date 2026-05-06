/**
 * src/lib/pdf/renderer.ts
 *
 * Production (Docker): connects to the browserless/chrome container via
 * BROWSERLESS_URL=ws://browserless:3000 — already in docker-compose.yml.
 * Local dev: falls back to launching bundled Chromium via full puppeteer.
 */

import { logger } from "@/lib/logger";

const PDF_OPTIONS = {
    format: "A4" as const,
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
} as const;

const LOCAL_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    "--no-zygote",
] as const;

async function launchBrowser() {
    const browserlessUrl = process.env.BROWSERLESS_URL;

    if (browserlessUrl) {
        // Keep protocol, host, and query params (for auth token)
        // but remove the path (e.g., /playwright/chromium)
        const url = new URL(browserlessUrl);
        const baseUrl = `${url.protocol}//${url.host}${url.search}`;
        logger.info(`[PDF] Connecting to browserless at ${baseUrl}`);
        const { default: puppeteer } = await import("puppeteer-core");
        try {
            return await puppeteer.connect({ browserWSEndpoint: baseUrl });
        } catch (err) {
            logger.error(`[PDF] Failed to connect to browserless`, { url: baseUrl, error: (err as Error)?.message });
            throw err;
        }
    }

    logger.info("[PDF] No BROWSERLESS_URL — launching local Chromium (dev only)");
    const { default: puppeteer } = await import("puppeteer");
    return puppeteer.launch({
        headless: true,
        args: [...LOCAL_LAUNCH_ARGS],
    });
}

export async function renderHtmlToPdf(html: string, label: string): Promise<Buffer> {
    let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();

        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const type = req.resourceType();
            if (["document", "stylesheet", "image", "font"].includes(type)) {
                req.continue();
            } else {
                req.abort();
            }
        });

        await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
        const pdf = await page.pdf(PDF_OPTIONS);

        logger.info(`[PDF:${label}] rendered`, { bytes: pdf.length });
        return Buffer.from(pdf);

    } catch (err: unknown) {
        const e = err as Error;
        logger.error(`[PDF:${label}] render failed`, {
            message: e?.message ?? String(err),
            name: e?.name,
            stack: e?.stack?.split("\n").slice(0, 6).join(" | "),
        });
        throw err;

    } finally {
        try { await (browser as any)?.disconnect?.(); } catch { /* remote */ }
        try { await (browser as any)?.close?.(); } catch { /* local  */ }
    }
}