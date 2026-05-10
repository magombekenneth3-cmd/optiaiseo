"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { inngest } from "@/lib/inngest/client";
import { checkRateLimit } from "@/lib/rate-limit";

// Constants

const RECENT_REPORT_WINDOW_MS = 30 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 3_600;
const MAX_ISSUES_STORED = 50;
const AUDIT_TIMEOUT_MS = 15_000;

// Helpers

function normalizeUrl(input: string): string {
    try {
        const u = new URL(input.startsWith("http") ? input : `https://${input}`);
        u.hash = "";
        u.search = "";
        return u.toString().replace(/\/$/, "");
    } catch {
        throw new Error("INVALID_URL");
    }
}

async function requireSite(siteId: string) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) throw new Error("UNAUTHORIZED");

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: session.user.id },
    });
    if (!site) throw new Error("SITE_NOT_FOUND");

    return { userId: session.user.id, site };
}

/**
 * Rejects after `ms` ms — used in Promise.race() to timeout runOnPageAudit(),
 * which only accepts a URL string (no AbortSignal option).
 * This avoids the "Argument of type { signal } not assignable to string" error.
 */
function rejectAfter(ms: number): Promise<never> {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Audit timed out after ${ms}ms`)), ms)
    );
}

// NOTE: The `status` and `scoreDelta` fields used below require a schema
// migration. Add the following to your OnPageReport model and run:
//   npx prisma migrate dev --name add-onpage-status-delta
//
//   status     String  @default("COMPLETED")
//   scoreDelta Int     @default(0)
//
// The `as any` casts below are temporary bridges that will resolve
// automatically once the migration runs and Prisma regenerates its types.

// Public: runOnPageReport

export async function runOnPageReport(
    siteId: string,
    url: string
): Promise<{ success: boolean; reportId?: string; cached?: boolean; error?: string }> {
    try {
        const { userId, site } = await requireSite(siteId);

        let targetUrl: string;
        try {
            targetUrl = normalizeUrl(url);
        } catch {
            return { success: false, error: "Invalid URL — please enter a full URL like https://example.com/page" };
        }

        // Fix #1 — reuse a recent completed report for the same URL.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recent = await prisma.onPageReport.findFirst({
            where: {
                siteId: site.id,
                url: targetUrl,
                // @ts-expect-error — status added by migration; remove cast after migrate
                status: "COMPLETED",
                createdAt: { gte: new Date(Date.now() - RECENT_REPORT_WINDOW_MS) },
            },
            orderBy: { createdAt: "desc" },
        });
        if (recent) {
            logger.debug("[OnPage] Returning cached report", { url: targetUrl, reportId: recent.id });
            return { success: true, reportId: recent.id, cached: true };
        }

        // Fix #2 — rate limit before any work starts
        const rate = await checkRateLimit(`onpage:${userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
        if (!rate.allowed) {
            return { success: false, error: "You've reached your hourly audit limit (10/hr). Try again shortly." };
        }

        // Fix #7 — capture previous score so the worker can compute delta
        const previous = await prisma.onPageReport.findFirst({
            where: {
                siteId: site.id,
                url: targetUrl,
                // @ts-expect-error — status added by migration; remove cast after migrate
                status: "COMPLETED",
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, score: true },
        });

        // Fix #4 — create PENDING report and hand off to background worker
        const report = await prisma.onPageReport.create({
            data: {
                siteId: site.id,
                url: targetUrl,
                issues: [],
                score: 0,
                // @ts-expect-error — status, scoreDelta added by migration; remove after migrate
                status: "PENDING",
                scoreDelta: 0,
            },
        });

        await inngest.send({
            name: "onpage.audit.run",
            data: {
                reportId: report.id,
                siteId: site.id,
                url: targetUrl,
                previousScore: previous?.score ?? null,
            },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        return { success: true, reportId: report.id, cached: false };

    } catch (error: unknown) {
        const msg = (error as Error)?.message;
        if (msg === "UNAUTHORIZED") return { success: false, error: "Unauthorized" };
        if (msg === "SITE_NOT_FOUND") return { success: false, error: "Site not found or access denied" };

        logger.error("[OnPage] runOnPageReport error", { error });
        return { success: false, error: "Failed to start on-page audit." };
    }
}

// Worker helper: completeOnPageReport
// Call this from your Inngest "onpage.audit.run" handler.
// All DB writes for a finished audit live here.

export async function completeOnPageReport(
    reportId: string,
    siteId: string,
    url: string,
    previousScore: number | null
): Promise<void> {
    const { runOnPageAudit } = await import("@/lib/onpage");

    // Fix #5 — timeout via Promise.race; runOnPageAudit only accepts a URL string
    // so AbortController is not an option without modifying the lib.
    let result: { issues: unknown[]; score: number };
    try {
        result = await Promise.race([
            runOnPageAudit(url),
            rejectAfter(AUDIT_TIMEOUT_MS),
        ]);
    } catch (err) {
        logger.error("[OnPage] completeOnPageReport: audit failed or timed out", { reportId, url, error: err });
        await prisma.onPageReport.update({
            where: { id: reportId },
            // @ts-expect-error — status added by migration; remove after migrate
            data: { status: "FAILED" },
        });
        return;
    }

    // Fix #6 — cap stored issues to prevent unbounded DB growth
    const cappedIssues = Array.isArray(result.issues)
        ? result.issues.slice(0, MAX_ISSUES_STORED)
        : [];

    // Fix #7 — compute and persist delta so UI can show "↑12 since last scan"
    const scoreDelta = previousScore !== null ? result.score - previousScore : 0;

    await prisma.onPageReport.update({
        where: { id: reportId },
        data: {
            // @ts-expect-error — status, scoreDelta added by migration; remove after migrate
            status: "COMPLETED",
            issues: cappedIssues as object,
            score: result.score,
            scoreDelta,
        },
    });

    revalidatePath(`/dashboard/sites/${siteId}`);
}

// Public: getOnPageHistory — cursor pagination + optional distinct-by-URL

export async function getOnPageHistory(
    siteId: string,
    options: { cursor?: string; take?: number; distinctByUrl?: boolean } = {}
): Promise<{
    success: boolean;
    reports: Awaited<ReturnType<typeof prisma.onPageReport.findMany>>;
    nextCursor?: string;
}> {
    const { cursor, take = 20, distinctByUrl = false } = options;

    try {
        const { site } = await requireSite(siteId);

        const reports = await prisma.onPageReport.findMany({
            where: { siteId: site.id },
            orderBy: { createdAt: "desc" },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            ...(distinctByUrl ? { distinct: ["url"] as const } : {}),
        });

        const hasMore = reports.length > take;
        const page = hasMore ? reports.slice(0, take) : reports;
        const nextCursor = hasMore ? page[page.length - 1].id : undefined;

        return { success: true, reports: page, nextCursor };

    } catch (error: unknown) {
        const msg = (error as Error)?.message;
        if (msg === "UNAUTHORIZED" || msg === "SITE_NOT_FOUND") {
            return { success: false, reports: [] };
        }
        logger.error("[OnPage] getOnPageHistory error", { error });
        return { success: false, reports: [] };
    }
}