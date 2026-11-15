import { parse, type HTMLElement } from 'node-html-parser';
import {
    CONFIDENCE_BY_KIND,
    computeFindingFingerprint,
    createEvidence,
    type ExplainablePriority,
    type SEOEvidence,
} from './contracts';
import { computePriorityV4, fixabilityForRemediation } from './prioritization';
import type { DiagnosticFinding } from './root-cause-engine';
import type {
    DeepPageSummary,
    DuplicateMetadataCluster,
    NormalizedRecommendation,
    PageGraphBrokenLink,
    PageGraphNode,
    SiteGraphSummary,
} from './types';
import { getUrlLookupVariants, normalizeAuditUrl, safeUrlOrigin } from './utils/url';

const MAX_OUTBOUND_LINKS_PER_PAGE = 250;
const MAX_DUPLICATE_CLUSTERS = 20;
const MAX_ORPHANS = 50;
const MAX_BROKEN_EDGES = 50;
const DEEP_CLICK_THRESHOLD = 3;

export interface SiteBrokenLinkEdge {
    from: string;
    to: string;
    status: number;
}

export interface SiteCrawlCachePayload {
    clickDepthMap: Record<string, number>;
    orphanPages: string[];
    brokenLinks: SiteBrokenLinkEdge[];
    updatedAt: string;
}

export interface PageAuditGraphInput {
    pageUrl: string;
    issueList?: unknown;
}

export const SITE_GRAPH_ISSUE_TYPES = [
    'duplicate_titles',
    'duplicate_meta_descriptions',
    'duplicate_h1s',
    'orphan_pages',
] as const;

export interface SiteGraphFindingWithPriority {
    finding: DiagnosticFinding;
    priority: ExplainablePriority;
}

export interface SiteGraphAnalysisResult {
    hasGraphData: boolean;
    summary: SiteGraphSummary;
    crawlCache: SiteCrawlCachePayload;
    recommendations: NormalizedRecommendation[];
    buildDiagnosticFindings: (siteId: string, origin: string) => SiteGraphFindingWithPriority[];
}

/** Extracts normalized same-origin outbound links from an already-parsed DOM root. */
export function extractSameOriginLinksFromRoot(
    root: HTMLElement,
    pageUrl: string,
    maxLinks = MAX_OUTBOUND_LINKS_PER_PAGE,
): string[] {
    const origin = safeUrlOrigin(pageUrl);
    if (!origin) return [];

    const seen = new Set<string>();
    for (const anchor of root.querySelectorAll('a[href]')) {
        const href = (anchor.getAttribute('href') ?? '').trim();
        if (
            !href ||
            href.startsWith('#') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('javascript:')
        ) {
            continue;
        }
        try {
            const parsed = new URL(href, origin);
            if (parsed.origin.toLowerCase() !== origin) continue;
            seen.add(normalizeAuditUrl(parsed.href));
            if (seen.size >= maxLinks) break;
        } catch {
            // Skip malformed hrefs
        }
    }
    return Array.from(seen);
}

/** Builds a lightweight per-page graph snapshot from an already-parsed HTML root. */
export function buildPageGraphNodeFromRoot(params: {
    url: string;
    root: HTMLElement;
    outboundInternalLinks?: string[];
    brokenInternalLinks?: PageGraphBrokenLink[];
}): PageGraphNode {
    const { url, root, outboundInternalLinks, brokenInternalLinks } = params;
    const normUrl = normalizeAuditUrl(url);
    const title = root.querySelector('title')?.textContent.trim().replace(/\s+/g, ' ') || null;
    const metaDescription =
        root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim().replace(/\s+/g, ' ') || null;
    const h1 = root.querySelector('h1')?.textContent.trim().replace(/\s+/g, ' ') || null;
    const canonicalRaw = root.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || null;
    let canonicalUrl: string | null = null;
    if (canonicalRaw) {
        try {
            canonicalUrl = normalizeAuditUrl(new URL(canonicalRaw, normUrl).href);
        } catch {
            canonicalUrl = null;
        }
    }
    const robotsMeta = root.querySelector('meta[name="robots"]')?.getAttribute('content')?.toLowerCase() ?? '';
    const isNoindex = robotsMeta.includes('noindex');
    const links = outboundInternalLinks
        ? Array.from(new Set(outboundInternalLinks.map(normalizeAuditUrl))).slice(0, MAX_OUTBOUND_LINKS_PER_PAGE)
        : extractSameOriginLinksFromRoot(root, normUrl);

    return {
        url: normUrl,
        title: title ? title.slice(0, 200) : null,
        metaDescription: metaDescription ? metaDescription.slice(0, 300) : null,
        h1: h1 ? h1.slice(0, 200) : null,
        canonicalUrl,
        isNoindex,
        outboundInternalLinks: links,
        brokenInternalLinks: brokenInternalLinks?.slice(0, 50),
    };
}

