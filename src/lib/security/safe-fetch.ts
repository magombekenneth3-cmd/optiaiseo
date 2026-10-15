/**
 * safeFetchPublicUrl — SSRF-safe outbound fetch for user-controlled URLs.
 *
 * Every outbound request driven by user-controlled input (sitemap entries,
 * discovered page URLs, etc.) MUST go through this helper rather than raw
 * `fetch()`.
 *
 * Protections:
 *  1. Scheme validation (https/http only)
 *  2. Hostname validation (rejects private/reserved TLDs, IP literals)
 *  3. DNS resolution → reject private & special-purpose IP ranges (IPv4 + IPv6)
 *  4. Manual redirect following with per-hop validation
 *  5. Redirect hop limit (default 3)
 *  6. Response body size limit (default 10 MB)
 *  7. Optional domain-scope restriction (e.g. URLs from a sitemap must
 *     belong to the same registered domain)
 */

import dns from "dns/promises";
import { isIP } from "net";
import { logger } from "@/lib/logger";

// ── Private / special-purpose IP ranges ────────────────────────────────────────

const PRIVATE_IPV4_RANGES: Array<{ prefix: string; mask: number }> = [
    { prefix: "10.0.0.0",       mask: 8  },   // RFC 1918
    { prefix: "172.16.0.0",     mask: 12 },   // RFC 1918
    { prefix: "192.168.0.0",    mask: 16 },   // RFC 1918
    { prefix: "127.0.0.0",     mask: 8  },   // Loopback
    { prefix: "169.254.0.0",   mask: 16 },   // Link-local
    { prefix: "0.0.0.0",       mask: 8  },   // "This host" network
    { prefix: "100.64.0.0",    mask: 10 },   // Carrier-grade NAT
    { prefix: "192.0.0.0",     mask: 24 },   // IETF protocol assignments
    { prefix: "192.0.2.0",     mask: 24 },   // TEST-NET-1
    { prefix: "198.51.100.0",  mask: 24 },   // TEST-NET-2
    { prefix: "203.0.113.0",   mask: 24 },   // TEST-NET-3
    { prefix: "198.18.0.0",    mask: 15 },   // Benchmarking
    { prefix: "224.0.0.0",     mask: 4  },   // Multicast
    { prefix: "240.0.0.0",     mask: 4  },   // Reserved
];

/** Convert dotted-decimal IPv4 to 32-bit integer. */
function ipv4ToInt(ip: string): number {
    const parts = ip.split(".").map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
    const addr = ipv4ToInt(ip);
    for (const range of PRIVATE_IPV4_RANGES) {
        const base = ipv4ToInt(range.prefix);
        const mask = ~((1 << (32 - range.mask)) - 1) >>> 0;
        if ((addr & mask) === (base & mask)) return true;
    }
    return false;
}

/** Rejects IPv6 loopback, link-local, unique local, and mapped IPv4 addresses. */
function isPrivateIPv6(ip: string): boolean {
    const clean = ip.replace(/^\[|\]$/g, "").toLowerCase();
    if (clean === "::1" || clean === "::") return true;
    if (clean.startsWith("fe80:")) return true;   // Link-local
    if (clean.startsWith("fc") || clean.startsWith("fd")) return true;  // Unique local
    // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract the embedded IPv4
    const v4Mapped = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);
    return false;
}

function isPrivateIP(ip: string): boolean {
    if (isIP(ip) === 4) return isPrivateIPv4(ip);
    if (isIP(ip) === 6) return isPrivateIPv6(ip);
    return false;
}

// ── Hostname validation ────────────────────────────────────────────────────────

const BLOCKED_TLDS = [".local", ".internal", ".localhost", ".test", ".invalid", ".example"];

function isPublicHostname(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (lower === "localhost") return false;
    // Strip IPv6 brackets for isIP check — URL.hostname uses [::1] format
    const unbracketed = lower.replace(/^\[|\]$/g, "");
    if (isIP(unbracketed)) {
        return !isPrivateIP(unbracketed) && !isPrivateIPv6(unbracketed);
    }
    for (const tld of BLOCKED_TLDS) {
        if (lower.endsWith(tld)) return false;
    }
    return true;
}

