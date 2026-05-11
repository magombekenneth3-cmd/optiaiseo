import { logger } from "@/lib/logger";

const PDF_OPTIONS = {
    format: "A4" as const,
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
} as const;

const LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    "--no-zygote",
    "--disable-extensions",
] as const;

type BrowserHandle = {
    browser: { newPage: () => Promise<import("puppeteer-core").Page> };
    isRemote: boolean;
    close: () => Promise<void>;
};

async function launchBrowser(): Promise<BrowserHandle> {
    const browserlessUrl = process.env.BROWSERLESS_URL;

    if (browserlessUrl) {
        const url = new URL(browserlessUrl);
        const wsEndpoint = `${url.protocol}//${url.host}${url.search}`;
        logger.info(`[PDF] Connecting to browserless: ${wsEndpoint}`);
        const { default: puppeteer } = await import("puppeteer-core");
        const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
        return {
            browser,
            isRemote: true,
            close: async () => { try { browser.disconnect(); } catch {} },
        };
    }

    const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

    if (isServerless) {
        logger.info("[PDF] Serverless env — launching @sparticuz/chromium");
        const [{ default: puppeteer }, chromium] = await Promise.all([
            import("puppeteer-core"),
            import("@sparticuz/chromium").then(m => m.default),
        ]);
        const executablePath = await chromium.executablePath();
        const browser = await puppeteer.launch({
            executablePath,
            args: [...chromium.args, ...LAUNCH_ARGS],
            headless: true,
        });
        return {
            browser,
            isRemote: false,
            close: async () => { try { await browser.close(); } catch {} },
        };
    }

    logger.info("[PDF] Local dev — launching bundled Chromium");
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
        headless: true,
        args: [...LAUNCH_ARGS],
    });
    return {
        browser,
        isRemote: false,
        close: async () => { try { await browser.close(); } catch {} },
    };
}

export async function renderHtmlToPdf(html: string, label: string): Promise<Buffer> {
    const handle = await launchBrowser();

    try {
        const page = await handle.browser.newPage();

        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const type = req.resourceType();
            if (["document", "stylesheet", "image", "font"].includes(type)) {
                req.continue();
            } else {
                req.abort();
            }
        });

        await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 45_000 });
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
        await handle.close();
    }
}