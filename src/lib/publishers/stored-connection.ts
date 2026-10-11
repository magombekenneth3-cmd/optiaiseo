import { z } from "zod";
import type { CmsPlatform, SitePlatformConfig } from "./index";

/**
 * Resolves a CMS destination from a site's persisted, owner-managed connection
 * (written via `/api/sites/[siteId]/cms-config`). Request bodies must never be
 * used as a source of destination credentials.
 */

export const CMS_PLATFORMS = [
    "WORDPRESS",
    "SHOPIFY",
    "WEBFLOW",
    "FRAMER",
    "NEXTJS",
    "WIX",
    "GHOST",
] as const satisfies readonly CmsPlatform[];

const StoredWordPressConfigSchema = z.object({
    wpUrl: z.string().url(),
    wpUser: z.string().min(1),
    wpAppPassword: z.string().min(1),
});

const StoredGhostConfigSchema = z.object({
    ghostUrl: z.string().url(),
    ghostAdminKey: z.string().includes(":"),
});

export type StoredConnectionResolution =
    | { ok: true; config: SitePlatformConfig }
    | { ok: false; reason: "NOT_CONNECTED" | "UNSUPPORTED_STORAGE"; error: string };

export function resolveStoredConnection(
    platform: CmsPlatform,
    site: { id: string; wordPressConfig: unknown; ghostConfig: unknown },
): StoredConnectionResolution {
    switch (platform) {
        case "WORDPRESS": {
            const parsed = StoredWordPressConfigSchema.safeParse(site.wordPressConfig);
            if (!parsed.success) {
                return { ok: false, reason: "NOT_CONNECTED", error: "WordPress is not connected for this site." };
            }
            return { ok: true, config: { platform, siteId: site.id, wordPressConfig: parsed.data } };
        }
        case "GHOST": {
            const parsed = StoredGhostConfigSchema.safeParse(site.ghostConfig);
            if (!parsed.success) {
                return { ok: false, reason: "NOT_CONNECTED", error: "Ghost is not connected for this site." };
            }
            return { ok: true, config: { platform, siteId: site.id, ghostConfig: parsed.data } };
        }
        default:
            // SHOPIFY / WEBFLOW / FRAMER / NEXTJS / WIX have no persisted
            // connection storage on Site. Refuse rather than trusting
            // client-supplied credentials.
            return {
                ok: false,
                reason: "UNSUPPORTED_STORAGE",
                error: `${platform} publishing requires a stored site connection, which is not yet supported.`,
            };
    }
}
