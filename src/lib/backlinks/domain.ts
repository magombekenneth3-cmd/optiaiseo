/**
 * Canonicalise user- and database-supplied backlink targets before they reach
 * DataForSEO or become cache keys. The Backlinks API expects a bare hostname
 * for domain requests, never a URL, path, or `www.` alias.
 */
export function normaliseBacklinkDomain(input: string): string | null {
    const value = input.trim().toLowerCase();
    if (!value || value.length > 253 || /[\s@]/.test(value)) return null;

    try {
        const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        const url = new URL(candidate);

        // A domain lookup must not silently accept a path/query target. It is
        // too easy to accidentally cache a page-level lookup as a domain one.
        if (
            url.username ||
            url.password ||
            url.port ||
            url.search ||
            url.hash ||
            (url.pathname !== "/" && url.pathname !== "")
        ) {
            return null;
        }

        const hostname = url.hostname.replace(/^www\./, "");
        if (!hostname || hostname.length > 253 || !hostname.includes(".")) return null;
        if (!/^[a-z0-9.-]+$/i.test(hostname) || hostname.includes("..")) return null;

        return hostname;
    } catch {
        return null;
    }
}

export function requireBacklinkDomain(input: string): string {
    const domain = normaliseBacklinkDomain(input);
    if (!domain) throw new Error("Enter a valid domain, such as example.com.");
    return domain;
}
