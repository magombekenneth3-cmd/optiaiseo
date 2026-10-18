"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { runSiteAudit } from "@/lib/audit";
import { clearSessionCaches } from "@/lib/seo/ai";
// Monthly audit count limit removed — credits are the single gate.
import { getEffectiveTier, guardErrorToResult } from "@/lib/stripe/guards";
import { CREDIT_COSTS } from "@/lib/credits";
import { chargeAuditCreditsOnce, refundAuditCreditsOnce } from "@/lib/credits/audit-billing";
import { redis } from "@/lib/redis";
import { inngest } from "@/lib/inngest/client";
import { requireUser } from "@/lib/auth/require-user";
import { z } from "zod";

// Prisma uses cuid() for all PKs — cuid starts with 'c', alphanumeric, 20–30 chars
const idSchema = z.string().regex(/^c[a-z0-9]{19,29}$/, "Invalid ID format");

type AuditSummary = {
  id: string;
  runTimestamp: Date;
  fixStatus: string;
  totalPages: number;
  completedPages: number;
  failedPages: number;
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
  | { success: false; error: string; code?: "insufficient_credits" | "credits_locked" | "queue_unavailable" };

function creditErrorMessage(reason: "insufficient_credits" | "credits_locked", remaining: number): string {
  return reason === "credits_locked"
    ? "Your credits are locked. Resubscribe or buy a credit pack to unlock them."
    : `Not enough credits (${remaining} remaining, need ${CREDIT_COSTS.full_site_audit}). Buy a credit pack or upgrade your plan.`;
}

type GetPageAuditsResult =
  | { success: true; pages: unknown[] }
  | { success: false; error: string; pages: []; upsell?: true };

type DeleteAuditResult =
  | { success: true }
  | { success: false; error: string };

export async function getUserAudits(
  cursor?: string,
  pageSize = 20,
  siteId?: string,
): Promise<GetUserAuditsResult> {
  if (cursor !== undefined && !idSchema.safeParse(cursor).success) {
    return { success: false, error: "Invalid cursor.", audits: [], nextCursor: null };
  }
  if (siteId !== undefined && !idSchema.safeParse(siteId).success) {
    return { success: false, error: "Invalid site ID.", audits: [], nextCursor: null };
  }

  try {
    const auth = await requireUser();
    // getUserAudits is read-only — unauthenticated users just get an empty list
    if (!auth.ok) return { success: true, audits: [], nextCursor: null };
    const { user } = auth;

    const audits = await prisma.audit.findMany({
      where: { site: { userId: user.id }, ...(siteId ? { siteId } : {}) },
      select: {
        id: true,
        runTimestamp: true,
        fixStatus: true,
        totalPages: true,
        completedPages: true,
        failedPages: true,
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

  // Declare these outside try so the finally/catch blocks can access them.
  let lockKey: string | undefined;
  let auditId: string | undefined;
  // Set when the queue is down AND the synchronous fallback also failed.
  let fallbackFailed = false;

  try {
    const auth = await requireUser();
    if (!auth.ok) return { success: false as const, error: auth.error.error };
    const { user } = auth;

    const site = await prisma.site.findUnique({ where: { id: siteId, userId: user.id } });
    if (!site) {
      return { success: false, error: "Site not found or you do not have access to it." };
    }

    // Redis is a fast mutual-exclusion mechanism, but its lease can expire
    // while a large page fan-out is waiting in the queue. The persisted audit
    // state is the durable second fence that prevents overlapping site runs.
    const activeAudit = await prisma.audit.findFirst({
      where: { siteId: site.id, fixStatus: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true },
    });
    if (activeAudit) {
      return {
        success: false,
        error: "An audit is already running for this site. Please wait for it to finish.",
      };
    }

    const effectiveTier = await getEffectiveTier(user.id);

    clearSessionCaches();

    // Create the PENDING audit record first so we have the auditId for the lock token.
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
    auditId = newAudit.id;

    // Acquire lease with auditId as token (renewable, conditional release).
    // The 120s initial TTL is extended by the Inngest job's heartbeat for long audits.
    lockKey = `audit-lock:${user.id}:${site.id}`;
    const { acquireAuditLease } = await import("@/lib/audit-lock");
    const acquired = await acquireAuditLease(lockKey, auditId);
    if (!acquired) {
      // Another audit is actively running — mark this one as duplicate and bail
      await prisma.audit.delete({ where: { id: auditId } }).catch(() => null);
      return {
        success: false,
        error: "An audit is already running for this site. Please wait for it to finish.",
      };
    }

    // Charge at job creation (not when results are viewed). Keyed by auditId, so
    // it can never be applied twice. Homepage-only scans are free (no CreditGate in UI).
    if (auditMode === "full") {
      const charge = await chargeAuditCreditsOnce(user.id, auditId);
      if (!charge.charged) {
        await prisma.audit.delete({ where: { id: auditId } }).catch(() => null);
        const { releaseAuditLease } = await import("@/lib/audit-lock");
        await releaseAuditLease(lockKey, auditId).catch(() => null);
        lockKey = undefined;
        auditId = undefined;
        return { success: false, error: creditErrorMessage(charge.reason, charge.remaining), code: charge.reason };
      }
    }

    try {
      await inngest.send({
        name: "audit.run.manual" as const,
        data: {
          siteId: site.id,
          auditId,
          domain: site.domain,
          userId: user.id,
          tier: effectiveTier,
          auditMode,
          // Forward the key so the Inngest job can release it when done.
          lockKey,
        },
      });
      logger.info("[runAudit] Queued manual audit job", { domain: site.domain, auditId, auditMode });
    } catch (queueErr: unknown) {
      // Lock cleanup is handled by the outer finally / the finally blocks below.
      if (auditMode === "full") {
        // Never substitute a homepage-only scan for the paid full-site audit the
        // user asked for. Fail the audit, refund the charge exactly once, and let
        // the user choose a free homepage-only scan explicitly.
        logger.error("[runAudit] Inngest unavailable — failing full-site audit and refunding", {
          auditId,
          error: (queueErr as Error)?.message,
        });
        await prisma.audit.update({
          where: { id: auditId },
          data: { fixStatus: "FAILED" },
        }).catch(() => null);
        await refundAuditCreditsOnce(user.id, auditId, "Queue unavailable: full-site audit not started")
          .catch((e: unknown) => logger.error("[runAudit] Refund after queue failure failed", { auditId, error: (e as Error)?.message }));
        const { releaseAuditLease } = await import("@/lib/audit-lock");
        await releaseAuditLease(lockKey, auditId).catch(() => null);
        lockKey = undefined; // Prevent double-release in outer catch
        revalidatePath("/dashboard/audits");
        revalidateTag(`dashboard-metrics-${user.id}`);
        return {
          success: false,
          code: "queue_unavailable",
          error:
            "The full-site audit could not be started right now, and you have not been charged. " +
            "Please try again shortly, or run a free homepage-only scan instead.",
        };
      }

      // Homepage-only scans are free and are exactly what was requested, so the
      // synchronous path is an equivalent substitute for the queue here.
      logger.warn("[runAudit] Inngest unavailable — running homepage-only audit synchronously", {
        error: (queueErr as Error)?.message,
      });
      try {
        const { runSiteAudit } = await import("@/lib/audit");
        const liveAuditResult = await runSiteAudit(site.domain, {
          targetKeyword: site.targetKeyword ?? undefined,
        });
        await prisma.audit.update({
          where: { id: auditId },
          data: {
            categoryScores: liveAuditResult.categoryScores as object,
            issueList: (liveAuditResult.rawReport ?? liveAuditResult.issues) as object,
            fixStatus: "COMPLETED",   // homepage-only is always terminal — no page fan-out
            lcp: liveAuditResult.lcp ?? null,
            cls: liveAuditResult.cls ?? null,
            inp: liveAuditResult.inp ?? null,
          },
        });
      } catch (syncErr: unknown) {
        fallbackFailed = true;
        // Synchronous run also failed — mark audit FAILED (nothing was charged).
        logger.error("[runAudit] Synchronous homepage audit failed", {
          error: (syncErr as Error)?.message,
          auditId,
        });
        await prisma.audit.update({
          where: { id: auditId },
          data: { fixStatus: "FAILED" },
        }).catch(() => null);
      } finally {
        // Release lock on synchronous path (success or failure)
        const { releaseAuditLease } = await import("@/lib/audit-lock");
        await releaseAuditLease(lockKey, auditId).catch(() => null);
        lockKey = undefined; // Prevent double-release in outer finally
      }
    }

    revalidatePath("/dashboard/audits");
    revalidateTag(`dashboard-metrics-${user.id}`);
    if (fallbackFailed) {
      // The audit row exists but never ran; don't report success.
      return {
        success: false,
        error: "The homepage scan could not be completed. Please try again.",
      };
    }
    return { success: true, audit: newAudit };
  } catch (error: unknown) {
    // If we created an audit but something unexpected threw, mark it FAILED
    if (auditId) {
      await prisma.audit.updateMany({
        where: { id: auditId, fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] } },
        data: { fixStatus: "FAILED" },
      }).catch(() => null);
      // Idempotent and a no-op if the charge never happened.
      const { refundAuditIfFailed } = await import("@/lib/credits/audit-billing");
      await refundAuditIfFailed(auditId, "Audit failed to start")
        .catch((e: unknown) => logger.error("[runAudit] Refund after failure failed", { auditId, error: (e as Error)?.message }));
    }
    // Release lock if still held
    if (lockKey && auditId) {
      const { releaseAuditLease } = await import("@/lib/audit-lock");
      await releaseAuditLease(lockKey, auditId).catch(() => null);
    }

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
    if (!auth.ok) return { success: false, error: auth.error.error, pages: [] };
    const { user } = auth;

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, site: { userId: user.id } },
      select: {
        id: true,
        pageAudits: {
          orderBy: { overallScore: "asc" },
        },
      },
    });
    if (!audit) return { success: false, error: "Audit not found", pages: [] };

    // Read-only: audits are charged exactly once, when runAudit accepts them
    // (keyed by auditId). Viewing results must never create a debit.

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
    if (!auth.ok) return { success: false as const, error: auth.error.error };
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
