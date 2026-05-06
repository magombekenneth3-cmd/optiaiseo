// =============================================================================
// FIX #20: Deep Sitemap Validation
// FIX #22: Full robots.txt State-Machine Parser
// =============================================================================

import { isSafeUrl } from '@/lib/security/safe-url';

export interface RobotsParsed {
    sitemapUrls: string[];
    crawlDelay?: number;
    disallowsRoot: boolean;           // Disallow: / for * or Googlebot
    blocksGooglebot: boolean;
    blocksAIBots: boolean;            // GPTBot, ClaudeBot, PerplexityBot blocked
    allowsAll: boolean;
    rawRules: Array<{ agent: string; disallow: string[]; allow: string[] }>;
}

export interface SitemapValidationResult {
    robotsTxtExists: boolean;
    sitemapReferenced: boolean;
    sitemapExists: boolean;
    sitemapUrl?: string;
    details: string[];
    // FIX #20 additions
    sitemapUrlCount?: number;
    staleSitemapUrls?: number;      // lastmod > 6 months ago
    robotsParsed?: RobotsParsed;    // FIX #22
}

// FIX #22: State-machine robots.txt parser
function parseRobotsTxt(text: string): RobotsParsed {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const result: RobotsParsed = {
        sitemapUrls: [],
        disallowsRoot: false,
        blocksGooglebot: false,
        blocksAIBots: false,
        allowsAll: false,
        rawRules: [],
    };

    const AI_BOTS = ['gptbot', 'claudebot', 'perplexitybot', 'anthropicbot', 'googleextended'];

    let currentAgents: string[] = [];
    let currentDisallow: string[] = [];
    let currentAllow: string[] = [];

    const flushBlock = () => {
        if (currentAgents.length === 0) return;
        result.rawRules.push({
            agent: currentAgents.join(', '),
            disallow: [...currentDisallow],
            allow: [...currentAllow],
        });

        const isWildcard = currentAgents.some(a => a === '*');
        const isGooglebot = currentAgents.some(a => a.toLowerCase() === 'googlebot');
        const isAI = currentAgents.some(a => AI_BOTS.includes(a.toLowerCase()));

        if (isWildcard && currentDisallow.includes('/')) result.disallowsRoot = true;
        if (isGooglebot && (currentDisallow.includes('/') || currentDisallow.length > 0)) result.blocksGooglebot = true;
        if (isAI && (currentDisallow.includes('/') || currentDisallow.length > 0)) result.blocksAIBots = true;
        if (isWildcard && currentDisallow.length === 0) result.allowsAll = true;

        // Crawl-delay (store maximum seen)
        currentAgents = [];
        currentDisallow = [];
        currentAllow = [];
    };

    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;

        const [directive, ...rest] = line.split(':');
        const key = directive.trim().toLowerCase();
        const value = rest.join(':').trim();

        if (key === 'user-agent') {
            if (currentAgents.length > 0 && (currentDisallow.length > 0 || currentAllow.length > 0)) {
                flushBlock();
            } else if (currentDisallow.length === 0 && currentAllow.length === 0 && currentAgents.length > 0) {
                // Multiple consecutive User-agent lines = same block
            }
            currentAgents.push(value);
        } else if (key === 'disallow') {
            currentDisallow.push(value);
        } else if (key === 'allow') {
            currentAllow.push(value);
        } else if (key === 'crawl-delay') {
            const delay = parseFloat(value);
            if (!isNaN(delay)) {
                result.crawlDelay = Math.max(result.crawlDelay ?? 0, delay);
            }
        } else if (key === 'sitemap') {
            if (value.startsWith('http')) result.sitemapUrls.push(value);
        }
    }
    flushBlock(); // flush last block

    return result;
}

