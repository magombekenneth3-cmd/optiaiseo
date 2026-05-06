import { logger } from "@/lib/logger";
// playwright is imported dynamically below to avoid top-level module resolution issues
import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "./constants/ai-models";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeWebsiteVisuals(url: string): Promise<string> {
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;

    let browser;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (await import("playwright")) as any;
        const chromium = pw.default?.chromium ?? pw.chromium;
        browser = await chromium.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });

        const page = await context.newPage();
        await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 15000 });

        // Hide cookie banners or popups if possible to get a clean screenshot
        await page.evaluate(() => {
            const elements = document.querySelectorAll(
                '[id*="cookie"], [class*="cookie"], [id*="banner"], [class*="banner"], [id*="popup"], [class*="popup"]'
            );
            elements.forEach((el) => {
                if (el instanceof HTMLElement) el.style.display = "none";
            });
        });

        const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 80 });
        const base64Image = screenshotBuffer.toString("base64");

        const prompt = `You are an expert UX/UI designer and Conversion Rate Optimization (CRO) specialist.
I am providing you with a screenshot of a website: ${fullUrl}.

Please analyze the design, layout, typography, colors, and overall user experience.
Provide a concise, highly actionable critique. Do not use markdown syntax or formatting in your response. 
Speak naturally and professionally as if you were on a consulting call with the site owner. 

In your response, include:
1. Impressions of the visual hierarchy and above-the-fold content.
2. Any accessibility or contrast issues you notice.
3. One or two specific recommendations to improve trust or conversion rates.

Keep the response under 150 words.`;

        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_PRO,
            contents: [
                prompt,
                { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
            ],
            config: { temperature: 0.4 },
        });

        return response.text || "I was unable to analyze the image.";
     
     
    } catch (error: unknown) {
        logger.error("[Vision Analysis Error]", { error: (error as Error)?.message || String(error) });
        return `I encountered an error trying to visually analyze that website: ${(error as Error).message}`;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}
