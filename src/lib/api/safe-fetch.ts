import { isSafeUrl } from "@/lib/security/safe-url";

interface SafeFetchOptions {
    headers?: Record<string, string>;
    timeoutMs?: number;
}

export interface SafeFetchResult {
    ok: boolean;
    text?: string;
    status?: number;
    error?: string;
}

/**
 * Fetches a URL with SSRF protection and single-hop redirect validation.
 * Blocks private IPs, localhost, and internal hostnames at both the
 * initial URL and any redirect destination.
 *
 * Uses redirect:"manual" so we can validate the Location header before
 * following it — a public URL that redirects to 169.254.169.254 would
 * otherwise bypass the isSafeUrl check on the original URL.
 */
export async function safeFetch(
    rawUrl: string,
    options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
    const { headers = {}, timeoutMs = 10_000 } = options;

    // Check the original URL
    const safeCheck = isSafeUrl(rawUrl);
    if (!safeCheck.ok || !safeCheck.url) {
        return { ok: false, error: safeCheck.error ?? "Invalid URL" };
    }

    const fetchOpts: RequestInit = {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
    };

    let res: Response;
    try {
        res = await fetch(safeCheck.url.href, fetchOpts);
    } catch (err) {
        return { ok: false, error: `Fetch error: ${String(err)}` };
    }

    // Follow one redirect hop — validate the destination first
    if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
            return { ok: false, error: "Redirect with no Location header" };
        }

        const redirectCheck = isSafeUrl(location);
        if (!redirectCheck.ok || !redirectCheck.url) {
            return { ok: false, error: "Redirect target is not allowed" };
        }

        try {
            res = await fetch(redirectCheck.url.href, {
                ...fetchOpts,
                redirect: "manual", // no further hops
            });
        } catch (err) {
            return { ok: false, error: `Redirect fetch error: ${String(err)}` };
        }
    }

    if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }

    const text = await res.text();
    return { ok: true, status: res.status, text };
}
