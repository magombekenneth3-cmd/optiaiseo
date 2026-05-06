import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem, AuditStatus } from '../types';
import { fetchHtml } from '../utils/fetch-html';
import { parse, HTMLElement } from 'node-html-parser';
import { analyzeInternalLinksForUrl } from '../internal-links';

const MAX_HTML_BYTES = 10 * 1024 * 1024;

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'shall', 'can', 'need', 'your', 'my', 'our', 'its',
    'this', 'that', 'these', 'those', 'it',
]);

const TITLE_STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
]);

const GENERIC_ANCHOR_PHRASES = new Set([
    'click here', 'read more', 'learn more', 'here', 'more', 'this', 'link',
]);

const GENERIC_HEADING_TERMS = new Set([
    'introduction', 'overview', 'details', 'more info', 'summary', 'conclusion',
]);

const CTA_WORDS = [
    'best', 'top', 'free', 'guide', 'how to', 'review', 'vs', 'alternative',
    'cheap', 'easy', 'fast', 'quick', 'ultimate', 'complete', 'proven',
    'expert', 'professional', 'official', 'trusted', 'rated', 'award',
];

const TITLE_SEPARATORS = ['|', '–', '—', '-', ':', '·'];

const TRANSACTIONAL_TERMS = ['buy', 'price', 'software', 'platform', 'tool', 'hire'];
const INFORMATIONAL_TERMS = ['how', 'what', 'guide', 'tutorial', 'tips', 'why'];

const HIGH_ROI_SCHEMA_TYPES: { type: string; label: string }[] = [
    { type: '"@type":"faqpage"', label: 'FAQPage' },
    { type: '"@type":"product"', label: 'Product' },
    { type: '"@type":"aggregaterating"', label: 'AggregateRating/Review' },
    { type: '"@type":"organization"', label: 'Organization' },
    { type: '"@type":"article"', label: 'Article' },
    { type: '"@type":"breadcrumblist"', label: 'BreadcrumbList' },
];

const ABOVE_FOLD_NAV_PATTERN = /^(home|menu|skip to|navigation|cookie|accept|search|log in|sign in)/i;
const SUBSTANTIAL_SENTENCE_PATTERN = /[a-z]{4,}\s[a-z]{3,}\s[a-z]{3,}/;

type PageType = 'Product Page' | 'Blog / Article' | 'Homepage' | 'Category / Archive' | 'Landing Page';

interface PageTypeConfig {
    type: PageType;
    recommendations: string[];
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccardOverlap(a: string[], b: string[]): { score: number; shared: string[] } {
    const setA = new Set(a);
    const setB = new Set(b);
    const shared = [...setA].filter(w => setB.has(w));
    const union = new Set([...setA, ...setB]).size;
    return { score: union > 0 ? Math.round((shared.length / union) * 100) : 0, shared };
}

function wordFrequency(words: string[]): Record<string, number> {
    const freq: Record<string, number> = {};
    for (const w of words) {
        if (w.length > 3 && !TITLE_STOP_WORDS.has(w)) {
            freq[w] = (freq[w] ?? 0) + 1;
        }
    }
    return freq;
}

function assertMaxHtmlSize(html: string, url: string): void {
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        throw new Error(`HTML payload for ${url} exceeds the ${MAX_HTML_BYTES / (1024 * 1024)} MB limit.`);
    }
}

function detectPageType(
    url: string,
    bodyText: string,
    schemaText: string,
    root: ReturnType<typeof parse>,
): PageTypeConfig {
    const urlLower = url.toLowerCase();
    const urlPath = (() => { try { return new URL(url).pathname; } catch { return ''; } })();

    const isProduct =
        schemaText.includes('"product"') ||
        schemaText.includes('"offer"') ||
        bodyText.includes('add to cart') ||
        bodyText.includes('buy now') ||
        bodyText.includes('add to bag') ||
        root.querySelector('[class*="cart"], [class*="product-price"], [itemprop="price"]') !== null;

    const isBlog =
        urlLower.includes('/blog') ||
        urlLower.includes('/post') ||
        urlLower.includes('/news') ||
        urlLower.includes('/article') ||
        schemaText.includes('"article"') ||
        schemaText.includes('"blogposting"');

    const isHomepage = urlPath === '/' || urlPath === '';

    const isCategoryOrArchive =
        urlLower.includes('/category') ||
        urlLower.includes('/tag') ||
        urlLower.includes('/archive') ||
        root.querySelectorAll('article').length > 3;

    if (isProduct) {
        return {
            type: 'Product Page',
            recommendations: [
                'Add Product schema with aggregateRating, offers, and availability fields.',
                'Include a breadcrumb schema for navigation context.',
                'Add FAQ schema for common product questions.',
                'Ensure H1 equals the product name exactly as sold; use H2 for features, specs, and reviews.',
            ],
        };
    }
    if (isBlog) {
        return {
            type: 'Blog / Article',
            recommendations: [
                'Add Article schema with author, datePublished, and dateModified.',
                'Add FAQPage schema if the article answers questions.',
                'Include a BreadcrumbList schema.',
                'Add an author bio section (E-E-A-T signal).',
                'Internally link to 3–5 related articles and 1 pillar page.',
            ],
        };
    }
    if (isHomepage) {
        return {
            type: 'Homepage',
            recommendations: [
                'Add WebSite schema with a SearchAction for sitelinks search box.',
                'Add Organisation schema with logo, social profiles, and contact info.',
                'Ensure H1 states your primary value proposition, not just the brand name.',
                'Link to your top 5–10 most important pages from the homepage.',
            ],
        };
    }
    if (isCategoryOrArchive) {
        return {
            type: 'Category / Archive',
            recommendations: [
                'Add CollectionPage or ItemList schema.',
                'Write a unique 100–200 word category description above the listing grid.',
                'Implement pagination with rel=prev/next or use canonical for paginated pages.',
            ],
        };
    }
    return {
        type: 'Landing Page',
        recommendations: [
            'Add a single, benefit-focused H1 with your primary keyword.',
            'Include SoftwareApplication, Service, or FAQPage schema as appropriate.',
            'Ensure one clear CTA per screen fold.',
            'Add FAQPage schema below the fold to capture question-based search intent.',
        ],
    };
}

