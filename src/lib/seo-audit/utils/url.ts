/**
 * Shared URL canonicalization helpers for cross-page SEO audit graphs,
 * GSC query-to-URL matching, and Redis crawl cache lookups.
 */

export function normalizeAuditUrl(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return rawUrl.trim();
        }
        parsed.hash = '';
        const origin = parsed.origin.toLowerCase();
        const pathname =
            parsed.pathname !== '/' && parsed.pathname.endsWith('/')
                ? parsed.pathname.slice(0, -1)
                : parsed.pathname || '/';
        return `${origin}${pathname}${parsed.search}`;
    } catch {
        return rawUrl.trim().replace(/\/+$/, '').toLowerCase();
    }
}

export function getUrlLookupVariants(rawUrl: string): string[] {
    const normalized = normalizeAuditUrl(rawUrl);
    const trimmed = rawUrl.trim();
    const withoutTrailingSlash = normalized.endsWith('/') && normalized.length > 1
        ? normalized.slice(0, -1)
        : normalized;
    const withTrailingSlash = normalized.endsWith('/') ? normalized : `${normalized}/`;

    return Array.from(new Set([trimmed, normalized, withoutTrailingSlash, withTrailingSlash]));
}

export function safeUrlOrigin(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed.origin.toLowerCase()
            : '';
    } catch {
        return '';
    }
}

