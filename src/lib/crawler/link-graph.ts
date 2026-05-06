// =============================================================================
// FIX #18: BFS Internal Link Graph
// Crawls up to `maxPages` pages of a domain using BFS to build a link graph.
// Calculates relative link depth, detects orphan pages, and estimates
// PageRank flow using a simplified iterative algorithm.
// =============================================================================

import { isSafeUrl } from "@/lib/security/safe-url";

export interface LinkNode {
    url: string;
    inboundLinks: string[];   // Which pages link TO this page
    outboundLinks: string[];  // Which pages this page links TO
    depth: number;            // BFS depth from seed URL
    isOrphan: boolean;        // No internal inbound links
    pageRankScore: number;    // Simplified PageRank (0–1)
}

export interface LinkGraphResult {
    nodes: LinkNode[];
    orphanPages: string[];
    deepPages: string[];         // Pages at depth > 3
    topLinkedPages: string[];    // Pages with most inbound links
    pageCount: number;
    maxDepth: number;
    avgDepth: number;
    recommendation: string;
}

const FETCH_TIMEOUT_MS = 8000;
const INTERNAL_LINK_SELECTOR = /href="(\/[^"#?][^"]*?)"/g;
const SAME_PAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|woff2?)$/i;

async function fetchInternalLinks(url: string, origin: string): Promise<string[]> {
    try {
        const guard = isSafeUrl(url);
        if (!guard.ok) return [];
        const res = await fetch(url, {
            headers: { 'User-Agent': 'SEO-Link-Bot/1.0' },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) return [];
        const html = await res.text();
        const links: string[] = [];
        let match: RegExpExecArray | null;
        const regex = new RegExp(INTERNAL_LINK_SELECTOR.source, 'g');
        while ((match = regex.exec(html)) !== null) {
            const href = match[1];
            if (SAME_PAGE_EXTENSIONS.test(href)) continue;
            const absolute = `${origin}${href.startsWith('/') ? href : `/${href}`}`;
            links.push(absolute);
        }
        return [...new Set(links)];
    } catch {
        return [];
    }
}

function computePageRank(
    nodes: Map<string, { inbound: Set<string>; outbound: Set<string> }>,
    iterations = 20,
    damping = 0.85
): Map<string, number> {
    const N = nodes.size;
    const pr = new Map<string, number>();
    nodes.forEach((_, url) => pr.set(url, 1 / N));

    for (let i = 0; i < iterations; i++) {
        const newPr = new Map<string, number>();
        nodes.forEach((data, url) => {
            let rank = (1 - damping) / N;
            data.inbound.forEach(linker => {
                const linkerOut = nodes.get(linker)?.outbound.size || 1;
                rank += damping * (pr.get(linker) || 0) / linkerOut;
            });
            newPr.set(url, rank);
        });
        newPr.forEach((v, k) => pr.set(k, v));
    }

    return pr;
}

export async function buildLinkGraph(
    seedUrl: string,
    maxPages = 50
): Promise<LinkGraphResult> {
    let origin: string;
    try {
        origin = new URL(seedUrl).origin;
    } catch {
        return {
            nodes: [], orphanPages: [], deepPages: [], topLinkedPages: [],
            pageCount: 0, maxDepth: 0, avgDepth: 0,
            recommendation: 'Invalid seed URL provided.',
        };
    }

    const visited = new Map<string, { inbound: Set<string>; outbound: Set<string>; depth: number }>();
    const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
    visited.set(seedUrl, { inbound: new Set(), outbound: new Set(), depth: 0 });

    const BFS_BATCH = 8;
    while (queue.length > 0 && visited.size < maxPages) {
        const batch = queue.splice(0, BFS_BATCH);
        await Promise.allSettled(batch.map(async ({ url, depth }) => {
            const links = await fetchInternalLinks(url, origin);
            const node = visited.get(url);
            if (!node) return;

            for (const link of links) {
                if (!link.startsWith(origin)) continue;
                node.outbound.add(link);
                if (!visited.has(link) && visited.size < maxPages) {
                    visited.set(link, { inbound: new Set([url]), outbound: new Set(), depth: depth + 1 });
                    queue.push({ url: link, depth: depth + 1 });
                } else if (visited.has(link)) {
                    visited.get(link)!.inbound.add(url);
                }
            }
        }));
    }

    const prScores = computePageRank(visited);

    const nodes: LinkNode[] = [];
    const depths: number[] = [];

    visited.forEach((data, url) => {
        const isOrphan = data.inbound.size === 0 && url !== seedUrl;
        depths.push(data.depth);
        nodes.push({
            url,
            inboundLinks: [...data.inbound],
            outboundLinks: [...data.outbound],
            depth: data.depth,
            isOrphan,
            pageRankScore: parseFloat((prScores.get(url) || 0).toFixed(4)),
        });
    });

    const orphanPages = nodes.filter(n => n.isOrphan).map(n => n.url);
    const deepPages = nodes.filter(n => n.depth > 3).map(n => n.url);
    const topLinkedPages = nodes
        .sort((a, b) => b.inboundLinks.length - a.inboundLinks.length)
        .slice(0, 10)
        .map(n => n.url);

    const maxDepth = Math.max(...depths, 0);
    const avgDepth = depths.length > 0 ? parseFloat((depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1)) : 0;

    const issues: string[] = [];
    if (orphanPages.length > 0) issues.push(`${orphanPages.length} orphan page(s) with no internal inbound links`);
    if (deepPages.length > 0) issues.push(`${deepPages.length} page(s) at depth > 3 (hard to crawl)`);
    if (maxDepth > 4) issues.push(`Maximum crawl depth is ${maxDepth} — Google recommends < 4 clicks from homepage`);

    const recommendation = issues.length === 0
        ? `Link graph looks healthy (${nodes.length} pages, avg depth ${avgDepth}).`
        : `Link graph issues: ${issues.join('; ')}. Add internal links to orphan pages and reduce deep URL paths.`;

    return {
        nodes,
        orphanPages,
        deepPages,
        topLinkedPages,
        pageCount: nodes.length,
        maxDepth,
        avgDepth,
        recommendation,
    };
}
