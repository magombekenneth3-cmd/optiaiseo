import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
import { parse, HTMLElement } from 'node-html-parser';
import { fetchHtml } from '../utils/fetch-html';
import { isSafeUrl } from '@/lib/security/safe-url';
import { getAhrefsDomainOverview, getAhrefsBacklinks } from '@/lib/ahrefs';

const MAX_HTML_BYTES = 10 * 1024 * 1024;
const MAX_LINKS_TO_CHECK = 20;   // reduced from 50 — checking 50 links serially caused 70s+ hangs
const FETCH_CHUNK_SIZE = 20;     // check all links in one parallel batch (was 8, causing serial waits)
const FETCH_TIMEOUT_MS = 5_000;  // reduced from 10s — 5s is enough for a reachability check
const MAX_HREF_LENGTH = 2048;

const BROWSER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const ACCEPT_HEADER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const BOT_BLOCKED_DOMAINS = new Set([
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
    'linkedin.com', 'tiktok.com', 'pinterest.com', 'youtube.com', 'threads.net',
]);

const SKIP_SCHEMES = new Set(['mailto:', 'tel:', '#', 'javascript:']);

type PageType = 'Blog' | 'Article' | 'Product' | 'Homepage' | 'Landing' | 'General Page';

interface OutboundLink {
    href: string;
    nofollow: boolean;
    anchor: string;
}

interface BrokenLink {
    url: string;
    status: number;
    label: string;
}

interface UnreachableLink {
    url: string;
    label: string;
}

function assertMaxHtmlSize(html: string, url: string): void {
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        throw new Error(`HTML payload for ${url} exceeds the ${MAX_HTML_BYTES / (1024 * 1024)} MB limit.`);
    }
}

function isBotBlocked(url: string): boolean {
    try {
        return BOT_BLOCKED_DOMAINS.has(new URL(url).hostname.replace(/^www\./, ''));
    } catch {
        return false;
    }
}

function shouldSkipHref(href: string): boolean {
    return !href || SKIP_SCHEMES.has(href.slice(0, href.indexOf(':') + 1)) || href.startsWith('#');
}

function resolveHref(href: string, origin: string, base: string): string | null {
    if (href.length > MAX_HREF_LENGTH) return null;
    if (href.startsWith('http')) return href;
    if (href.startsWith('/')) return `${origin}${href}`;
    try {
        return new URL(href, base).toString();
    } catch {
        return null;
    }
}

function collectExternalLinks(
    links: HTMLElement[],
    origin: string,
    baseUrl: string,
): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const a of links) {
        const raw = a.getAttribute('href') ?? '';
        if (shouldSkipHref(raw)) continue;
        const resolved = resolveHref(raw, origin, baseUrl);
        if (!resolved || resolved.startsWith(origin) || seen.has(resolved)) continue;
        seen.add(resolved);
        result.push(resolved);
    }

    return result;
}

