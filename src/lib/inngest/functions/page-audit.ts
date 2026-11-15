import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { CONCURRENCY } from "../concurrency";
import { getAuditEngine } from "@/lib/seo-audit";
import { discoverPages } from "@/lib/seo-audit/crawler";
import { logger } from "@/lib/logger";
import { releaseAuditLease, renewAuditLease, acquireAuditLease } from "@/lib/audit-lock";
import { fireWhiteLabelWebhook } from "@/lib/webhooks/white-label";
import { sendAuditCompleteEmail } from "@/lib/email";
import { notifyAuditComplete } from "@/lib/notifications";
import { trackFunnelEvent } from "@/lib/funnel";
import { refundCreditsIdempotent, CREDIT_COSTS } from "@/lib/credits";
import { writeMetricSnapshot } from "@/lib/metrics/metric-snapshot";
import { extractAuditVitalsAndSchema } from "@/lib/audit";
import { persistFindingWithEvidence, reconcileResolvedFindings } from "@/lib/seo-audit/diagnostic-persistence";
import type { DiagnosticFinding } from "@/lib/seo-audit/root-cause-engine";
import type { ExplainablePriority } from "@/lib/seo-audit/contracts";

const TERMINAL_STATES = ["COMPLETED", "FAILED", "PARTIAL"] as const;

/**
 * Aggregates completed sub-page audit scores and recommendations into the parent Audit
 * record and updates the site's MetricSnapshot so Full Site Audits reflect site-wide health.
 */