/** Parses HTML and extracts a `PageGraphNode` (used when OnPageModule did not run). */
export function extractPageGraphNode(url: string, html: string): PageGraphNode {
    const root = parse(html);
    return buildPageGraphNodeFromRoot({ url, root });
}

function readStringDetail(details: Record<string, unknown> | undefined, key: string): string | null {
    const val = details?.[key];
    return typeof val === 'string' && val.trim() ? val.trim() : null;
}

/**
 * Extracts a `PageGraphNode` from a stored `FullAuditReport` / `issueList` payload,
 * preferring the explicit `pageGraph` snapshot and falling back to `on-page` checklist items.
 */
export function extractGraphNodeFromReport(fallbackUrl: string, reportLike: unknown): PageGraphNode | null {
    if (!reportLike || typeof reportLike !== 'object') return null;
    const raw = reportLike as Record<string, unknown>;

    if (raw.pageGraph && typeof raw.pageGraph === 'object') {
        const pg = raw.pageGraph as Partial<PageGraphNode>;
        const nodeUrl = normalizeAuditUrl(typeof pg.url === 'string' && pg.url ? pg.url : fallbackUrl);
        if (!nodeUrl) return null;
        return {
            url: nodeUrl,
            title: typeof pg.title === 'string' ? pg.title : null,
            metaDescription: typeof pg.metaDescription === 'string' ? pg.metaDescription : null,
            h1: typeof pg.h1 === 'string' ? pg.h1 : null,
            canonicalUrl: typeof pg.canonicalUrl === 'string' ? normalizeAuditUrl(pg.canonicalUrl) : null,
            isNoindex: Boolean(pg.isNoindex),
            outboundInternalLinks: Array.isArray(pg.outboundInternalLinks)
                ? Array.from(new Set(pg.outboundInternalLinks.filter((u): u is string => typeof u === 'string').map(normalizeAuditUrl))).slice(0, MAX_OUTBOUND_LINKS_PER_PAGE)
                : [],
            brokenInternalLinks: Array.isArray(pg.brokenInternalLinks)
                ? pg.brokenInternalLinks.filter((b): b is PageGraphBrokenLink => Boolean(b && typeof b.to === 'string'))
                : undefined,
        };
    }

    const categories = Array.isArray(raw.categories) ? (raw.categories as Array<Record<string, unknown>>) : null;
    const onPageCat = categories?.find((c) => c.id === 'on-page');
    if (!onPageCat || !Array.isArray(onPageCat.items)) return null;

    const items = onPageCat.items as Array<Record<string, unknown>>;
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of items) {
        if (typeof item.id === 'string') byId.set(item.id, item);
    }

    const titleDetails = byId.get('title-tag')?.details as Record<string, unknown> | undefined;
    const descDetails = byId.get('meta-description')?.details as Record<string, unknown> | undefined;
    const h1Details = byId.get('h1-tag')?.details as Record<string, unknown> | undefined;
    const canonicalDetails = byId.get('canonical-tag')?.details as Record<string, unknown> | undefined;
    const robotsDetails = byId.get('robots-meta')?.details as Record<string, unknown> | undefined;

    const nodeUrl = normalizeAuditUrl(typeof raw.url === 'string' && raw.url ? raw.url : fallbackUrl);
    if (!nodeUrl) return null;

    const canonicalRaw = readStringDetail(canonicalDetails, 'canonicalUrl');
    let canonicalUrl: string | null = null;
    if (canonicalRaw) {
        try {
            canonicalUrl = normalizeAuditUrl(new URL(canonicalRaw, nodeUrl).href);
        } catch {
            canonicalUrl = null;
        }
    }

    const robotsContent = (readStringDetail(robotsDetails, 'robotsContent') ?? '').toLowerCase();
    const isNoindex = robotsContent.includes('noindex') || byId.get('robots-meta')?.status === 'Fail';

    return {
        url: nodeUrl,
        title: readStringDetail(titleDetails, 'value'),
        metaDescription: readStringDetail(descDetails, 'value'),
        h1: readStringDetail(h1Details, 'h1Text'),
        canonicalUrl,
        isNoindex,
        outboundInternalLinks: [],
    };
}

