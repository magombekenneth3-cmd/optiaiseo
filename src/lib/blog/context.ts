import { logger } from "@/lib/logger";
/**
 * src/lib/blog/context.ts
 *
 * Site context crawler and types for blog generation.
 */

import { parse } from 'node-html-parser';


export interface SiteContext {
    title: string;
    description: string;
    headings: string[];
    category: string;
    keywords: string[];
    domain: string;
}


const MAX_CONTEXT_HTML_BYTES = 2_000_000;

async function readCappedText(res: Response, maxBytes: number): Promise<string> {
    if (!res.body) return (await res.text()).slice(0, maxBytes);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (received >= maxBytes) {
            await reader.cancel().catch(() => undefined);
            break;
        }
    }
    return text + decoder.decode();
}

/**
 * Crawls the live site to extract real content context.
 * Returns structured data used to ground blog generation.
 */
export async function extractSiteContext(domain: string, options: { timeoutMs?: number } = {}): Promise<SiteContext | null> {
    try {
        const url = domain.startsWith("http") ? domain : `https://${domain}`;
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" },
            signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
            redirect: "follow",
        });

        if (!res.ok) return null;
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType && !/html|xml|text\/plain/i.test(contentType)) return null;

        const html = await readCappedText(res, MAX_CONTEXT_HTML_BYTES);

        // Use node-html-parser for robust parsing (handles multiline, encoded chars etc.)
        const root = parse(html);

        // Extract title — robust against multiline and encoded content
        const title = root.querySelector('title')?.textContent?.trim() ?? "";

        // Extract meta description
        const description =
            root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ??
            root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ??
            "";

        // Extract H1, H2, H3 headings — reveals actual topics
        const headings = root.querySelectorAll('h1, h2, h3')
            .map(el => el.textContent?.trim() ?? "")
            .filter(h => h.length > 3 && h.length < 120)
            .slice(0, 15);

        // Extract keywords from meta keywords tag (if present)
        const metaKeywords =
            root.querySelector('meta[name="keywords"]')?.getAttribute('content')
                ?.split(",")
                .map(k => k.trim())
                .filter(Boolean) ?? [];

        // Build a rich category label from site content
        const brand = domain.replace(/^www\./, "").split(".")[0];
        const category = title
            ? `${title} — ${brand}`
            : brand;

        // Build keywords from multiple sources: headings + meta keywords
        const derivedKeywords = [
            ...headings.slice(0, 8).map(h => h.toLowerCase()),
            ...metaKeywords.slice(0, 5),
        ].filter(Boolean);

        // Fallback if we got nothing useful
        const keywords = derivedKeywords.length > 0
            ? derivedKeywords
            : [brand, "guide", "tips", "best practices"];

        return {
            title,
            description,
            headings,
            category,
            keywords,
            domain: brand,
        };
     
     
    } catch (err: unknown) {
        logger.warn("[Blog Action] Failed to crawl site for context:", { error: (err as Error)?.message || String(err) });
        return null;
    }
}
