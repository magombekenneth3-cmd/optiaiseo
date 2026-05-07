"use server";

import { logger } from "@/lib/logger";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pingGoogleIndexingApi } from "@/lib/gsc/indexing";
import { prisma } from "@/lib/prisma";
import { submitUrlForIndexing } from "@/lib/indexer";
import { limiters } from "@/lib/rate-limit";
import { requireTiers, guardErrorToResult } from "@/lib/stripe/guards";

const INDEXING_TIMEOUT_MS = 10000;

type ActionResult =
    | { success: true; message: string }
    | { success: false; code: string; error: string; retryAfter?: number; consoleUrl?: string };

function parseAndNormalizeUrl(raw: string): URL | null {
    try {
        const parsed = new URL(raw);
        parsed.hash = "";
        return parsed;
    } catch {
        return null;
    }
}

function isDomainMatch(hostname: string, domain: string): boolean {
    const clean = hostname.replace(/^www\./, "");
    return clean === domain || clean.endsWith(`.${domain}`);
}



export async function requestIndexing(url: string, siteId?: string): Promise<ActionResult> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return { success: false, code: "UNAUTHORIZED", error: "Sign in again to use this feature." };
        }

        const parsed = parseAndNormalizeUrl(url);
        if (!parsed) {
            return { success: false, code: "INVALID_URL", error: "Invalid URL." };
        }
        const normalizedUrl = parsed.toString();

        if (siteId) {
            const site = await prisma.site.findUnique({
                where: { id: siteId },
                select: { userId: true },
            });
            if (!site || site.userId !== session.user.id) {
                return { success: false, code: "UNAUTHORIZED", error: "You don't have access to this site." };
            }
        }

        try {
        await requireTiers(session.user.id, ["PRO", "AGENCY"]);
    } catch (err) {
        return { ...guardErrorToResult(err), code: "UPGRADE_REQUIRED" };
    }

        const { success: rlSuccess, reset } = await limiters.indexingSubmit.limit(
            `indexing-global:${session.user.id}`
        );
        if (!rlSuccess) {
            const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
            return {
                success: false,
                code: "RATE_LIMITED",
                error: `Daily submission cap reached. Resets in ${Math.ceil(retryAfter / 3600)}h.`,
                retryAfter,
            };
        }

        const result = await Promise.race([
            pingGoogleIndexingApi(normalizedUrl, "URL_UPDATED", session.user.id),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), INDEXING_TIMEOUT_MS)
            ),
        ]);

        if (result.success) {
            return { success: true, message: "Google is on it! Your URL has been queued for fast indexing." };
        }

        if (result.code === "API_DISABLED") {
            return {
                success: false,
                code: "API_DISABLED",
                consoleUrl: result.message,
                error: "The Google Indexing API is not enabled in your Google Cloud project.",
            };
        }

        if (result.code === "PERMISSION_DENIED") {
            return { success: false, code: "PERMISSION_DENIED", error: result.message };
        }

        return { success: false, code: "UNKNOWN", error: result.message };
    } catch (error: unknown) {
        logger.error("[Action] requestIndexing error:", { error });
        return { success: false, code: "UNKNOWN", error: "An unexpected error occurred." };
    }
}

export async function submitManualIndexing(siteId: string, url: string): Promise<ActionResult> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return { success: false, code: "UNAUTHORIZED", error: "Not authenticated." };
        }

        const parsed = parseAndNormalizeUrl(url);
        if (!parsed) {
            return { success: false, code: "INVALID_URL", error: "Invalid URL." };
        }

        const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { id: true, userId: true, domain: true },
        });
        if (!site || site.userId !== session.user.id) {
            return { success: false, code: "UNAUTHORIZED", error: "Site not found or access denied." };
        }

        const domain = site.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/^www\./, "");
        if (!isDomainMatch(parsed.hostname, domain)) {
            return { success: false, code: "INVALID_URL", error: `URL must belong to ${domain}.` };
        }

        try {
        await requireTiers(session.user.id, ["PRO", "AGENCY"]);
    } catch (err) {
        return { ...guardErrorToResult(err), code: "UPGRADE_REQUIRED" };
    }

        const { success: rlSuccess, reset } = await limiters.indexingSubmit.limit(`indexing:${siteId}`);
        if (!rlSuccess) {
            const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
            return {
                success: false,
                code: "RATE_LIMITED",
                error: `Daily submission cap (20 URLs/day per site) reached. Resets in ${Math.ceil(retryAfter / 3600)}h.`,
                retryAfter,
            };
        }

        const normalizedUrl = parsed.toString();

        const result = await Promise.race([
            submitUrlForIndexing(siteId, normalizedUrl, "MANUAL", session.user.id),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), INDEXING_TIMEOUT_MS)
            ),
        ]);

        if (result.skipped && result.reason === "Daily quota reached") {
            return { success: false, code: "QUOTA_EXCEEDED", error: "Daily quota of 200 URLs reached. Resets at midnight UTC." };
        }
        if (result.skipped) {
            return { success: true, message: "Already submitted in the last 24 hours — no action needed." };
        }
        if (!result.success) {
            return { success: false, code: "UNKNOWN", error: result.reason ?? "Indexing request failed." };
        }

        return { success: true, message: "Submitted to Google — typically crawled within 24 hours." };
    } catch (error: unknown) {
        logger.error("[Action] submitManualIndexing error:", { error });
        return { success: false, code: "UNKNOWN", error: "An unexpected error occurred." };
    }
}