async function fetchWithFallback(url: string): Promise<Response> {
    const opts = (method: string) => ({
        method,
        headers: { 'User-Agent': BROWSER_UA, Accept: ACCEPT_HEADER },
        redirect: 'follow' as RequestRedirect,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const res = await fetch(url, opts('HEAD'));
    if ([400, 403, 405].includes(res.status)) {
        return fetch(url, opts('GET'));
    }
    return res;
}

async function checkLinks(urls: string[]): Promise<{ broken: BrokenLink[]; unreachable: UnreachableLink[] }> {
    const broken: BrokenLink[] = [];
    const unreachable: UnreachableLink[] = [];
    const limited = urls.slice(0, MAX_LINKS_TO_CHECK);

    for (let i = 0; i < limited.length; i += FETCH_CHUNK_SIZE) {
        const chunk = limited.slice(i, i + FETCH_CHUNK_SIZE);
        await Promise.allSettled(chunk.map(async (url) => {
            if (isBotBlocked(url)) return;
            try {
                const res = await fetchWithFallback(url);
                if (!isSafeUrl(res.url).ok) return;
                if (res.status >= 400) {
                    broken.push({ url, status: res.status, label: `HTTP ${res.status}` });
                }
            } catch {
                unreachable.push({ url, label: 'Timeout/Unreachable' });
            }
        }));
    }

    return { broken, unreachable };
}

function resolvePageType(raw: unknown): PageType {
    const s = typeof raw === 'string' ? raw : '';
    if (s.includes('Blog') || s.includes('Article')) return 'Blog';
    if (s.includes('Product')) return 'Product';
    if (s.includes('Homepage')) return 'Homepage';
    if (s.includes('Landing')) return 'Landing';
    return 'General Page';
}

const GENERIC_TACTICS: readonly string[] = [
    '• Broken Link Building: find broken external links on competitor pages and reach out to replace them with your content.',
    '• Skyscraper Technique: find top-ranking content for your keyword, create something meaningfully better, then contact sites that linked to the original.',
    '• HARO / Qwoted / Source Bottle: respond to journalist queries in your niche to earn high-DR press links.',
    '• Unlinked Brand Mentions: use Google Alerts or Ahrefs to find brand mentions without a link and request attribution.',
    '• Digital PR: publish original research or data studies. Journalists link extensively to primary data sources.',
];

const PAGE_TYPE_CONFIG: Record<PageType, { tactics: string[]; effortNote: string }> = {
    Blog: {
        tactics: [
            '• Guest Posting: write guest posts on topically-relevant blogs (DR 40+) with a contextual link back to this article.',
            '• Podcast Guest Appearances: appear on niche podcasts — show notes always include a link to your site.',
            '• Link to authoritative sources within this article; they may notice and reciprocate.',
            '• Internal Link Boost: link to this article from 3–5 of your highest-traffic existing pages.',
        ],
        effortNote: 'Blogs: aim for 2–3 quality links per month. Even 5–10 high-DR links can move a post from page 3 to page 1.',
    },
    Article: {
        tactics: [
            '• Guest Posting: write guest posts on topically-relevant blogs (DR 40+) with a contextual link back to this article.',
            '• Podcast Guest Appearances: appear on niche podcasts — show notes always include a link to your site.',
            '• Link to authoritative sources within this article; they may notice and reciprocate.',
            '• Internal Link Boost: link to this article from 3–5 of your highest-traffic existing pages.',
        ],
        effortNote: 'Blogs: aim for 2–3 quality links per month. Even 5–10 high-DR links can move a post from page 3 to page 1.',
    },
    Product: {
        tactics: [
            '• Supplier / Manufacturer Links: ask suppliers or technology partners to feature this page on their "Where to Buy" section.',
            '• Affiliate & Review Network: submit to affiliate networks — affiliates link to product pages to earn commissions.',
            '• Product Review Outreach: identify bloggers and YouTubers who review similar products and request an honest review.',
            '• Comparison & Best-Of Lists: email authors of roundup articles and request inclusion.',
        ],
        effortNote: 'Product pages: 10–20 authoritative links with buyer-intent anchor text are typically enough to rank top 5.',
    },
    Homepage: {
        tactics: [
            '• Directory & Citation Building: submit to Crunchbase, AngelList, G2, Capterra, Product Hunt, and niche directories.',
            '• Local Citations (if applicable): submit to Google Business Profile, Bing Places, Yelp, and niche local directories.',
            '• Partner / Integration Pages: ask integration partners (Zapier, Slack, Shopify) to list you on their integrations page.',
            '• Case Studies from Clients: publish client success stories. Clients often link back to case studies that feature them.',
        ],
        effortNote: 'Homepages: prioritise high-DR links (50+) from directories, press, and partner sites. Quality matters most.',
    },
    Landing: {
        tactics: [
            '• Co-marketing with Complementary Brands: publish a joint guide or webinar; both parties link to each other.',
            '• Niche Community Posting: share the landing page in relevant Slack communities, subreddits, and Facebook groups.',
            '• PPC Reference Links: share the landing page URL in email and social campaigns to build branded traffic signals.',
        ],
        effortNote: 'Landing pages: 5–15 quality links + strong internal link flow from homepage and blog posts typically achieves top-3 rankings.',
    },
    'General Page': {
        tactics: [
            '• Resource Page Link Building: search `[niche] + inurl:resources` or `[niche] + "useful links"` and request inclusion.',
            '• Testimonials in Exchange for Links: write genuine testimonials for tools you use — most companies link back to reviewers.',
        ],
        effortNote: 'Aim for 5–10 quality backlinks from DR 40+ sites per month to see meaningful ranking movement within 3–6 months.',
    },
};

function buildBacklinkRecommendationText(pageType: PageType, hasApiKey: boolean): string {
    const { tactics, effortNote } = PAGE_TYPE_CONFIG[pageType];
    return [
        `PAGE TYPE: ${pageType}`,
        `STRATEGY: ${effortNote}`,
        hasApiKey
            ? 'API KEY CONFIGURED: Live backlink data fetch coming soon.'
            : 'NO BACKLINK API CONFIGURED: Set AHREFS_API_KEY or MOZ_API_KEY for live data.',
        '',
        'PAGE-SPECIFIC TACTICS:',
        ...tactics,
        '',
        'UNIVERSAL TACTICS:',
        ...GENERIC_TACTICS,
    ].join('\n');
}

function calculateScore(items: ChecklistItem[]): { score: number; passed: number; failed: number; warnings: number } {
    const analyzable = items.filter(i => i.status !== 'Skipped');
    const passed = analyzable.filter(i => i.status === 'Pass').length;
    const failed = analyzable.filter(i => i.status === 'Fail').length;
    const warnings = analyzable.filter(i => i.status === 'Warning').length;
    const score = analyzable.length > 0
        ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100)
        : 0;
    return { score, passed, failed, warnings };
}

export const OffPageModule: AuditModule = {
    id: 'off-page',
    label: 'Off-Page Optimization',

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        const items: ChecklistItem[] = [];

        const html = context.html;

        if (!html) {
            return { id: OffPageModule.id, label: OffPageModule.label, items, score: 0, passed: 0, failed: 1, warnings: 0 };
        }

        assertMaxHtmlSize(html, context.url);

        const origin = new URL(context.url).origin;
        const root = parse(html);
        const anchors = root.querySelectorAll('a[href]');

        const externalUrls = collectExternalLinks(anchors, origin, context.url);

        items.push({
            id: 'external-links',
            label: 'External Links',
            status: externalUrls.length > 0 ? 'Pass' : 'Info',
            finding: `Found ${externalUrls.length} external link(s) on this page.`,
            recommendation: externalUrls.length === 0 ? {
                text: 'Consider linking to authoritative external sources (studies, documentation, partner sites) to improve credibility and topical depth.',
                priority: 'Low',
            } : undefined,
            roiImpact: 40,
            aiVisibilityImpact: 80,
        });

        const pageType = resolvePageType((context as any).pageType);
        const hasApiKey = !!(
            process.env.AHREFS_API_KEY ||
            process.env.MOZ_API_KEY ||
            process.env.OPEN_PAGERANK_API_KEY
        );

        const domain = (() => {
            try { return new URL(context.url).hostname.replace(/^www\./, ''); } catch { return ''; }
        })();

        const [domainOverview, backlinks] = await Promise.all([
            domain ? getAhrefsDomainOverview(domain).catch(() => null) : Promise.resolve(null),
            domain ? getAhrefsBacklinks(domain, 20).catch(() => []) : Promise.resolve([]),
        ]);

        const isMockData = !hasApiKey || (domainOverview?.domainRating === 0 && domainOverview?.backlinks === 0);

        if (domainOverview && !isMockData) {
            const drStatus: 'Pass' | 'Warning' | 'Fail' =
                domainOverview.domainRating >= 40 ? 'Pass'
                : domainOverview.domainRating >= 20 ? 'Warning'
                : 'Fail';

            items.push({
                id: 'backlink-profile',
                label: 'Backlink Profile',
                status: drStatus,
                finding: `Domain Rating: ${domainOverview.domainRating}/100. Referring domains: ${domainOverview.referringDomains.toLocaleString()}. Total backlinks: ${domainOverview.backlinks.toLocaleString()}. Organic traffic estimate: ${domainOverview.organicTraffic.toLocaleString()}/mo.`,
                recommendation: drStatus !== 'Pass' ? {
                    text: buildBacklinkRecommendationText(pageType, hasApiKey),
                    priority: 'High',
                } : undefined,
                roiImpact: 100,
                aiVisibilityImpact: 70,
                details: {
                    domainRating: domainOverview.domainRating,
                    referringDomains: domainOverview.referringDomains,
                    totalBacklinks: domainOverview.backlinks,
                    organicTraffic: domainOverview.organicTraffic,
                    pageType,
                },
            });

            if (backlinks.length > 0) {
                const topLinks = backlinks
                    .sort((a, b) => b.domainRating - a.domainRating)
                    .slice(0, 5)
                    .map(l => `• ${l.sourceDomain} (DR ${l.domainRating}) — "${l.anchorText || 'no anchor'}"`)
                    .join('\n');
                items.push({
                    id: 'top-backlinks',
                    label: 'Top Backlinks',
                    status: 'Pass',
                    finding: `Top ${Math.min(backlinks.length, 5)} backlinks by domain authority:\n${topLinks}`,
                    roiImpact: 60,
                    aiVisibilityImpact: 50,
                    details: { backlinksFetched: backlinks.length },
                });
            }
        } else {
            items.push({
                id: 'backlink-profile',
                label: 'Backlink Building Strategy',
                status: 'Info',
                finding: hasApiKey
                    ? `API key configured but returned no data for ${domain}. Tactical ${pageType} link-building roadmap below.`
                    : `No backlink API configured (set MOZ_API_TOKEN, MOZ_ACCESS_ID, or OPEN_PAGERANK_API_KEY). Tactical ${pageType} link-building strategy below.`,
                recommendation: {
                    text: buildBacklinkRecommendationText(pageType, hasApiKey),
                    priority: 'High',
                },
                roiImpact: 100,
                aiVisibilityImpact: 70,
                details: { pageType, apiConnected: hasApiKey },
            });
        }

        const outboundLinks: OutboundLink[] = externalUrls.map(href => {
            const el = anchors.find(a => {
                const h = a.getAttribute('href') ?? '';
                return resolveHref(h, origin, context.url) === href;
            });
            return {
                href: href.slice(0, 80),
                nofollow: (el?.getAttribute('rel') ?? '').includes('nofollow'),
                anchor: (el?.textContent ?? '').trim().slice(0, 40),
            };
        });

        const nofollowCount = outboundLinks.filter(l => l.nofollow).length;
        const dofollowCount = outboundLinks.filter(l => !l.nofollow).length;
        const allNofollow = outboundLinks.length > 0 && nofollowCount === outboundLinks.length;
        const tooManyDofollow = dofollowCount > 20;

        items.push({
            id: 'outbound-link-quality',
            label: 'Outbound Link Quality',
            status: outboundLinks.length === 0 ? 'Info'
                : allNofollow || tooManyDofollow ? 'Warning'
                    : 'Pass',
            finding: outboundLinks.length === 0
                ? 'No external links detected on this page.'
                : `${outboundLinks.length} external link(s): ${dofollowCount} dofollow, ${nofollowCount} nofollow.${allNofollow ? ' All external links are nofollowed — overly conservative and may reduce topical trust signals.'
                    : tooManyDofollow ? ' High volume of dofollow outbound links may dilute PageRank.'
                        : ''}`,
            recommendation: allNofollow ? {
                text: 'Allow dofollow links to authoritative sources (gov, edu, Wikipedia, official docs). Sites that link naturally to quality sources are viewed as more trustworthy.',
                priority: 'Low',
            } : tooManyDofollow ? {
                text: 'Consider adding rel="nofollow" or rel="sponsored" to commercial/paid links and rel="ugc" to user-generated content links.',
                priority: 'Low',
            } : undefined,
            roiImpact: 45,
            aiVisibilityImpact: 55,
            details: { totalExternal: outboundLinks.length, dofollow: dofollowCount, nofollow: nofollowCount },
        });

        const { broken, unreachable } = await checkLinks(externalUrls);
        const totalProblematic = broken.length + unreachable.length;
        const linksChecked = Math.min(externalUrls.length, MAX_LINKS_TO_CHECK);

        const problematicLines = [
            ...broken.map(b => `• ${b.url} (${b.label})`),
            ...unreachable.map(u => `• ${u.url} (${u.label} — verify manually)`),
        ];

        items.push({
            id: 'page-broken-links',
            label: 'On-Page Broken Links',
            status: broken.length > 0 ? 'Fail' : unreachable.length > 0 ? 'Warning' : 'Pass',
            finding: totalProblematic === 0
                ? `Checked ${linksChecked} link(s). All reachable.`
                : broken.length > 0
                    ? `Found ${broken.length} confirmed broken link(s) and ${unreachable.length} unreachable link(s) out of ${linksChecked} checked:\n\n${problematicLines.join('\n')}`
                    : `Found ${unreachable.length} potentially unreachable link(s) out of ${linksChecked} checked — may be bot-protected. Verify manually:\n\n${problematicLines.join('\n')}`,
            recommendation: totalProblematic > 0 ? {
                text: [
                    broken.length > 0
                        ? `Fix the ${broken.length} confirmed broken link(s) — they return HTTP 4xx/5xx errors detectable by any crawler.`
                        : '',
                    unreachable.length > 0
                        ? `Verify the ${unreachable.length} unreachable link(s) manually — timeouts may indicate bot-protection (common for social platforms).`
                        : '',
                    'Broken links leak PageRank, harm user experience, and send negative quality signals to Google.',
                    'Fix: update the URL, add a 301 redirect, or remove the link.',
                ].filter(Boolean).join('\n'),
                priority: broken.length > 0 ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 85,
            aiVisibilityImpact: 60,
            details: {
                linksChecked,
                confirmedBroken: broken.length,
                unreachable: unreachable.length,
                brokenUrls: broken.map(b => b.url).join(', '),
                unreachableUrls: unreachable.map(u => u.url).join(', '),
            },
        });

        const { score, passed, failed, warnings } = calculateScore(items);

        return {
            id: OffPageModule.id,
            label: OffPageModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        };
    },
};