"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { runSiteAudit } from "@/lib/audit";
import { clearSessionCaches } from "@/lib/seo/ai";
import { checkAuditLimit } from "@/lib/rate-limit";
import { getEffectiveTier, requireTiers, guardErrorToResult } from "@/lib/stripe/guards";
import { redis } from "@/lib/redis";
import { inngest } from "@/lib/inngest/client";
import { requireUser } from "@/lib/auth/require-user";
import { z } from "zod";

// Prisma uses cuid() (not uuid()) for all PKs — validate as a non-empty string ≤ 50 chars
const idSchema = z.string().min(1).max(50);

type AuditSummary = {
  id: string;
  runTimestamp: Date;
  fixStatus: string;
  categoryScores: unknown;
  issueList: unknown;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  site: { id: string; domain: string };
};

type GetUserAuditsResult =
  | { success: true; audits: AuditSummary[]; nextCursor: string | null }
  | { success: false; error: string; audits: []; nextCursor: null };

type RunAuditResult =
  | { success: true; audit: { id: string } }
  | { success: false; error: string };

type GetPageAuditsResult =
  | { success: true; pages: unknown[] }
  | { success: false; error: string; pages: []; upsell?: true };

type DeleteAuditResult =
  | { success: true }
  | { success: false; error: string };

function isPaidTier(tier: string): boolean {
  return ["PRO", "AGENCY", "ENTERPRISE"].includes(tier?.toUpperCase());
}

