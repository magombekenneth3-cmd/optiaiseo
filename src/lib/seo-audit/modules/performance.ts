import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
import { fetchHtml } from '../utils/fetch-html';
import { parse } from 'node-html-parser';

const MAX_HTML_BYTES = 10 * 1024 * 1024;

const HERO_SELECTOR = 'main img, header img, section img, [class*="hero"] img, [class*="banner"] img';

const ABOVE_FOLD_IMG_COUNT = 3;
const LARGE_SVG_THRESHOLD_BYTES = 1000;
const LARGE_SVG_COUNT_THRESHOLD = 5;
const BLOCKING_SCRIPT_THRESHOLD = 2;
const MISSING_LAZY_THRESHOLD = 3;
const LEGACY_IMG_THRESHOLD = 3;

const PRECONNECT_RE = /rel=["']preconnect["']/i;
const PRELOAD_RE = /rel=["']preload["']/i;

function assertMaxHtmlSize(html: string, url: string): void {
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        throw new Error(`HTML payload for ${url} exceeds the ${MAX_HTML_BYTES / (1024 * 1024)} MB limit.`);
    }
}

function calculateScore(items: ChecklistItem[]): AuditCategoryResult {
    const passed = items.filter(i => i.status === 'Pass' || i.status === 'Info').length;
    const failed = items.filter(i => i.status === 'Fail').length;
    const warnings = items.filter(i => i.status === 'Warning').length;
    const total = passed + failed + warnings;
    const score = total > 0 ? Math.round(((passed + warnings * 0.5) / total) * 100) : 100;

    return {
        id: PerformanceModule.id,
        label: PerformanceModule.label,
        items,
        score,
        passed,
        failed,
        warnings,
    };
}

export const PerformanceModule: AuditModule = {
    id: 'performance',
    label: 'Performance',

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        const html = context.html;

        if (!html) {
            return calculateScore([{
                id: 'perf-fetch-error',
                label: 'Performance Audit',
                status: 'Fail',
                finding: 'Could not fetch page HTML — performance checks skipped.',
                roiImpact: 0,
                aiVisibilityImpact: 0,
            }]);
        }

        assertMaxHtmlSize(html, context.url);

        const root = parse(html);
        const items: ChecklistItem[] = [];

        {
            const heroImg = root.querySelector(HERO_SELECTOR) ?? root.querySelector('img');
            const heroLoading = heroImg?.getAttribute('loading') ?? '';
            const heroFetchpri = heroImg?.getAttribute('fetchpriority') ?? '';
            const heroIsLazy = heroLoading === 'lazy';
            const hasPriority = heroFetchpri === 'high';

            items.push({
                id: 'lcp-hero-image',
                label: 'LCP Hero Image Priority',
                status: heroIsLazy ? 'Fail' : hasPriority ? 'Pass' : 'Warning',
                finding: heroIsLazy
                    ? 'Above-fold hero image has loading="lazy". Lazy-loading the LCP element directly harms Core Web Vitals LCP score.'
                    : hasPriority
                        ? 'Hero image is correctly prioritised with fetchpriority="high".'
                        : 'Hero image is not lazy-loaded (good), but is missing fetchpriority="high". Adding it tells the browser to fetch it at the highest priority.',
                recommendation: heroIsLazy ? {
                    text: 'Remove loading="lazy" from the LCP hero image. Optionally add fetchpriority="high" to further accelerate browser prioritisation.',
                    priority: 'High',
                } : !hasPriority ? {
                    text: 'Add fetchpriority="high" to the first above-fold <img>. Combined with <link rel="preload"> in <head>, this can reduce LCP by 200–500 ms.',
                    priority: 'Low',
                } : undefined,
                roiImpact: 88,
                aiVisibilityImpact: 70,
                details: { loading: heroLoading || 'not set', fetchpriority: heroFetchpri || 'not set' },
            });
        }

        {
            const allImgs = root.querySelectorAll('img');
            const belowFoldImgs = allImgs.slice(ABOVE_FOLD_IMG_COUNT);
            const missingLazy = belowFoldImgs.filter(img => img.getAttribute('loading') !== 'lazy');

            items.push({
                id: 'lazy-load-images',
                label: 'Below-Fold Image Lazy Loading',
                status: missingLazy.length === 0 ? 'Pass'
                    : missingLazy.length <= MISSING_LAZY_THRESHOLD ? 'Warning'
                        : 'Fail',
                finding: missingLazy.length === 0
                    ? `All ${belowFoldImgs.length} below-fold image(s) correctly use loading="lazy".`
                    : `${missingLazy.length} of ${belowFoldImgs.length} below-fold image(s) are missing loading="lazy". Each defers load completion and wastes bandwidth for users who never scroll.`,
                recommendation: missingLazy.length > 0 ? {
                    text: 'Add loading="lazy" to all <img> tags that appear below the first visible screen. This defers download until the user scrolls near them, reducing initial page weight and improving Time to Interactive.',
                    priority: missingLazy.length > MISSING_LAZY_THRESHOLD ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 72,
                aiVisibilityImpact: 55,
                details: { totalBelowFoldImgs: belowFoldImgs.length, missingLazyCount: missingLazy.length },
            });
        }

        {
            const allImgs = root.querySelectorAll('img');
            const legacyImgs = allImgs.filter(img => {
                const src = (img.getAttribute('src') ?? '').toLowerCase();
                return !src.startsWith('data:') &&
                    (src.endsWith('.jpg') || src.endsWith('.jpeg') || src.endsWith('.png'));
            });
            const pictureCount = root.querySelectorAll('picture').length;

            items.push({
                id: 'image-format-audit',
                label: 'Next-Gen Image Formats (WebP/AVIF)',
                status: legacyImgs.length === 0 ? 'Pass'
                    : pictureCount > 0 ? 'Warning'
                        : 'Fail',
                finding: legacyImgs.length === 0
                    ? 'No legacy JPEG/PNG images detected — modern formats are in use.'
                    : pictureCount > 0
                        ? `${legacyImgs.length} JPEG/PNG image(s) found, but ${pictureCount} <picture> element(s) exist — some may already deliver WebP. Audit <picture> sources to ensure full coverage.`
                        : `${legacyImgs.length} JPEG/PNG image(s) without <picture> or .webp/.avif alternatives. Serving legacy formats adds unnecessary page weight and slows LCP.`,
                recommendation: legacyImgs.length > 0 ? {
                    text: 'Convert images to WebP (use Sharp, Squoosh, or Next.js <Image>). Wrap each in a <picture> with WebP/AVIF <source> and the original as fallback. Next.js users: <Image> from next/image serves WebP/AVIF automatically.',
                    priority: legacyImgs.length > LEGACY_IMG_THRESHOLD ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 50,
                details: { legacyImageCount: legacyImgs.length, pictureElements: pictureCount },
            });
        }

        {
            const headHtml = root.querySelector('head')?.innerHTML ?? '';
            const hasPreconnect = PRECONNECT_RE.test(headHtml);
            const hasPreload = PRELOAD_RE.test(headHtml);
            const hasGoogleFonts = headHtml.includes('fonts.googleapis.com') || headHtml.includes('fonts.gstatic.com');
            const missingFontPreconn = hasGoogleFonts && !headHtml.includes('fonts.gstatic.com');
            const isDeficient = (!hasPreconnect && !hasPreload) || missingFontPreconn;

            const recommendationLines = [
                hasGoogleFonts && missingFontPreconn
                    ? '• Add: <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin> for Google Fonts.'
                    : '',
                !hasPreload
                    ? '• Add <link rel="preload" as="image" href="/hero.webp"> for your LCP hero image, and <link rel="preload" as="font"> for your primary font file.'
                    : '',
                !hasPreconnect
                    ? '• Add <link rel="preconnect"> for any third-party origins (CDN, analytics, font hosts) your page relies on.'
                    : '',
            ].filter(Boolean).join('\n');

            items.push({
                id: 'resource-hints',
                label: 'Resource Hints (Preconnect / Preload)',
                status: isDeficient ? 'Warning' : 'Pass',
                finding: !hasPreconnect && !hasPreload
                    ? 'No <link rel="preconnect"> or <link rel="preload"> found. Adding resource hints tells the browser to establish connections early, reducing latency for critical resources.'
                    : missingFontPreconn
                        ? 'Google Fonts detected but no preconnect to fonts.gstatic.com. Without this, font download is delayed, causing a flash of invisible text (FOIT) that hurts LCP and CLS.'
                        : `Resource hints present: preconnect=${hasPreconnect ? 'yes' : 'no'}, preload=${hasPreload ? 'yes' : 'no'}.`,
                recommendation: isDeficient && recommendationLines ? {
                    text: recommendationLines,
                    priority: 'Medium',
                } : undefined,
                roiImpact: 65,
                aiVisibilityImpact: 45,
                details: { hasPreconnect, hasPreload, hasGoogleFonts, missingFontPreconnect: missingFontPreconn },
            });
        }

        {
            const headScripts = root.querySelector('head')?.querySelectorAll('script[src]') ?? [];
            const blockingScripts = headScripts.filter(s =>
                !s.hasAttribute('defer') &&
                !s.hasAttribute('async') &&
                !(s.getAttribute('type') ?? '').includes('module')
            );

            items.push({
                id: 'render-blocking-scripts',
                label: 'Render-Blocking Scripts',
                status: blockingScripts.length === 0 ? 'Pass'
                    : blockingScripts.length <= BLOCKING_SCRIPT_THRESHOLD ? 'Warning'
                        : 'Fail',
                finding: blockingScripts.length === 0
                    ? 'No render-blocking scripts found in <head> — all scripts are deferred or async.'
                    : `${blockingScripts.length} render-blocking <script src> tag(s) in <head> without defer or async. Each pauses HTML parsing and delays First Contentful Paint.`,
                recommendation: blockingScripts.length > 0 ? {
                    text: 'Add defer or async to all <script src="..."> tags in <head>. Use defer (preferred) for scripts that need the DOM. Use async for independent scripts (analytics, ads). Move non-critical scripts to the end of <body> as a fallback.',
                    priority: blockingScripts.length > BLOCKING_SCRIPT_THRESHOLD ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 80,
                aiVisibilityImpact: 60,
                details: { blockingScriptCount: blockingScripts.length },
            });
        }

        {
            const styleText = root.querySelectorAll('style').map(s => s.textContent ?? '').join(' ');
            const hasWebFont = styleText.includes('@font-face') || html.includes('fonts.googleapis.com');
            const hasFontSwap = styleText.includes('font-display:swap') || styleText.includes('font-display: swap');

            items.push({
                id: 'font-display-swap',
                label: 'Font Display Strategy',
                status: !hasWebFont || hasFontSwap ? 'Pass' : 'Warning',
                finding: !hasWebFont
                    ? 'No web fonts detected via @font-face. System fonts render instantly — no action needed.'
                    : hasFontSwap
                        ? 'font-display:swap is present — fonts fall back to system font while loading, preventing FOIT.'
                        : 'Web font detected without font-display:swap. Browsers block text rendering while the font downloads, causing Flash of Invisible Text (FOIT) that damages LCP.',
                recommendation: hasWebFont && !hasFontSwap ? {
                    text: 'Add font-display:swap to every @font-face rule. For Google Fonts, append &display=swap to the font URL. This prevents invisible text during font load.',
                    priority: 'Medium',
                } : undefined,
                roiImpact: 60,
                aiVisibilityImpact: 40,
                details: { hasWebFont, hasFontSwap },
            });
        }

        {
            const inlineSvgs = root.querySelectorAll('body svg');
            const largeSvgs = inlineSvgs.filter(s => (s.innerHTML ?? '').length > LARGE_SVG_THRESHOLD_BYTES);

            if (inlineSvgs.length > 0) {
                items.push({
                    id: 'inline-svg-bloat',
                    label: 'Inline SVG Bloat',
                    status: largeSvgs.length > LARGE_SVG_COUNT_THRESHOLD ? 'Warning' : 'Pass',
                    finding: largeSvgs.length > LARGE_SVG_COUNT_THRESHOLD
                        ? `${largeSvgs.length} large inline SVGs detected (>${LARGE_SVG_THRESHOLD_BYTES} bytes each). Inlining many complex SVGs adds significant bytes to the HTML payload and increases parse time.`
                        : `${inlineSvgs.length} inline SVG(s) found — within acceptable range.`,
                    recommendation: largeSvgs.length > LARGE_SVG_COUNT_THRESHOLD ? {
                        text: 'Move complex or repeated SVGs to an external sprite file and reference them with <use href="/sprite.svg#icon-name">. This enables browser caching and reduces per-page HTML weight.',
                        priority: 'Low',
                    } : undefined,
                    roiImpact: 40,
                    aiVisibilityImpact: 20,
                    details: { totalInlineSvgs: inlineSvgs.length, largeSvgCount: largeSvgs.length },
                });
            }
        }

        return calculateScore(items);
    },
};