function isIndexableCanonicalNode(node: PageGraphNode): boolean {
    if (node.isNoindex) return false;
    if (node.canonicalUrl && normalizeAuditUrl(node.canonicalUrl) !== normalizeAuditUrl(node.url)) {
        return false;
    }
    return true;
}

function findDuplicateClusters(
    nodes: PageGraphNode[],
    selector: (n: PageGraphNode) => string | null | undefined,
): DuplicateMetadataCluster[] {
    const groups = new Map<string, { display: string; urls: Set<string> }>();
    for (const node of nodes) {
        if (!isIndexableCanonicalNode(node)) continue;
        const raw = selector(node)?.trim().replace(/\s+/g, ' ');
        if (!raw) continue;
        const key = raw.toLowerCase();
        const existing = groups.get(key);
        if (existing) {
            existing.urls.add(node.url);
        } else {
            groups.set(key, { display: raw, urls: new Set([node.url]) });
        }
    }

    return Array.from(groups.values())
        .filter((g) => g.urls.size >= 2)
        .map((g) => ({ value: g.display, urls: Array.from(g.urls) }))
        .sort((a, b) => b.urls.length - a.urls.length);
}

function computePriority(params: {
    searchImpact: number;
    affectedCount: number;
    totalPages: number;
    remediationType: 'DETERMINISTIC' | 'AI_PATCH' | 'MANUAL' | 'EXPERIMENT';
}): ExplainablePriority {
    return computePriorityV4({
        businessImpact: 0.75,
        searchImpact: params.searchImpact,
        affectedScope: Math.max(0.2, Math.min(1, params.affectedCount / Math.max(1, params.totalPages))),
        confidence: 0.95,
        fixability: fixabilityForRemediation(params.remediationType),
        evidenceStrength: 0.85,
        recency: 1.0,
    });
}

/**
 * Analyzes cross-page duplicate titles/descriptions/H1s, BFS click depth, true orphan
 * pages (sitemap URLs with 0 internal inbound links across all crawled pages), and
 * site-wide broken internal links.
 */
