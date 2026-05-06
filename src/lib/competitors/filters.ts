// =============================================================================
// Competitor detection engine — 5-layer domain filter
// =============================================================================

// ---------------------------------------------------------------------------
// Layer 3: Blocked domain roots (TLD-agnostic — "capterra" blocks capterra.ca, .co.uk etc.)
// ---------------------------------------------------------------------------

const BUILT_IN_BLOCKED_ROOTS = new Set<string>([
    // Social & video
    "facebook", "twitter", "x", "instagram", "linkedin",
    "youtube", "tiktok", "pinterest", "reddit", "quora", "snapchat",
    "whatsapp", "telegram", "discord", "twitch",
    // App stores & retail
    "amazon", "ebay", "etsy", "alibaba", "aliexpress",
    "play.google", "apps.apple", "itunes.apple",
    // Review & comparison aggregators
    "trustpilot", "g2", "capterra", "getapp", "softwareadvice",
    "slashdot", "sourceforge", "alternativeto", "producthunt",
    "clutch", "designrush", "goodfirms", "appsumo",
    // Reference & dictionary (NOT competitors to any commercial business)
    "wikipedia", "wikimedia", "wikidata", "imdb", "britannica",
    "merriam-webster", "dictionary", "thesaurus", "vocabulary",
    "oxforddictionaries", "collinsdictionary", "macmillandictionary",
    "cambridge", "longman",
    // Analytics / data aggregators (not direct competitors to most businesses)
    "crunchbase", "cbinsights", "statista", "similarweb", "alexa",
    // Business listings & reviews
    "yelp", "glassdoor", "tripadvisor", "yellowpages", "bbb",
    "foursquare", "angi", "houzz", "thumbtack",
    // Publishing & blog platforms
    "medium", "substack", "wordpress", "blogger", "blogspot",
    "wix", "squarespace", "weebly", "jimdo", "strikingly",
    // Marketing/e-commerce SaaS (not competitors to arbitrary businesses)
    "hubspot", "mailchimp", "shopify", "bigcommerce", "woocommerce",
    "salesforce", "zendesk", "freshdesk", "intercom",
    // News aggregators
    "techmeme", "flipboard", "feedly", "pocket",
    // Gaming / modding (never a commercial service competitor)
    "optifine", "curseforge", "modrinth", "minecraftforum",
]);

// ---------------------------------------------------------------------------
// Layer 2: Hosting platform suffixes
// ---------------------------------------------------------------------------

const HOSTING_PLATFORM_SUFFIXES = new Set<string>([
    "railway.app", "vercel.app", "netlify.app", "pages.dev",
    "herokuapp.com", "azurewebsites.net", "azurestaticapps.net",
    "web.app", "firebaseapp.com", "github.io", "gitlab.io",
    "onrender.com", "fly.dev", "digitaloceanspaces.com",
    "s3.amazonaws.com", "cloudfront.net", "workers.dev",
    "surge.sh", "glitch.me", "replit.dev", "stackblitz.io", "codesandbox.io",
]);

// ---------------------------------------------------------------------------
// Layer 4: Content site patterns — tested only on root segment
// Prevents "guidedsolutions.co.ug" matching /^guide/
// ---------------------------------------------------------------------------

const CONTENT_ROOT_PATTERNS: RegExp[] = [
    /^(news|blog|magazine|media|press|journal|post|times|daily|weekly|tribune|herald|gazette|report|digest)/i,
    /^(techradar|pcmag|wired|theverge|engadget|cnet|tomsguide|techcrunch|mashable|gizmodo|venturebeat|zdnet|infoworld)/i,
    /^(statista|similarweb|semrush|ahrefs|moz|alexa|spyfu)$/i,
    /^(howto|tutorial|learn|guide|tips|advice|reviews|compare|versus|ranked|bestof|top\d+)/i,
];

// ---------------------------------------------------------------------------
// Helper: extract the registrable root word from a hostname
// ---------------------------------------------------------------------------

/**
 * Extracts the root segment used for block-list matching.
 * Handles two-segment specials: "play.google", "apps.apple"
 *
 * "www.capterra.ca" → "capterra"
 * "play.google.com" → "play.google"
 */
export function extractRoot(hostname: string): string {
    const clean = hostname.replace(/^www\./, "").toLowerCase();
    const parts = clean.split(".");

    if (parts.length >= 3) {
        const twoSeg = `${parts[0]}.${parts[1]}`;
        if (BUILT_IN_BLOCKED_ROOTS.has(twoSeg)) return twoSeg;
    }

    return parts[0];
}

// ---------------------------------------------------------------------------
// Individual filter functions (exported for unit testing)
// ---------------------------------------------------------------------------

/** Layer 1 — same brand / staging URL check */
export function isSameBrand(hostname: string, ownRoot: string): boolean {
    const ownClean = ownRoot.replace(/^www\./, "").toLowerCase();
    const brand    = ownClean.split(".")[0];

    return (
        hostname === ownClean ||
        hostname.endsWith(`.${ownClean}`) ||
        (brand.length > 3 && hostname.includes(brand))
    );
}

/** Layer 2 — subdomain of a known hosting platform */
export function isHostingPlatform(hostname: string): boolean {
    return Array.from(HOSTING_PLATFORM_SUFFIXES).some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
}

/** Layer 3 — blocked domain root (TLD-agnostic) */
export function isBlockedDomain(
    hostname: string,
    extraBlockedRoots: Set<string> = new Set()
): boolean {
    const root = extractRoot(hostname);
    return BUILT_IN_BLOCKED_ROOTS.has(root) || extraBlockedRoots.has(root);
}

/** Layer 4 — content/blog site pattern on root segment only */
export function isContentSite(hostname: string): boolean {
    const root = extractRoot(hostname);
    return CONTENT_ROOT_PATTERNS.some((p) => p.test(root));
}

// ---------------------------------------------------------------------------
// Central gate
// ---------------------------------------------------------------------------

/** Layer 5b — domain segments contain 'alternatives', 'compare', 'versus' etc. */
export function isAlternativesOrCompareSite(hostname: string): boolean {
    const segments = hostname.replace(/^www\./, "").toLowerCase().split(".");
    const SEGMENT_KEYWORDS = ["alternatives", "alternative", "compare", "versus", "comparison", "ranked", "bestof"];
    // If any non-TLD segment is a comparison keyword, exclude
    return segments.slice(0, -1).some(seg => SEGMENT_KEYWORDS.includes(seg));
}

/**
 * Returns true when a domain should be excluded.
 * Layer 5 (frequency threshold) is applied separately during ranking.
 */
export function shouldExclude(
    hostname: string,
    ownRoot: string,
    extraBlockedRoots: Set<string> = new Set()
): boolean {
    return (
        isSameBrand(hostname, ownRoot) ||
        isHostingPlatform(hostname) ||
        isBlockedDomain(hostname, extraBlockedRoots) ||
        isContentSite(hostname) ||
        isAlternativesOrCompareSite(hostname)
    );
}

export { BUILT_IN_BLOCKED_ROOTS };