export async function aggregateMultiPageAuditResults(auditId: string, siteId: string): Promise<void> {
  const [audit, pageAudits] = await Promise.all([
    prisma.audit.findUnique({
      where: { id: auditId },
      select: {
        id: true,
        categoryScores: true,
        issueList: true,
        lcp: true,
        cls: true,
        inp: true,
      },
    }),
    prisma.pageAudit.findMany({
      where: { auditId },
      select: {
        pageUrl: true,
        overallScore: true,
        categoryScores: true,
        issueList: true,
      },
    }),
  ]);

  if (!audit || pageAudits.length === 0) return;

  const baseCategoryScores = { ...((audit.categoryScores as Record<string, number>) ?? {}) };
  const subCatBuckets = new Map<string, number[]>();

  for (const pa of pageAudits) {
    const scores = (pa.categoryScores as Record<string, number>) ?? {};
    for (const [catId, val] of Object.entries(scores)) {
      if (typeof val === "number" && Number.isFinite(val)) {
        const list = subCatBuckets.get(catId) ?? [];
        list.push(val);
        subCatBuckets.set(catId, list);
      }
    }
  }

  const blendedCategoryScores: Record<string, number> = { ...baseCategoryScores };
  for (const [catId, subVals] of subCatBuckets.entries()) {
    const subAvg = subVals.reduce((a, b) => a + b, 0) / subVals.length;
    const homeVal = baseCategoryScores[catId];
    blendedCategoryScores[catId] =
      typeof homeVal === "number"
        ? Math.round(homeVal * 0.5 + subAvg * 0.5)
        : Math.round(subAvg);
  }

  const issueList = ((audit.issueList as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const homeOverall =
    typeof issueList.overallScore === "number"
      ? issueList.overallScore
      : Object.values(baseCategoryScores).length > 0
        ? Math.round(
            Object.values(baseCategoryScores).reduce((a, b) => a + b, 0) /
              Object.values(baseCategoryScores).length,
          )
        : 0;
  const avgSubOverall =
    pageAudits.reduce((sum, p) => sum + (typeof p.overallScore === "number" ? p.overallScore : 0), 0) /
    pageAudits.length;
  const blendedOverallScore = Math.round(homeOverall * 0.5 + avgSubOverall * 0.5);

  const categories = Array.isArray(issueList.categories)
    ? (issueList.categories as Array<Record<string, unknown>>).map((cat) => {
        const catId = typeof cat.id === "string" ? cat.id : "";
        return catId && typeof blendedCategoryScores[catId] === "number"
          ? { ...cat, score: blendedCategoryScores[catId] }
          : cat;
      })
    : [];

  const existingRecs = Array.isArray(issueList.recommendations)
    ? [...(issueList.recommendations as Array<Record<string, unknown>>)]
    : [];
  const seenRecKeys = new Set<string>(
    existingRecs.map((r) => `${String(r.itemId ?? "")}::homepage`),
  );

  const subPageRecs: Array<Record<string, unknown>> = [];
  for (const pa of pageAudits) {
    const paIssues = (pa.issueList as Record<string, unknown>) ?? {};
    const paRecs = Array.isArray(paIssues.recommendations)
      ? (paIssues.recommendations as Array<Record<string, unknown>>)
      : [];
    let shortPath = pa.pageUrl;
    try {
      shortPath = new URL(pa.pageUrl).pathname || "/";
    } catch {}
    for (const rec of paRecs) {
      const key = `${String(rec.itemId ?? "")}::${pa.pageUrl}`;
      if (seenRecKeys.has(key)) continue;
      seenRecKeys.add(key);
      subPageRecs.push({
        ...rec,
        pageUrl: pa.pageUrl,
        label: `${String(rec.label ?? rec.itemId ?? "Issue")} (${shortPath})`,
      });
      if (subPageRecs.length >= 50) break;
    }
    if (subPageRecs.length >= 50) break;
  }

  const lowestScoringPages = [...pageAudits]
    .sort((a, b) => a.overallScore - b.overallScore)
    .slice(0, 5)
    .map((p) => ({ pageUrl: p.pageUrl, overallScore: p.overallScore }));

  const updatedIssueList = {
    ...issueList,
    overallScore: blendedOverallScore,
    categories,
    recommendations: [...existingRecs, ...subPageRecs],
    subPageSummary: {
      pagesAudited: pageAudits.length,
      homepageScore: homeOverall,
      avgSubPageScore: Math.round(avgSubOverall),
      lowestScoringPages,
    },
  };

  await prisma.audit.update({
    where: { id: auditId },
    data: {
      categoryScores: blendedCategoryScores,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      issueList: updatedIssueList as any,
    },
  });

  const vitals = extractAuditVitalsAndSchema(updatedIssueList as unknown as Parameters<typeof extractAuditVitalsAndSchema>[0]);
  await writeMetricSnapshot({
    siteId,
    overallScore: blendedOverallScore,
    aeoScore: vitals.aeoScore,
    schemaScore: vitals.schemaScore,
    lcp: audit.lcp ?? vitals.lcp,
    cls: audit.cls ?? vitals.cls,
    inp: audit.inp ?? vitals.inp,
  }).catch(() => {});
}

async function emitParentAuditCompletion(auditId: string, siteId: string): Promise<void> {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    select: {
      id: true,
      issueList: true,
      site: {
        select: {
          id: true,
          domain: true,
          userId: true,
          user: { select: { email: true, name: true, preferences: true } },
        },
      },
    },
  });
  if (!audit?.site) return;

  const { site } = audit;
  const issueList = audit.issueList as {
    overallScore?: number;
    categories?: Array<{ items?: Array<{ status?: string }> }>;
  } | null;
  const overallScore = typeof issueList?.overallScore === "number" ? issueList.overallScore : 0;
  const allItems = issueList?.categories?.flatMap((c) => c.items ?? []) ?? [];
  const issueCount = allItems.filter((i) => {
    const s = i.status?.toLowerCase();
    return s === "fail" || s === "warning";
  }).length;

  await fireWhiteLabelWebhook(site.userId, {
    event: "audit.completed",
    siteId: site.id,
    domain: site.domain,
    timestamp: new Date().toISOString(),
    data: { auditId, seoScore: overallScore },
  }).catch(() => null);

  const dbUser = site.user;
  if (dbUser?.email) {
    const prefs = (dbUser.preferences as Record<string, unknown>) ?? {};
    if (prefs.emailDigest !== false) {
      await sendAuditCompleteEmail({
        toEmail: dbUser.email,
        userName: dbUser.name ?? dbUser.email.split("@")[0],
        domain: site.domain,
        auditId,
        score: overallScore,
      }).catch(() => null);
    }
  }

  await notifyAuditComplete({
    userId: site.userId,
    siteId: site.id,
    domain: site.domain,
    overallScore,
    issueCount,
    auditId,
  }).catch(() => null);

  await trackFunnelEvent(site.userId, "audit_completed", site.id, {
    auditId,
    mode: "full",
    score: overallScore,
  }).catch(() => null);
}


