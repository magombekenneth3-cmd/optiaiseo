import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
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

interface PsiAudits {
    'largest-contentful-paint'?: { numericValue: number };
    'cumulative-layout-shift'?: { numericValue: number };
    'interaction-to-next-paint'?: { numericValue: number };
    'max-potential-fid'?: { numericValue: number };
    'total-blocking-time'?: { numericValue: number };
    'speed-index'?: { numericValue: number };
    'server-response-time'?: { numericValue: number };
    'first-contentful-paint'?: { numericValue: number };
}

interface PsiResponse {
    lighthouseResult?: { audits: PsiAudits };
}

interface CruxMetrics {
    largest_contentful_paint?: { percentiles: { p75: number } };
    interaction_to_next_paint?: { percentiles: { p75: number } };
    cumulative_layout_shift?: { percentiles: { p75: number } };
    first_input_delay?: { percentiles: { p75: number } };
    first_contentful_paint?: { percentiles: { p75: number } };
    experimental_time_to_first_byte?: { percentiles: { p75: number } };
}

interface CruxResponse {
    record?: { metrics: CruxMetrics };
}

async function fetchWithRedisCache<T>(key: string, fetcher: () => Promise<T | null>, ttlSeconds = 86400): Promise<T | null> {
    try {
        const { redis } = await import('@/lib/redis');
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached as string) as T;
        const result = await fetcher();
        if (result) {
            await redis.set(key, JSON.stringify(result), { ex: ttlSeconds }).catch(() => null);
        }
        return result;
    } catch {
        return fetcher().catch(() => null);
    }
}

async function fetchPsi(url: string, strategy: 'mobile' | 'desktop'): Promise<PsiResponse | 'timeout' | null> {
    const key = `psi:perf:${strategy}:v1:${url}`;
    return fetchWithRedisCache<PsiResponse | 'timeout'>(key, async () => {
        const apiKey = process.env.PAGESPEED_API_KEY;
        const keyParam = apiKey ? `&key=${apiKey}` : '';
        const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}${keyParam}&strategy=${strategy}&category=PERFORMANCE`;
        try {
            const res = await fetch(psiUrl, { signal: AbortSignal.timeout(25000) });
            if (!res.ok) return null;
            return await res.json() as PsiResponse;
        } catch (e: unknown) {
            if ((e as { name?: string }).name === 'TimeoutError') return 'timeout';
            return null;
        }
    });
}

async function fetchCrux(url: string, formFactor: 'PHONE' | 'DESKTOP'): Promise<CruxResponse | null> {
    const apiKey = process.env.PAGESPEED_API_KEY;
    if (!apiKey) return null;
    const key = `crux:perf:${formFactor.toLowerCase()}:v1:${url}`;
    return fetchWithRedisCache<CruxResponse>(key, async () => {
        try {
            const res = await fetch(
                `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, formFactor }),
                    signal: AbortSignal.timeout(12000),
                }
            );
            if (!res.ok) return null;
            return await res.json() as CruxResponse;
        } catch {
            return null;
        }
    });
}

function icon(value: number, good: number, poor: number): string {
    return value <= good ? '✓' : value <= poor ? '⚠' : '✗';
}

function lcpStatus(secs: number): 'Pass' | 'Warning' | 'Fail' {
    return secs <= 2.5 ? 'Pass' : secs <= 4.0 ? 'Warning' : 'Fail';
}

function clsStatusFn(val: number): 'Pass' | 'Warning' | 'Fail' {
    return val <= 0.1 ? 'Pass' : val <= 0.25 ? 'Warning' : 'Fail';
}

function inpStatus(ms: number): 'Pass' | 'Warning' | 'Fail' {
    return ms <= 200 ? 'Pass' : ms <= 500 ? 'Warning' : 'Fail';
}

function tbtStatus(ms: number): 'Pass' | 'Warning' | 'Fail' {
    return ms <= 200 ? 'Pass' : ms <= 600 ? 'Warning' : 'Fail';
}

