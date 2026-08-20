// =============================================================================
// TECHNICAL SEO CRAWLER
// Follows internal links (max depth 4) and finds technical SEO issues.
// READ ONLY — only makes GET requests, respects robots.txt.
// Supports JS-rendered crawling via Playwright for SPA frameworks.
// =============================================================================

import { isSafeUrl } from "@/lib/security/safe-url";
import { logger } from "@/lib/logger";

export interface CrawlIssue {
    url: string
    type: "broken_link" | "redirect_chain" | "duplicate_title" | "missing_canonical" | "thin_content" | "slow_page" | "deep_click_depth" | "orphan_page"
    severity: "critical" | "warning"
    details: string
}

/**
 * Options for the technical SEO crawl.
 */
export interface CrawlOptions {
    maxPages?: number;
    maxDepth?: number;
    /**
     * JS rendering strategy:
     * - 'auto' (default): detect SPA markers in homepage raw HTML, switch to Playwright if found
     * - 'always': use Playwright for every page fetch
     * - 'never': plain fetch only (legacy behaviour)
     */
    jsRendering?: 'auto' | 'always' | 'never';
}

export interface CrawlResult {
    domain: string
    pagesScanned: number
    issues: CrawlIssue[]
    brokenLinks: { from: string; to: string; status: number }[]
    redirectChains: { url: string; chain: string[] }[]
    duplicateTitles: { title: string; urls: string[] }[]
    clickDepthMap: Record<string, number>
    orphanPages: string[]
    deepPages: string[]
    linkGraph: { url: string; inboundCount: number; outboundCount: number; depth: number }[]
    scannedAt: Date
    /** Whether Playwright JS rendering was active for this crawl. */
    jsRendered: boolean
    /** SPA framework detected in the homepage HTML, if any. */
    spaFrameworkDetected: string | null
}

const DEFAULT_MAX_PAGES = 50
const DEFAULT_MAX_DEPTH = 4
const TIMEOUT_MS = 8000
const JS_RENDER_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// SPA Detection
// ---------------------------------------------------------------------------

interface SpaDetectionResult {
    isSpa: boolean;
    framework: string | null;
}

/**
 * Analyse raw HTML for SPA framework markers.
 * Returns whether the page appears to be a client-rendered SPA and which
 * framework was detected (if any).
 *
 * Exported for testing — not part of the public crawl API.
 */
export function detectSpaSignatures(html: string): SpaDetectionResult {
    // Next.js CSR / SSR hydration markers
    if (html.includes('__NEXT_DATA__') || html.includes('_next/static') || html.includes('id="__next"')) {
        // Next.js pages may be SSR or CSR — check if the body is thin
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 200) {
            return { isSpa: true, framework: 'Next.js' };
        }
    }

    // React SPA (CRA, Vite-React, etc.) — thin body with root mount point
    if (
        (html.includes('data-reactroot') || html.includes('id="root"')) &&
        !html.includes('data-reactroot') // id="root" alone isn't conclusive — also check body
    ) {
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 200) {
            return { isSpa: true, framework: 'React' };
        }
    }
    // Explicit React root attribute is strong signal
    if (html.includes('data-reactroot')) {
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 200) {
            return { isSpa: true, framework: 'React' };
        }
    }

    // Vue / Nuxt markers
    if (html.includes('__NUXT__') || html.includes('data-server-rendered')) {
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 200) {
            return { isSpa: true, framework: 'Vue' };
        }
    }
    if (/data-v-[a-f0-9]/i.test(html)) {
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 200) {
            return { isSpa: true, framework: 'Vue' };
        }
    }

    // Angular markers
    if (html.includes('ng-version') || html.includes('ng-app')) {
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 200) {
            return { isSpa: true, framework: 'Angular' };
        }
    }

    // Generic SPA heuristic: very thin body with many script tags
    const scriptCount = (html.match(/<script/gi) ?? []).length;
    if (scriptCount > 3) {
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 100) {
            return { isSpa: true, framework: null };
        }
    }

    return { isSpa: false, framework: null };
}

// ---------------------------------------------------------------------------
// Playwright-aware page fetch
// ---------------------------------------------------------------------------

/**
 * Check whether Playwright rendering is available in the current environment.
 */