export async function getUserAudits(
  cursor?: string,
  pageSize = 20,
): Promise<GetUserAuditsResult> {
  if (cursor !== undefined && !idSchema.safeParse(cursor).success) {
    return { success: false, error: "Invalid cursor.", audits: [], nextCursor: null };
  }

  try {
    const auth = await requireUser();
    // getUserAudits is read-only — unauthenticated users just get an empty list
    if (!auth.ok) return { success: true, audits: [], nextCursor: null };
    const { user } = auth;

    const audits = await prisma.audit.findMany({
      where: { site: { userId: user.id } },
      select: {
        id: true,
        runTimestamp: true,
        fixStatus: true,
        categoryScores: true,
        issueList: true,
        lcp: true,
        cls: true,
        inp: true,
        site: { select: { id: true, domain: true } },
      },
      orderBy: { runTimestamp: "desc" },
      take: pageSize + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasNextPage = audits.length > pageSize;
    if (hasNextPage) audits.pop();
    const nextCursor = hasNextPage ? (audits[audits.length - 1]?.id ?? null) : null;

    return { success: true, audits: audits as AuditSummary[], nextCursor };
  } catch (error: unknown) {
    logger.error("[Audits] getUserAudits failed", {
      error: (error as Error)?.message || String(error),
    });
    return { success: false, error: "Failed to fetch audits.", audits: [], nextCursor: null };
  }
}

export async function runAudit(siteId?: string, auditMode: "homepage" | "full" = "full"): Promise<RunAuditResult> {
  if (!siteId) {
    return { success: false, error: "A specific site must be selected before running an audit." };
  }
  if (!idSchema.safeParse(siteId).success) {
    return { success: false, error: "Invalid site ID." };
  }

  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;
    const { user } = auth;

    const site = await prisma.site.findUnique({ where: { id: siteId, userId: user.id } });
    if (!site) {
      return { success: false, error: "Site not found or you do not have access to it." };
    }

    // The lock key is forwarded to the Inngest job which releases it on
    // completion (or FAILED). The 600s TTL is a backstop for crash scenarios —
    // if Inngest never calls back the user is unlocked automatically after 10m.
    const lockKey = `audit-lock:${user.id}:${site.id}`;
    const acquired = await redis.set(lockKey, "1", { ex: 600, nx: true });
    if (!acquired) {
      return {
        success: false,
        error: "An audit is already running for this site. Please wait for it to finish.",
      };
    }

    const effectiveTier = await getEffectiveTier(user.id);
    const rateCheck = await checkAuditLimit(user.id, effectiveTier);
    if (!rateCheck.allowed) {
      // Must release the lock or the user can never retry until TTL expires
      await redis.del(lockKey).catch(() => null);
      return {
        success: false,
        error: `You have reached your audit limit for this month. Upgrade to Pro for unlimited audits. Resets on ${rateCheck.resetAt.toLocaleDateString()}.`,
      };
    }

    clearSessionCaches();

    const newAudit = await prisma.audit.create({
      data: {
        siteId: site.id,
        categoryScores: {},
        issueList: [],
        fixStatus: "PENDING",
        lcp: null,
        cls: null,
        inp: null,
      },
    });

    try {
      await inngest.send({
        name: "audit.run.manual" as const,
        data: {
          siteId: site.id,
          auditId: newAudit.id,
          domain: site.domain,
          userId: user.id,
          tier: effectiveTier,
          auditMode,
          // Forward the key so the Inngest job can release it when done.
          // This prevents the user seeing "audit already running" after it finishes.
          lockKey,
        },
      });
      logger.info("[runAudit] Queued manual audit job", { domain: site.domain, auditId: newAudit.id, auditMode });
    } catch (queueErr: unknown) {
      // If Inngest is unavailable, fall back to synchronous execution
      logger.warn("[runAudit] Inngest unavailable — falling back to synchronous homepage-only audit", {
        error: (queueErr as Error)?.message,
      });
      // Fallback: homepage-only audit to avoid timing out the serverless function.
      // Full-site crawls can exceed Vercel's 60s limit — we never attempt them here.
      const { runSiteAudit } = await import("@/lib/audit");
      const liveAuditResult = await runSiteAudit(site.domain, {
        targetKeyword: site.targetKeyword ?? undefined,
      });
      await prisma.audit.update({
        where: { id: newAudit.id },
        data: {
          categoryScores: liveAuditResult.categoryScores as object,
          issueList: (liveAuditResult.rawReport ?? liveAuditResult.issues) as object,
          fixStatus: "COMPLETED",   // homepage-only is always terminal — no page fan-out
          lcp: liveAuditResult.lcp ?? null,
          cls: liveAuditResult.cls ?? null,
          inp: liveAuditResult.inp ?? null,
        },
      });
      // Release lock on synchronous path too
      await redis.del(lockKey).catch(() => null);
    }

    revalidatePath("/dashboard/audits");
    revalidateTag(`dashboard-metrics-${user.id}`);
    return { success: true, audit: newAudit };
  } catch (error: unknown) {
    logger.error("[Audits] runAudit failed", {
      error: (error as Error)?.message || String(error),
    });
    return { success: false, error: "Failed to execute audit." };
  }
}

export async function getPageAudits(auditId: string): Promise<GetPageAuditsResult> {
  if (!idSchema.safeParse(auditId).success) {
    return { success: false, error: "Invalid audit ID.", pages: [] };
  }

  try {
    const auth = await requireUser();
    if (!auth.ok) return { ...auth.error, pages: [] };
    const { user } = auth;

    try {
        await requireTiers(user.id, ["STARTER", "PRO", "AGENCY"]);
    } catch (err) {
        return { ...guardErrorToResult(err), pages: [], upsell: true };
    }

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, site: { userId: user.id } },
      select: {
        id: true,
        pageAudits: {
          orderBy: { overallScore: "asc" },
          take: 100,
        },
      },
    });
    if (!audit) return { success: false, error: "Audit not found", pages: [] };

    return { success: true, pages: audit.pageAudits };
  } catch (error: unknown) {
    logger.error("[Audits] getPageAudits failed", { error: (error as Error)?.message });
    return { success: false, error: "Failed to fetch page audits.", pages: [] };
  }
}

export async function deleteAudit(auditId: string): Promise<DeleteAuditResult> {
  if (!idSchema.safeParse(auditId).success) {
    return { success: false, error: "Invalid audit ID." };
  }

  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;
    const { user } = auth;

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, site: { userId: user.id } },
      select: { id: true },
    });
    if (!audit) return { success: false, error: "Audit not found or access denied" };

    await prisma.audit.delete({ where: { id: auditId } });

    revalidatePath("/dashboard/audits");
    return { success: true };
  } catch (error: unknown) {
    logger.error("[Audits] deleteAudit failed", {
      error: (error as Error)?.message || String(error),
    });
    return { success: false, error: "Failed to delete audit." };
  }
}