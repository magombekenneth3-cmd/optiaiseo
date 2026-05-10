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


/**
 * Crawls the live site to extract real content context.
 * Returns structured data used to ground blog generation.
 */
export async function extractSiteContext(domain: string): Promise<SiteContext | null> {
    try {
        const url = domain.startsWith("http") ? domain : `https://${domain}`;
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" },
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) return null;

        const html = await res.text();

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
