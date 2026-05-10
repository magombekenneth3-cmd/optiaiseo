import { parse } from 'node-html-parser';
import { isSafeUrl } from '@/lib/security/safe-url';

// =============================================================================
// ON-PAGE SEO CHECKER
// Fetches a page's HTML and analyses SEO elements — READ ONLY.
// Never modifies, injects into, or writes to the target site.
// =============================================================================

// Google truncates titles at ~580px, not character count.
const CHAR_WIDTHS: Record<string, number> = {
    default: 7, ' ': 3,
    'i': 4, 'l': 4, '1': 4, 'f': 4, 'j': 4, 'r': 5, 't': 5,
    'w': 11, 'm': 11, 'W': 13, 'M': 13,
};

function estimateTitlePx(text: string): number {
    return [...text].reduce((sum, c) => sum + (CHAR_WIDTHS[c] ?? CHAR_WIDTHS.default), 0);
}

const BAD_ALT_REGEX = /^(img|image|photo|pic|banner|logo|icon|thumbnail)[-_]?\d*$/i;

export interface OnPageIssue {
    type: string
    severity: "critical" | "warning" | "info"
    message: string
    recommendation: string
    element?: string
}

export interface OnPageResult {
    url: string
    score: number
    title: string | null
    metaDescription: string | null
    h1: string | null
    issues: OnPageIssue[]
    passed: string[]
    stats: {
        wordCount: number
        imageCount: number
        imagesWithAlt: number
        internalLinks: number
        externalLinks: number
        h2Count: number
        h3Count: number
        keywordInTitle?: boolean
        keywordInH1?: boolean
        keywordInH2Count?: number
        keywordDensityBody?: number
        keywordCount?: number
    }
}

