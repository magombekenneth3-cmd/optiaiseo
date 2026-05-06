import { logger } from "@/lib/logger";
import { isValidPublicDomain } from "@/lib/security";
/**
 * fetchHtml — fetches the raw HTML of a URL with smart retry logic.
 *
 * Handles Render.com / Railway / Fly.io cold-start 503s by retrying
 * up to 4 times with exponential back-off (1s, 2s, 4s, 8s).
 * Also retries on 429 (rate-limit) and 502 (bad gateway).
 *
 * SSRF protection: validates the target hostname against isValidPublicDomain
 * before making any network request, blocking private IPs, localhost, and
 * internal TLDs regardless of how the URL was constructed.
 */

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 4;
// FIX: reduced from 1500ms — the previous value caused 22s total worst-case wait
// (1.5s + 3s + 6s + 12s) for genuinely unreachable sites, stalling audit jobs.
// 800ms still covers Render/Railway cold-starts and gives 12s total max wait.
const BASE_DELAY_MS = 800; // 0.8s, 1.6s, 3.2s, 6.4s → ~12s total max

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchHtml(url: string): Promise<string> {
    // SSRF guard — reject private/internal targets before any network call
    try {
        const { hostname } = new URL(url);
        if (!isValidPublicDomain(hostname)) {
            throw new Error(`[fetchHtml] Blocked SSRF attempt: ${hostname} is not a valid public domain.`);
        }

        // Gap 1.5: DNS-level SSRF guard — blocks domains that resolve to private IPs
        // (e.g. internal.company.com → 10.0.0.1). isValidPublicDomain only checks
        // the string; this check verifies the actual resolved addresses.
        try {
            const dns = await import("dns/promises");
            const { isIP } = await import("net");
            const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
            const isPrivate = (ip: string): boolean => {
                if (!isIP(ip)) return false;
                const p = ip.split(".").map(Number);
                return (
                    p[0] === 10 ||
                    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
                    (p[0] === 192 && p[1] === 168) ||
                    p[0] === 127 ||
                    (p[0] === 169 && p[1] === 254)
                );
            };
            for (const addr of addresses) {
                if (isPrivate(addr)) {
                    throw new Error(`[fetchHtml] Blocked SSRF: ${hostname} resolves to private IP ${addr}`);
                }
            }
        } catch (dnsErr: unknown) {
            if ((dnsErr as Error).message.includes("Blocked SSRF")) throw dnsErr;
            // DNS lookup failure (NXDOMAIN, timeout) — not a security issue; let the
            // fetch proceed and fail naturally with a network error.
            logger.debug(`[fetchHtml] DNS pre-check failed for ${hostname} — proceeding`, { err: (dnsErr as Error).message });
        }

    } catch (e: unknown) {
        if ((e as Error).message.includes("Blocked SSRF")) throw e;
        throw new Error(`[fetchHtml] Invalid URL: ${url}`);
    }


    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Cache-Control': 'no-cache, no-store',
                    'Pragma': 'no-cache',
                },
                // Always fetch live HTML — no Next.js data-cache for audit requests
                cache: 'no-store',
                signal: AbortSignal.timeout(10000), // 10-second timeout to fail fast
            });

            if (response.ok) {
                return await response.text();
            }

            // Retryable HTTP errors (cold-start, rate-limit, bad gateway)
            if (RETRYABLE_STATUSES.has(response.status)) {
                lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
                if (attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 0.8s, 1.6s, 3.2s, 6.4s
                    logger.warn(`[fetchHtml] ${url} returned ${response.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay}ms…`);
                    await sleep(delay);
                    continue;
                }
            }

            // Non-retryable error — propagate immediately
            throw new Error(`Failed to fetch HTML: ${response.status} ${response.statusText}`);
  

         
        } catch (error: unknown) {
            // Network errors (ECONNRESET, ETIMEDOUT, AbortError) — also retry
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < MAX_RETRIES) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt);
                logger.warn(`[fetchHtml] ${url} network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${(error as Error)?.message}. Retrying in ${delay}ms…`);
                await sleep(delay);
            }
        }
    }

    // All retries exhausted
    logger.error(`[fetchHtml] All ${MAX_RETRIES + 1} attempts failed for ${url}:`, { error: lastError?.message });
    throw new Error(`Failed to fetch HTML: ${lastError?.message || 'timeout/unavailable'}`);
}
