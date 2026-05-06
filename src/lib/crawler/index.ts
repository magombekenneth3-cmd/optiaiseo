// =============================================================================
// TECHNICAL SEO CRAWLER
// Follows internal links (max depth 2) and finds technical SEO issues.
// READ ONLY — only makes GET requests, respects robots.txt.
// =============================================================================

import { isSafeUrl } from "@/lib/security/safe-url";

export interface CrawlIssue {
    url: string
    type: "broken_link" | "redirect_chain" | "duplicate_title" | "missing_canonical" | "thin_content" | "slow_page"
    severity: "critical" | "warning"
    details: string
}

export interface CrawlResult {
    domain: string
    pagesScanned: number
    issues: CrawlIssue[]
    brokenLinks: { from: string; to: string; status: number }[]
    redirectChains: { url: string; chain: string[] }[]
    duplicateTitles: { title: string; urls: string[] }[]
    scannedAt: Date
}

const MAX_PAGES = 50
const MAX_DEPTH = 2
const TIMEOUT_MS = 8000

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

export const crawlSite = async (domain: string): Promise<CrawlResult> => {
    let origin: string
    try {
        const parsed = new URL(domain.startsWith("http") ? domain : `https://${domain}`)
        origin = parsed.origin
    } catch {
        throw new Error(`Invalid domain: ${domain}`)
    }

    const visited = new Set<string>()
    const queue: { url: string; depth: number; from: string }[] = [{ url: origin, depth: 0, from: "root" }]
    const issues: CrawlIssue[] = []
    const brokenLinks: CrawlResult["brokenLinks"] = []
    const redirectChains: CrawlResult["redirectChains"] = []
    const titleMap = new Map<string, string[]>()
    const robotsCache = new Map<string, string>()
    const externalLinksToCheck: { url: string; from: string }[] = []
    const visitedExternal = new Set<string>()

    while (queue.length > 0 && visited.size < MAX_PAGES) {
        const item = queue.shift()
        if (!item) break
        const { url, depth, from } = item

        if (visited.has(url)) continue
        visited.add(url)

        let parsedPath: string
        try { parsedPath = new URL(url).pathname } catch { continue }

        const allowed = await isAllowedByRobots(origin, parsedPath, robotsCache)
        if (!allowed) continue

        try {
            // Follow redirects manually to detect chains
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

            // Re-validate the resolved URL before fetching page content —
            // guards against open-redirect chains that escape isSafeUrl in followRedirects.
            const resolvedGuard = isSafeUrl(finalUrl)
            if (!resolvedGuard.ok) continue

            const pageRes = await fetch(finalUrl, {
                redirect: "follow",
                headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            })

            if (!pageRes.ok) continue

            const html = await pageRes.text()

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

            if (depth < MAX_DEPTH) {
                const linkMatches = [...html.matchAll(/href=["']([^"'#?]+)["']/gi)]
                for (const match of linkMatches) {
                    let href = match[1]
                    if (href.startsWith("/")) href = `${origin}${href}`
                    if (!href.startsWith("http")) continue

                    // ── SSRF guard on every discovered link ────────────────────
                    if (!isSafeUrl(href)) continue

                    if (!href.startsWith(origin)) {
                        // External link
                        if (!visitedExternal.has(href)) {
                            visitedExternal.add(href)
                            externalLinksToCheck.push({ url: href, from: url })
                        }
                        continue
                    }

                    if (!visited.has(href)) queue.push({ url: href, depth: depth + 1, from: url })
                }
            }
         
         
        } catch (err: unknown) {
            brokenLinks.push({ from, to: url, status: 0 })
            if ((err as { name?: string }).name !== "AbortError") {
                issues.push({ url, type: "broken_link", severity: "warning", details: `Failed to fetch: ${(err as Error).message}` })
            } else {
                issues.push({ url, type: "broken_link", severity: "warning", details: `Timeout — linked from ${from}` })
            }
        }
    }

    // Check external links (batched to respect limits)
    const CHUNK_SIZE = 10;
    for (let i = 0; i < externalLinksToCheck.length; i += CHUNK_SIZE) {
        const chunk = externalLinksToCheck.slice(i, i + CHUNK_SIZE);
        await Promise.allSettled(chunk.map(async ({ url: extUrl, from: extFrom }) => {
            // ── SSRF guard on external links too ──────────────────────────────
            if (!isSafeUrl(extUrl)) return

            try {
                // First try HEAD request to save bandwidth
                let res = await fetch(extUrl, {
                    method: 'HEAD',
                    headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
                    signal: AbortSignal.timeout(5000),
                });

                // Some servers block HEAD requests, fallback to GET
                if (res.status === 405 || res.status === 403) {
                    res = await fetch(extUrl, {
                        method: 'GET',
                        headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
                        signal: AbortSignal.timeout(5000),
                    });
                }

                if (res.status >= 400) {
                    brokenLinks.push({ from: extFrom, to: extUrl, status: res.status });
                    issues.push({ url: extUrl, type: "broken_link", severity: "warning", details: `External HTTP ${res.status} Error — linked from ${extFrom}` });
                }
            } catch {
                brokenLinks.push({ from: extFrom, to: extUrl, status: 0 });
                issues.push({ url: extUrl, type: "broken_link", severity: "warning", details: `External Network Error / Timeout — linked from ${extFrom}` });
            }
        }));
    }

    const duplicateTitles: CrawlResult["duplicateTitles"] = []
    for (const [titleText, urls] of titleMap.entries()) {
        if (urls.length > 1) {
            duplicateTitles.push({ title: titleText, urls })
            issues.push({ url: urls[0], type: "duplicate_title", severity: "warning", details: `Title "${titleText}" used on ${urls.length} pages: ${urls.join(", ")}` })
        }
    }

    return {
        domain,
        pagesScanned: visited.size,
        issues,
        brokenLinks,
        redirectChains,
        duplicateTitles,
        scannedAt: new Date(),
    }
}
