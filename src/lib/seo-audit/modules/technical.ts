import { logger } from "@/lib/logger";
import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
import { parse } from 'node-html-parser';
import { fetchHtml } from '../utils/fetch-html';
import { validateRobotsAndSitemap } from '../../onpage/validator';
import { runCrawlerAgent } from '../../crawler/agent';
import { runSecurityAudit } from '../../audit/security';

export const TechnicalModule: AuditModule = {
    id: 'technical-seo',
    label: 'Technical SEO',
    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        let html = context.html;
        if (!html) {
            html = await fetchHtml(context.url);

        }

        const items: ChecklistItem[] = [];

        if (!html) {
            return {
                id: TechnicalModule.id,
                label: TechnicalModule.label,
                items,
                score: 0,
                passed: 0,
                failed: 1,
                warnings: 0
            };
        }
        const root = parse(html || '');

        // Run Crawler Agent + PageSpeed API + CrUX in parallel for maximum efficiency
        const [crawlerRes, psiData, psiDesktopData, cruxData] = await Promise.all([
            runCrawlerAgent(context.url, context.html).catch(() => ({
                isJavaScriptHeavy: false,
                frameworkDetected: 'Unknown',
                hydrationTimeMs: 0,
                crawlerRisks: [] as string[],
            })),
            (async () => {
                const psiCacheKey = `psi:v1:${context.url}`;
                try {
                    const { redis } = await import('@/lib/redis');
                    const cached = await redis.get(psiCacheKey);
                    if (cached) {
                        logger.debug(`[PSI Cache] HIT for ${context.url}`);
                        return JSON.parse(cached as string);
                    }
                } catch { /* Redis unavailable — fall through to live fetch */ }

                try {
                    const keyParam = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : '';
                    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(context.url)}${keyParam}&strategy=mobile&category=PERFORMANCE`;
                    const res = await fetch(psiUrl, { signal: AbortSignal.timeout(20000) });
                    if (!res.ok) return null;
                    const data = await res.json();
                    // Cache the result for 24hr
                    try {
                        const { redis } = await import('@/lib/redis');
                        await redis.set(psiCacheKey, JSON.stringify(data), { ex: 86400 });
                    } catch { /* non-fatal */ }
                    return data;
                 
                 
                } catch (e: unknown) {
                    if ((e as { name?: string }).name === 'TimeoutError') return 'timeout';
                    return null;
                }
            })(),
            (async () => {
                const psiDesktopCacheKey = `psi:desktop:v1:${context.url}`;
                try {
                    const { redis } = await import('@/lib/redis');
                    const cached = await redis.get(psiDesktopCacheKey);
                    if (cached) return JSON.parse(cached as string);
                } catch { }
                try {
                    const keyParam = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : '';
                    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(context.url)}${keyParam}&strategy=desktop&category=PERFORMANCE`;
                    const res = await fetch(psiUrl, { signal: AbortSignal.timeout(20000) });
                    if (!res.ok) return null;
                    const data = await res.json();
                    try {
                        const { redis } = await import('@/lib/redis');
                        await redis.set(psiDesktopCacheKey, JSON.stringify(data), { ex: 86400 });
                    } catch { }
                    return data;
                } catch (e: unknown) {
                    if ((e as { name?: string }).name === 'TimeoutError') return 'timeout';
                    return null;
                }
            })(),
            // FIX #17: CrUX API — real-user field data alongside lab data
            (async () => {
                if (!process.env.PAGESPEED_API_KEY) return null;
                try {
                    const res = await fetch(
                        `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${process.env.PAGESPEED_API_KEY}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: context.url, formFactor: 'PHONE' }),
                            signal: AbortSignal.timeout(10000),
                        }
                    );
                    if (!res.ok) return null;
                    return await res.json();
                } catch {
                    return null;
                }
            })(),
        ]);


        if (crawlerRes.frameworkDetected) {
            context.frameworkHints.push(crawlerRes.frameworkDetected);
        }

        // 1. JS Hydration & Framework Rendering
        items.push({
            id: 'js-hydration',
            label: 'JavaScript Hydration & Framework Rendering',
            status: crawlerRes.isJavaScriptHeavy ? 'Warning' : 'Pass',
            finding: `Detected Framework: ${crawlerRes.frameworkDetected}. Hydration time: ${crawlerRes.hydrationTimeMs}ms. ${crawlerRes.crawlerRisks.length} rendering risk(s).`,
            recommendation: crawlerRes.crawlerRisks.length > 0
                ? { text: `Crawler Agent suggests:\n- ${crawlerRes.crawlerRisks.join('\n- ')}`, priority: 'High' }
                : undefined,
            roiImpact: 95,
            aiVisibilityImpact: 100,
            details: { framework: crawlerRes.frameworkDetected, hydrationMs: crawlerRes.hydrationTimeMs, risks: crawlerRes.crawlerRisks.length },
        });

        // 2. Indexability (noindex meta)
        const noindexTag = root.querySelector('meta[name="robots"][content*="noindex"]');
        items.push({
            id: 'indexability',
            label: 'Website Indexability',
            status: noindexTag ? 'Fail' : 'Pass',
            finding: noindexTag
                ? 'Page has a noindex meta tag — search engines are blocked from including it in results.'
                : 'No noindex tags found. Page is indexable.',
            recommendation: noindexTag ? { text: 'Remove noindex from the robots meta to make this page indexable.', priority: 'High' } : undefined,
            roiImpact: 100,
            aiVisibilityImpact: 100,
        });

        // 3. SSL / HTTPS
        const isHttps = context.url.startsWith('https://');
        items.push({
            id: 'ssl-certificate',
            label: 'SSL Certificate (HTTPS)',
            status: isHttps ? 'Pass' : 'Fail',
            finding: isHttps ? 'Site is served over HTTPS.' : 'Site is using insecure HTTP — Google treats HTTPS as a ranking signal.',
            recommendation: !isHttps ? { text: 'Install an SSL certificate and enforce HTTPS with a 301 redirect from HTTP.', priority: 'High' } : undefined,
            roiImpact: 90,
            aiVisibilityImpact: 80,
        });

        if (isHttps) {
            const mixedMatches = (html || '').match(/<(?:img|script|iframe|source|link)[^>]+(?:src|href)="http:\/\/[^"]+"/gi) || [];
            const mixedCount = mixedMatches.length;
            items.push({
                id: 'mixed-content',
                label: 'Mixed Content',
                status: mixedCount === 0 ? 'Pass' : 'Fail',
                finding: mixedCount === 0
                    ? 'No mixed content detected. All inline resource references use HTTPS.'
                    : `${mixedCount} resource(s) are loaded over HTTP on this HTTPS page. Browsers block or warn on mixed content, causing broken assets and security warnings.`,
                recommendation: mixedCount > 0 ? {
                    text: 'Update all resource URLs to HTTPS. Search your templates/CMS for `src="http://` and `href="http://`. If a third-party resource does not support HTTPS, find an alternative or self-host it.',
                    priority: 'High',
                } : undefined,
                roiImpact: 85,
                aiVisibilityImpact: 60,
                details: { mixedResourcesDetected: mixedCount },
            });
        }

        // 4. Robots.txt & XML Sitemap
        const sitemapResult = await validateRobotsAndSitemap(context.url).catch(() => ({ robotsTxtExists: false, sitemapExists: false }));
        items.push({
            id: 'robots-txt',
            label: 'Robots.txt',
            status: sitemapResult.robotsTxtExists ? 'Pass' : 'Fail',
            finding: sitemapResult.robotsTxtExists ? 'robots.txt found.' : 'robots.txt is missing — crawlers have no guidance on what to crawl.',
            recommendation: !sitemapResult.robotsTxtExists ? { text: 'Create robots.txt at the domain root. Point it to your XML sitemap.', priority: 'Medium' } : undefined,
            roiImpact: 80,
            aiVisibilityImpact: 95,
        });

        items.push({
            id: 'xml-sitemap',
            label: 'XML Sitemap',
            status: sitemapResult.sitemapExists ? 'Pass' : 'Fail',
            finding: sitemapResult.sitemapExists ? 'XML Sitemap found.' : 'XML Sitemap not found — Google cannot discover all your pages efficiently.',
            recommendation: !sitemapResult.sitemapExists ? { text: 'Create and submit an XML sitemap to Google Search Console.', priority: 'High' } : undefined,
            roiImpact: 85,
            aiVisibilityImpact: 90,
        });

        // 5. Schema Markup (quick presence check; full audit in schema.ts)
        const schemaElements = root.querySelectorAll('script[type="application/ld+json"]');
        const hasMicrodata = (html || '').includes('itemtype=');
        const hasSomeSchema = schemaElements.length > 0 || hasMicrodata;
        items.push({
            id: 'schema-presence',
            label: 'Schema Markup (Structured Data)',
            status: hasSomeSchema ? 'Pass' : 'Warning',
            finding: hasSomeSchema
                ? `Detected ${schemaElements.length} JSON-LD block(s)${hasMicrodata ? ' + Microdata' : ''}.`
                : 'No structured data found. See Schema Markup module for detailed validation.',
            recommendation: !hasSomeSchema ? { text: 'Add JSON-LD schema markup. Start with Organization and WebSite types, then add page-specific types (Article, Product, FAQ, etc.).', priority: 'Medium' } : undefined,
            roiImpact: 75,
            aiVisibilityImpact: 100,
            details: { jsonLdBlocks: schemaElements.length, microdata: hasMicrodata },
        });

        // 6. Hreflang Tags
        const hreflangTags = root.querySelectorAll('link[rel="alternate"][hreflang]');
        items.push({
            id: 'hreflang-tags',
            label: 'Hreflang Tags',
            status: hreflangTags.length > 0 ? 'Pass' : 'Info',
            finding: hreflangTags.length > 0
                ? `Detected ${hreflangTags.length} hreflang tag(s) for multilingual targeting.`
                : 'No hreflang tags (only required for multi-language/multi-region sites).',
            recommendation: undefined,
            roiImpact: 60,
            aiVisibilityImpact: 50,
            details: { count: hreflangTags.length },
        });

        // 7. Render-Blocking Scripts (non-tracking)
        const headEl = root.querySelector('head');
        const headScripts = headEl ? headEl.querySelectorAll('script[src]') : [];
        const renderBlockingScripts = headScripts.filter(s => {
            const hasAsync = s.hasAttribute('async');
            const hasDefer = s.hasAttribute('defer');
            return !hasAsync && !hasDefer;
        });

        items.push({
            id: 'render-blocking-scripts',
            label: 'Render-Blocking Scripts',
            status: renderBlockingScripts.length === 0 ? 'Pass' : 'Warning',
            finding: renderBlockingScripts.length === 0
                ? 'No render-blocking <script> tags found in <head>.'
                : `${renderBlockingScripts.length} render-blocking <script> tag(s) in <head> without async/defer. These delay First Contentful Paint.`,
            recommendation: renderBlockingScripts.length > 0 ? {
                text: 'Add async (for independent scripts) or defer (for DOM-dependent scripts) to all <script src="..."> tags in <head>. Move scripts to <body> end where possible.',
                priority: 'Medium',
            } : undefined,
            roiImpact: 80,
            aiVisibilityImpact: 40,
            details: renderBlockingScripts.length > 0 ? { count: renderBlockingScripts.length, scripts: renderBlockingScripts.slice(0, 3).map(s => s.getAttribute('src') || '').join(', ') } : undefined,
        });

        const domNodeCount = root.querySelectorAll('*').length;
        items.push({
            id: 'dom-size',
            label: 'DOM Size',
            status: domNodeCount <= 800 ? 'Pass' : domNodeCount <= 1500 ? 'Warning' : 'Fail',
            finding: domNodeCount <= 800
                ? `DOM contains ${domNodeCount} nodes — within the healthy range.`
                : domNodeCount <= 1500
                ? `DOM contains ${domNodeCount} nodes. Google Lighthouse warns above 800 nodes. Large DOMs slow style recalculation, hurt INP, and increase memory usage.`
                : `DOM contains ${domNodeCount} nodes — exceeds Google's 1,500-node failure threshold. This will degrade rendering performance across all devices.`,
            recommendation: domNodeCount > 800 ? {
                text: 'Reduce DOM size:\n• Remove unnecessary wrapper divs (divitis)\n• Use CSS pseudo-elements instead of DOM nodes for decorative elements\n• Implement virtualisation for long lists (react-virtual, tanstack-virtual)\n• Lazy-render off-screen sections\nTarget: under 800 nodes for optimal performance.',
                priority: domNodeCount > 1500 ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 75,
            aiVisibilityImpact: 40,
            details: { domNodes: domNodeCount },
        });

        // 8. Font Loading — font-display:swap & preconnect
        const hasGoogleFontsLink = root.querySelectorAll('link[href*="fonts.googleapis.com"]').length > 0;
        const hasGoogleFontsPreconnect = root.querySelectorAll('link[rel="preconnect"][href*="fonts.googleapis.com"], link[rel="preconnect"][href*="fonts.gstatic.com"]').length > 0;
        const hasFontDisplaySwap = (html || '').includes('font-display:swap') || (html || '').includes('font-display: swap');
        const hasNextFont = (html || '').includes('next/font') || (html || '').includes('__nextjs_original-stack-frame');

        if (hasGoogleFontsLink && !hasNextFont) {
            items.push({
                id: 'font-loading',
                label: 'Font Loading Optimisation',
                status: hasGoogleFontsPreconnect && hasFontDisplaySwap ? 'Pass' : 'Warning',
                finding: [
                    `Google Fonts detected via <link>`,
                    hasGoogleFontsPreconnect ? 'preconnect hint present ✓' : 'missing preconnect to fonts.googleapis.com ✗',
                    hasFontDisplaySwap ? 'font-display:swap ✓' : 'font-display:swap not detected ✗',
                ].join('. '),
                recommendation: (!hasGoogleFontsPreconnect || !hasFontDisplaySwap) ? {
                    text: `${!hasGoogleFontsPreconnect ? 'Add <link rel="preconnect" href="https://fonts.googleapis.com"> and <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>. ' : ''}${!hasFontDisplaySwap ? 'Add &display=swap to your Google Fonts URL to prevent invisible text during font load.' : ''}`,
                    priority: 'Medium',
                } : undefined,
                roiImpact: 65,
                aiVisibilityImpact: 30,
            });
        } else if (hasNextFont) {
            items.push({
                id: 'font-loading',
                label: 'Font Loading (next/font)',
                status: 'Pass',
                finding: 'next/font detected — fonts are automatically optimised with font-display:swap and preloading.',
                roiImpact: 65,
                aiVisibilityImpact: 30,
            });
        } else {
            items.push({
                id: 'font-loading',
                label: 'Font Loading',
                status: 'Info',
                finding: 'No external Google Fonts link detected. Ensure any custom fonts use font-display:swap in CSS.',
                roiImpact: 40,
                aiVisibilityImpact: 20,
            });
        }

        // 9. Resource Hints (preload / prefetch / preconnect / dns-prefetch)
        const preloadLinks = root.querySelectorAll('link[rel="preload"]').length;
        const prefetchLinks = root.querySelectorAll('link[rel="prefetch"]').length;
        const preconnectLinks = root.querySelectorAll('link[rel="preconnect"]').length;
        const dnsPrefetch = root.querySelectorAll('link[rel="dns-prefetch"]').length;
        const totalHints = preloadLinks + prefetchLinks + preconnectLinks + dnsPrefetch;

        items.push({
            id: 'resource-hints',
            label: 'Resource Hints',
            status: totalHints > 0 ? 'Pass' : 'Warning',
            finding: totalHints > 0
                ? `Resource hints: ${preloadLinks} preload, ${prefetchLinks} prefetch, ${preconnectLinks} preconnect, ${dnsPrefetch} dns-prefetch.`
                : 'No resource hints found (preload, prefetch, preconnect, dns-prefetch). These significantly improve LCP.',
            recommendation: totalHints === 0 ? {
                text: 'Add <link rel="preload"> for your LCP image and critical fonts. Add <link rel="preconnect"> for third-party origins (CDNs, analytics). Add <link rel="dns-prefetch"> for less-critical origins.',
                priority: 'Medium',
            } : undefined,
            roiImpact: 70,
            aiVisibilityImpact: 35,
            details: { preload: preloadLinks, prefetch: prefetchLinks, preconnect: preconnectLinks, dnsPrefetch },
        });

        // 10. Image CLS Risk (missing width/height attributes)
        const allImages = root.querySelectorAll('img');
        const imgsWithoutDimensions = allImages.filter(img => !img.getAttribute('width') || !img.getAttribute('height'));
        const _imgsWithoutLazy = allImages.filter(img => !img.hasAttribute('loading') && !img.hasAttribute('fetchpriority'));

        items.push({
            id: 'image-dimensions',
            label: 'Image Dimensions (CLS Prevention)',
            status: imgsWithoutDimensions.length === 0 ? 'Pass' : 'Warning',
            finding: imgsWithoutDimensions.length === 0
                ? 'All images have explicit width and height attributes.'
                : `${imgsWithoutDimensions.length} of ${allImages.length} images are missing width/height attributes, causing Cumulative Layout Shift (CLS).`,
            recommendation: imgsWithoutDimensions.length > 0 ? {
                text: 'Set explicit width and height on all <img> tags (or use next/image which does this automatically). This eliminates CLS and improves Core Web Vitals.',
                priority: 'Medium',
            } : undefined,
            roiImpact: 75,
            aiVisibilityImpact: 40,
            details: { total: allImages.length, missingDimensions: imgsWithoutDimensions.length },
        });

        // 11. Next.js-Specific Checks
        const framework = crawlerRes.frameworkDetected;
        if (framework?.toLowerCase().includes('next')) {
            const rawImgTags = root.querySelectorAll('img').filter(img => {
                const src = img.getAttribute('src') || '';
                // next/image renders as <img> with _next/image in src
                return !src.includes('_next/image') && !src.startsWith('data:');
            });

            items.push({
                id: 'nextjs-image',
                label: 'Next.js — next/image Usage',
                status: rawImgTags.length === 0 ? 'Pass' : 'Warning',
                finding: rawImgTags.length === 0
                    ? 'All detected images appear to use next/image (optimised).'
                    : `${rawImgTags.length} raw <img> tag(s) detected that may not be using next/image. You are missing automatic WebP conversion, lazy loading, and size optimisation.`,
                recommendation: rawImgTags.length > 0 ? {
                    text: 'Replace raw <img> tags with Next.js <Image> component from next/image for automatic WebP, lazy loading, and CLS prevention.',
                    priority: 'Medium',
                } : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 50,
                details: { nonOptimisedImages: rawImgTags.length },
            });

            const hasNextFontImport = (html || '').includes('next/font') || (html || '').includes('__next_font');
            const hasGoogleFontImport = (html || '').includes('fonts.googleapis.com');
            items.push({
                id: 'nextjs-font',
                label: 'Next.js — next/font Usage',
                status: hasGoogleFontImport && !hasNextFontImport ? 'Warning' : 'Pass',
                finding: hasGoogleFontImport && !hasNextFontImport
                    ? 'Google Fonts loaded via <link> instead of next/font. You are missing automatic font optimisation and self-hosting.'
                    : 'Font loading appears optimised (next/font or self-hosted).',
                recommendation: (hasGoogleFontImport && !hasNextFontImport) ? {
                    text: "Switch from Google Fonts <link> to next/font/google (e.g. `import { Inter } from 'next/font/google'`) for automatic self-hosting, font-display:swap, and zero layout shift.",
                    priority: 'Low',
                } : undefined,
                roiImpact: 55,
                aiVisibilityImpact: 25,
            });
        }

        // 12. Core Web Vitals (PageSpeed Insights)
        if (psiData === 'timeout') {
            items.push({
                id: 'core-web-vitals-timeout',
                label: 'Core Web Vitals',
                status: 'Warning',
                finding: 'PageSpeed API timed out — test manually.',
                roiImpact: 95,
                aiVisibilityImpact: 75,
            });
        } else if (psiData && psiData.lighthouseResult) {
            const auditsData = psiData.lighthouseResult.audits;

            // LCP — lab data (PSI) merged with real-user field data (CrUX p75)
            const lcpAudit = auditsData['largest-contentful-paint'];
            if (lcpAudit) {
                const lcpValue = lcpAudit.numericValue;
                const lcpSecs = lcpValue / 1000;
                let lcpStatus: 'Pass' | 'Warning' | 'Fail' = 'Fail';
                if (lcpSecs <= 2.5) lcpStatus = 'Pass';
                else if (lcpSecs <= 4.0) lcpStatus = 'Warning';

                // FIX #4: Merge CrUX real-user LCP p75 into this item so the
                // finding shows lab vs field in one place instead of two
                // disconnected audit rows.
                const cruxLcpMs = cruxData?.record?.metrics?.['largest_contentful_paint']?.percentiles?.p75 as number | undefined;
                let fieldSuffix = '';
                if (cruxLcpMs != null) {
                    const fieldSecs = cruxLcpMs / 1000;
                    const fieldIcon = fieldSecs <= 2.5 ? '✓' : fieldSecs <= 4.0 ? '⚠' : '✗';
                    fieldSuffix = ` | Real-user p75 (CrUX): ${fieldSecs.toFixed(2)}s ${fieldIcon}`;
                    // Promote status if real-user data is worse than lab data
                    if (fieldSecs > 4.0 && lcpStatus !== 'Fail') lcpStatus = 'Fail';
                    else if (fieldSecs > 2.5 && lcpStatus === 'Pass') lcpStatus = 'Warning';
                }

                items.push({
                    id: 'core-web-vitals-lcp',
                    label: 'Core Web Vitals: LCP',
                    status: lcpStatus,
                    finding: `Largest Contentful Paint — Lab (PSI): ${lcpSecs.toFixed(2)}s${fieldSuffix}.`,
                    recommendation: lcpStatus !== 'Pass' ? {
                        text: `Google threshold: ≤2.5s good, ≤4s needs improvement.${cruxLcpMs != null ? ' Real-user (CrUX) data reflects actual visitor experience and directly affects rankings — prioritise this over lab results.' : ''}`,
                        priority: lcpStatus === 'Fail' ? 'High' : 'Medium',
                    } : undefined,
                    roiImpact: 95,
                    aiVisibilityImpact: 75,
                    details: {
                        labLcpMs: lcpValue,
                        ...(cruxLcpMs != null ? { fieldLcpP75Ms: cruxLcpMs } : {}),
                    } as Record<string, string | number | boolean>,
                });
            }

            // CLS
            const clsAudit = auditsData['cumulative-layout-shift'];
            if (clsAudit) {
                const clsValue = clsAudit.numericValue;
                let clsStatus: 'Pass' | 'Warning' | 'Fail' = 'Fail';
                if (clsValue <= 0.1) clsStatus = 'Pass';
                else if (clsValue <= 0.25) clsStatus = 'Warning';

                items.push({
                    id: 'core-web-vitals-cls',
                    label: 'Core Web Vitals: CLS',
                    status: clsStatus,
                    finding: `Cumulative Layout Shift (CLS) is ${clsValue.toFixed(3)}.`,
                    recommendation: clsStatus !== 'Pass' ? { text: 'Google threshold: ≤0.1 good, ≤0.25 needs improvement.', priority: clsStatus === 'Fail' ? 'High' : 'Medium' } : undefined,
                    roiImpact: 95,
                    aiVisibilityImpact: 75,
                });
            }

            // INP / FID
            const inpAudit = auditsData['interaction-to-next-paint'] || auditsData['max-potential-fid'];
            if (inpAudit) {
                const inpValue = inpAudit.numericValue;
                let inpStatus: 'Pass' | 'Warning' | 'Fail' = 'Fail';
                if (inpValue <= 200) inpStatus = 'Pass';
                else if (inpValue <= 500) inpStatus = 'Warning';

                items.push({
                    id: 'core-web-vitals-inp',
                    label: 'Core Web Vitals: INP / FID',
                    status: inpStatus,
                    finding: `Responsiveness (INP/FID) is ${inpValue.toFixed(0)}ms.`,
                    recommendation: inpStatus !== 'Pass' ? { text: 'Google threshold: ≤200ms good, ≤500ms needs improvement.', priority: inpStatus === 'Fail' ? 'High' : 'Medium' } : undefined,
                    roiImpact: 95,
                    aiVisibilityImpact: 75,
                });
            }
        } else {
            items.push({
                id: 'core-web-vitals-missing',
                label: 'Core Web Vitals',
                status: 'Warning',
                finding: 'Could not fetch Core Web Vitals from PageSpeed Insights.',
                recommendation: { text: 'Optimise Core Web Vitals: target LCP < 2.5s, FID < 100ms, CLS < 0.1. These are direct Google ranking signals since 2021.', priority: 'High' },
                roiImpact: 90,
                aiVisibilityImpact: 70,
            });
        }

        // FIX #17 / FIX #4: CrUX field data — INP, CLS, FID only.
        // LCP is now merged into the core-web-vitals-lcp item above to show
        // lab vs real-user data in one place. This item covers the remaining
        // real-user signals that have no corresponding PSI lab item.
        if (cruxData?.record?.metrics) {
            const m = cruxData.record.metrics;
            const cruxInp = m['interaction_to_next_paint']?.percentiles?.p75 as number | undefined;
            const cruxCls = m['cumulative_layout_shift']?.percentiles?.p75 as number | undefined;
            const cruxFid = m['first_input_delay']?.percentiles?.p75 as number | undefined;
            // Also keep raw LCP for details but don't repeat it in the finding string
            const cruxLcp = m['largest_contentful_paint']?.percentiles?.p75 as number | undefined;

            const cruxFindings: string[] = [];
            // Use a plain string variable so TypeScript does not narrow it to
            // a single literal and flag comparisons as impossible.
            let cruxStatusVal: string = 'Pass';

            if (cruxInp != null) {
                if (cruxInp > 500) cruxStatusVal = 'Fail';
                else if (cruxInp > 200 && cruxStatusVal === 'Pass') cruxStatusVal = 'Warning';
                cruxFindings.push(`INP (p75): ${cruxInp}ms ${cruxInp <= 200 ? '✓' : cruxInp <= 500 ? '⚠' : '✗'}`);
            }
            if (cruxCls != null) {
                if (cruxCls > 0.25 && cruxStatusVal !== 'Fail') cruxStatusVal = 'Fail';
                else if (cruxCls > 0.1 && cruxStatusVal === 'Pass') cruxStatusVal = 'Warning';
                cruxFindings.push(`CLS (p75): ${cruxCls.toFixed(3)} ${cruxCls <= 0.1 ? '✓' : cruxCls <= 0.25 ? '⚠' : '✗'}`);
            }
            if (cruxFid != null) {
                cruxFindings.push(`FID (p75): ${cruxFid}ms ${cruxFid <= 100 ? '✓' : '⚠'}`);
            }
            const cruxStatus = cruxStatusVal as 'Pass' | 'Warning' | 'Fail';

            // Only emit this item if we have at least one non-LCP metric
            if (cruxFindings.length > 0) {
                items.push({
                    id: 'crux-field-data',
                    label: 'Core Web Vitals: Real-User INP & CLS (CrUX)',
                    status: cruxStatus,
                    finding: `Chrome UX Report (real users, mobile p75): ${cruxFindings.join(' | ')}. LCP comparison is shown in the LCP item above.`,
                    recommendation: cruxStatus !== 'Pass' ? {
                        text: 'Real-user data reflects actual visitor experience and directly affects Google rankings. INP replaces FID as the interactivity metric in Core Web Vitals — target ≤200ms. CLS target ≤0.1. Prioritise fixing real-user CWV over lab data.',
                        priority: cruxStatus === 'Fail' ? 'High' : 'Medium',
                    } : undefined,
                    roiImpact: 95,
                    aiVisibilityImpact: 75,
                    details: {
                        ...(cruxLcp != null ? { lcpP75Ms: cruxLcp } : {}),
                        ...(cruxInp != null ? { inpP75Ms: cruxInp } : {}),
                        ...(cruxCls != null ? { clsP75:   cruxCls } : {}),
                        ...(cruxFid != null ? { fidP75Ms: cruxFid } : {}),
                    } as Record<string, string | number | boolean>,
                });
            }
        }


        if (psiDesktopData && psiDesktopData !== 'timeout' && psiDesktopData.lighthouseResult) {
            const dAudits = psiDesktopData.lighthouseResult.audits;
            const dLcp = dAudits['largest-contentful-paint'];
            if (dLcp) {
                const dLcpSecs = dLcp.numericValue / 1000;
                const dLcpStatus: 'Pass' | 'Warning' | 'Fail' = dLcpSecs <= 2.5 ? 'Pass' : dLcpSecs <= 4.0 ? 'Warning' : 'Fail';
                items.push({
                    id: 'desktop-cwv-lcp',
                    label: 'Desktop Core Web Vitals: LCP',
                    status: dLcpStatus,
                    finding: `Desktop LCP: ${dLcpSecs.toFixed(2)}s.`,
                    recommendation: dLcpStatus !== 'Pass' ? { text: 'Desktop LCP threshold: ≤2.5s good, ≤4s needs improvement. Google ranks desktop and mobile independently — both scores matter.', priority: dLcpStatus === 'Fail' ? 'High' : 'Medium' } : undefined,
                    roiImpact: 90,
                    aiVisibilityImpact: 70,
                    details: { desktopLcpMs: dLcp.numericValue },
                });
            }
            const dCls = dAudits['cumulative-layout-shift'];
            if (dCls) {
                const dClsVal = dCls.numericValue;
                const dClsStatus: 'Pass' | 'Warning' | 'Fail' = dClsVal <= 0.1 ? 'Pass' : dClsVal <= 0.25 ? 'Warning' : 'Fail';
                items.push({
                    id: 'desktop-cwv-cls',
                    label: 'Desktop Core Web Vitals: CLS',
                    status: dClsStatus,
                    finding: `Desktop CLS: ${dClsVal.toFixed(3)}.`,
                    recommendation: dClsStatus !== 'Pass' ? { text: 'Desktop CLS threshold: ≤0.1 good, ≤0.25 needs improvement.', priority: dClsStatus === 'Fail' ? 'High' : 'Medium' } : undefined,
                    roiImpact: 90,
                    aiVisibilityImpact: 70,
                    details: { desktopCls: dClsVal },
                });
            }
            const dInp = dAudits['interaction-to-next-paint'] || dAudits['max-potential-fid'];
            if (dInp) {
                const dInpVal = dInp.numericValue;
                const dInpStatus: 'Pass' | 'Warning' | 'Fail' = dInpVal <= 200 ? 'Pass' : dInpVal <= 500 ? 'Warning' : 'Fail';
                items.push({
                    id: 'desktop-cwv-inp',
                    label: 'Desktop Core Web Vitals: INP',
                    status: dInpStatus,
                    finding: `Desktop INP/FID: ${dInpVal.toFixed(0)}ms.`,
                    recommendation: dInpStatus !== 'Pass' ? { text: 'Desktop INP threshold: ≤200ms good, ≤500ms needs improvement.', priority: dInpStatus === 'Fail' ? 'High' : 'Medium' } : undefined,
                    roiImpact: 90,
                    aiVisibilityImpact: 70,
                    details: { desktopInpMs: dInpVal },
                });
            }
        } else if (psiDesktopData === 'timeout') {
            items.push({
                id: 'desktop-cwv-timeout',
                label: 'Desktop Core Web Vitals',
                status: 'Warning',
                finding: 'Desktop PageSpeed API timed out — test manually at pagespeed.web.dev.',
                roiImpact: 85,
                aiVisibilityImpact: 65,
            });
        }

        // 13. Gzip / Brotli Compression
        let gzipStatus: 'Pass' | 'Fail' = 'Fail';
        let gzipEncoding = 'none';
        let gzipFinding = '';
        let ttfbMs = 0;
        let httpProtocol = 'Unknown';
        let hstsHeader = '';
        try {
            const ttfbStart = Date.now();
            const gzipRes = await fetch(context.url, {
                method: 'GET',
                headers: {
                    'Accept-Encoding': 'gzip, br, deflate',
                    'User-Agent': 'Mozilla/5.0 (compatible; AuditBot/1.0)',
                },
                signal: AbortSignal.timeout(8000),
                cache: 'no-store',
            });
            ttfbMs = Date.now() - ttfbStart;
            hstsHeader = gzipRes.headers.get('strict-transport-security') || '';
            const altSvc = (gzipRes.headers.get('alt-svc') || '').toLowerCase();
            const cfRay = gzipRes.headers.get('cf-ray');
            const xPoweredBy = (gzipRes.headers.get('x-powered-by') || '').toLowerCase();
            httpProtocol = (altSvc.includes('h3') || altSvc.includes('h2') || cfRay || xPoweredBy.includes('next'))
                ? 'HTTP/2'
                : 'HTTP/1.1';
            const encoding = (gzipRes.headers.get('content-encoding') || '').toLowerCase();
            if (encoding.includes('br') || encoding.includes('brotli')) {
                gzipStatus = 'Pass';
                gzipEncoding = 'Brotli';
                gzipFinding = 'Brotli compression is active. Brotli delivers 15–25% better compression than gzip, reducing transfer size by 70–80%. Excellent for TTFB and LCP.';
            } else if (encoding.includes('gzip') || encoding.includes('deflate')) {
                gzipStatus = 'Pass';
                gzipEncoding = encoding === 'deflate' ? 'Deflate' : 'Gzip';
                gzipFinding = `${gzipEncoding} compression is active. Typical transfer size reduction: 60–80%. Estimated TTFB improvement: 100–400ms. Consider upgrading to Brotli for additional 15% savings.`;
            } else {
                gzipFinding = 'No compression detected (Content-Encoding header absent). Pages are served uncompressed, wasting bandwidth and slowing load times. Enabling gzip typically saves 60–80% of HTML/CSS/JS transfer size.';
            }
        } catch {
            gzipFinding = 'Could not check compression (request failed). Verify your server sends a Content-Encoding: gzip or br header.';
        }

        items.push({
            id: 'gzip-compression',
            label: 'Gzip / Brotli Compression',
            status: gzipStatus,
            finding: gzipFinding,
            recommendation: gzipStatus === 'Fail' ? {
                text: 'Enable Brotli (preferred) or Gzip compression on your server/CDN.\n• Next.js/Vercel: automatic — verify deployment.\n• Nginx: add `gzip on; gzip_types text/html text/css application/javascript;` to server block.\n• Apache: enable mod_deflate or mod_brotli.\n• Cloudflare: enable "Speed → Compression" in dashboard.\n• Impact forecast: enabling compression typically reduces HTML transfer size by 60–80%, improving TTFB by 100–500ms and LCP by 0.3–0.8s.',
                priority: 'High',
            } : gzipEncoding === 'Gzip' ? {
                text: 'Upgrade from Gzip to Brotli for an additional 15–25% compression ratio. Cloudflare, Vercel, and Nginx 1.11.5+ support Brotli natively.',
                priority: 'Low',
            } : undefined,
            roiImpact: 85,
            aiVisibilityImpact: 30,
            details: { encoding: gzipEncoding },
        });

        if (ttfbMs > 0) {
            const ttfbStatus: 'Pass' | 'Warning' | 'Fail' = ttfbMs <= 600 ? 'Pass' : ttfbMs <= 1000 ? 'Warning' : 'Fail';
            items.push({
                id: 'ttfb',
                label: 'Time To First Byte (TTFB)',
                status: ttfbStatus,
                finding: `TTFB measured at ${ttfbMs}ms.${ttfbStatus === 'Pass' ? ' Server response time is healthy.' : ttfbStatus === 'Warning' ? ' Server response is slow — consider CDN caching or server-side optimisation.' : ' TTFB exceeds 1000ms. This is a direct Google ranking signal and degrades LCP significantly.'}`,
                recommendation: ttfbStatus !== 'Pass' ? {
                    text: 'Improve TTFB by:\n• Enabling edge caching (Cloudflare, Vercel Edge, Fastly)\n• Reducing server-side processing time (database queries, API calls)\n• Using a CDN geographically close to your users\n• Enabling HTTP/2 or HTTP/3 for connection multiplexing\nTarget: TTFB < 600ms. Every 100ms of TTFB improvement reduces LCP by roughly the same amount.',
                    priority: ttfbStatus === 'Fail' ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 90,
                aiVisibilityImpact: 50,
                details: { ttfbMs },
            });
        }

        items.push({
            id: 'http-protocol',
            label: 'HTTP Protocol Version',
            status: httpProtocol === 'HTTP/2' ? 'Pass' : httpProtocol === 'HTTP/1.1' ? 'Warning' : 'Info',
            finding: httpProtocol === 'HTTP/2'
                ? 'HTTP/2 detected. Multiplexing, header compression, and server push are available.'
                : httpProtocol === 'HTTP/1.1'
                ? 'HTTP/1.1 detected. Upgrading to HTTP/2 enables request multiplexing, reducing page load time significantly on resource-heavy pages.'
                : 'Could not determine HTTP protocol version from response headers.',
            recommendation: httpProtocol === 'HTTP/1.1' ? {
                text: 'Enable HTTP/2 on your server or CDN:\n• Cloudflare: enabled by default — verify in Speed → Optimisation\n• Nginx: add `listen 443 ssl http2;` to your server block\n• Vercel/Netlify: HTTP/2 is automatic\n• Apache: enable mod_http2 and add `Protocols h2 http/1.1`',
                priority: 'Medium',
            } : undefined,
            roiImpact: 70,
            aiVisibilityImpact: 30,
            details: { protocol: httpProtocol },
        });

        if (isHttps) {
            const hasHsts = hstsHeader.length > 0;
            const hstsMaxAge = hasHsts ? (hstsHeader.match(/max-age=(\d+)/)?.[1] ?? '0') : '0';
            const hstsAgeNum = parseInt(hstsMaxAge, 10);
            const hstsGood = hasHsts && hstsAgeNum >= 31536000;
            items.push({
                id: 'hsts',
                label: 'HSTS (Strict-Transport-Security)',
                status: hstsGood ? 'Pass' : hasHsts ? 'Warning' : 'Fail',
                finding: !hasHsts
                    ? 'Strict-Transport-Security header is missing. Without HSTS, browsers may downgrade HTTPS to HTTP on subsequent requests.'
                    : hstsAgeNum < 31536000
                    ? `HSTS present but max-age=${hstsMaxAge}s is below the recommended 31536000s (1 year). Current value: ${hstsHeader}`
                    : `HSTS is correctly configured: ${hstsHeader}`,
                recommendation: !hstsGood ? {
                    text: 'Add the Strict-Transport-Security header with max-age of at least 1 year:\n\nStrict-Transport-Security: max-age=31536000; includeSubDomains; preload\n\n• Nginx: add to server block\n• Next.js: add in next.config.ts headers()\n• Cloudflare: enable HSTS in SSL/TLS → Edge Certificates',
                    priority: !hasHsts ? 'High' : 'Low',
                } : undefined,
                roiImpact: 60,
                aiVisibilityImpact: 40,
                details: { hstsPresent: hasHsts, maxAgeSeconds: hstsAgeNum, raw: hstsHeader.substring(0, 80) },
            });
        }

        // 14. www vs non-www Redirect Consistency
        let wwwStatus: 'Pass' | 'Warning' | 'Fail' = 'Pass';
        let wwwFinding = '';
        let wwwDetails: Record<string, string | number | boolean> = {};
        try {
            const urlObj = new URL(context.url);
            const hostname = urlObj.hostname;
            const isWww = hostname.startsWith('www.');
            const bareHost = isWww ? hostname.slice(4) : hostname;
            const wwwHost = isWww ? hostname : `www.${hostname}`;
            const protocol = urlObj.protocol;

            const testUrl = `${protocol}//${isWww ? bareHost : wwwHost}${urlObj.pathname}`;

            const redirectRes = await fetch(testUrl, {
                method: 'HEAD',
                redirect: 'manual',
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditBot/1.0)' },
                signal: AbortSignal.timeout(8000),
            });

            const redirectStatus = redirectRes.status;
            const location = redirectRes.headers.get('location') || '';
            wwwDetails = { alternativeUrl: testUrl, httpStatus: redirectStatus, location: location.substring(0, 80) };

            if (redirectStatus === 301) {
                // Correct permanent redirect
                const _redirectsToCanonical = location.includes(isWww ? hostname : hostname);
                wwwStatus = 'Pass';
                wwwFinding = `Correct: ${testUrl} returns 301 → ${location.substring(0, 60) || 'canonical URL'}. No duplicate content risk.`;
            } else if (redirectStatus === 302) {
                wwwStatus = 'Warning';
                wwwFinding = `${testUrl} returns a 302 (temporary) redirect instead of 301 (permanent). Temporary redirects do not pass PageRank. Change to 301.`;
            } else if (redirectStatus === 200) {
                wwwStatus = 'Warning';
                wwwFinding = `Both ${hostname} and ${wwwHost} return HTTP 200. This creates duplicate content — Google indexes both versions and splits link equity. Canonical tag alone is not enough; a server-level 301 redirect is required.`;
            } else if (redirectStatus >= 400) {
                wwwStatus = 'Warning';
                wwwFinding = `${testUrl} returns HTTP ${redirectStatus}. The alternate URL is unreachable, which is fine if you only use one version — but ensure your canonical tag and GSC are set to the primary version.`;
            } else {
                wwwFinding = `Unexpected HTTP ${redirectStatus} from ${testUrl}. Manually verify your redirect configuration.`;
                wwwStatus = 'Warning';
            }
        } catch {
            wwwFinding = 'Could not check www/non-www consistency (request timed out or DNS error). Manually verify using: https://redirectchecker.org';
            wwwStatus = 'Warning';
        }

        items.push({
            id: 'www-redirect',
            label: 'www vs non-www Redirect',
            status: wwwStatus,
            finding: wwwFinding,
            recommendation: wwwStatus !== 'Pass' ? {
                text: 'Choose one canonical version (www or non-www) and 301-redirect the other server-side.\n• Nginx: `return 301 https://www.yourdomain.com$request_uri;`\n• Apache: use mod_rewrite in .htaccess\n• Next.js/Vercel: set "alias" and "redirect" in vercel.json\n• After fixing: update your canonical tag, GSC preferred domain, and sitemap URLs to match.',
                priority: 'High',
            } : undefined,
            roiImpact: 80,
            aiVisibilityImpact: 60,
            details: wwwDetails,
        });

        const soft404HttpStatus = await (async () => {
            try {
                const urlObj = new URL(context.url);
                const testUrl = `${urlObj.origin}/__audit_probe_${Date.now()}__`;
                const res = await fetch(testUrl, {
                    method: 'HEAD',
                    redirect: 'follow',
                    signal: AbortSignal.timeout(6000),
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditBot/1.0)' },
                });
                return res.status;
            } catch {
                return null;
            }
        })();

        const soft404Status: 'Pass' | 'Warning' | 'Fail' =
            soft404HttpStatus === 404 || soft404HttpStatus === 410 ? 'Pass'
            : soft404HttpStatus === 200 ? 'Fail'
            : 'Warning';

        items.push({
            id: 'soft-404',
            label: 'Soft 404 Detection',
            status: soft404Status,
            finding: soft404HttpStatus === 404 || soft404HttpStatus === 410
                ? `Non-existent pages correctly return HTTP ${soft404HttpStatus}.`
                : soft404HttpStatus === 200
                ? 'Soft 404 detected: non-existent URLs return HTTP 200. Googlebot indexes these as live pages, wasting crawl budget and polluting your index.'
                : `Could not verify 404 behaviour (HTTP ${soft404HttpStatus ?? 'timeout/network error'}).`,
            recommendation: soft404Status === 'Fail' ? {
                text: 'Configure your server/framework to return HTTP 404 for non-existent pages:\n• Next.js: call `notFound()` in page components, or use the 404.tsx page which auto-returns 404\n• Nginx: ensure `try_files` does not silently serve your index.html for all paths\n• Check that your catch-all route ([...slug]) returns notFound() when no content matches',
                priority: 'High',
            } : undefined,
            roiImpact: 75,
            aiVisibilityImpact: 50,
            details: { probeHttpStatus: soft404HttpStatus ?? 0 },
        });

        // 15. Speed Improvement Forecast
        // Build a synthesised forecast from all warnings/failures found so far
        const speedFindings: Array<{ issue: string; estimatedSavingMs: number; effort: string }> = [];

        if (gzipStatus === 'Fail') {
            speedFindings.push({ issue: 'Enable Gzip/Brotli compression', estimatedSavingMs: 350, effort: 'Low' });
        }
        if (renderBlockingScripts.length > 0) {
            speedFindings.push({ issue: `Defer/async ${renderBlockingScripts.length} render-blocking script(s)`, estimatedSavingMs: renderBlockingScripts.length * 100, effort: 'Low' });
        }
        if (imgsWithoutDimensions.length > 0) {
            speedFindings.push({ issue: `Add dimensions to ${imgsWithoutDimensions.length} image(s) (CLS fix)`, estimatedSavingMs: 80, effort: 'Low' });
        }
        if (totalHints === 0) {
            speedFindings.push({ issue: 'Add preload/preconnect resource hints', estimatedSavingMs: 200, effort: 'Medium' });
        }
        if (hasGoogleFontsLink && !hasNextFont && (!hasGoogleFontsPreconnect || !hasFontDisplaySwap)) {
            speedFindings.push({ issue: 'Optimise Google Fonts (preconnect + font-display:swap)', estimatedSavingMs: 150, effort: 'Low' });
        }

        const totalEstimatedMs = speedFindings.reduce((acc, f) => acc + f.estimatedSavingMs, 0);
        const forecastItems = speedFindings
            .sort((a, b) => b.estimatedSavingMs - a.estimatedSavingMs)
            .map(f => `${f.issue} → ~${f.estimatedSavingMs}ms faster (${f.effort} effort)`)
            .join('\n• ');

        items.push({
            id: 'speed-forecast',
            label: 'Speed Improvement Forecast',
            status: speedFindings.length === 0 ? 'Pass' : speedFindings.length <= 2 ? 'Warning' : 'Fail',
            finding: speedFindings.length === 0
                ? 'No critical speed bottlenecks identified in this audit pass. Continue monitoring via PageSpeed Insights and Core Web Vitals.'
                : `${speedFindings.length} optimisation(s) identified. Cumulative LCP/load time saving estimate: ~${totalEstimatedMs}ms.\n• ${forecastItems}`,
            recommendation: speedFindings.length > 0 ? {
                text: `Prioritised by impact:\n1. ${speedFindings.sort((a, b) => b.estimatedSavingMs - a.estimatedSavingMs).map(f => `${f.issue} (${f.effort} effort, ~${f.estimatedSavingMs}ms gain)`).join('\n2. ')}\n\nCombined, these fixes are projected to improve LCP by ${(totalEstimatedMs / 1000).toFixed(1)}s and boost your PageSpeed score by an estimated ${Math.min(Math.round(speedFindings.length * 4 + totalEstimatedMs / 50), 35)} points.`,
                priority: speedFindings.length >= 3 ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 90,
            aiVisibilityImpact: 60,
            details: { issuesFound: speedFindings.length, estimatedTotalSavingMs: totalEstimatedMs },
        });

        // 16. Mobile Touch Target Size
        const interactiveEls = root.querySelectorAll('a, button, input[type="submit"], input[type="button"]');
        let smallTargetCount = 0;
        interactiveEls.forEach(el => {
            const style = el.getAttribute('style') || '';
            // Detect tiny inline font-size (< 12px signals element is very small)
            const fontMatch = style.match(/font-size:\s*([\d.]+)px/);
            if (fontMatch && parseFloat(fontMatch[1]) < 12) smallTargetCount++;
            // Detect explicit small height inline style
            const heightMatch = style.match(/height:\s*([\d.]+)px/);
            if (heightMatch && parseFloat(heightMatch[1]) < 28) smallTargetCount++;
        });
        // Also count anchor-only navigation that are single characters (common tiny link pattern)
        const singleCharLinks = root.querySelectorAll('a').filter(a => (a.textContent || '').trim().length === 1);
        smallTargetCount += singleCharLinks.length;

        items.push({
            id: 'touch-targets',
            label: 'Mobile Touch Target Size',
            status: smallTargetCount === 0 ? 'Pass' : smallTargetCount <= 3 ? 'Warning' : 'Fail',
            finding: smallTargetCount === 0
                ? 'No obviously undersized touch targets detected. Interactive elements appear to meet the 44×44px minimum.'
                : `${smallTargetCount} potentially undersized touch target(s) detected. Google recommends all tap targets be at least 44×44px. Undersized targets cause mis-taps and high mobile bounce rates.`,
            recommendation: smallTargetCount > 0 ? {
                text: 'Ensure all clickable elements (links, buttons) have a minimum tap area of 44×44px.\n• CSS: `min-height: 44px; min-width: 44px; padding: 12px 16px;`\n• For icon-only buttons, use `padding` to expand the hit area without changing visual size.\n• For text links within paragraphs, increase line-height to at least 1.6.',
                priority: smallTargetCount > 3 ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 70,
            aiVisibilityImpact: 30,
            details: { smallTargetsDetected: smallTargetCount },
        });

        // 17. Font Size Legibility (Mobile)
        const styleBlocks = root.querySelectorAll('style');
        const allInlineCss = styleBlocks.map(s => s.textContent || '').join(' ');
        // Look for body/p font-size declarations that are too small
        const smallFontMatches = [...allInlineCss.matchAll(/(?:body|p|div|span)\s*\{[^}]*font-size:\s*([\d.]+)px/g)]
            .filter(m => parseFloat(m[1]) < 16);
        const hasSmallBodyFont = smallFontMatches.length > 0;
        // Also check inline styles on p/body elements
        const bodyEl = root.querySelector('body');
        const bodyFontStyle = bodyEl?.getAttribute('style') || '';
        const bodyFontMatch = bodyFontStyle.match(/font-size:\s*([\d.]+)px/);
        const bodyFontTooSmall = bodyFontMatch && parseFloat(bodyFontMatch[1]) < 16;

        items.push({
            id: 'font-legibility',
            label: 'Font Size Legibility (Mobile)',
            status: (hasSmallBodyFont || bodyFontTooSmall) ? 'Warning' : 'Pass',
            finding: (hasSmallBodyFont || bodyFontTooSmall)
                ? `Small font-size detected in CSS (< 16px on body/paragraph elements). Google's mobile guidelines recommend a minimum 16px body font to prevent zoom-in on mobile, which degrades UX and increases bounce rate.`
                : 'Body text font size appears acceptable for mobile readability (≥ 16px or using framework defaults).',
            recommendation: (hasSmallBodyFont || bodyFontTooSmall) ? {
                text: 'Set body font-size to at least 16px (1rem).\n• CSS: `body { font-size: 16px; line-height: 1.6; }`\n• Avoid `font-size` in px for headings when you can use rem or em for scaling.\n• Impact: prevents browser mobile zoom-trigger, reduces bounce rate by up to 15% on mobile.',
                priority: 'Medium',
            } : undefined,
            roiImpact: 65,
            aiVisibilityImpact: 25,
            details: { smallFontDeclarationsFound: smallFontMatches.length },
        });

        // 18. Mobile-Specific Meta Tags
        const hasThemeColor = root.querySelector('meta[name="theme-color"]') !== null;
        const hasAppleTouchIcon = root.querySelector('link[rel="apple-touch-icon"]') !== null;
        const hasAppleWebApp = root.querySelector('meta[name="apple-mobile-web-app-capable"]') !== null;
        const hasFormatDetection = root.querySelector('meta[name="format-detection"]') !== null;

        const mobileMeta = { hasThemeColor, hasAppleTouchIcon, hasAppleWebApp, hasFormatDetection };
        const mobileMetaScore = [hasThemeColor, hasAppleTouchIcon].filter(Boolean).length;
        const missingMobile = [
            !hasThemeColor && 'theme-color',
            !hasAppleTouchIcon && 'apple-touch-icon',
        ].filter(Boolean) as string[];

        items.push({
            id: 'mobile-meta',
            label: 'Mobile & PWA Meta Tags',
            status: mobileMetaScore >= 2 ? 'Pass' : mobileMetaScore === 1 ? 'Warning' : 'Warning',
            finding: mobileMetaScore >= 2
                ? `Mobile meta tags present: theme-color ✓, apple-touch-icon ✓${hasAppleWebApp ? ', apple-mobile-web-app-capable ✓' : ''}.`
                : `Missing mobile meta tags: ${missingMobile.join(', ')}. These improve the add-to-homescreen experience and PWA readiness.`,
            recommendation: mobileMetaScore < 2 ? {
                text: [
                    !hasThemeColor ? '• Add `<meta name="theme-color" content="#your-brand-color">` — controls browser chrome colour on Android Chrome.' : '',
                    !hasAppleTouchIcon ? '• Add `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">` — used when users add your site to iPhone homescreen.' : '',
                    !hasFormatDetection ? '• Add `<meta name="format-detection" content="telephone=no">` to prevent iOS from auto-linking phone numbers incorrectly.' : '',
                ].filter(Boolean).join('\n'),
                priority: 'Low',
            } : undefined,
            roiImpact: 40,
            aiVisibilityImpact: 20,
            details: { ...mobileMeta, score: `${mobileMetaScore}/2 core tags` },
        });

        // FIX #19: Security Headers Audit
        const secIssues = await runSecurityAudit(context.url).catch(() => []);
        for (const issue of secIssues) {
            items.push({
                id: 'sec-' + issue.title.toLowerCase().replace(/\s+/g, '-'),
                label: issue.title,
                status: issue.severity === 'error' ? 'Fail' : 'Warning',
                finding: issue.description,
                recommendation: { text: issue.fixSuggestion ?? '', priority: issue.impact === 'HIGH' ? 'High' : issue.impact === 'MEDIUM' ? 'Medium' : 'Low' },
                roiImpact: issue.impact === 'HIGH' ? 75 : issue.impact === 'MEDIUM' ? 50 : 30,
                aiVisibilityImpact: 30,
                details: {},
            });
        }
        if (secIssues.length === 0) {
            items.push({
                id: 'security-headers',
                label: 'Security Headers & SSL',
                status: 'Pass',
                finding: 'Security headers present, SSL grade acceptable, domain not flagged by Safe Browsing.',
                roiImpact: 0,
                aiVisibilityImpact: 0,
                details: {},
            });
        }

        // FIX #21: Redirect Chain Detection
        const redirectChainResult = await (async () => {
            const chain: string[] = [context.url];
            const statuses: number[] = [];
            let current = context.url;
            const seen = new Set<string>([current]);
            for (let i = 0; i < 8; i++) {
                try {
                    const res = await fetch(current, {
                        method: 'HEAD',
                        redirect: 'manual',
                        signal: AbortSignal.timeout(6000),
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditBot/1.0)' },
                    });
                    const status = res.status;
                    const location = res.headers.get('location');
                    if (status >= 300 && status < 400 && location) {
                        statuses.push(status);
                        const next = location.startsWith('http') ? location : new URL(location, current).href;
                        if (seen.has(next)) { chain.push('[LOOP DETECTED]'); break; }
                        seen.add(next);
                        chain.push(next);
                        current = next;
                    } else {
                        break;
                    }
                } catch {
                    break;
                }
            }
            return { chain, statuses };
        })();
        const redirectChain = redirectChainResult.chain;
        const redirectStatuses = redirectChainResult.statuses;

        const redirectHops = redirectChain.length - 1;
        const hasLoop = redirectChain.includes('[LOOP DETECTED]');
        const hasTemporaryRedirect = redirectStatuses.some(s => s === 302 || s === 307);
        const redirectStatus: 'Pass' | 'Warning' | 'Fail' =
            hasLoop || redirectHops > 4 ? 'Fail' : hasTemporaryRedirect || redirectHops > 2 ? 'Warning' : 'Pass';
        const statusSummary = redirectStatuses.length > 0 ? ` (HTTP ${redirectStatuses.join(' → ')})` : '';

        items.push({
            id: 'redirect-chain',
            label: 'Redirect Chain',
            status: redirectStatus,
            finding: redirectHops === 0
                ? 'No redirects detected — URL resolves directly.'
                : hasLoop
                    ? `Redirect loop detected! Chain: ${redirectChain.join(' → ')}`
                    : `Redirect chain: ${redirectHops} hop(s)${statusSummary}. ${redirectChain.join(' → ')}.${hasTemporaryRedirect ? ' Temporary redirect (302/307) detected — does not pass PageRank to destination.' : ''}`,
            recommendation: redirectHops > 2 || hasLoop || hasTemporaryRedirect ? {
                text: hasLoop
                    ? 'Fix redirect loop immediately — this makes the page uncrawlable and will cause significant rank drops.'
                    : hasTemporaryRedirect
                    ? 'Change 302/307 (temporary) redirects to 301 (permanent). Temporary redirects do not transfer PageRank to the destination. Update your server or CDN redirect configuration.'
                    : `Reduce redirect chain to max 1 hop. Each redirect adds ~100-300ms latency and dilutes PageRank. Update all internal links to point directly to the final URL.`,
                priority: hasLoop || redirectHops > 4 ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 85,
            aiVisibilityImpact: 60,
            details: { hops: redirectHops, chain: redirectChain.join(' → '), hasLoop, hasTemporaryRedirect, redirectTypes: redirectStatuses.join(',') },
        });

        // 23. Invisible Text (SEO Cloaking / Accessibility Risk)
        const textElements = root.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6, a, li');
        let invisibleCount = 0;
        const invisibleExamples: string[] = [];

        textElements.forEach(el => {
            const style = el.getAttribute('style') || '';
            const className = el.getAttribute('class') || '';
            const textContent = el.textContent.trim();

            // Typical CSS patterns used to hide text
            const hasInvisibleStyle =
                style.includes('display: none') ||
                style.includes('display:none') ||
                style.includes('visibility: hidden') ||
                style.includes('visibility:hidden') ||
                style.includes('opacity: 0;') ||
                style.includes('opacity:0') ||
                style.includes('font-size: 0') ||
                style.includes('font-size:0');

            // Tailwind/utility class patterns
            const hasInvisibleClass =
                className.split(/\s+/).some(c => ['hidden', 'invisible', 'opacity-0', 'text-transparent'].includes(c));

            if ((hasInvisibleStyle || hasInvisibleClass) && textContent.length > 10) {
                invisibleCount++;
                if (invisibleExamples.length < 3) {
                    invisibleExamples.push(textContent.substring(0, 50) + '...');
                }
            }
        });

        items.push({
            id: 'invisible-text-cloaking',
            label: 'Invisible Text (Cloaking Risk)',
            status: invisibleCount === 0 ? 'Pass' : 'Warning',
            finding: invisibleCount === 0
                ? 'No significant invisible text detected.'
                : `Detected ${invisibleCount} block(s) of hidden text >10 characters (e.g. "${invisibleExamples[0]}").`,
            recommendation: invisibleCount > 0 ? {
                text: 'Review hidden text. If it contains keywords intended only for search engines, Google may issue a manual cloaking penalty. If used for UI states (like accordions or tabs), ensure they are accessible to screen readers using ARIA attributes.',
                priority: 'Medium'
            } : undefined,
            roiImpact: 85,
            aiVisibilityImpact: 60,
            details: { invisibleCount, invisibleExamples: invisibleExamples.join(', ') }
        });

        // Score
        const analyzableItems = items.filter(i => i.status !== 'Skipped' && i.status !== 'Info');
        const passed = analyzableItems.filter(i => i.status === 'Pass').length;
        const failed = analyzableItems.filter(i => i.status === 'Fail').length;
        const warnings = analyzableItems.filter(i => i.status === 'Warning').length;
        const maxScore = analyzableItems.length;
        const score = maxScore > 0 ? Math.round(((passed + warnings * 0.5) / maxScore) * 100) : 0;

        return {
            id: TechnicalModule.id,
            label: TechnicalModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        };
    }
};