const PAGE_LIMIT: Record<string, number> = {
  FREE: 5,
  STARTER: 50,
  PRO: 250,
  AGENCY: 500,
};

async function releaseParentLease(auditId: string, siteId: string): Promise<void> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } });
  if (!site) return;
  await releaseAuditLease(`audit-lock:${site.userId}:${siteId}`, auditId);
}

async function getTierPageLimit(siteId: string): Promise<number> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { user: { select: { subscriptionTier: true } } },
  });
  const tier = (site?.user?.subscriptionTier ?? "FREE").toUpperCase();
  return PAGE_LIMIT[tier] ?? 5;
}

async function getUserIdForSite(siteId: string): Promise<string | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  });
  return site?.userId ?? null;
}


export const runPageAuditJob = inngest.createFunction(
  {
    id: "run-page-audit",
    name: "Run Multi-Page Audit (Fan-Out)",
    retries: 2,
    onFailure: async ({ error, event }) => {
        const data = event.data?.event?.data as Record<string, unknown> | undefined;
        const auditId = data?.auditId as string | undefined;

        // Atomically transition IN_PROGRESS/PENDING → FAILED (idempotent)
        if (auditId) {
            const { count } = await prisma.audit.updateMany({
                where: {
                    id: auditId,
                    fixStatus: { notIn: [...TERMINAL_STATES] },
                },
                data: { fixStatus: "FAILED" },
            });
            if (count > 0) {
                const siteId = data?.siteId as string | undefined;
                const userId = data?.userId as string | undefined;
                const auditMode = data?.auditMode as string | undefined;
                if (siteId) await releaseParentLease(auditId, siteId).catch(() => null);
                if (userId && auditMode !== "homepage") {
                    await refundCreditsIdempotent(
                        userId,
                        CREDIT_COSTS.full_site_audit,
                        `refund:audit:${auditId}`,
                        "page_audit_coordinator_failed",
                    ).catch(() => null);
                }
                logger.info("[PageAudit] Parent audit finalized as FAILED after coordinator failure", { auditId });
            }
        }

        logger.error("[PageAudit] Coordinator failed after all retries", {
            error: error.message,
            auditId,
        });
    },

    triggers: [{ event: "audit.pages.run" }],
  },
  async ({ event, step }) => {
    const { siteId, auditId, domain, tier, auditMode } = event.data as {
      siteId: string;
      auditId: string;
      domain: string;
      tier: string;
      auditMode?: "homepage" | "full";
    };

    await step.run("verify-parent", async () => {
      const audit = await prisma.audit.findUnique({ where: { id: auditId } });
      if (!audit) throw new NonRetriableError(`Parent audit ${auditId} not found`);
      const userId = await getUserIdForSite(siteId);
      if (userId) {
        await renewAuditLease(`audit-lock:${userId}:${siteId}`, auditId).catch(() => null);
      }
    });

    const pageUrls = await step.run("discover-pages", async () => {
      const [limit, userId] = await Promise.all([
        getTierPageLimit(siteId),
        getUserIdForSite(siteId),
      ]);
      const urls = await discoverPages(domain, limit, siteId, userId ?? undefined);
      logger.info("[PageAudit] Discovered pages", {
        auditId,
        siteId,
        domain,
        count: urls.length,
        limit,
        gsc: userId ? "yes" : "no",
      });
      return urls;
    });

    if (auditMode === "homepage") {
      logger.info(`[PageAudit] Homepage-only mode — skipping page fan-out for ${domain}`);
      await prisma.audit.update({
        where: { id: auditId },
        data: { fixStatus: "COMPLETED" },
      });
      await releaseParentLease(auditId, siteId).catch(() => null);
      return { skipped: true, reason: "Homepage-only audit requested" };
    }

    const pagesToAudit = pageUrls.slice(1);

    if (pagesToAudit.length === 0) {
      logger.warn("[PageAudit] No sub-pages discovered — marking COMPLETED", { auditId, domain });
      await prisma.audit.update({
        where: { id: auditId },
        data: { fixStatus: "COMPLETED", totalPages: 0 },
      });
      await releaseParentLease(auditId, siteId).catch(() => null);
      await emitParentAuditCompletion(auditId, siteId).catch(() => null);
      return { skipped: true, reason: "No sub-pages discovered" };
    }

    await step.run("set-progress-and-fan-out", async () => {
      const userId = await getUserIdForSite(siteId);
      if (userId) {
        const lockKey = `audit-lock:${userId}:${siteId}`;
        const renewed = await renewAuditLease(lockKey, auditId).catch(() => false);
        if (!renewed) {
          await acquireAuditLease(lockKey, auditId).catch(() => null);
        }
      }
      await prisma.audit.update({
        where: { id: auditId },
        data: {
          fixStatus: "IN_PROGRESS",
          totalPages: pagesToAudit.length,
          completedPages: 0,
          failedPages: 0,
        },
      });

      logger.info("[PageAudit] Set IN_PROGRESS, dispatching page jobs", {
        auditId,
        totalPages: pagesToAudit.length,
      });
    });

    await step.sendEvent(
      "fan-out-page-audits",
      pagesToAudit.map((pageUrl) => ({
        name: "audit.page.single" as const,
        data: { siteId, auditId, pageUrl },
      }))
    );

    logger.info("[PageAudit] Fan-out dispatched", {
      auditId,
      count: pagesToAudit.length,
      domain,
    });

    return { fanned: pagesToAudit.length, domain };
  }
);