export function isPlaywrightAvailable(): boolean {
    return !!(process.env.BROWSERLESS_URL || process.env.PLAYWRIGHT_ENABLED === 'true');
}

/**
 * Fetch a page's HTML, optionally using Playwright for JS rendering.
 * Falls back to plain fetch if Playwright is unavailable or errors.
 */
async function fetchPageHtml(
    url: string,
    usePlaywright: boolean,
): Promise<{ html: string; renderTimeMs?: number } | null> {
    if (usePlaywright) {
        try {
            const { fetchRenderedHtml } = await import('@/lib/crawler/browser');
            const result = await fetchRenderedHtml(url, JS_RENDER_TIMEOUT_MS);
            if (result.html && result.html.length > 0) {
                return { html: result.html, renderTimeMs: result.jsRenderTimeMs };
            }
            // Rendered HTML was empty — fall through to plain fetch
            logger.warn(`[Crawler] Playwright returned empty HTML for ${url} — falling back to plain fetch`);
        } catch (err: unknown) {
            // Playwright unavailable or page-level error — graceful degradation
            logger.warn(`[Crawler] Playwright fetch failed for ${url}, falling back to plain fetch`, {
                error: (err as Error)?.message,
            });
        }
    }

    // Plain fetch fallback
    try {
        const res = await fetch(url, {
            redirect: 'follow',
            headers: { 'User-Agent': 'SEOTool-Bot/1.0 (site audit; read-only)' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const html = await res.text();
        return { html };
    } catch {
        return null;
    }
}

const isAllowedByRobots = async (
    origin: string,
    path: string,
    robotsCache: Map<string, string>
): Promise<boolean> => {
    try {
        if (!robotsCache.has(origin)) {
            const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5000) })
            robotsCache.set(origin, res.ok ? await res.text() : "")
        }

        const robots = robotsCache.get(origin) ?? ""
        const lines = robots.split("\n")
        let applies = false

        for (const line of lines) {
            const trimmed = line.trim().toLowerCase()
            if (trimmed.startsWith("user-agent:")) {
                applies = trimmed.includes("*") || trimmed.includes("seotool-bot")
            }
            if (applies && trimmed.startsWith("disallow:")) {
                const disallowedPath = trimmed.replace("disallow:", "").trim()
                if (disallowedPath && path.startsWith(disallowedPath)) return false
            }
        }

        return true
    } catch {
        return true
    }
}

/**
 * Follow redirects manually (without auto-follow) to detect redirect chains.
 * Returns the full chain of URLs visited and the final HTTP status.
 * A chain.length > 2 means there is a multi-hop redirect chain.
 */
const followRedirects = async (
    url: string
): Promise<{ finalUrl: string; chain: string[]; finalStatus: number }> => {
    const chain: string[] = [url]
    let current = url
    const MAX_HOPS = 10

    for (let i = 0; i < MAX_HOPS; i++) {
        const guard = isSafeUrl(current)
        if (!guard.ok) return { finalUrl: current, chain, finalStatus: 0 }

        try {
            const res = await fetch(current, {
                redirect: "manual",
                headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            })

            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get("location")
                if (!location) break
                const next = location.startsWith("http")
                    ? location
                    : new URL(location, current).toString()
                const nextGuard = isSafeUrl(next)
                if (!nextGuard.ok) return { finalUrl: next, chain, finalStatus: 0 }
                chain.push(next)
                current = next
            } else {
                return { finalUrl: current, chain, finalStatus: res.status }
            }
        } catch {
            break
        }
    }

    return { finalUrl: current, chain, finalStatus: 0 }
}