// ── Domain scope checking ──────────────────────────────────────────────────────

/**
 * Extracts the registered domain (eTLD+1) from a hostname.
 * Simple heuristic: last two labels, or last three for known
 * two-part TLDs (.co.uk, .com.au, etc.).
 */
const TWO_PART_TLDS = new Set([
    "co.uk", "co.za", "co.ke", "co.ug", "co.tz", "co.rw",
    "com.au", "com.br", "com.ng", "com.gh",
    "org.uk", "net.au", "ac.uk", "gov.uk",
]);

export function getRegisteredDomain(hostname: string): string {
    const parts = hostname.toLowerCase().replace(/^www\./, "").split(".");
    if (parts.length <= 2) return parts.join(".");
    const lastTwo = parts.slice(-2).join(".");
    if (TWO_PART_TLDS.has(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join(".");
    }
    return lastTwo;
}

function isWithinDomainScope(url: URL, allowedDomain: string): boolean {
    return getRegisteredDomain(url.hostname) === getRegisteredDomain(allowedDomain);
}

// ── DNS resolution with SSRF check ────────────────────────────────────────────

async function resolveAndValidate(hostname: string): Promise<{ ok: true } | { ok: false; error: string }> {
    // If hostname is already an IP, check it directly
    if (isIP(hostname)) {
        return isPrivateIP(hostname)
            ? { ok: false, error: `Blocked: IP ${hostname} is a private/reserved address` }
            : { ok: true };
    }

    try {
        // Resolve all addresses (A + AAAA) to catch dual-stack attacks
        const addresses = await dns.resolve(hostname);
        for (const addr of addresses) {
            if (isPrivateIP(addr)) {
                return { ok: false, error: `Blocked: ${hostname} resolves to private IP ${addr}` };
            }
        }

        // Also check IPv6 addresses
        try {
            const v6Addresses = await dns.resolve6(hostname);
            for (const addr of v6Addresses) {
                if (isPrivateIPv6(addr)) {
                    return { ok: false, error: `Blocked: ${hostname} resolves to private IPv6 ${addr}` };
                }
            }
        } catch {
            // No AAAA records — that's fine, IPv4 was checked above
        }

        return { ok: true };
    } catch {
        return { ok: false, error: `DNS resolution failed for ${hostname}` };
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface SafeFetchOptions {
    /** Maximum number of redirects to follow. Default: 3 */
    maxRedirects?: number;
    /** Maximum response body size in bytes. Default: 10 MB */
    maxResponseBytes?: number;
    /** Timeout for the overall request in milliseconds. Default: 10000 */
    timeoutMs?: number;
    /** If set, the URL's registered domain must match this domain. */
    allowedDomain?: string;
    /** Additional fetch init options (headers, etc.) */
    fetchInit?: Omit<RequestInit, "signal" | "redirect">;
}

export interface SafeFetchResult {
    ok: true;
    response: Response;
    /** The final URL after redirects */
    finalUrl: string;
    /** The response body text (already read, size-limited) */
    body: string;
}

export interface SafeFetchError {
    ok: false;
    error: string;
}

/**
 * Fetches a URL with full SSRF protections.
 * Use this for ALL outbound requests involving user-controlled URLs.
 */
export async function safeFetchPublicUrl(
    url: string,
    options: SafeFetchOptions = {},
): Promise<SafeFetchResult | SafeFetchError> {
    const {
        maxRedirects = 3,
        maxResponseBytes = 10 * 1024 * 1024,
        timeoutMs = 10_000,
        allowedDomain,
        fetchInit = {},
    } = options;

    // 1. Parse and validate URL
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, error: `Invalid URL: ${url}` };
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: `Blocked: only http/https URLs allowed, got ${parsed.protocol}` };
    }

    if (!isPublicHostname(parsed.hostname)) {
        return { ok: false, error: `Blocked: hostname ${parsed.hostname} is not a public hostname` };
    }

    // 2. Domain scope check
    if (allowedDomain && !isWithinDomainScope(parsed, allowedDomain)) {
        return { ok: false, error: `Blocked: URL ${url} is outside allowed domain scope (${allowedDomain})` };
    }

    // 3. DNS resolution check
    const dnsCheck = await resolveAndValidate(parsed.hostname);
    if (!dnsCheck.ok) {
        return { ok: false, error: dnsCheck.error };
    }

    // 4. Fetch with manual redirect handling
    let currentUrl = url;
    let redirectCount = 0;
    let response: Response;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        while (true) {
            response = await fetch(currentUrl, {
                ...fetchInit,
                redirect: "manual",
                signal: controller.signal,
            });

            // Handle redirects
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                if (redirectCount >= maxRedirects) {
                    return { ok: false, error: `Blocked: exceeded maximum ${maxRedirects} redirects` };
                }
                redirectCount++;

                const location = response.headers.get("location");
                if (!location) {
                    return { ok: false, error: "Redirect response missing Location header" };
                }

                // Resolve relative redirects
                let redirectUrl: URL;
                try {
                    redirectUrl = new URL(location, currentUrl);
                } catch {
                    return { ok: false, error: `Invalid redirect URL: ${location}` };
                }

                // Re-validate the redirect destination
                if (redirectUrl.protocol !== "https:" && redirectUrl.protocol !== "http:") {
                    return { ok: false, error: `Blocked redirect: scheme ${redirectUrl.protocol} not allowed` };
                }
                if (!isPublicHostname(redirectUrl.hostname)) {
                    return { ok: false, error: `Blocked redirect to private hostname: ${redirectUrl.hostname}` };
                }
                if (allowedDomain && !isWithinDomainScope(redirectUrl, allowedDomain)) {
                    return { ok: false, error: `Blocked redirect: ${redirectUrl.href} is outside allowed domain scope` };
                }

                // DNS-resolve the redirect target too (catches DNS rebinding)
                const redirectDnsCheck = await resolveAndValidate(redirectUrl.hostname);
                if (!redirectDnsCheck.ok) {
                    return { ok: false, error: `Blocked redirect: ${redirectDnsCheck.error}` };
                }

                currentUrl = redirectUrl.href;
                logger.debug("[safeFetch] Following redirect", { from: currentUrl, to: redirectUrl.href, hop: redirectCount });
                continue;
            }

            // Non-redirect response — we're done
            break;
        }

        // 5. Read body with size limit
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > maxResponseBytes) {
            return { ok: false, error: `Blocked: response Content-Length ${contentLength} exceeds ${maxResponseBytes} byte limit` };
        }

        // Stream-read with size enforcement
        const reader = response.body?.getReader();
        if (!reader) {
            return { ok: true, response, finalUrl: currentUrl, body: "" };
        }

        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxResponseBytes) {
                reader.cancel();
                return { ok: false, error: `Blocked: response body exceeded ${maxResponseBytes} byte limit` };
            }
            chunks.push(value);
        }

        const decoder = new TextDecoder();
        const body = decoder.decode(Buffer.concat(chunks));

        return { ok: true, response, finalUrl: currentUrl, body };
    } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") {
            return { ok: false, error: `Timeout: request to ${url} exceeded ${timeoutMs}ms` };
        }
        return { ok: false, error: `Fetch failed: ${(err as Error)?.message || String(err)}` };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Validates a list of sitemap URLs, filtering out those outside the allowed
 * domain scope or pointing to private addresses.
 */
export async function validateSitemapUrls(
    urls: string[],
    allowedDomain: string,
): Promise<{ valid: string[]; rejected: Array<{ url: string; reason: string }> }> {
    const valid: string[] = [];
    const rejected: Array<{ url: string; reason: string }> = [];

    for (const url of urls) {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            rejected.push({ url, reason: "Invalid URL" });
            continue;
        }

        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            rejected.push({ url, reason: `Non-http(s) scheme: ${parsed.protocol}` });
            continue;
        }

        if (!isPublicHostname(parsed.hostname)) {
            rejected.push({ url, reason: "Private/reserved hostname" });
            continue;
        }

        if (!isWithinDomainScope(parsed, allowedDomain)) {
            rejected.push({ url, reason: `Outside allowed domain: ${allowedDomain}` });
            continue;
        }

        valid.push(url);
    }

    return { valid, rejected };
}

// Re-export for backward compatibility
export { isPrivateIP, isPublicHostname, isPrivateIPv4, isPrivateIPv6 };