export const processPageAuditJob = inngest.createFunction(
  {
    id: "process-page-audit",
    name: "Audit Single Page",
    retries: 2,
    concurrency: {
      limit: CONCURRENCY.pageAuditChild,
      key: "event.data.siteId",
    },

    triggers: [{ event: "audit.page.single" }],
  },
  async ({ event, step }) => {
    const { siteId, auditId, pageUrl } = event.data as {
      siteId: string;
      auditId: string;
      pageUrl: string;
    };

    logger.info("[PageAudit] Started", { auditId, pageUrl });

    let auditSucceeded = false;
    let score = 0;

    try {
      const result = await step.run("run-page-audit", async () => {
        // Verify parent audit is still IN_PROGRESS and refresh or re-acquire the token-bound lease.
        // Re-acquiring when expired (nx: true) prevents queue delays > 120s from failing sub-pages,
        // while still failing if a newer audit has taken ownership of the lock.
        const [userId, parentAudit] = await Promise.all([
          getUserIdForSite(siteId),
          prisma.audit.findUnique({ where: { id: auditId }, select: { fixStatus: true } }),
        ]);
        if (!userId || (parentAudit && TERMINAL_STATES.includes(parentAudit.fixStatus as typeof TERMINAL_STATES[number]))) {
          throw new NonRetriableError("Parent audit is no longer active");
        }
        const lockKey = `audit-lock:${userId}:${siteId}`;
        const leaseActive = (await renewAuditLease(lockKey, auditId)) || (await acquireAuditLease(lockKey, auditId));
        if (!leaseActive) {
          throw new NonRetriableError("Audit lease was lost before page execution");
        }
        const engine = getAuditEngine("page");

        const site = await prisma.site.findUnique({
          where: { id: siteId },
          select: { targetKeyword: true },
        });

        return await engine.runAudit(pageUrl, {
          siteId,
          userId,
          targetKeyword: site?.targetKeyword ?? undefined,
        });
      });

      await step.run("save-page-audit", async () => {
        await prisma.pageAudit.upsert({
          where: { auditId_pageUrl: { auditId, pageUrl } },
          create: {
            auditId,
            siteId,
            pageUrl,
            overallScore: result.overallScore,
            categoryScores: result.categories.reduce(
              (acc: Record<string, number>, c: { id: string; score: number }) => ({
                ...acc,
                [c.id]: c.score,
              }),
              {}
            ),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            issueList: result as any,
          },
          update: {
            overallScore: result.overallScore,
            categoryScores: result.categories.reduce(
              (acc: Record<string, number>, c: { id: string; score: number }) => ({
                ...acc,
                [c.id]: c.score,
              }),
              {}
            ),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            issueList: result as any,
            runTimestamp: new Date(),
          },
        });

        const dr = result.diagnosticResult;
        const findings = (dr?.findings ?? []) as DiagnosticFinding[];
        const priorityMap = new Map<string, ExplainablePriority>();
        for (const a of (dr?.plan?.actions ?? []) as Array<{ findingFingerprint?: string; priority?: ExplainablePriority }>) {
          if (a?.findingFingerprint && a?.priority) {
            priorityMap.set(a.findingFingerprint, a.priority);
          }
        }
        for (const finding of findings) {
          await persistFindingWithEvidence(siteId, finding, priorityMap.get(finding.fingerprint)).catch(() => null);
        }
        await reconcileResolvedFindings(
          siteId,
          findings.map((f) => f.fingerprint),
          pageUrl,
        ).catch(() => 0);
      });

      auditSucceeded = true;
      score = result.overallScore;
      logger.info("[PageAudit] Completed", { auditId, pageUrl, score });
    } catch (err) {
      logger.error("[PageAudit] Failed", {
        auditId,
        pageUrl,
        error: (err as Error)?.message || String(err),
      });
    }

    await step.run("update-progress", async () => {
      const updated = await prisma.audit.update({
        where: { id: auditId },
        data: auditSucceeded
          ? { completedPages: { increment: 1 } }
          : { failedPages: { increment: 1 } },
        select: { totalPages: true, completedPages: true, failedPages: true },
      });

      const processed = updated.completedPages + updated.failedPages;
      logger.info("[PageAudit] Progress", {
        auditId,
        pageUrl,
        completed: updated.completedPages,
        failed: updated.failedPages,
        total: updated.totalPages,
      });

      if (updated.totalPages > 0 && processed >= updated.totalPages) {
        const finalStatus =
          updated.completedPages === 0
            ? "FAILED"
            : updated.failedPages > 0
              ? "PARTIAL"
              : "COMPLETED";

        // Idempotent: only one worker transitions IN_PROGRESS → terminal.
        // If two workers race here, the second updateMany matches zero rows.
        const { count } = await prisma.audit.updateMany({
          where: {
            id: auditId,
            fixStatus: "IN_PROGRESS",
          },
          data: { fixStatus: finalStatus },
        });

        if (count > 0) {
          await releaseParentLease(auditId, siteId).catch(() => null);
          if (finalStatus !== "FAILED") {
            await aggregateMultiPageAuditResults(auditId, siteId).catch((err) => {
              logger.error("[PageAudit] Failed to aggregate sub-page results", {
                auditId,
                error: (err as Error)?.message,
              });
            });
            await emitParentAuditCompletion(auditId, siteId).catch(() => null);
          } else {
            const userId = await getUserIdForSite(siteId);
            if (userId) {
              await refundCreditsIdempotent(
                userId,
                CREDIT_COSTS.full_site_audit,
                `refund:audit:${auditId}`,
                "all_subpages_failed",
              ).catch(() => null);
            }
          }
          logger.info("[PageAudit] All pages processed — audit finalized", {
            auditId,
            finalStatus,
            completed: updated.completedPages,
            failed: updated.failedPages,
          });
        }
      }
    });

    return { pageUrl, score, success: auditSucceeded };
  }
);