export const crawlSite = async (
    domain: string,
    options?: CrawlOptions
): Promise<CrawlResult> => {
    let origin: string
    try {
        const parsed = new URL(domain.startsWith("http") ? domain : `https://${domain}`)
        origin = parsed.origin
    } catch {
        throw new Error(`Invalid domain: ${domain}`)
    }

    const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES
    const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH
    const jsRenderingMode = options?.jsRendering ?? 'auto'

    const visited = new Set<string>()
    const clickDepthMap: Record<string, number> = {}
    const inboundCounts = new Map<string, number>()
    const outboundCounts = new Map<string, number>()
    const queue: { url: string; depth: number; from: string }[] = [{ url: origin, depth: 0, from: "root" }]
    const issues: CrawlIssue[] = []
    const brokenLinks: CrawlResult["brokenLinks"] = []
    const redirectChains: CrawlResult["redirectChains"] = []
    const titleMap = new Map<string, string[]>()
    const robotsCache = new Map<string, string>()
    const externalLinksToCheck: { url: string; from: string }[] = []
    const visitedExternal = new Set<string>()

    inboundCounts.set(origin, 1)

    // -----------------------------------------------------------------------
    // SPA detection (auto mode) — fetch homepage raw HTML once to decide
    // whether Playwright rendering is needed for this site.
    // -----------------------------------------------------------------------
    let spaDetection: { isSpa: boolean; framework: string | null } | null = null;
    let usePlaywright = false;

    if (jsRenderingMode === 'always') {
        usePlaywright = isPlaywrightAvailable();
        if (!usePlaywright) {
            logger.warn('[Crawler] jsRendering=always but Playwright is not available — falling back to plain fetch');
        }
    } else if (jsRenderingMode === 'auto') {
        // Probe homepage with a quick plain fetch to check for SPA markers
        try {
            const probeRes = await fetch(origin, {
                redirect: 'follow',
                headers: { 'User-Agent': 'SEOTool-Bot/1.0 (site audit; read-only)' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (probeRes.ok) {
                const probeHtml = await probeRes.text();
                spaDetection = detectSpaSignatures(probeHtml);
                if (spaDetection.isSpa && isPlaywrightAvailable()) {
                    usePlaywright = true;
                    logger.info(
                        `[Crawler] SPA detected on ${origin}` +
                        (spaDetection.framework ? ` (${spaDetection.framework})` : '') +
                        ' — enabling Playwright rendering'
                    );
                } else if (spaDetection.isSpa) {
                    logger.warn(
                        `[Crawler] SPA detected on ${origin} but Playwright is not available — crawling with plain fetch`
                    );
                }
            }
        } catch {
            // Homepage probe failed — proceed with plain fetch
            logger.warn(`[Crawler] Homepage probe failed for ${origin} — proceeding without JS rendering`);
        }
    }
    // jsRenderingMode === 'never' → usePlaywright stays false

    while (queue.length > 0 && visited.size < maxPages) {
        const item = queue.shift()
        if (!item) break
        const { url, depth, from } = item

        if (visited.has(url)) continue
        visited.add(url)
        clickDepthMap[url] = depth

        if (depth > 3) {
            issues.push({
                url,
                type: "deep_click_depth",
                severity: "warning",
                details: `Click depth of ${depth} exceeds recommended maximum of 3 clicks from homepage.`
            })
        }

        let parsedPath: string
        try { parsedPath = new URL(url).pathname } catch { continue }

        const allowed = await isAllowedByRobots(origin, parsedPath, robotsCache)
        if (!allowed) continue

        try {
            const { finalUrl, chain, finalStatus } = await followRedirects(url)

            if (chain.length > 2) {
                redirectChains.push({ url: chain[0], chain })
                issues.push({
                    url: chain[0],
                    type: "redirect_chain",
                    severity: "warning",
                    details: `Redirect chain of ${chain.length - 1} hops: ${chain.join(" → ")}`,
                })
            }

            if (finalUrl !== url && !visited.has(finalUrl)) {
                visited.add(finalUrl)
                clickDepthMap[finalUrl] = depth
            }

            if (finalStatus === 0 || finalStatus >= 400) {
                const details = finalStatus === 0
                    ? `Network Error / Timeout — linked from ${from}`
                    : `HTTP ${finalStatus} Error — linked from ${from}`

                brokenLinks.push({ from, to: url, status: finalStatus })
                issues.push({ url, type: "broken_link", severity: "critical", details })
                continue
            }

            if (finalStatus !== 0 && (finalStatus < 200 || finalStatus >= 400)) continue

            const resolvedGuard = isSafeUrl(finalUrl)
            if (!resolvedGuard.ok) continue

            const pageResult = await fetchPageHtml(finalUrl, usePlaywright)
            if (!pageResult) continue

            const html = pageResult.html

            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
            const pageTitle = titleMatch ? titleMatch[1].trim() : null
            if (pageTitle) {
                const existing = titleMap.get(pageTitle) ?? []
                existing.push(url)
                titleMap.set(pageTitle, existing)
            }

            const wordCount = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(w => w.length > 2).length
            if (wordCount < 200) {
                issues.push({ url, type: "thin_content", severity: "warning", details: `Only ~${wordCount} words — potential thin content penalty` })
            }

            const linkMatches = [...html.matchAll(/href=["']([^"'#?]+)["']/gi)]
            let outboundCount = 0

            for (const match of linkMatches) {
                let href = match[1]
                if (href.startsWith("/")) href = `${origin}${href}`
                if (!href.startsWith("http")) continue

                if (!isSafeUrl(href)) continue

                if (!href.startsWith(origin)) {
                    if (!visitedExternal.has(href)) {
                        visitedExternal.add(href)
                        externalLinksToCheck.push({ url: href, from: url })
                    }
                    continue
                }

                outboundCount++
                const currentInbound = inboundCounts.get(href) ?? 0
                inboundCounts.set(href, currentInbound + 1)

                if (depth < maxDepth && !visited.has(href)) {
                    queue.push({ url: href, depth: depth + 1, from: url })
                }
            }

            outboundCounts.set(url, outboundCount)

        } catch (err: unknown) {
            brokenLinks.push({ from, to: url, status: 0 })
            if ((err as { name?: string }).name !== "AbortError") {
                issues.push({ url, type: "broken_link", severity: "warning", details: `Failed to fetch: ${(err as Error).message}` })
            } else {
                issues.push({ url, type: "broken_link", severity: "warning", details: `Timeout — linked from ${from}` })
            }
        }
    }

    const CHUNK_SIZE = 10
    for (let i = 0; i < externalLinksToCheck.length; i += CHUNK_SIZE) {
        const chunk = externalLinksToCheck.slice(i, i + CHUNK_SIZE)
        await Promise.allSettled(chunk.map(async ({ url: extUrl, from: extFrom }) => {
            if (!isSafeUrl(extUrl)) return

            try {
                let res = await fetch(extUrl, {
                    method: 'HEAD',
                    headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
                    signal: AbortSignal.timeout(5000),
                })

                if (res.status === 405 || res.status === 403) {
                    res = await fetch(extUrl, {
                        method: 'GET',
                        headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
                        signal: AbortSignal.timeout(5000),
                    })
                }

                if (res.status >= 400) {
                    brokenLinks.push({ from: extFrom, to: extUrl, status: res.status })
                    issues.push({ url: extUrl, type: "broken_link", severity: "warning", details: `External HTTP ${res.status} Error — linked from ${extFrom}` })
                }
            } catch {
                brokenLinks.push({ from: extFrom, to: extUrl, status: 0 })
                issues.push({ url: extUrl, type: "broken_link", severity: "warning", details: `External Network Error / Timeout — linked from ${extFrom}` })
            }
        }))
    }

    const duplicateTitles: CrawlResult["duplicateTitles"] = []
    for (const [titleText, urls] of titleMap.entries()) {
        if (urls.length > 1) {
            duplicateTitles.push({ title: titleText, urls })
            issues.push({ url: urls[0], type: "duplicate_title", severity: "warning", details: `Title "${titleText}" used on ${urls.length} pages: ${urls.join(", ")}` })
        }
    }

    const orphanPages: string[] = []
    const deepPages: string[] = []
    const linkGraph: CrawlResult["linkGraph"] = []

    for (const url of visited) {
        const depth = clickDepthMap[url] ?? 0
        const inboundCount = inboundCounts.get(url) ?? 0
        const outboundCount = outboundCounts.get(url) ?? 0

        linkGraph.push({ url, inboundCount, outboundCount, depth })

        if (depth > 3) {
            deepPages.push(url)
        }

        if (inboundCount === 0 && url !== origin && url !== `${origin}/`) {
            orphanPages.push(url)
            issues.push({
                url,
                type: "orphan_page",
                severity: "warning",
                details: "Orphan page detected — no internal inbound links were found pointing to this page."
            })
        }
    }

    return {
        domain,
        pagesScanned: visited.size,
        issues,
        brokenLinks,
        redirectChains,
        duplicateTitles,
        clickDepthMap,
        orphanPages,
        deepPages,
        linkGraph,
        scannedAt: new Date(),
        jsRendered: usePlaywright,
        spaFrameworkDetected: spaDetection?.framework ?? null,
    }
}
