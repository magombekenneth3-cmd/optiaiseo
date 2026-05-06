/**
 * Central fetch wrapper for all client-side API calls.
 *
 * Reads rate limit headers on 429 responses and backs off automatically
 * using the Retry-After header value + exponential jitter, up to maxRetries
 * attempts before giving up and returning the raw 429 response.
 */

interface FetchOptions extends RequestInit {
    /** Maximum number of retry attempts on 429. Defaults to 2. */
    maxRetries?: number;
}

/**
 * Fetch a URL with automatic 429 back-off and retry.
 *
 * On non-429 responses (including errors), returns immediately.
 * On 429: waits `Retry-After` seconds + random jitter, then retries.
 * On final retry still 429: returns the 429 response so the caller can inspect it.
 */
export async function fetchWithRetry(
    url: string,
    options: FetchOptions = {}
): Promise<Response> {
    const { maxRetries = 2, ...fetchOptions } = options;
    let attempt = 0;

    while (attempt <= maxRetries) {
        const res = await fetch(url, fetchOptions);

        if (res.status !== 429) return res;

        // If we've exhausted retries, return the 429 for the caller to handle
        if (attempt === maxRetries) return res;

        // Parse Retry-After header (seconds)
        const retryAfter = parseInt(
            res.headers.get("Retry-After") ?? "5",
            10
        );

        // Exponential backoff with jitter to prevent thundering herd
        const delay = retryAfter * 1000 * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        attempt++;
    }

    // Unreachable but TypeScript requires it
    throw new Error("Max retries exceeded");
}