export const runOnPageAudit = async (url: string, targetKeyword?: string): Promise<OnPageResult> => {
    let html: string;
    let contentType: string | null = null;

    try {
        const urlGuard = isSafeUrl(url);
        if (!urlGuard.ok) {
            return {
                url, score: 0, title: null, metaDescription: null, h1: null,
                issues: [{ type: "ssrf_blocked", severity: "critical", message: `URL blocked: ${urlGuard.error ?? "private or unsafe host"}`, recommendation: "Only public URLs may be audited." }],
                passed: [],
                stats: { wordCount: 0, imageCount: 0, imagesWithAlt: 0, internalLinks: 0, externalLinks: 0, h2Count: 0, h3Count: 0 },
            };
        }

        const res = await fetch(url, {
            headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`);

        contentType = res.headers.get("content-type");
        if (contentType && !contentType.includes("text/html")) {
            return {
                url, score: 0, title: null, metaDescription: null, h1: null,
                issues: [{ type: "invalid_content_type", severity: "critical", message: `URL returned non-HTML content: ${contentType}`, recommendation: "Ensure the URL points to an HTML page." }],
                passed: [],
                stats: { wordCount: 0, imageCount: 0, imagesWithAlt: 0, internalLinks: 0, externalLinks: 0, h2Count: 0, h3Count: 0 },
            };
        }

        html = await res.text();
     
     
    } catch (err: unknown) {
        return {
            url, score: 0, title: null, metaDescription: null, h1: null,
            issues: [{ type: "fetch_error", severity: "critical", message: `Could not fetch page: ${(err as Error).message}`, recommendation: "Ensure the URL is publicly accessible" }],
            passed: [],
            stats: { wordCount: 0, imageCount: 0, imagesWithAlt: 0, internalLinks: 0, externalLinks: 0, h2Count: 0, h3Count: 0 },
        };
    }

    const issues: OnPageIssue[] = [];
    const passed: string[] = [];

    // Parse HTML
    const root = parse(html);

    const titleElement = root.querySelector('title');
    const title = titleElement ? titleElement.textContent.trim().replace(/\s+/g, " ") : null;

    if (!title) {
        issues.push({ type: "missing_title", severity: "critical", message: "Page has no title tag", recommendation: "Add a unique, descriptive title tag between 50-60 characters" });
    } else if (title.length < 30) {
        issues.push({ type: "title_too_short", severity: "warning", message: `Title is too short (${title.length} chars): "${title}"`, recommendation: "Expand the title to 50-60 characters", element: title });
    } else {
        // FIX #1: Use pixel-width estimation (Google truncates at ~580px)
        const titlePx = estimateTitlePx(title);
        if (titlePx > 580) {
            issues.push({ type: "title_too_wide", severity: "warning", message: `Title exceeds ~580px (${titlePx}px est.) — will be truncated in SERPs`, recommendation: "Shorten title — Google truncates at ~580px regardless of character count.", element: title });
        } else {
            passed.push(`Title tag is good length (~${titlePx}px / ${title.length} chars)`);
        }
    }

    const metaDescElement = root.querySelector('meta[name="description"]') || root.querySelector('meta[property="og:description"]');
    const metaDescription = metaDescElement ? metaDescElement.getAttribute('content')?.trim() || null : null;

    if (!metaDescription) {
        issues.push({ type: "missing_meta_description", severity: "critical", message: "No meta description found", recommendation: "Add a meta description between 140-160 characters" });
    } else if (metaDescription.length < 100) {
        issues.push({ type: "meta_description_short", severity: "warning", message: `Meta description is short (${metaDescription.length} chars)`, recommendation: "Expand to 140-160 characters", element: metaDescription });
    } else if (metaDescription.length > 160) {
        issues.push({ type: "meta_description_long", severity: "warning", message: `Meta description too long (${metaDescription.length} chars)`, recommendation: "Trim to under 160 characters", element: metaDescription });
    } else {
        passed.push(`Meta description is good length (${metaDescription.length} chars)`);
    }

    const h1Elements = root.querySelectorAll('h1');
    const h1Text = h1Elements.length > 0 ? h1Elements[0].textContent.trim().replace(/\s+/g, " ") : null;

    if (h1Elements.length === 0) {
        issues.push({ type: "missing_h1", severity: "critical", message: "No H1 tag found", recommendation: "Add exactly one H1 tag with your primary keyword" });
    } else if (h1Elements.length > 1) {
        issues.push({ type: "multiple_h1", severity: "warning", message: `Found ${h1Elements.length} H1 tags — should be exactly one`, recommendation: "Use only one H1 per page", element: h1Text ?? undefined });
    } else {
        passed.push(`Single H1 tag found: "${h1Text}"`);
    }

    const h2Elements = root.querySelectorAll('h2');
    const h3Elements = root.querySelectorAll('h3');

    if (h2Elements.length === 0) {
        issues.push({ type: "no_h2", severity: "warning", message: "No H2 headings found", recommendation: "Add H2 headings to structure your content" });
    } else {
        passed.push(`${h2Elements.length} H2 headings found`);
    }

    const canonicalElement = root.querySelector('link[rel="canonical"]');
    const canonicalUrl = canonicalElement?.getAttribute('href');
    if (!canonicalUrl) {
        issues.push({ type: "missing_canonical", severity: "warning", message: "No canonical tag found", recommendation: 'Add <link rel="canonical" href="YOUR_URL"> to prevent duplicate content' });
    } else {
        passed.push(`Canonical tag present: ${canonicalUrl}`);
    }

    // FIX #4: hreflang / multilingual tag audit ────────────────────────────────
    const hreflangTags = root.querySelectorAll('link[rel="alternate"]').filter(t => t.getAttribute('hreflang'));
    if (hreflangTags.length > 0) {
        const langs = hreflangTags.map(t => t.getAttribute('hreflang') || '');
        const hasDefault = langs.includes('x-default');
        const hasSelfRef = hreflangTags.some(t => t.getAttribute('href') === url);
        const invalidLangs = langs.filter(l => l !== 'x-default' && !/^[a-z]{2}(-[A-Z]{2})?$/.test(l));
        if (!hasDefault) {
            issues.push({ type: 'hreflang_missing_xdefault', severity: 'warning', message: 'hreflang tags found but x-default is missing', recommendation: 'Add <link rel="alternate" hreflang="x-default" href="..."> for the default language fallback.' });
        }
        if (!hasSelfRef) {
            issues.push({ type: 'hreflang_missing_selfref', severity: 'info', message: 'No self-referential hreflang tag for the current URL', recommendation: 'Add a hreflang tag pointing to the current page URL for the canonical language.' });
        }
        if (invalidLangs.length > 0) {
            issues.push({ type: 'hreflang_invalid_codes', severity: 'warning', message: `Invalid hreflang language codes: ${invalidLangs.join(', ')}`, recommendation: 'Use BCP-47 format (e.g. en-US, fr-FR, es).' });
        }
        if (hasDefault && hasSelfRef && invalidLangs.length === 0) {
            passed.push(`hreflang tags correctly implemented (${hreflangTags.length} language variants)`);
        }
    }

    // FIX #5: robots meta max-snippet / max-image-preview check ───────────────
    const robotsMeta = root.querySelector('meta[name="robots"]');
    const robotsContent = robotsMeta?.getAttribute('content') || '';
    if (!robotsContent.includes('max-snippet:-1')) {
        issues.push({
            type: 'robots_max_snippet',
            severity: 'info',
            message: 'max-snippet not set to -1 in robots meta tag',
            recommendation: 'Add content="max-snippet:-1" to your robots meta tag to allow full snippets in SERPs and improve Google AI Overview eligibility.',
        });
    } else {
        passed.push('max-snippet:-1 enabled — full snippet display allowed');
    }
    if (!robotsContent.includes('max-image-preview:large')) {
        issues.push({
            type: 'robots_max_image_preview',
            severity: 'info',
            message: 'max-image-preview not set to "large" in robots meta tag',
            recommendation: 'Add max-image-preview:large to allow large image previews in search results.',
        });
    } else {
        passed.push('max-image-preview:large enabled');
    }

    const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const ogDescription = root.querySelector('meta[property="og:description"]')?.getAttribute('content');
    const ogImage = root.querySelector('meta[property="og:image"]')?.getAttribute('content');

    if (!ogTitle) issues.push({ type: "missing_og_title", severity: "info", message: "Missing og:title meta tag", recommendation: "Add Open Graph tags for better social sharing" });
    if (!ogDescription) issues.push({ type: "missing_og_description", severity: "info", message: "Missing og:description meta tag", recommendation: "Add og:description for social previews" });
    if (!ogImage) issues.push({ type: "missing_og_image", severity: "info", message: "Missing og:image meta tag", recommendation: "Add og:image with 1200x630 image" });
    if (ogTitle && ogDescription && ogImage) passed.push("Open Graph tags complete");

    const imgElements = root.querySelectorAll('img');
    const imgsWithAlt = imgElements.filter(img => {
        const alt = img.getAttribute('alt');
        return alt !== undefined && alt !== null && alt.trim() !== '';
    });
    const imgsMissingAltCount = imgElements.length - imgsWithAlt.length;

    if (imgsMissingAltCount > 0) {
        issues.push({ type: "images_missing_alt", severity: imgsMissingAltCount > 3 ? "critical" : "warning", message: `${imgsMissingAltCount} of ${imgElements.length} images are missing alt text`, recommendation: "Add descriptive alt attributes to all images" });
    } else if (imgElements.length > 0) {
        passed.push(`All ${imgElements.length} images have alt text`);
    }

    // FIX #3: Alt text quality scoring — flag low-quality alts (not just missing)
    const suspiciousAlts = imgElements
        .filter(img => {
            const alt = img.getAttribute('alt');
            if (!alt || alt.trim() === '') return false;
            const trimmed = alt.trim();
            return trimmed.length < 5 || BAD_ALT_REGEX.test(trimmed) || (trimmed.match(/,/g) || []).length > 3;
        })
        .map(img => img.getAttribute('alt')!.trim());

    if (suspiciousAlts.length > 0) {
        issues.push({
            type: 'poor_alt_text_quality',
            severity: 'warning',
            message: `${suspiciousAlts.length} image(s) have low-quality alt text (e.g. "${suspiciousAlts[0]}")`,
            recommendation: 'Alt text should be descriptive (10–125 chars), not a filename or keyword list.',
            element: suspiciousAlts[0],
        });
    }

    const schemaElements = root.querySelectorAll('script[type="application/ld+json"]');
    const hasSchema = schemaElements.length > 0 || html.includes("itemtype=");
    if (!hasSchema) {
        issues.push({ type: "no_schema", severity: "info", message: "No structured data (schema markup) detected", recommendation: "Add JSON-LD schema markup for rich search results" });
    } else {
        passed.push("Structured data detected");
    }

    const bodyText = (root.querySelector('body') || root).textContent;
    const textContent = bodyText.replace(/\s+/g, " ").trim();
    const wordCount = textContent.split(" ").filter(w => w.length > 2).length;

    if (wordCount < 300) {
        issues.push({ type: "thin_content", severity: "critical", message: `Very thin content — only ~${wordCount} words`, recommendation: "Aim for at least 600 words of quality content" });
    } else if (wordCount < 600) {
        issues.push({ type: "low_word_count", severity: "warning", message: `Low word count — ~${wordCount} words`, recommendation: "Consider expanding to 800+ words" });
    } else {
        passed.push(`Good content length (~${wordCount} words)`);
    }

    const linkElements = root.querySelectorAll('a[href]');
    let parsedOrigin: string;
    try { parsedOrigin = new URL(url).origin; } catch { parsedOrigin = ""; }

    const internalLinks = linkElements.filter(a => {
        const href = a.getAttribute('href') || '';
        return href.startsWith("/") || href.startsWith(parsedOrigin);
    }).length;
    const externalLinks = linkElements.length - internalLinks;

    if (internalLinks < 2) {
        issues.push({ type: "few_internal_links", severity: "info", message: `Only ${internalLinks} internal links found`, recommendation: "Add more internal links to improve site structure" });
    } else {
        passed.push(`${internalLinks} internal links found`);
    }

    type KeywordStats = {
        keywordInTitle?: boolean; keywordInH1?: boolean; keywordInH2Count?: number;
        keywordDensityBody?: number; keywordCount?: number;
    };
    let keywordStats: KeywordStats = {};
    if (targetKeyword) {
        const kw = targetKeyword.toLowerCase();

        const titleText = (title || "").toLowerCase();
        const kwInTitle = titleText.includes(kw);

        const h1TextContent = (h1Text || "").toLowerCase();
        const kwInH1 = h1TextContent.includes(kw);

        const kwInH2Count = Array.from(h2Elements).filter(el => el.textContent.toLowerCase().includes(kw)).length;

        const fullTextLower = textContent.toLowerCase();
        const kwCount = fullTextLower.split(kw).length - 1;
        const kwDensityBody = wordCount > 0 ? (kwCount / wordCount) * 100 : 0;

        keywordStats = {
            keywordInTitle: kwInTitle,
            keywordInH1: kwInH1,
            keywordInH2Count: kwInH2Count,
            keywordDensityBody: kwDensityBody,
            keywordCount: kwCount
        };

        if (!kwInTitle) issues.push({ type: "missing_keyword_title", severity: "warning", message: `Title missing target keyword: "${targetKeyword}"`, recommendation: "Include your primary keyword in the page title." });
        else passed.push("Keyword found in title");

        if (!kwInH1) issues.push({ type: "missing_keyword_h1", severity: "warning", message: `H1 missing target keyword: "${targetKeyword}"`, recommendation: "Include your primary keyword in the main H1 heading." });
        else passed.push("Keyword found in H1");
        
        if (kwInH2Count === 0) issues.push({ type: "missing_keyword_h2", severity: "info", message: `No H2 headings contain the target keyword`, recommendation: "Try to naturally include the keyword or variations in at least one H2." });
        else passed.push(`Keyword found in ${kwInH2Count} H2 heading(s)`);

        // FIX #2: Keyword-in-URL slug check ────────────────────────────────────
        try {
            const urlSlug = new URL(url).pathname.replace(/[-_/]/g, ' ').toLowerCase().trim();
            const kwInUrl = urlSlug.includes(kw);
            if (!kwInUrl) {
                issues.push({
                    type: 'missing_keyword_url',
                    severity: 'warning',
                    message: `URL slug missing target keyword: "${targetKeyword}"`,
                    recommendation: 'Include your primary keyword in the URL path for a stronger on-page signal.',
                });
            } else {
                passed.push('Keyword present in URL slug');
            }
        } catch { /* invalid URL — skip */ }
    }

    const criticalIssues = issues.filter(i => i.severity === "critical").length;
    const warningIssues = issues.filter(i => i.severity === "warning").length;
    const score = Math.max(0, 100 - (criticalIssues * 20) - (warningIssues * 8));

    return {
        url, score, title, metaDescription, h1: h1Text, issues, passed,
        stats: { 
            wordCount, imageCount: imgElements.length, 
            imagesWithAlt: imgsWithAlt.length, internalLinks, 
            externalLinks, h2Count: h2Elements.length, h3Count: h3Elements.length,
            ...keywordStats 
        },
    };
};
