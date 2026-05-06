/**
 * Shared DataForSEO client — single place for credentials, auth header,
 * and the raw POST helper.  Import from here; never duplicate in individual
 * backlink files.
 */

import { logger } from "@/lib/logger";

const LOGIN    = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;

/** True when DataForSEO credentials are present in the environment */
export function isConfigured(): boolean {
    return Boolean(LOGIN && PASSWORD);
}

/** Returns the Base64-encoded Basic auth header value */
export function getAuthHeader(): string {
    if (!isConfigured()) {
        throw new Error("[Backlinks/client] DataForSEO credentials not set");
    }
    return `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64")}`;
}

/**
 * POST to the DataForSEO v3 API.
 * Throws on non-2xx responses so callers only need to handle success.
 */
export async function dataForSeoPost<T>(
    path: string,
    body: unknown,
): Promise<T> {
    const res = await fetch(`https://api.dataforseo.com/v3${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: getAuthHeader(),
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        logger.error(`[Backlinks/client] DataForSEO ${path} returned ${res.status}`);
        throw new Error(`DataForSEO ${path} returned ${res.status}`);
    }

    return res.json() as Promise<T>;
}
