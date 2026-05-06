"use client";

/**
 * React hook for rate-limit-aware API mutations.
 *
 * Wraps fetchWithRetry and exposes the loading/error/retryAfter state
 * needed to show meaningful UI feedback when a 429 is returned.
 *
 * Usage:
 *   const { loading, error, retryAfter, data, mutate } =
 *     useRateLimitedMutation<{ blogId: string }>(`/api/sites/${siteId}/blogs/generate`)
 *
 *   return (
 *     <button onClick={() => mutate({ keyword })} disabled={loading || !!retryAfter}>
 *       {loading ? 'Generating...' : 'Generate'}
 *     </button>
 *     {retryAfter && <p>Rate limit reached. Try again in {retryAfter}s.</p>}
 *     {error && !retryAfter && <p>{error}</p>}
 *   )
 */
import { useState, useCallback } from "react";
import { fetchWithRetry } from "@/lib/api/fetch-with-retry";

interface MutationState<T> {
    loading: boolean;
    error: string | null;
    /** Seconds until the rate limit resets (non-null when a 429 was received) */
    retryAfter: number | null;
    data: T | null;
}

interface UseRateLimitedMutationOptions extends Omit<RequestInit, "body" | "method"> {
    method?: "POST" | "PUT" | "PATCH" | "DELETE";
}

export function useRateLimitedMutation<T = unknown>(
    url: string,
    options?: UseRateLimitedMutationOptions
) {
    const [state, setState] = useState<MutationState<T>>({
        loading:    false,
        error:      null,
        retryAfter: null,
        data:       null,
    });

    const mutate = useCallback(
        async (body?: unknown) => {
            setState((s) => ({ ...s, loading: true, error: null, retryAfter: null }));

            try {
                const res = await fetchWithRetry(url, {
                    method:  options?.method ?? "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...options?.headers,
                    },
                    body:    body !== undefined ? JSON.stringify(body) : undefined,
                    ...options,
                });

                if (res.status === 429) {
                    const retryAfter = parseInt(
                        res.headers.get("Retry-After") ?? "60",
                        10
                    );
                    let errorMessage = "Too many requests";
                    try {
                        const json = await res.json();
                        errorMessage = json.error ?? errorMessage;
                    } catch {
                        // non-JSON body — use default message
                    }
                    setState({
                        loading:    false,
                        error:      errorMessage,
                        retryAfter,
                        data:       null,
                    });
                    return null;
                }

                if (!res.ok) {
                    let errorMessage = `Request failed with status ${res.status}`;
                    try {
                        const json = await res.json();
                        errorMessage = json.error ?? errorMessage;
                    } catch {
                        // non-JSON — keep status code message
                    }
                    setState({
                        loading:    false,
                        error:      errorMessage,
                        retryAfter: null,
                        data:       null,
                    });
                    return null;
                }

                const data = await res.json() as T;
                setState({ loading: false, error: null, retryAfter: null, data });
                return data;
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : "An unexpected error occurred";
                setState({
                    loading:    false,
                    error:      message,
                    retryAfter: null,
                    data:       null,
                });
                return null;
            }
        },
        [url, options]
    );

    return { ...state, mutate };
}