// FIX #20: Count URLs and check lastmod dates in sitemap XML
async function deepValidateSitemap(sitemapUrl: string): Promise<{ urlCount: number; staleSitemapUrls: number }> {
    try {
        const guard = isSafeUrl(sitemapUrl);
        if (!guard.ok) return { urlCount: 0, staleSitemapUrls: 0 };

        const res = await fetch(sitemapUrl, {
            headers: { 'User-Agent': 'SEO-Bot/1.0' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { urlCount: 0, staleSitemapUrls: 0 };

        const xml = await res.text();

        // Handle sitemap index files (contains <sitemap> entries rather than <url>)
        if (xml.includes('<sitemapindex')) {
            const childUrls = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(m => m[1].trim());
            return { urlCount: childUrls.length, staleSitemapUrls: 0 };
        }

        const urlMatches = xml.match(/<url>/g) || [];
        const urlCount = urlMatches.length;

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const lastmodMatches = [...xml.matchAll(/<lastmod>([\s\S]*?)<\/lastmod>/g)];
        const staleSitemapUrls = lastmodMatches.filter(m => {
            try {
                return new Date(m[1].trim()) < sixMonthsAgo;
            } catch {
                return false;
            }
        }).length;

        return { urlCount, staleSitemapUrls };
    } catch {
        return { urlCount: 0, staleSitemapUrls: 0 };
    }
}

export async function validateRobotsAndSitemap(domain: string): Promise<SitemapValidationResult> {
    const result: SitemapValidationResult = {
        robotsTxtExists: false,
        sitemapReferenced: false,
        sitemapExists: false,
        details: []
    };

    let urlObj: URL;
    try {
        let cleanDomain = domain.trim();
        if (!cleanDomain.startsWith('http://') && !cleanDomain.startsWith('https://')) {
            cleanDomain = `https://${cleanDomain}`;
        }
        urlObj = new URL(cleanDomain);
    } catch {
        result.details.push("Invalid domain format provided.");
        return result;
    }

    const robotsUrl = `${urlObj.origin}/robots.txt`;
    try {
        const robotsRes = await fetch(robotsUrl, {
            headers: { 'User-Agent': 'SEO-Bot/1.0' },
            signal: AbortSignal.timeout(8000),
        });

        if (robotsRes.ok) {
            result.robotsTxtExists = true;
            result.details.push("Found robots.txt file.");

            const robotsText = await robotsRes.text();

            // FIX #22: Full state-machine parse
            const parsed = parseRobotsTxt(robotsText);
            result.robotsParsed = parsed;

            if (parsed.sitemapUrls.length > 0) {
                result.sitemapReferenced = true;
                result.sitemapUrl = parsed.sitemapUrls[0];
                result.details.push(`Sitemap directive(s) found: ${parsed.sitemapUrls.join(', ')}`);
            } else {
                result.details.push("WARNING: robots.txt is missing a Sitemap directive.");
                result.sitemapUrl = `${urlObj.origin}/sitemap.xml`;
            }

            if (parsed.disallowsRoot) result.details.push("⚠ Disallow: / found — all pages blocked from crawling.");
            if (parsed.blocksGooglebot) result.details.push("⚠ Googlebot appears blocked or restricted.");
            if (parsed.blocksAIBots) result.details.push("⚠ AI bots (GPTBot/ClaudeBot/PerplexityBot) are blocked — reduces AI citation potential.");
            if (parsed.crawlDelay && parsed.crawlDelay > 5) result.details.push(`⚠ Crawl-delay: ${parsed.crawlDelay}s is high — may slow Googlebot indexing.`);
            if (parsed.sitemapUrls.length > 1) result.details.push(`Multiple sitemaps referenced: ${parsed.sitemapUrls.length} sitemap(s).`);
        } else {
            result.details.push(`WARNING: robots.txt returned ${robotsRes.status}`);
            result.sitemapUrl = `${urlObj.origin}/sitemap.xml`;
        }

        // Validate sitemap
        if (result.sitemapUrl) {
            const sitemapRes = await fetch(result.sitemapUrl, {
                method: 'HEAD',
                headers: { 'User-Agent': 'SEO-Bot/1.0' },
                signal: AbortSignal.timeout(8000),
            });
            if (sitemapRes.ok) {
                result.sitemapExists = true;
                result.details.push(`Sitemap accessible at ${result.sitemapUrl}`);

                // FIX #20: Deep sitemap validation
                const { urlCount, staleSitemapUrls } = await deepValidateSitemap(result.sitemapUrl);
                result.sitemapUrlCount = urlCount;
                result.staleSitemapUrls = staleSitemapUrls;

                if (urlCount > 0) result.details.push(`Sitemap contains ${urlCount} URL(s).`);
                if (staleSitemapUrls > 0) {
                    result.details.push(`⚠ ${staleSitemapUrls} URL(s) have lastmod older than 6 months — consider refreshing content.`);
                }
                if (urlCount > 50000) result.details.push("⚠ Sitemap exceeds 50,000 URLs — split into a sitemap index.");
            } else {
                result.details.push(`ERROR: Sitemap not accessible at ${result.sitemapUrl} (HTTP ${sitemapRes.status})`);
            }
        }
     
     
    } catch (e: unknown) {
        result.details.push(`Fetch error testing robots/sitemap: ${(e as Error).message}`);
    }

    return result;
}
