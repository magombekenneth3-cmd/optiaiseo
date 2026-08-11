import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface IndexNowSiteConfig {
    host: string;
    apiKey: string;
    source: "database" | "env";
}

const cache = new Map<string, { config: IndexNowSiteConfig | null; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getIndexNowConfig(siteId: string): Promise<IndexNowSiteConfig | null> {
    const now = Date.now();
    const cached = cache.get(siteId);
    if (cached && now < cached.expiresAt) {
        return cached.config;
    }

    let config: IndexNowSiteConfig | null = null;

    try {
        const row = await prisma.indexNowConfig.findUnique({ where: { siteId } });
        if (row?.apiKey && row?.host) {
            config = { host: row.host, apiKey: row.apiKey, source: "database" };
        }
    } catch (err: unknown) {
        logger.warn("[indexnow-config] DB lookup failed, falling back to env", {
            siteId,
            error: (err as Error)?.message,
        });
    }

    if (!config) {
        const envKey  = process.env.INDEXNOW_KEY ?? process.env.INDEXNOW_API_KEY;
        const envHost = process.env.INDEXNOW_HOST;

        if (envKey && envHost) {
            config = { host: envHost, apiKey: envKey, source: "env" };
        } else if (envKey && !envHost) {
            try {
                const site = await prisma.site.findUnique({
                    where: { id: siteId },
                    select: { domain: true },
                });
                if (site?.domain) {
                    const host = site.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
                    config = { host, apiKey: envKey, source: "env" };
                }
            } catch {
                // no site found — remain null
            }
        }
    }

    cache.set(siteId, { config, expiresAt: now + CACHE_TTL_MS });
    return config;
}

export function invalidateIndexNowCache(siteId: string): void {
    cache.delete(siteId);
}
