/**
 * Shared crawler constants used across AEO, SEO audit, backlinks,
 * and indexability modules. A single User-Agent prevents bot-detection
 * discrepancies where one fetch path succeeds and another gets 403.
 */

/** Chrome-like UA avoids WAF blocks from Cloudflare / Akamai while remaining honest about purpose. */
export const CRAWLER_USER_AGENT =
    "Mozilla/5.0 (compatible; OptiAISEO/1.0; +https://optiaiseo.com/bot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Maximum redirect hops before giving up — matches Googlebot's behaviour. */
export const MAX_REDIRECT_HOPS = 5;

/** Maximum fetch retries with exponential backoff. */
export const MAX_FETCH_RETRIES = 3;

/** Base delay between retries (ms). Actual delay = BASE * 2^attempt. */
export const RETRY_BASE_DELAY_MS = 800;