function calculateScore(items: ChecklistItem[]): { score: number; passed: number; failed: number; warnings: number } {
    const analyzable = items.filter(i => i.status !== 'Skipped' && i.status !== 'Info');
    const passed = analyzable.filter(i => i.status === 'Pass').length;
    const failed = analyzable.filter(i => i.status === 'Fail').length;
    const warnings = analyzable.filter(i => i.status === 'Warning').length;
    const score = analyzable.length > 0
        ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100)
        : 0;
    return { score, passed, failed, warnings };
}

export const OnPageModule: AuditModule = {
    id: 'on-page',
    label: 'On-Page Optimization',

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        const items: ChecklistItem[] = [];

        const html = context.html;

        if (!html) {
            return { id: OnPageModule.id, label: OnPageModule.label, items, score: 0, passed: 0, failed: 1, warnings: 0 };
        }

        assertMaxHtmlSize(html, context.url);

        const root = parse(html);

        // ── 1. HTML lang ───────────────────────────────────────────────────
        const langAttr = root.querySelector('html')?.getAttribute('lang') ?? '';
        items.push({
            id: 'html-lang',
            label: 'HTML Lang Attribute',
            status: langAttr ? 'Pass' : 'Fail',
            finding: langAttr
                ? `<html lang="${langAttr}"> detected.`
                : '<html> tag is missing the lang attribute, which harms accessibility and i18n signals.',
            recommendation: !langAttr ? { text: 'Add lang="en" (or the correct BCP-47 locale) to your <html> tag.', priority: 'High' } : undefined,
            roiImpact: 60,
            aiVisibilityImpact: 70,
            details: langAttr ? { lang: langAttr } : undefined,
        });

        // ── 2. Charset ─────────────────────────────────────────────────────
        const charsetEl = root.querySelector('meta[charset]');
        const contentType = root.querySelector('meta[http-equiv="Content-Type"]');
        const hasCharset = !!(charsetEl || contentType);
        items.push({
            id: 'charset',
            label: 'Charset Declaration',
            status: hasCharset ? 'Pass' : 'Warning',
            finding: hasCharset
                ? `Charset declared: ${charsetEl?.getAttribute('charset') ?? 'via Content-Type meta'}.`
                : 'No charset meta tag found. Browsers may misinterpret character encoding.',
            recommendation: !hasCharset ? { text: 'Add <meta charset="UTF-8"> as the first element inside <head>.', priority: 'Medium' } : undefined,
            roiImpact: 30,
            aiVisibilityImpact: 25,
        });

        // ── 3. Title Tag ───────────────────────────────────────────────────
        const title = root.querySelector('title')?.textContent.trim().replace(/\s+/g, ' ') ?? null;

        let titleStatus: AuditStatus = 'Pass';
        let titleFinding = `Title tag found (${title?.length} chars): "${title}".`;
        let titleRec: ChecklistItem['recommendation'];

        if (!title) {
            titleStatus = 'Fail';
            titleFinding = 'No title tag found. This is a critical SEO error.';
            titleRec = { text: 'Add a descriptive <title> tag (50–60 characters) containing your primary keyword.', priority: 'High' };
        } else if (title.length > 60) {
            titleStatus = 'Warning';
            titleFinding = `Title too long (${title.length} chars, max 60): "${title}". Google will truncate in SERPs.`;
            titleRec = { text: 'Shorten the title to 50–60 characters. Lead with the primary keyword.', priority: 'Medium' };
        } else if (title.length < 50) {
            titleStatus = 'Warning';
            titleFinding = `Title too short (${title.length} chars, ideal 50–60): "${title}". Wasted keyword real estate.`;
            titleRec = { text: 'Expand the title to 50–60 characters with your primary keyword and a qualifier.', priority: 'Medium' };
        }

        items.push({
            id: 'title-tag',
            label: 'Title Tag',
            status: titleStatus,
            finding: titleFinding,
            recommendation: titleRec,
            roiImpact: 90,
            aiVisibilityImpact: 80,
            details: title ? { length: title.length, value: title.slice(0, 80) } : undefined,
        });

        // ── 4. Meta Description ────────────────────────────────────────────
        const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? null;

        let descStatus: AuditStatus = 'Pass';
        let descFinding = `Meta description found (${metaDesc?.length} chars).`;
        let descRec: ChecklistItem['recommendation'];

        if (!metaDesc) {
            descStatus = 'Fail';
            descFinding = 'No meta description found. Google will auto-generate one, which is usually suboptimal.';
            descRec = { text: 'Write a compelling meta description (120–160 chars) with your primary keyword and a clear CTA.', priority: 'High' };
        } else if (metaDesc.length > 160) {
            descStatus = 'Warning';
            descFinding = `Meta description too long (${metaDesc.length} chars, max 160). Will be truncated in SERPs.`;
            descRec = { text: 'Trim to 120–160 characters. End with a CTA.', priority: 'Medium' };
        } else if (metaDesc.length < 120) {
            descStatus = 'Warning';
            descFinding = `Meta description too short (${metaDesc.length} chars, ideal 120–160). Opportunity for more keyword coverage.`;
            descRec = { text: 'Expand to 120–160 characters with targeted keywords and a CTA.', priority: 'Medium' };
        }

        items.push({
            id: 'meta-description',
            label: 'Meta Description',
            status: descStatus,
            finding: descFinding,
            recommendation: descRec,
            roiImpact: 70,
            aiVisibilityImpact: 65,
            details: metaDesc ? { length: metaDesc.length, value: metaDesc.slice(0, 100) } : undefined,
        });

        // ── 5. Canonical ───────────────────────────────────────────────────
        const canonicalEl = root.querySelector('link[rel="canonical"]');
        const canonicalHref = canonicalEl?.getAttribute('href') ?? '';

        let canonicalStatus: AuditStatus = canonicalEl ? 'Pass' : 'Fail';
        let canonicalFinding = canonicalEl
            ? `Canonical tag present: ${canonicalHref}.`
            : 'No canonical tag found. Google may pick the wrong URL, causing duplicate content issues.';
        let canonicalRec: ChecklistItem['recommendation'] = !canonicalEl
            ? { text: 'Add <link rel="canonical" href="https://yourdomain.com/this-page"> in <head> of every page.', priority: 'High' }
            : undefined;

        if (canonicalEl && canonicalHref) {
            try {
                const pageOrigin = new URL(context.url).origin;
                const canonicalOrigin = new URL(canonicalHref).origin;
                if (canonicalOrigin !== pageOrigin) {
                    canonicalStatus = 'Warning';
                    canonicalFinding = `Cross-domain canonical detected: page on ${pageOrigin} but canonical points to ${canonicalOrigin}. Verify this is intentional.`;
                    canonicalRec = { text: 'If syndicated content, this is correct. Otherwise update to a self-referencing canonical.', priority: 'Medium' };
                }
            } catch { /* malformed URL — leave status as Pass */ }
        }

        items.push({
            id: 'canonical-tag',
            label: 'Canonical Tag',
            status: canonicalStatus,
            finding: canonicalFinding,
            recommendation: canonicalRec,
            roiImpact: 80,
            aiVisibilityImpact: 70,
            details: canonicalHref ? { canonicalUrl: canonicalHref } : undefined,
        });

        // ── 6. Robots Meta ─────────────────────────────────────────────────
        const robotsMeta = root.querySelector('meta[name="robots"]');
        const robotsContent = robotsMeta?.getAttribute('content')?.toLowerCase() ?? '';
        const isNoindex = robotsContent.includes('noindex');
        const isNofollow = robotsContent.includes('nofollow');

        items.push({
            id: 'robots-meta',
            label: 'Robots Meta Tag',
            status: isNoindex ? 'Fail' : 'Pass',
            finding: isNoindex
                ? 'CRITICAL: robots meta tag contains "noindex" — this page is excluded from Google\'s index!'
                : robotsMeta
                    ? `Robots meta found: "${robotsContent}".${isNofollow ? ' Note: nofollow prevents PageRank flow.' : ''}`
                    : 'No robots meta tag (defaults to index, follow — acceptable).',
            recommendation: isNoindex
                ? { text: 'Remove the noindex directive immediately if this page should be indexed.', priority: 'High' }
                : undefined,
            roiImpact: isNoindex ? 100 : 20,
            aiVisibilityImpact: isNoindex ? 100 : 15,
            details: robotsContent ? { robotsContent } : undefined,
        });

        // ── 7. Viewport ────────────────────────────────────────────────────
        const viewport = root.querySelector('meta[name="viewport"]');
        const viewportContent = viewport?.getAttribute('content') ?? '';
        items.push({
            id: 'mobile-ux',
            label: 'Viewport / Mobile Responsiveness',
            status: viewport ? 'Pass' : 'Fail',
            finding: viewport
                ? `Viewport meta found: "${viewportContent}".`
                : 'Viewport meta tag missing — page will not render correctly on mobile. Google applies mobile-first indexing.',
            recommendation: !viewport
                ? { text: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.', priority: 'High' }
                : undefined,
            roiImpact: 95,
            aiVisibilityImpact: 90,
        });

        // ── 8. H1 ──────────────────────────────────────────────────────────
        const h1Elements = root.querySelectorAll('h1');

        let h1Status: AuditStatus = 'Pass';
        let h1Finding = h1Elements.length === 1
            ? `One H1 found: "${h1Elements[0].textContent.trim().slice(0, 80)}".`
            : '';
        let h1Rec: ChecklistItem['recommendation'];

        if (h1Elements.length === 0) {
            h1Status = 'Fail';
            h1Finding = 'No H1 tag found. Every page should have exactly one H1 defining its primary topic.';
            h1Rec = { text: 'Add a single H1 tag containing your primary keyword.', priority: 'High' };
        } else if (h1Elements.length > 1) {
            h1Status = 'Warning';
            h1Finding = `Multiple H1 tags (${h1Elements.length}) found. Only one H1 per page is best practice.`;
            h1Rec = { text: 'Consolidate to a single H1. Use H2–H6 for section headers.', priority: 'Medium' };
        }

        items.push({
            id: 'h1-tag',
            label: 'H1 Tag',
            status: h1Status,
            finding: h1Finding,
            recommendation: h1Rec,
            roiImpact: 80,
            aiVisibilityImpact: 75,
            details: { count: h1Elements.length },
        });

        // ── 9. Heading Strategy ────────────────────────────────────────────
        const allHeadings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const hierarchyIssues: string[] = [];
        let prevLevel = 0;
        let emptyHeadings = 0;
        let genericHeadings = 0;

        for (const h of allHeadings) {
            const level = parseInt(h.tagName.replace('H', ''), 10);
            const text = h.textContent.trim().toLowerCase();
            if (!text) emptyHeadings++;
            if (prevLevel > 0 && level > prevLevel + 1) {
                hierarchyIssues.push(`H${prevLevel}→H${level} skip detected`);
            }
            if (level === 2 && GENERIC_HEADING_TERMS.has(text)) genericHeadings++;
            prevLevel = level;
        }

        const uniqueHierarchyIssues = [...new Set(hierarchyIssues)];
        const strategyWarning = uniqueHierarchyIssues.length > 0 || emptyHeadings > 0 || genericHeadings > 0;

        items.push({
            id: 'header-tag-strategy',
            label: 'Header Tag Strategy (H2–H6)',
            status: strategyWarning ? 'Warning' : 'Pass',
            finding: strategyWarning
                ? `Strategy issues: ${uniqueHierarchyIssues.join('; ')}${emptyHeadings > 0 ? `; ${emptyHeadings} empty heading(s)` : ''}${genericHeadings > 0 ? `; ${genericHeadings} generic H2(s)` : ''}.`
                : `Heading strategy is solid. ${allHeadings.length} headings, correctly nested, no generic H2s.`,
            recommendation: strategyWarning ? {
                text: 'Fix heading hierarchy and replace generic headings with keyword-rich, question-based, or benefit-driven headings to capture featured snippets.',
                priority: 'Medium',
            } : undefined,
            roiImpact: 65,
            aiVisibilityImpact: 75,
            details: { totalHeadings: allHeadings.length, hierarchyIssues: uniqueHierarchyIssues.length, genericHeadings },
        });

        // ── 10. Image Alt Tags ─────────────────────────────────────────────
        const images = root.querySelectorAll('img');
        const imgsWithoutAlt = images.filter(img => img.getAttribute('alt') === null || img.getAttribute('alt') === undefined);
        const imgsWithEmptyAlt = images.filter(img => img.getAttribute('alt') === '');

        items.push({
            id: 'image-alts',
            label: 'Image Alt Tags',
            status: imgsWithoutAlt.length === 0 ? 'Pass' : 'Fail',
            finding: imgsWithoutAlt.length > 0
                ? `${imgsWithoutAlt.length} of ${images.length} images are missing alt attributes. ${imgsWithEmptyAlt.length} have empty alt="" (decorative — verify correctness).`
                : `All ${images.length} images have alt attributes. ${imgsWithEmptyAlt.length} are decorative (alt="").`,
            recommendation: imgsWithoutAlt.length > 0
                ? { text: 'Add descriptive alt text to all informational images. Use alt="" explicitly for decorative images.', priority: 'Medium' }
                : undefined,
            roiImpact: 55,
            aiVisibilityImpact: 45,
            details: { totalImages: images.length, missingAlt: imgsWithoutAlt.length, emptyAlt: imgsWithEmptyAlt.length },
        });

        // ── 11. Internal Links ─────────────────────────────────────────────
        const anchors = root.querySelectorAll('a[href]');
        let internalLinksCount = 0;
        let genericAnchorCount = 0;

        try {
            const parsedOrigin = new URL(context.url).origin;
            for (const a of anchors) {
                const href = a.getAttribute('href') ?? '';
                const anchorText = a.textContent.trim().toLowerCase();
                if (href.startsWith('/') || href.startsWith(parsedOrigin)) internalLinksCount++;
                if (GENERIC_ANCHOR_PHRASES.has(anchorText)) genericAnchorCount++;
            }
        } catch { /* invalid URL — skip count */ }

        items.push({
            id: 'internal-links',
            label: 'Internal Links',
            status: internalLinksCount >= 25 ? 'Pass' : 'Warning',
            finding: `Found ${internalLinksCount} internal link(s) (benchmark: 25+).`,
            recommendation: internalLinksCount < 25
                ? { text: 'Add more keyword-rich internal links to distribute PageRank and improve crawlability.', priority: 'Medium' }
                : undefined,
            roiImpact: 65,
            aiVisibilityImpact: 55,
            details: { internalLinks: internalLinksCount, genericAnchors: genericAnchorCount },
        });

        if (genericAnchorCount > 0) {
            items.push({
                id: 'generic-anchor-text',
                label: 'Generic Anchor Text',
                status: 'Warning',
                finding: `${genericAnchorCount} link(s) use generic anchor text ("click here", "read more", etc). These provide no keyword signal to search engines.`,
                recommendation: { text: 'Replace generic anchor text with descriptive, keyword-rich phrases that describe the destination page content.', priority: 'Medium' },
                roiImpact: 50,
                aiVisibilityImpact: 45,
                details: { genericAnchors: genericAnchorCount },
            });
        }

        // ── 12. OpenGraph ──────────────────────────────────────────────────
        const ogTitle = root.querySelector('meta[property="og:title"]');
        const ogDesc = root.querySelector('meta[property="og:description"]');
        const ogImage = root.querySelector('meta[property="og:image"]');

        items.push({
            id: 'og-title',
            label: 'OpenGraph Title (og:title)',
            status: ogTitle ? 'Pass' : 'Warning',
            finding: ogTitle ? 'og:title tag is present.' : 'Missing og:title — social platforms will struggle to display a proper title.',
            recommendation: !ogTitle ? { text: 'Add <meta property="og:title" content="..."> to <head>.', priority: 'Medium' } : undefined,
            roiImpact: 40,
            aiVisibilityImpact: 50,
        });

        items.push({
            id: 'og-description',
            label: 'OpenGraph Description (og:description)',
            status: ogDesc ? 'Pass' : 'Warning',
            finding: ogDesc ? 'og:description tag is present.' : 'Missing og:description — social platforms will struggle to display a summary snippet.',
            recommendation: !ogDesc ? { text: 'Add <meta property="og:description" content="..."> to <head>.', priority: 'Medium' } : undefined,
            roiImpact: 40,
            aiVisibilityImpact: 50,
        });

        items.push({
            id: 'og-image',
            label: 'OpenGraph Image (og:image)',
            status: ogImage ? 'Pass' : 'Fail',
            finding: ogImage
                ? 'og:image tag is present.'
                : 'Missing og:image — links shared on social media and iMessage will not unfurl a preview image, severely limiting CTR.',
            recommendation: !ogImage
                ? { text: 'Add <meta property="og:image" content="..."> with an absolute URL to a 1200×630 px image.', priority: 'High' }
                : undefined,
            roiImpact: 60,
            aiVisibilityImpact: 60,
        });

        // ── 13. Word Count ─────────────────────────────────────────────────
        const bodyText = root.querySelector('body')?.textContent ?? '';
        const wordCount = bodyText.trim().split(/\s+/).filter(w => w.length > 0).length;

        items.push({
            id: 'content-word-count',
            label: 'Content Word Count',
            status: wordCount >= 300 ? 'Pass' : 'Warning',
            finding: `Page has approximately ${wordCount} visible word(s)${wordCount < 300 ? ' (thin content — Google may deprioritise this page)' : ''}.`,
            recommendation: wordCount < 300
                ? { text: 'Aim for at least 300 words of substantive content. For competitive topics, 800–1500+ words typically outranks thin pages.', priority: 'Medium' }
                : undefined,
            roiImpact: 70,
            aiVisibilityImpact: 80,
            details: { wordCount },
        });

        // ── 14. URL Structure ──────────────────────────────────────────────
        try {
            const urlObj = new URL(context.url);
            const pathParts = urlObj.pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
            const hasParams = urlObj.search.length > 0;
            const urlLength = context.url.length;
            const isDeep = pathParts.length > 3;
            const urlIssues: string[] = [];

            if (urlLength > 115) urlIssues.push(`URL too long (${urlLength} chars, max 115)`);
            if (hasParams) urlIssues.push('URL contains query parameters — prefer clean slugs');
            if (isDeep) urlIssues.push(`URL is ${pathParts.length} levels deep (max 3 recommended)`);

            items.push({
                id: 'url-structure',
                label: 'URL Structure',
                status: urlIssues.length > 0 ? 'Warning' : 'Pass',
                finding: urlIssues.length > 0
                    ? urlIssues.join('; ') + '.'
                    : `URL is clean and ${isDeep ? 'deep' : 'shallow'} (${pathParts.length} level(s)).`,
                recommendation: urlIssues.length > 0
                    ? { text: 'Use short, keyword-rich, lowercase URLs with hyphens. Avoid query strings and deep nesting.', priority: 'Low' }
                    : undefined,
                roiImpact: 45,
                aiVisibilityImpact: 35,
                details: { urlLength, depth: pathParts.length, hasParams },
            });
        } catch { /* malformed URL — skip check */ }

        // ── 15. Favicon ────────────────────────────────────────────────────
        const favicon = root.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
        items.push({
            id: 'favicon',
            label: 'Favicon',
            status: favicon ? 'Pass' : 'Warning',
            finding: favicon ? 'Favicon detected.' : 'No favicon detected.',
            recommendation: !favicon ? { text: 'Add a favicon for better brand recognition and UX.', priority: 'Low' } : undefined,
            roiImpact: 20,
            aiVisibilityImpact: 10,
        });

        // ── 16. H1 ↔ Title Keyword Alignment ──────────────────────────────
        if (h1Elements.length > 0 && title) {
            const h1Text = h1Elements[0].textContent.trim();
            const { score: overlapScore, shared } = jaccardOverlap(tokenize(h1Text), tokenize(title));

            items.push({
                id: 'h1-keyword-alignment',
                label: 'H1 Keyword Alignment with Title',
                status: overlapScore >= 50 ? 'Pass' : overlapScore >= 25 ? 'Warning' : 'Fail',
                finding: overlapScore >= 50
                    ? `Strong alignment: H1 and title share ${overlapScore}% keyword overlap (${shared.length} terms: "${shared.slice(0, 4).join(', ')}").`
                    : overlapScore >= 25
                        ? `Partial alignment: ${overlapScore}% keyword overlap. Aligning them strengthens topical relevance.`
                        : `Weak alignment: H1 and title share almost no keywords (${overlapScore}%). H1: "${h1Text.slice(0, 60)}" vs Title: "${title.slice(0, 60)}".`,
                recommendation: overlapScore < 50 ? {
                    text: `Rewrite H1 or title to share the primary keyword. Shared words currently: ${shared.length > 0 ? shared.join(', ') : 'none'}. Example: Title "SEO Audit Tool" → H1 "Free SEO Audit Tool for Any Website".`,
                    priority: overlapScore < 25 ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 78,
                aiVisibilityImpact: 82,
                details: { h1Text: h1Text.slice(0, 80), titleText: title.slice(0, 80), overlapPercent: overlapScore, sharedWords: shared.join(', ') },
            });
        }

        // ── 17. Page Type Detection ────────────────────────────────────────
        const schemaText = root.querySelectorAll('script[type="application/ld+json"]')
            .map(s => (s.textContent ?? '').toLowerCase())
            .join(' ');
        const bodyTextLow = bodyText.toLowerCase();
        const { type: pageType, recommendations: typeRecommendations } =
            detectPageType(context.url, bodyTextLow, schemaText, root);

        (context as any).pageType = pageType;

        const h2Count = root.querySelectorAll('h2').length;
        const h3Count = root.querySelectorAll('h3').length;

        items.push({
            id: 'content-header-type',
            label: 'Content & Page Type Detection',
            status: 'Info',
            finding: `Page classified as: ${pageType} | Heading structure: ${h1Elements.length} H1, ${h2Count} H2, ${h3Count} H3.`,
            recommendation: typeRecommendations.length > 0 ? {
                text: `Recommendations for ${pageType}:\n• ${typeRecommendations.join('\n• ')}`,
                priority: 'Medium',
            } : undefined,
            roiImpact: 70,
            aiVisibilityImpact: 85,
            details: { pageType, h1Count: h1Elements.length, h2Count, h3Count },
        });

        // ── 18. Title Term Analysis ────────────────────────────────────────
        if (title) {
            const titleLower = title.toLowerCase();
            const titleWords = titleLower.split(/\s+/);
            const freq = wordFrequency(titleWords);
            const stuffedWords = Object.entries(freq).filter(([, c]) => c > 2).map(([w]) => w);
            const isStuffed = stuffedWords.length > 0;
            const hasCTA = CTA_WORDS.some(w => titleLower.includes(w));
            const hasSeparator = TITLE_SEPARATORS.some(s => title.includes(s));
            const firstThree = titleWords.slice(0, 3);
            const hasKeywordFirst = firstThree.some(w => w.length > 3 && !TITLE_STOP_WORDS.has(w));

            const primaryTerm = Object.entries(freq).sort(([, a], [, b]) => b - a)[0]?.[0]
                ?? firstThree.find(w => w.length > 3 && !TITLE_STOP_WORDS.has(w))
                ?? '';

            const metaDescText = (root.querySelector('meta[name="description"]')?.getAttribute('content') ?? '').toLowerCase();
            const termInMetaDesc = primaryTerm ? metaDescText.includes(primaryTerm) : false;

            const issues: string[] = [];
            if (isStuffed) issues.push(`Keyword stuffing: "${stuffedWords.join(', ')}" repeated > 2×`);
            if (!hasCTA) issues.push('No power word / CTA modifier (e.g. Best, Free, Guide, How to)');
            if (!hasSeparator) issues.push('No brand separator (|, –, :) to divide keyword from brand name');
            if (!hasKeywordFirst) issues.push('Primary keyword not in first 3 words (power position)');
            if (primaryTerm && !termInMetaDesc) issues.push(`Primary term "${primaryTerm}" not found in meta description`);

            items.push({
                id: 'title-term-analysis',
                label: 'Page Title Term Analysis',
                status: isStuffed ? 'Fail' : issues.length === 0 ? 'Pass' : 'Warning',
                finding: issues.length === 0
                    ? `Title is well-optimised: keyword in power position, CTA modifier present${hasSeparator ? ', brand separator detected' : ''}${termInMetaDesc ? ', primary term in meta description' : ''}.`
                    : `${issues.length} title optimisation issue(s):\n• ${issues.join('\n• ')}`,
                recommendation: issues.length > 0 ? {
                    text: [
                        !hasKeywordFirst ? '• Move your primary keyword to the first 2–3 words of the title.' : '',
                        !hasCTA ? `• Add a power modifier: "${CTA_WORDS.slice(0, 5).join(', ')}".` : '',
                        !hasSeparator ? '• Use a separator (|, –, :) to divide keyword phrase from brand name.' : '',
                        !termInMetaDesc && primaryTerm ? `• Add "${primaryTerm}" to your meta description for keyword coherence.` : '',
                        isStuffed ? `• Remove repeated keywords ("${stuffedWords.join(', ')}"). Google ignores stuffed titles.` : '',
                    ].filter(Boolean).join('\n'),
                    priority: isStuffed ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 70,
                details: { hasCTA, hasSeparator, hasKeywordFirst, isStuffed, primaryTerm, termInMetaDesc },
            });
        }

        // ── 19. Dynamic Links ──────────────────────────────────────────────
        {
            const allLinks = root.querySelectorAll('a');
            let jsHrefCount = 0;
            let onclickOnlyCount = 0;
            let dataHrefCount = 0;

            for (const a of allLinks) {
                const href = a.getAttribute('href') ?? '';
                const onclick = a.getAttribute('onclick') ?? '';
                const dataHref = a.getAttribute('data-href') ?? a.getAttribute('data-url') ?? a.getAttribute('data-target') ?? '';
                const isDynamic = href === '#' || href.startsWith('javascript:') || href === '';

                if (isDynamic) jsHrefCount++;
                if (onclick && isDynamic) onclickOnlyCount++;
                if (dataHref && isDynamic) dataHrefCount++;
            }

            const totalDynamic = jsHrefCount + dataHrefCount;
            const dynamicPatterns: string[] = [];
            if (jsHrefCount > 0) dynamicPatterns.push(`${jsHrefCount} href="#" or javascript: link(s)`);
            if (onclickOnlyCount > 0) dynamicPatterns.push(`${onclickOnlyCount} onclick-only navigation element(s) (no real href)`);
            if (dataHrefCount > 0) dynamicPatterns.push(`${dataHrefCount} data-href / data-url attribute link(s) (invisible to crawlers)`);

            items.push({
                id: 'dynamic-links',
                label: 'Dynamic Links Detection',
                status: totalDynamic === 0 ? 'Pass' : totalDynamic <= 5 ? 'Warning' : 'Fail',
                finding: totalDynamic === 0
                    ? 'No JS-only dynamic links detected. All links appear crawlable.'
                    : `${totalDynamic} dynamic link(s) that search engines cannot follow:\n• ${dynamicPatterns.join('\n• ')}`,
                recommendation: totalDynamic > 0 ? {
                    text: [
                        'Replace dynamic navigation links with real HTML href attributes:',
                        '• Change `href="#"` + onclick to `href="/real-url"` with optional JS enhancement.',
                        '• Replace `data-href="/url"` with real `href="/url"` on anchor tags.',
                        '• For SPAs (React/Next.js/Vue): use `<Link href="/page">` instead of click handlers.',
                        '• Use `<a href="/page">` styled as a button rather than `<button onclick>`.',
                        `• Fixing ${totalDynamic} dynamic link(s) makes those destinations crawlable.`,
                    ].join('\n'),
                    priority: totalDynamic > 5 ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 72,
                aiVisibilityImpact: 55,
                details: { jsHrefLinks: jsHrefCount, onclickOnlyLinks: onclickOnlyCount, dataHrefLinks: dataHrefCount, totalDynamic },
            });
        }

        // ── 20. Unsafe Cross-Origin Links ──────────────────────────────────
        {
            const targetBlankLinks = root.querySelectorAll('a[target="_blank"]');
            const unsafeCount = targetBlankLinks.filter(a => !(a.getAttribute('rel') ?? '').includes('noopener')).length;

            items.push({
                id: 'unsafe-cross-origin-links',
                label: 'Unsafe Cross-Origin Links',
                status: unsafeCount === 0 ? 'Pass' : 'Warning',
                finding: unsafeCount === 0
                    ? 'All target="_blank" links securely use rel="noopener".'
                    : `${unsafeCount} link(s) open in a new tab without rel="noopener".`,
                recommendation: unsafeCount > 0 ? {
                    text: 'Add rel="noopener noreferrer" to all target="_blank" links. Without this, the opened page runs in the same process, causing performance issues and exposing the site to reverse tabnabbing.',
                    priority: 'Medium',
                } : undefined,
                roiImpact: 50,
                aiVisibilityImpact: 10,
                details: { totalTargetBlank: targetBlankLinks.length, unsafeCount },
            });
        }

        // ── 21. Content Decay & Freshness ──────────────────────────────────
        {
            const dateNodes = root.querySelectorAll('time, .date, .post-date, [class*="date"]');
            const currentYear = new Date().getFullYear().toString();
            const hasRecentDate = [...dateNodes].some(d =>
                (d.textContent ?? '').includes(currentYear) ||
                (d.getAttribute('datetime') ?? '').includes(currentYear)
            );
            const decayRisk = (pageType === 'Blog / Article' || pageType === 'Landing Page') && !hasRecentDate && wordCount > 300;

            items.push({
                id: 'content-decay-detector',
                label: 'Content Decay & Freshness',
                status: decayRisk ? 'Warning' : 'Pass',
                finding: decayRisk
                    ? `High decay risk: no "${currentYear}" timestamp found on this content-heavy page. Search engines prioritise fresh, maintained content.`
                    : 'Content appears fresh or relies on an evergreen structure.',
                recommendation: decayRisk ? {
                    text: `Add an "Updated ${currentYear}" section, refresh stale facts, and strengthen E-E-A-T signals to maintain rankings.`,
                    priority: 'High',
                } : undefined,
                roiImpact: 85,
                aiVisibilityImpact: 80,
                details: { decayRisk, hasRecentDate },
            });
        }

        // ── 22. Search Intent Mismatch ─────────────────────────────────────
        {
            const titleLower = (title ?? '').toLowerCase();
            let titleIntent: string = 'Mixed';
            if (TRANSACTIONAL_TERMS.some(t => titleLower.includes(t))) titleIntent = 'Transactional/Commercial';
            else if (INFORMATIONAL_TERMS.some(t => titleLower.includes(t))) titleIntent = 'Informational';

            let intentMismatch = false;
            let detectedIntent = 'Mixed';

            if (pageType === 'Blog / Article' && titleIntent === 'Transactional/Commercial') {
                intentMismatch = true;
                detectedIntent = 'Informational (based on layout)';
            } else if ((pageType === 'Product Page' || pageType === 'Landing Page') && titleIntent === 'Informational') {
                intentMismatch = true;
                detectedIntent = 'Transactional (based on layout)';
            }

            items.push({
                id: 'search-intent-mapper',
                label: 'Search Intent Mismatch',
                status: intentMismatch ? 'Warning' : 'Pass',
                finding: intentMismatch
                    ? `Potential mismatch: title suggests "${titleIntent}" intent but content structure indicates "${detectedIntent}". Users and Google may bounce if expectations are not met.`
                    : 'Search intent appears aligned between page structure and title cues.',
                recommendation: intentMismatch ? {
                    text: 'Re-align page content with search intent. Restructure the introduction and H2s to satisfy the user\'s immediate informational or transactional needs.',
                    priority: 'High',
                } : undefined,
                roiImpact: 90,
                aiVisibilityImpact: 85,
                details: { intentMismatch, titleIntent, detectedIntent },
            });
        }

        // ── 23. JSON-LD Structured Data ────────────────────────────────────
        {
            const jsonLdBlocks = root.querySelectorAll('script[type="application/ld+json"]');
            const jsonLdFlat = jsonLdBlocks.map(s => (s.textContent ?? '').toLowerCase().replace(/\s/g, '')).join(' ');
            const hasJsonLd = jsonLdBlocks.length > 0;
            const presentTypes = HIGH_ROI_SCHEMA_TYPES.filter(t => jsonLdFlat.includes(t.type.replace(/\s/g, ''))).map(t => t.label);
            const missingTypes = HIGH_ROI_SCHEMA_TYPES.filter(t => !jsonLdFlat.includes(t.type.replace(/\s/g, ''))).map(t => t.label);

            let jsonLdStatus: AuditStatus = 'Fail';
            let jsonLdFinding = 'No JSON-LD structured data found. Bots and AI crawlers must parse raw HTML — rich snippets are impossible.';
            let jsonLdRec: ChecklistItem['recommendation'];

            if (hasJsonLd && presentTypes.length >= 2) {
                jsonLdStatus = 'Pass';
                jsonLdFinding = `${jsonLdBlocks.length} JSON-LD block(s) found. Present: ${presentTypes.join(', ')}.${missingTypes.length > 0 ? ` Missing high-ROI types: ${missingTypes.slice(0, 3).join(', ')}.` : ''}`;
            } else if (hasJsonLd) {
                jsonLdStatus = 'Warning';
                jsonLdFinding = `${jsonLdBlocks.length} JSON-LD block(s) found but only ${presentTypes.length} high-ROI type(s) present (${presentTypes.join(', ') || 'none recognised'}). Missing: ${missingTypes.slice(0, 3).join(', ')}.`;
                jsonLdRec = {
                    text: 'Add missing high-ROI schema types:\n• FAQPage: answers FAQ queries in AI Overviews\n• AggregateRating: star snippets for product and service pages\n• Organization: entity disambiguation for AI citation\n• BreadcrumbList: sitelinks breadcrumb in SERPs',
                    priority: 'Medium',
                };
            } else {
                jsonLdRec = {
                    text: 'Add JSON-LD to every page. Minimum for any content page:\n<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"...","author":{"@type":"Person","name":"..."}}</script>\nAlso add FAQPage (boosts AI citations) and BreadcrumbList (improves SERP display).',
                    priority: 'High',
                };
            }

            items.push({
                id: 'json-ld-schema',
                label: 'JSON-LD Structured Data',
                status: jsonLdStatus,
                finding: jsonLdFinding,
                recommendation: jsonLdRec,
                roiImpact: 88,
                aiVisibilityImpact: 95,
                details: { blockCount: jsonLdBlocks.length, presentTypes: presentTypes.join(', '), missingHighRoiTypes: missingTypes.slice(0, 4).join(', ') },
            });
        }

        // ── 24. Content-to-Code Ratio ──────────────────────────────────────
        {
            const htmlLength = html.length;
            const visibleText = (root.querySelector('body')?.textContent ?? '').replace(/\s+/g, ' ').trim();
            const textLength = visibleText.length;
            const ratio = htmlLength > 0 ? Math.round((textLength / htmlLength) * 100) : 0;

            let ratioStatus: AuditStatus = 'Pass';
            let ratioFinding = `Content-to-code ratio: ${ratio}% — good signal density for crawlers.`;
            let ratioRec: ChecklistItem['recommendation'];

            if (ratio < 10) {
                ratioStatus = 'Fail';
                ratioFinding = `Content-to-code ratio critically low: ${ratio}%. Bots parse ${htmlLength.toLocaleString()} bytes to extract ~${textLength.toLocaleString()} chars of content, raising retrieval cost and diluting keyword density.`;
                ratioRec = {
                    text: 'Reduce markup bloat:\n• Move inline <style> and <script> to external files\n• Remove unused template markup and hidden elements\n• Server-side render critical content; lazy-load supplementary blocks\n• Target: >15% content-to-code ratio',
                    priority: 'High',
                };
            } else if (ratio < 20) {
                ratioStatus = 'Warning';
                ratioFinding = `Content-to-code ratio: ${ratio}% — below ideal. Consider reducing inline CSS/JS.`;
                ratioRec = {
                    text: 'Aim for a content-to-code ratio above 20%. Move inline styles to stylesheets and reduce unused template structure.',
                    priority: 'Medium',
                };
            }

            items.push({
                id: 'content-code-ratio',
                label: 'Content-to-Code Ratio',
                status: ratioStatus,
                finding: ratioFinding,
                recommendation: ratioRec,
                roiImpact: 60,
                aiVisibilityImpact: 75,
                details: { htmlBytes: htmlLength, visibleChars: textLength, ratioPercent: ratio },
            });
        }

        // ── 25. Above-the-Fold Completeness ───────────────────────────────
        {
            const bodyClone = root.querySelector('body')?.toString() ?? '';
            const cloneRoot = parse(bodyClone);
            cloneRoot.querySelectorAll(
                'nav, header, footer, [class*="cookie"], [class*="banner"], [class*="modal"], script, style'
            ).forEach(el => el.remove());

            const firstVisibleText = (cloneRoot.textContent ?? '').replace(/\s+/g, ' ').trim();
            const above400 = firstVisibleText.slice(0, 400);
            const h1TextLow = (h1Elements[0]?.textContent.trim().toLowerCase() ?? '');
            const h1InAboveFold = h1TextLow.length > 3 && above400.toLowerCase().includes(h1TextLow.slice(0, 20));
            const hasSubstantial = above400.length > 60 && SUBSTANTIAL_SENTENCE_PATTERN.test(above400.toLowerCase());
            const navLikeOpener = above400.length < 40 || ABOVE_FOLD_NAV_PATTERN.test(above400.trim());

            let atfStatus: AuditStatus = 'Pass';
            let atfFinding = `Above-the-fold content starts with relevant text. H1 "${h1TextLow.slice(0, 50)}" is present in the opening content.`;
            let atfRec: ChecklistItem['recommendation'];

            if (navLikeOpener) {
                atfStatus = 'Fail';
                atfFinding = `Above-the-fold content opens with navigation or boilerplate rather than page content. First visible text: "${above400.slice(0, 100)}..."`;
                atfRec = {
                    text: 'Ensure the H1 and a summary sentence are the first rendered text. Move cookie banners, navigation, and modals after primary content in DOM order.',
                    priority: 'High',
                };
            } else if (!h1InAboveFold && !hasSubstantial) {
                atfStatus = 'Warning';
                atfFinding = `Above-the-fold content (first 400 chars) does not clearly contain the H1 or a keyword-dense summary. Opening: "${above400.slice(0, 120)}..."`;
                atfRec = {
                    text: 'Move the H1 and a 1–2 sentence summary to above the fold. Both users and crawlers evaluate first-visible content to determine page relevance.',
                    priority: 'Medium',
                };
            }

            items.push({
                id: 'above-fold-completeness',
                label: 'Above-the-Fold Content Completeness',
                status: atfStatus,
                finding: atfFinding,
                recommendation: atfRec,
                roiImpact: 72,
                aiVisibilityImpact: 82,
                details: { h1InAboveFold, hasSubstantialSentence: hasSubstantial, firstCharsPreview: above400.slice(0, 80) },
            });
        }

        // ── 26. Broken Internal Links & Orphan Pages ───────────────────────
        try {
            const linkAnalysis = await analyzeInternalLinksForUrl(context.url, html, { maxLinksToCheck: 40, timeout: 6000 });
            const brokenCount = linkAnalysis.brokenLinks.length;
            const orphanCount = linkAnalysis.orphanPages.length;
            const sampledCount = Math.min(40, linkAnalysis.stats.uniqueInternalLinks);

            const brokenExamples = linkAnalysis.brokenLinks.slice(0, 3)
                .map(b => `${b.url} (${b.httpStatus ?? b.error})`);

            items.push({
                id: 'broken-internal-links',
                label: 'Broken Internal Links',
                status: brokenCount >= 3 ? 'Fail' : brokenCount > 0 ? 'Warning' : 'Pass',
                finding: brokenCount > 0
                    ? `${brokenCount} broken internal link(s) detected (sampled ${sampledCount} of ${linkAnalysis.stats.uniqueInternalLinks}). Examples: ${brokenExamples.join('; ')}.`
                    : `No broken internal links detected in the ${sampledCount} sampled link(s).`,
                recommendation: brokenCount > 0 ? {
                    text: `Fix ${brokenCount} broken internal link(s). Broken links waste crawl budget and erode user trust. Use Screaming Frog or Google Search Console > Coverage to find all 404/410 responses.`,
                    priority: brokenCount >= 3 ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 80,
                aiVisibilityImpact: 65,
                details: {
                    totalLinks: linkAnalysis.stats.totalInternalLinks,
                    uniqueLinks: linkAnalysis.stats.uniqueInternalLinks,
                    brokenCount,
                    sampledCount,
                },
            });

            if (orphanCount > 0) {
                const orphanExamples = linkAnalysis.orphanPages.slice(0, 3).map(o => o.url).join(', ');
                items.push({
                    id: 'orphan-pages',
                    label: 'Orphan Pages (Sitemap vs Internal Links)',
                    status: orphanCount >= 5 ? 'Warning' : 'Info',
                    finding: `${orphanCount} page(s) in sitemap.xml with no inbound internal link from this page. Orphan pages receive no PageRank and are deprioritised by crawlers. Examples: ${orphanExamples}.`,
                    recommendation: orphanCount >= 3 ? {
                        text: `Link to the ${orphanCount} orphan page(s) from relevant sections or from a hub/category page. Internal links are the primary mechanism for authority distribution.`,
                        priority: 'Medium',
                    } : undefined,
                    roiImpact: 65,
                    aiVisibilityImpact: 55,
                    details: { orphanCount, examples: orphanExamples },
                });
            }
        } catch {
            items.push({
                id: 'broken-internal-links',
                label: 'Broken Internal Links',
                status: 'Info',
                finding: 'Internal link analysis could not complete (network timeout or parsing error). Run manually with Screaming Frog.',
                roiImpact: 80,
                aiVisibilityImpact: 65,
            });
        }

        // ── Score ──────────────────────────────────────────────────────────
        const { score, passed, failed, warnings } = calculateScore(items);

        return {
            id: OnPageModule.id,
            label: OnPageModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        };
    },
};