export function buildSiteGraphAnalysis(
    homepageReport: unknown,
    pageAudits: PageAuditGraphInput[],
    sitemapUrls: string[] = [],
): SiteGraphAnalysisResult {
    const nodeMap = new Map<string, PageGraphNode>();
    let homepageFallbackUrl = '';
    if (homepageReport && typeof homepageReport === 'object') {
        const rawUrl = (homepageReport as Record<string, unknown>).url;
        if (typeof rawUrl === 'string') homepageFallbackUrl = rawUrl;
    }

    const homeNode = homepageFallbackUrl
        ? extractGraphNodeFromReport(homepageFallbackUrl, homepageReport)
        : null;
    if (homeNode) {
        nodeMap.set(homeNode.url, homeNode);
    }

    for (const pa of pageAudits) {
        const node = extractGraphNodeFromReport(pa.pageUrl, pa.issueList);
        if (!node) continue;
        const existing = nodeMap.get(node.url);
        if (existing) {
            // Merge preferring richer sub-page/home metadata
            nodeMap.set(node.url, {
                url: existing.url,
                title: node.title ?? existing.title,
                metaDescription: node.metaDescription ?? existing.metaDescription,
                h1: node.h1 ?? existing.h1,
                canonicalUrl: node.canonicalUrl ?? existing.canonicalUrl,
                isNoindex: node.isNoindex || existing.isNoindex,
                outboundInternalLinks:
                    node.outboundInternalLinks.length >= existing.outboundInternalLinks.length
                        ? node.outboundInternalLinks
                        : existing.outboundInternalLinks,
                brokenInternalLinks: node.brokenInternalLinks ?? existing.brokenInternalLinks,
            });
        } else {
            nodeMap.set(node.url, node);
        }
    }

    const nodes = Array.from(nodeMap.values());
    const firstUrl = homeNode?.url ?? nodes[0]?.url ?? pageAudits[0]?.pageUrl ?? '';
    const origin = safeUrlOrigin(firstUrl);
    const rootHomepageUrl = origin ? normalizeAuditUrl(`${origin}/`) : firstUrl;
    const hasLinkGraphEdges = nodes.some((n) => n.outboundInternalLinks.length > 0);
    const hasGraphData =
        hasLinkGraphEdges ||
        nodes.some((n) => Boolean(n.title || n.metaDescription || n.h1 || n.brokenInternalLinks?.length));

    const duplicateTitlesAll = findDuplicateClusters(nodes, (n) => n.title);
    const duplicateDescriptionsAll = findDuplicateClusters(nodes, (n) => n.metaDescription);
    const duplicateH1sAll = findDuplicateClusters(nodes, (n) => n.h1);

    // Directed internal link graph across crawled pages
    const outboundMap = new Map<string, string[]>();
    const inboundMap = new Map<string, Set<string>>();

    for (const node of nodes) {
        const sameOriginLinks = origin
            ? node.outboundInternalLinks.filter((link) => safeUrlOrigin(link) === origin)
            : node.outboundInternalLinks;
        outboundMap.set(node.url, sameOriginLinks);
        for (const target of sameOriginLinks) {
            if (target === node.url) continue;
            const callers = inboundMap.get(target) ?? new Set<string>();
            callers.add(node.url);
            inboundMap.set(target, callers);
        }
    }

    // BFS from homepage origin to compute clickDepthMap
    const clickDepthMap: Record<string, number> = {};
    if (origin && hasLinkGraphEdges) {
        const bfsSeed = nodeMap.has(rootHomepageUrl) ? rootHomepageUrl : (homeNode?.url ?? '');
        if (bfsSeed) {
            const queue: Array<{ url: string; depth: number }> = [{ url: bfsSeed, depth: 0 }];
            clickDepthMap[bfsSeed] = 0;

            for (let i = 0; i < queue.length; i++) {
                const current = queue[i];
                const outgoing = outboundMap.get(current.url) ?? [];
                for (const target of outgoing) {
                    if (typeof clickDepthMap[target] === 'number') continue;
                    const nextDepth = current.depth + 1;
                    clickDepthMap[target] = nextDepth;
                    if (outboundMap.has(target)) {
                        queue.push({ url: target, depth: nextDepth });
                    }
                }
            }
        }
    }

    const deepPages: DeepPageSummary[] = [];
    let maxClickDepth = 0;
    for (const node of nodes) {
        const depth = clickDepthMap[node.url];
        if (typeof depth === 'number') {
            if (depth > maxClickDepth) maxClickDepth = depth;
            if (depth > DEEP_CLICK_THRESHOLD && isIndexableCanonicalNode(node)) {
                deepPages.push({ url: node.url, depth });
            }
        }
    }
    deepPages.sort((a, b) => b.depth - a.depth);

    // True orphan detection across ALL crawled pages
    const trueOrphanPages: string[] = [];
    if (origin && hasLinkGraphEdges && sitemapUrls.length > 0) {
        const homeVariants = new Set(getUrlLookupVariants(rootHomepageUrl).map(normalizeAuditUrl));
        const seenSitemap = new Set<string>();

        for (const rawSitemapUrl of sitemapUrls) {
            if (safeUrlOrigin(rawSitemapUrl) !== origin) continue;
            const normTarget = normalizeAuditUrl(rawSitemapUrl);
            if (seenSitemap.has(normTarget) || homeVariants.has(normTarget)) continue;
            seenSitemap.add(normTarget);

            const crawledTarget = nodeMap.get(normTarget);
            if (crawledTarget && !isIndexableCanonicalNode(crawledTarget)) continue;

            const inbound = inboundMap.get(normTarget);
            if (!inbound || inbound.size === 0) {
                trueOrphanPages.push(normTarget);
            }
        }
    }

    // Aggregate deduped site-wide broken links discovered during page audits
    const brokenEdges: SiteBrokenLinkEdge[] = [];
    const seenBroken = new Set<string>();
    for (const node of nodes) {
        for (const bl of node.brokenInternalLinks ?? []) {
            const toNorm = normalizeAuditUrl(bl.to);
            const dedupKey = `${node.url}::${toNorm}`;
            if (seenBroken.has(dedupKey)) continue;
            seenBroken.add(dedupKey);
            brokenEdges.push({
                from: node.url,
                to: toNorm,
                status: typeof bl.status === 'number' && bl.status > 0 ? bl.status : 0,
            });
            if (brokenEdges.length >= MAX_BROKEN_EDGES) break;
        }
        if (brokenEdges.length >= MAX_BROKEN_EDGES) break;
    }

    const recommendations: NormalizedRecommendation[] = [];
    const totalPages = Math.max(1, nodes.length);

    if (duplicateTitlesAll.length > 0) {
        const top = duplicateTitlesAll[0];
        recommendations.push({
            categoryId: 'on-page',
            itemId: 'duplicate-titles',
            label: `Duplicate <title> across ${top.urls.length} pages`,
            finding: `${duplicateTitlesAll.length} duplicate <title> cluster(s) detected across ${totalPages} audited pages. Top cluster "${top.value.slice(0, 70)}" appears on: ${top.urls.slice(0, 3).join(', ')}.`,
            recommendation: 'Write a distinct <title> for each indexable URL reflecting its unique target keyword and search intent, or canonicalize duplicate views.',
            priority: 'High',
            roiImpact: 88,
            aiVisibilityImpact: 80,
            priorityScore: computePriority({
                searchImpact: 0.85,
                affectedCount: top.urls.length,
                totalPages,
                remediationType: 'AI_PATCH',
            }).score,
        });
    }

    if (duplicateDescriptionsAll.length > 0) {
        const top = duplicateDescriptionsAll[0];
        recommendations.push({
            categoryId: 'on-page',
            itemId: 'duplicate-meta-descriptions',
            label: `Duplicate meta description across ${top.urls.length} pages`,
            finding: `${duplicateDescriptionsAll.length} duplicate <meta name="description"> cluster(s) detected. Example shared by ${top.urls.length} URLs: ${top.urls.slice(0, 3).join(', ')}.`,
            recommendation: 'Author unique meta descriptions summarizing each page’s specific topic and CTA to avoid SERP snippet suppression.',
            priority: 'Medium',
            roiImpact: 72,
            aiVisibilityImpact: 65,
            priorityScore: computePriority({
                searchImpact: 0.72,
                affectedCount: top.urls.length,
                totalPages,
                remediationType: 'AI_PATCH',
            }).score,
        });
    }

    if (duplicateH1sAll.length > 0) {
        const top = duplicateH1sAll[0];
        recommendations.push({
            categoryId: 'on-page',
            itemId: 'duplicate-h1s',
            label: `Duplicate H1 heading across ${top.urls.length} pages`,
            finding: `${duplicateH1sAll.length} duplicate <h1> heading cluster(s) found ("${top.value.slice(0, 70)}" on ${top.urls.slice(0, 3).join(', ')}).`,
            recommendation: 'Ensure every page uses a unique primary <h1> tailored to that URL’s topic cluster rather than repeating boilerplate headings.',
            priority: 'Medium',
            roiImpact: 70,
            aiVisibilityImpact: 70,
            priorityScore: computePriority({
                searchImpact: 0.70,
                affectedCount: top.urls.length,
                totalPages,
                remediationType: 'AI_PATCH',
            }).score,
        });
    }

    if (trueOrphanPages.length > 0) {
        recommendations.push({
            categoryId: 'on-page',
            itemId: 'orphan-pages-site-graph',
            label: `${trueOrphanPages.length} true orphan page(s) with 0 internal inbound links`,
            finding: `${trueOrphanPages.length} sitemap URL(s) received zero internal links across all ${totalPages} crawled pages: ${trueOrphanPages.slice(0, 3).join(', ')}.`,
            recommendation: 'Add contextual internal links from your homepage, pillar hubs, or related articles pointing to these orphan URLs so crawlers and link equity reach them.',
            priority: trueOrphanPages.length >= 3 ? 'High' : 'Medium',
            roiImpact: 82,
            aiVisibilityImpact: 75,
            priorityScore: computePriority({
                searchImpact: 0.80,
                affectedCount: trueOrphanPages.length,
                totalPages: Math.max(totalPages, sitemapUrls.length),
                remediationType: 'MANUAL',
            }).score,
        });
    }

    if (deepPages.length > 0) {
        recommendations.push({
            categoryId: 'on-page',
            itemId: 'deep-click-depth',
            label: `${deepPages.length} page(s) buried >${DEEP_CLICK_THRESHOLD} clicks from homepage`,
            finding: `Max click depth is ${maxClickDepth}. ${deepPages.length} page(s) require more than ${DEEP_CLICK_THRESHOLD} clicks from the homepage: ${deepPages.slice(0, 3).map((d) => `${d.url} (depth ${d.depth})`).join(', ')}.`,
            recommendation: 'Flatten site architecture by linking priority pages directly from navigation menus, category hubs, or HTML sitemaps.',
            priority: 'Medium',
            roiImpact: 68,
            aiVisibilityImpact: 60,
            priorityScore: computePriority({
                searchImpact: 0.65,
                affectedCount: deepPages.length,
                totalPages,
                remediationType: 'MANUAL',
            }).score,
        });
    }

    const summary: SiteGraphSummary = {
        pagesAnalyzed: nodes.length,
        duplicateTitlesCount: duplicateTitlesAll.length,
        duplicateDescriptionsCount: duplicateDescriptionsAll.length,
        duplicateH1sCount: duplicateH1sAll.length,
        trueOrphanCount: trueOrphanPages.length,
        deepPageCount: deepPages.length,
        brokenLinkCount: brokenEdges.length,
        maxClickDepth,
        duplicateTitles: duplicateTitlesAll.slice(0, MAX_DUPLICATE_CLUSTERS),
        duplicateMetaDescriptions: duplicateDescriptionsAll.slice(0, MAX_DUPLICATE_CLUSTERS),
        duplicateH1s: duplicateH1sAll.slice(0, MAX_DUPLICATE_CLUSTERS),
        trueOrphanPages: trueOrphanPages.slice(0, MAX_DUPLICATE_CLUSTERS),
        deepPages: deepPages.slice(0, MAX_DUPLICATE_CLUSTERS),
    };

    const crawlCache: SiteCrawlCachePayload = {
        clickDepthMap,
        orphanPages: trueOrphanPages.slice(0, MAX_ORPHANS),
        brokenLinks: brokenEdges,
        updatedAt: new Date().toISOString(),
    };

    const buildDiagnosticFindings = (siteId: string, targetOrigin: string): SiteGraphFindingWithPriority[] => {
        const findings: SiteGraphFindingWithPriority[] = [];
        const scopeBase = targetOrigin || origin || rootHomepageUrl;
        const observedAt = crawlCache.updatedAt;

        const addFinding = (params: {
            issueType: string;
            rootCauseId: string;
            rootCause: string;
            domain: 'CONTENT' | 'LINKS';
            severity: 'high' | 'medium';
            searchImpact: number;
            affectedUrls: string[];
            expectedOutcome: string;
            remediationType: 'AI_PATCH' | 'MANUAL';
            source: SEOEvidence['source'];
            observedValue: Record<string, unknown>;
        }) => {
            if (params.affectedUrls.length === 0) return;
            const urlsCapped = params.affectedUrls.slice(0, 20);
            findings.push({
                finding: {
                    id: `site-graph:${params.issueType}`,
                    fingerprint: computeFindingFingerprint(siteId, params.issueType, scopeBase, params.rootCauseId),
                    domain: params.domain,
                    issueType: params.issueType,
                    status: params.severity === 'high' ? 'FAIL' : 'WARNING',
                    severity: params.severity,
                    scope: {
                        type: urlsCapped.length > 1 ? 'URL_PATTERN' : 'SITE',
                        urls: urlsCapped,
                        affectedCount: params.affectedUrls.length,
                    },
                    rootCause: params.rootCause,
                    rootCauseId: params.rootCauseId,
                    evidence: [
                        createEvidence({
                            source: params.source,
                            url: scopeBase,
                            observedAt,
                            observedValue: params.observedValue,
                            confidence: CONFIDENCE_BY_KIND.DIRECTLY_OBSERVED,
                            confidenceKind: 'DIRECTLY_OBSERVED',
                        }),
                    ],
                    confidence: CONFIDENCE_BY_KIND.DIRECTLY_OBSERVED,
                    expectedOutcome: params.expectedOutcome,
                    remediationType: params.remediationType,
                    verificationCriteria: [],
                    dependencyFingerprints: [],
                },
                priority: computePriority({
                    searchImpact: params.searchImpact,
                    affectedCount: params.affectedUrls.length,
                    totalPages,
                    remediationType: params.remediationType,
                }),
            });
        };

        if (duplicateTitlesAll.length > 0) {
            const urls = Array.from(new Set(duplicateTitlesAll.flatMap((c) => c.urls)));
            addFinding({
                issueType: 'duplicate_titles',
                rootCauseId: 'cross_page_duplicate_title',
                rootCause: `${duplicateTitlesAll.length} duplicate <title> cluster(s) shared across ${urls.length} pages`,
                domain: 'CONTENT',
                severity: 'high',
                searchImpact: 0.85,
                affectedUrls: urls,
                expectedOutcome: 'Each indexable URL has a unique, intent-specific <title> tag.',
                remediationType: 'AI_PATCH',
                source: 'HTML',
                observedValue: {
                    clusters: duplicateTitlesAll.length,
                    topClusterValue: duplicateTitlesAll[0].value,
                    affectedUrls: urls.slice(0, 20),
                },
            });
        }

        if (duplicateDescriptionsAll.length > 0) {
            const urls = Array.from(new Set(duplicateDescriptionsAll.flatMap((c) => c.urls)));
            addFinding({
                issueType: 'duplicate_meta_descriptions',
                rootCauseId: 'cross_page_duplicate_meta_description',
                rootCause: `${duplicateDescriptionsAll.length} duplicate <meta name="description"> cluster(s) across ${urls.length} pages`,
                domain: 'CONTENT',
                severity: 'medium',
                searchImpact: 0.72,
                affectedUrls: urls,
                expectedOutcome: 'Unique meta descriptions improve SERP CTR differentiation across pages.',
                remediationType: 'AI_PATCH',
                source: 'HTML',
                observedValue: {
                    clusters: duplicateDescriptionsAll.length,
                    affectedUrls: urls.slice(0, 20),
                },
            });
        }

        if (duplicateH1sAll.length > 0) {
            const urls = Array.from(new Set(duplicateH1sAll.flatMap((c) => c.urls)));
            addFinding({
                issueType: 'duplicate_h1s',
                rootCauseId: 'cross_page_duplicate_h1',
                rootCause: `${duplicateH1sAll.length} duplicate <h1> cluster(s) across ${urls.length} pages`,
                domain: 'CONTENT',
                severity: 'medium',
                searchImpact: 0.70,
                affectedUrls: urls,
                expectedOutcome: 'Each page declares a unique primary <h1> matching its topic.',
                remediationType: 'AI_PATCH',
                source: 'HTML',
                observedValue: {
                    clusters: duplicateH1sAll.length,
                    topClusterValue: duplicateH1sAll[0].value,
                    affectedUrls: urls.slice(0, 20),
                },
            });
        }

        if (trueOrphanPages.length > 0) {
            addFinding({
                issueType: 'orphan_pages',
                rootCauseId: 'site_graph_zero_inbound_links',
                rootCause: `${trueOrphanPages.length} sitemap page(s) have zero inbound internal links across ${nodes.length} crawled pages`,
                domain: 'LINKS',
                severity: trueOrphanPages.length >= 3 ? 'high' : 'medium',
                searchImpact: 0.80,
                affectedUrls: trueOrphanPages,
                expectedOutcome: 'Every indexable sitemap URL receives internal links from at least one hub or contextual page.',
                remediationType: 'MANUAL',
                source: 'LINK_GRAPH',
                observedValue: {
                    orphanCount: trueOrphanPages.length,
                    pagesAnalyzed: nodes.length,
                    orphanPages: trueOrphanPages.slice(0, 20),
                },
            });
        }

        return findings;
    };

    return {
        hasGraphData,
        summary,
        crawlCache,
        recommendations,
        buildDiagnosticFindings,
    };
}