function ttfbStatus(ms: number): 'Pass' | 'Warning' | 'Fail' {
    return ms <= 600 ? 'Pass' : ms <= 1800 ? 'Warning' : 'Fail';
}

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

        const [psiMobile, psiDesktop, cruxMobile, cruxDesktop] = await Promise.all([
            fetchPsi(context.url, 'mobile'),
            fetchPsi(context.url, 'desktop'),
            fetchCrux(context.url, 'PHONE'),
            fetchCrux(context.url, 'DESKTOP'),
        ]);

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

        if (psiMobile === 'timeout' || psiDesktop === 'timeout') {
            items.push({
                id: 'cwv-lab-timeout',
                label: 'Core Web Vitals — Lab Data',
                status: 'Warning',
                finding: 'PageSpeed Insights API timed out. Lab measurement skipped — test manually at pagespeed.web.dev.',
                recommendation: { text: 'Run PageSpeed Insights manually and target LCP ≤2.5s, CLS ≤0.1, INP ≤200ms, TBT ≤200ms.', priority: 'Medium' },
                roiImpact: 95,
                aiVisibilityImpact: 75,
            });
        } else if (!psiMobile && !psiDesktop && !process.env.PAGESPEED_API_KEY) {
            items.push({
                id: 'cwv-lab-no-key',
                label: 'Core Web Vitals — Lab Data',
                status: 'Warning',
                finding: 'PAGESPEED_API_KEY is not configured. Synthetic lab measurements (LCP, CLS, INP, TBT, TTFB) require a Google Cloud API key with the PageSpeed Insights API enabled.',
                recommendation: {
                    text: 'Add PAGESPEED_API_KEY to your environment variables. Obtain a key at console.cloud.google.com → APIs & Services → PageSpeed Insights API. This unlocks synthetic lab data for both Mobile (simulated Moto G Power / 4G) and Desktop.',
                    priority: 'High',
                },
                roiImpact: 95,
                aiVisibilityImpact: 75,
            });
        } else {
            const psiMobileSafe = psiMobile as PsiResponse | 'timeout' | null;
            if (psiMobileSafe && psiMobileSafe !== 'timeout' && psiMobileSafe.lighthouseResult) {
                const a = psiMobileSafe.lighthouseResult.audits;

                const lcpAudit = a['largest-contentful-paint'];
                if (lcpAudit) {
                    const secs = lcpAudit.numericValue / 1000;
                    let status = lcpStatus(secs);
                    const cruxLcpMs = cruxMobile?.record?.metrics?.largest_contentful_paint?.percentiles?.p75;
                    let fieldSuffix = '';
                    if (cruxLcpMs != null) {
                        const fieldSecs = cruxLcpMs / 1000;
                        fieldSuffix = ` | Real-user p75 (CrUX mobile): ${fieldSecs.toFixed(2)}s ${icon(fieldSecs, 2.5, 4.0)}`;
                        if (lcpStatus(fieldSecs) === 'Fail') status = 'Fail';
                        else if (lcpStatus(fieldSecs) === 'Warning' && status === 'Pass') status = 'Warning';
                    }
                    items.push({
                        id: 'cwv-mobile-lcp',
                        label: 'Mobile CWV: LCP (Largest Contentful Paint)',
                        status,
                        finding: `Lab (Simulated Moto G Power / 4G): ${secs.toFixed(2)}s ${icon(secs, 2.5, 4.0)}${fieldSuffix}.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target ≤2.5s. Prioritise: set fetchpriority="high" on hero image, add <link rel="preload"> for LCP image, upgrade server to Brotli + HTTP/2, use a CDN.' + (cruxLcpMs != null ? ' Real-user CrUX data directly affects Google rankings — fix real-user data first.' : ''),
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 97,
                        aiVisibilityImpact: 80,
                        details: {
                            labLcpMs: lcpAudit.numericValue,
                            ...(cruxLcpMs != null ? { cruxMobileLcpP75Ms: cruxLcpMs } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }

                const clsAudit = a['cumulative-layout-shift'];
                if (clsAudit) {
                    const val = clsAudit.numericValue;
                    let status = clsStatusFn(val);
                    const cruxClsVal = cruxMobile?.record?.metrics?.cumulative_layout_shift?.percentiles?.p75;
                    let fieldSuffix = '';
                    if (cruxClsVal != null) {
                        fieldSuffix = ` | Real-user p75: ${cruxClsVal.toFixed(3)} ${icon(cruxClsVal, 0.1, 0.25)}`;
                        if (clsStatusFn(cruxClsVal) === 'Fail') status = 'Fail';
                        else if (clsStatusFn(cruxClsVal) === 'Warning' && status === 'Pass') status = 'Warning';
                    }
                    items.push({
                        id: 'cwv-mobile-cls',
                        label: 'Mobile CWV: CLS (Cumulative Layout Shift)',
                        status,
                        finding: `Lab CLS: ${val.toFixed(3)} ${icon(val, 0.1, 0.25)}${fieldSuffix}.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target ≤0.1. Add explicit width and height to all <img> and <video> tags. Avoid inserting content above existing content. Reserve space for ads/embeds.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 95,
                        aiVisibilityImpact: 75,
                        details: {
                            labCls: val,
                            ...(cruxClsVal != null ? { cruxMobileClsP75: cruxClsVal } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }

                const inpAudit = a['interaction-to-next-paint'] ?? a['max-potential-fid'];
                if (inpAudit) {
                    const val = inpAudit.numericValue;
                    let status = inpStatus(val);
                    const cruxInpVal = cruxMobile?.record?.metrics?.interaction_to_next_paint?.percentiles?.p75;
                    let fieldSuffix = '';
                    if (cruxInpVal != null) {
                        fieldSuffix = ` | Real-user INP p75: ${cruxInpVal}ms ${icon(cruxInpVal, 200, 500)}`;
                        if (inpStatus(cruxInpVal) === 'Fail') status = 'Fail';
                        else if (inpStatus(cruxInpVal) === 'Warning' && status === 'Pass') status = 'Warning';
                    }
                    items.push({
                        id: 'cwv-mobile-inp',
                        label: 'Mobile CWV: INP (Interaction to Next Paint)',
                        status,
                        finding: `Lab INP: ${val.toFixed(0)}ms ${icon(val, 200, 500)}${fieldSuffix}.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target ≤200ms. Break up long tasks (>50ms) with scheduler.yield() or setTimeout(0). Defer non-critical JS. Use web workers for CPU-heavy logic. Avoid synchronous event handlers blocking the main thread.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 90,
                        aiVisibilityImpact: 70,
                        details: {
                            labInpMs: val,
                            ...(cruxInpVal != null ? { cruxMobileInpP75Ms: cruxInpVal } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }

                const tbtAudit = a['total-blocking-time'];
                if (tbtAudit) {
                    const val = tbtAudit.numericValue;
                    const status = tbtStatus(val);
                    items.push({
                        id: 'cwv-mobile-tbt',
                        label: 'Mobile CWV: TBT (Total Blocking Time)',
                        status,
                        finding: `Lab TBT (simulated Mobile 4G): ${val.toFixed(0)}ms ${icon(val, 200, 600)}. TBT is the lab proxy for INP — high TBT predicts poor interaction responsiveness.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target ≤200ms. Use code-splitting (dynamic import()) to defer non-critical JS. Move expensive computations off the main thread with Web Workers. Audit Long Tasks in Chrome DevTools Performance panel.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 88,
                        aiVisibilityImpact: 65,
                        details: { labTbtMs: val } as Record<string, string | number | boolean>,
                    });
                }

                const ttfbAudit = a['server-response-time'];
                if (ttfbAudit) {
                    const val = ttfbAudit.numericValue;
                    const status = ttfbStatus(val);
                    const cruxTtfbVal = cruxMobile?.record?.metrics?.experimental_time_to_first_byte?.percentiles?.p75;
                    let fieldSuffix = '';
                    if (cruxTtfbVal != null) {
                        fieldSuffix = ` | Real-user TTFB p75: ${cruxTtfbVal}ms ${icon(cruxTtfbVal, 800, 1800)}`;
                    }
                    items.push({
                        id: 'cwv-mobile-ttfb',
                        label: 'Mobile CWV: TTFB (Time to First Byte)',
                        status,
                        finding: `Lab TTFB: ${val.toFixed(0)}ms ${icon(val, 600, 1800)}${fieldSuffix}. TTFB directly prolongs LCP — every 100ms of server delay increases LCP by the same amount.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target ≤600ms. Use a CDN with edge caching (Cloudflare, Vercel Edge). Reduce server-side processing (DB queries, API calls). Enable Brotli compression + HTTP/2.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 90,
                        aiVisibilityImpact: 55,
                        details: {
                            labTtfbMs: val,
                            ...(cruxTtfbVal != null ? { cruxMobileTtfbP75Ms: cruxTtfbVal } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }

                const siAudit = a['speed-index'];
                if (siAudit) {
                    const siSecs = siAudit.numericValue / 1000;
                    const siStatus: 'Pass' | 'Warning' | 'Fail' = siSecs <= 3.4 ? 'Pass' : siSecs <= 5.8 ? 'Warning' : 'Fail';
                    items.push({
                        id: 'cwv-mobile-speed-index',
                        label: 'Mobile Lab: Speed Index',
                        status: siStatus,
                        finding: `Speed Index (simulated Mobile 4G): ${siSecs.toFixed(2)}s ${icon(siSecs, 3.4, 5.8)}. Measures how quickly page content is visually populated.`,
                        recommendation: siStatus !== 'Pass' ? {
                            text: 'Target ≤3.4s. Reduce render-blocking resources, inline critical CSS, use content-visibility:auto for below-fold sections.',
                            priority: siStatus === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 75,
                        aiVisibilityImpact: 50,
                        details: { speedIndexSecs: siSecs } as Record<string, string | number | boolean>,
                    });
                }
            }

            const psiDesktopSafe = psiDesktop as PsiResponse | 'timeout' | null;
            if (psiDesktopSafe && psiDesktopSafe !== 'timeout' && psiDesktopSafe.lighthouseResult) {
                const a = psiDesktopSafe.lighthouseResult.audits;

                const dLcp = a['largest-contentful-paint'];
                if (dLcp) {
                    const secs = dLcp.numericValue / 1000;
                    let status = lcpStatus(secs);
                    const cruxLcpMs = cruxDesktop?.record?.metrics?.largest_contentful_paint?.percentiles?.p75;
                    let fieldSuffix = '';
                    if (cruxLcpMs != null) {
                        const fieldSecs = cruxLcpMs / 1000;
                        fieldSuffix = ` | Real-user p75 (CrUX desktop): ${fieldSecs.toFixed(2)}s ${icon(fieldSecs, 2.5, 4.0)}`;
                        if (lcpStatus(fieldSecs) === 'Fail') status = 'Fail';
                        else if (lcpStatus(fieldSecs) === 'Warning' && status === 'Pass') status = 'Warning';
                    }
                    items.push({
                        id: 'cwv-desktop-lcp',
                        label: 'Desktop CWV: LCP',
                        status,
                        finding: `Desktop Lab LCP: ${secs.toFixed(2)}s ${icon(secs, 2.5, 4.0)}${fieldSuffix}.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Desktop LCP target ≤2.5s. Google ranks desktop and mobile independently — both must be optimised.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 90,
                        aiVisibilityImpact: 70,
                        details: {
                            desktopLabLcpMs: dLcp.numericValue,
                            ...(cruxLcpMs != null ? { cruxDesktopLcpP75Ms: cruxLcpMs } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }

                const dCls = a['cumulative-layout-shift'];
                if (dCls) {
                    const val = dCls.numericValue;
                    let status = clsStatusFn(val);
                    const cruxClsVal = cruxDesktop?.record?.metrics?.cumulative_layout_shift?.percentiles?.p75;
                    let fieldSuffix = '';
                    if (cruxClsVal != null) {
                        fieldSuffix = ` | Real-user p75: ${cruxClsVal.toFixed(3)} ${icon(cruxClsVal, 0.1, 0.25)}`;
                        if (clsStatusFn(cruxClsVal) === 'Fail') status = 'Fail';
                        else if (clsStatusFn(cruxClsVal) === 'Warning' && status === 'Pass') status = 'Warning';
                    }
                    items.push({
                        id: 'cwv-desktop-cls',
                        label: 'Desktop CWV: CLS',
                        status,
                        finding: `Desktop Lab CLS: ${val.toFixed(3)} ${icon(val, 0.1, 0.25)}${fieldSuffix}.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target CLS ≤0.1 on desktop. Reserve space for all dynamic or async-loaded content.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 88,
                        aiVisibilityImpact: 68,
                        details: {
                            desktopLabCls: val,
                            ...(cruxClsVal != null ? { cruxDesktopClsP75: cruxClsVal } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }

                const dInp = a['interaction-to-next-paint'] ?? a['max-potential-fid'];
                if (dInp) {
                    const val = dInp.numericValue;
                    let status = inpStatus(val);
                    const cruxInpVal = cruxDesktop?.record?.metrics?.interaction_to_next_paint?.percentiles?.p75;
                    let fieldSuffix = '';
                    if (cruxInpVal != null) {
                        fieldSuffix = ` | Real-user INP p75: ${cruxInpVal}ms ${icon(cruxInpVal, 200, 500)}`;
                        if (inpStatus(cruxInpVal) === 'Fail') status = 'Fail';
                        else if (inpStatus(cruxInpVal) === 'Warning' && status === 'Pass') status = 'Warning';
                    }
                    items.push({
                        id: 'cwv-desktop-inp',
                        label: 'Desktop CWV: INP',
                        status,
                        finding: `Desktop Lab INP: ${val.toFixed(0)}ms ${icon(val, 200, 500)}${fieldSuffix}.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target ≤200ms on desktop. Reduce long tasks, minimise main-thread JavaScript, and use scheduler.yield() for deferred work.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 88,
                        aiVisibilityImpact: 68,
                        details: {
                            desktopLabInpMs: val,
                            ...(cruxInpVal != null ? { cruxDesktopInpP75Ms: cruxInpVal } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }

                const dTbt = a['total-blocking-time'];
                if (dTbt) {
                    const val = dTbt.numericValue;
                    const status = tbtStatus(val);
                    items.push({
                        id: 'cwv-desktop-tbt',
                        label: 'Desktop Lab: TBT',
                        status,
                        finding: `Desktop Lab TBT: ${val.toFixed(0)}ms ${icon(val, 200, 600)}.`,
                        recommendation: status !== 'Pass' ? {
                            text: 'Target ≤200ms. Desktop TBT correlates with INP — reduce main-thread blocking tasks.',
                            priority: status === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 82,
                        aiVisibilityImpact: 60,
                        details: { desktopLabTbtMs: val } as Record<string, string | number | boolean>,
                    });
                }
            }

            const cruxMobileMetrics = cruxMobile?.record?.metrics;
            const cruxDesktopMetrics = cruxDesktop?.record?.metrics;

            if (cruxMobileMetrics || cruxDesktopMetrics) {
                const rumFindings: string[] = [];
                let rumStatusVal: 'Pass' | 'Warning' | 'Fail' = 'Pass';

                const checkMetric = (
                    label: string,
                    val: number | undefined,
                    goodThreshold: number,
                    poorThreshold: number,
                    unit: string,
                    decimals = 0
                ) => {
                    if (val == null) return;
                    const formatted = decimals > 0 ? val.toFixed(decimals) : val.toFixed(0);
                    rumFindings.push(`${label}: ${formatted}${unit} ${icon(val, goodThreshold, poorThreshold)}`);
                    if (val > poorThreshold && rumStatusVal !== 'Fail') rumStatusVal = 'Fail';
                    else if (val > goodThreshold && rumStatusVal === 'Pass') rumStatusVal = 'Warning';
                };

                const mLcp = cruxMobileMetrics?.largest_contentful_paint?.percentiles?.p75;
                const dLcp = cruxDesktopMetrics?.largest_contentful_paint?.percentiles?.p75;
                if (mLcp != null) checkMetric('Mobile LCP p75', mLcp / 1000, 2.5, 4.0, 's', 2);
                if (dLcp != null) checkMetric('Desktop LCP p75', dLcp / 1000, 2.5, 4.0, 's', 2);

                const mInp = cruxMobileMetrics?.interaction_to_next_paint?.percentiles?.p75;
                const dInp = cruxDesktopMetrics?.interaction_to_next_paint?.percentiles?.p75;
                if (mInp != null) checkMetric('Mobile INP p75', mInp, 200, 500, 'ms');
                if (dInp != null) checkMetric('Desktop INP p75', dInp, 200, 500, 'ms');

                const mCls = cruxMobileMetrics?.cumulative_layout_shift?.percentiles?.p75;
                const dCls = cruxDesktopMetrics?.cumulative_layout_shift?.percentiles?.p75;
                if (mCls != null) checkMetric('Mobile CLS p75', mCls, 0.1, 0.25, '', 3);
                if (dCls != null) checkMetric('Desktop CLS p75', dCls, 0.1, 0.25, '', 3);

                const mFid = cruxMobileMetrics?.first_input_delay?.percentiles?.p75;
                if (mFid != null) checkMetric('Mobile FID p75', mFid, 100, 300, 'ms');

                const mTtfb = cruxMobileMetrics?.experimental_time_to_first_byte?.percentiles?.p75;
                const dTtfb = cruxDesktopMetrics?.experimental_time_to_first_byte?.percentiles?.p75;
                if (mTtfb != null) checkMetric('Mobile TTFB p75', mTtfb, 800, 1800, 'ms');
                if (dTtfb != null) checkMetric('Desktop TTFB p75', dTtfb, 800, 1800, 'ms');

                if (rumFindings.length > 0) {
                    items.push({
                        id: 'crux-rum-summary',
                        label: 'Real-User Metrics (CrUX — Chrome UX Report)',
                        status: rumStatusVal,
                        finding: `Chrome UX Report field data (p75 of real visitors, mobile + desktop): ${rumFindings.join(' | ')}. Field data directly influences Google Search ranking — it reflects actual user experience, not simulated lab conditions.`,
                        recommendation: rumStatusVal !== 'Pass' ? {
                            text: 'Real-user CrUX metrics are the definitive input to Google Search ranking. Prioritise fixing field data regressions over lab scores. Use the individual CWV items above to identify specific optimisations. Monitor monthly via Google Search Console → Core Web Vitals report.',
                            priority: rumStatusVal === 'Fail' ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 99,
                        aiVisibilityImpact: 85,
                        details: {
                            ...(mLcp != null ? { cruxMobileLcpP75Ms: mLcp } : {}),
                            ...(dLcp != null ? { cruxDesktopLcpP75Ms: dLcp } : {}),
                            ...(mInp != null ? { cruxMobileInpP75Ms: mInp } : {}),
                            ...(dInp != null ? { cruxDesktopInpP75Ms: dInp } : {}),
                            ...(mCls != null ? { cruxMobileClsP75: mCls } : {}),
                            ...(dCls != null ? { cruxDesktopClsP75: dCls } : {}),
                            ...(mFid != null ? { cruxMobileFidP75Ms: mFid } : {}),
                            ...(mTtfb != null ? { cruxMobileTtfbP75Ms: mTtfb } : {}),
                            ...(dTtfb != null ? { cruxDesktopTtfbP75Ms: dTtfb } : {}),
                        } as Record<string, string | number | boolean>,
                    });
                }
            }

            if (!psiMobile && !psiDesktop && process.env.PAGESPEED_API_KEY) {
                items.push({
                    id: 'cwv-lab-unavailable',
                    label: 'Core Web Vitals — Lab Data',
                    status: 'Warning',
                    finding: 'PageSpeed Insights returned no data for this URL. The page may be returning an error, blocking the PSI crawler, or is not yet indexed.',
                    recommendation: {
                        text: 'Verify the URL is publicly accessible and not blocking Googlebot. Test manually at pagespeed.web.dev.',
                        priority: 'Medium',
                    },
                    roiImpact: 90,
                    aiVisibilityImpact: 70,
                });
            }
        }

        return calculateScore(items);
    },
};