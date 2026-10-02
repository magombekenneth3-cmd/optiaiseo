import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  runTechnicalVerification,
} from "@/lib/seo-audit/verification-runner";
import type { VerificationCriterion } from "@/lib/seo-audit/contracts";
import {
  getFindingByDbId,
  persistDiagnosticEvidence,
} from "@/lib/seo-audit/diagnostic-persistence";
import { computeEvidenceHash } from "@/lib/seo-audit/contracts";
import {
  computeVerificationIdempotencyKey,
  transitionLifecycleState,
  LIFECYCLE_STATE,
} from "@/lib/seo-audit/lifecycle";

function isExpectedEvidenceConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta?.target as string[] | undefined) ?? [];
  return target.includes("findingId") && target.includes("evidenceHash");
}

interface T0EventData {
  siteId: string;
  findingDbId: string;
  url: string;
  deploymentRevision?: string;
  proposalId?: string;
  verificationCriteria: VerificationCriterion[];
  idempotencyKey?: string;
}

interface T7EventData {
  siteId: string;
  findingDbId: string;
  url: string;
  t0Outcome: string;
  deployedAt: string;
  deploymentRevision?: string;
}

export const verifyFixT0Job = inngest.createFunction(
  {
    id: "verify-fix-t0-technical",
    name: "T+0 Technical Verification",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: "seo/fix.deployed" as const }],
  },
  async ({ event, step }: { event: { data: T0EventData }; step: any }) => {
    const { siteId, findingDbId, url, verificationCriteria, deploymentRevision } = event.data;

    if (!findingDbId || findingDbId.startsWith("autofix:")) {
      logger.warn("[T+0 Verification] Skipped — no valid findingDbId", { findingDbId });
      return { skipped: true, reason: "invalid_finding_id" };
    }

    const idempotencyKey = computeVerificationIdempotencyKey(findingDbId, "T0", deploymentRevision ?? "unknown");

    const existingEvidence = await step.run("check-idempotency", async () => {
      const existing = await prisma.sEOEvidenceRecord.findFirst({
        where: {
          findingId: findingDbId,
          evidenceHash: idempotencyKey,
        },
        select: { id: true },
      });
      return !!existing;
    });

    if (existingEvidence) {
      logger.info("[T+0 Verification] Skipped — duplicate event", { findingDbId, idempotencyKey });
      return { skipped: true, reason: "duplicate_event", idempotencyKey };
    }

    await step.sleep("wait-for-deploy", "2m");

    const result = await step.run("run-t0-verification", async () => {
      return await runTechnicalVerification(url, verificationCriteria);
    });

    await step.run("persist-t0-result", async () => {
      const finding = await getFindingByDbId(findingDbId);

      if (!finding) {
        logger.error("[T+0 Verification] Finding not found by DB ID:", { findingDbId });
        return { outcome: result.outcome, error: "finding_not_found" };
      }

      if (finding.siteId !== siteId) {
        logger.error("[T+0 Verification] Site ID mismatch:", {
          expected: siteId,
          actual: finding.siteId,
          findingDbId,
        });
        return { outcome: result.outcome, error: "site_mismatch" };
      }

      const newDiagnosticStatus =
        result.outcome === "TECHNICALLY_VERIFIED" ? "WARNING" :
        result.outcome === "PARTIALLY_VERIFIED" ? "WARNING" :
        result.outcome === "UNKNOWN" ? "UNKNOWN" :
        "FAIL";

      await prisma.diagnosticFindingRecord.update({
        where: { id: finding.dbId },
        data: {
          status: newDiagnosticStatus,
        },
      });

      if (result.outcome === "TECHNICALLY_VERIFIED" || result.outcome === "PARTIALLY_VERIFIED") {
        await transitionLifecycleState(finding.dbId, LIFECYCLE_STATE.IN_PROGRESS);
      }

      const evidenceHash = idempotencyKey;

      try {
        await persistDiagnosticEvidence(
          siteId,
          finding.dbId,
          [{
            source: "HTML",
            url,
            observedAt: new Date().toISOString(),
            observedValue: {
              verificationType: "T0_TECHNICAL",
              outcome: result.outcome,
              passedCount: result.passedCount,
              totalCount: result.totalCount,
              deploymentRevision: deploymentRevision ?? null,
              criteria: result.criteria.map((c: any) => ({
                type: c.criterion.type,
                passed: c.passed,
                actual: c.actual,
                error: c.error,
              })),
            },
            confidence: result.passedCount / Math.max(1, result.totalCount),
            confidenceKind: "DIRECTLY_OBSERVED" as const,
            evidenceHash,
          }],
        );
      } catch (err) {
        if (isExpectedEvidenceConflict(err)) {
          logger.info("[T+0 Verification] Duplicate evidence skipped", { findingDbId, evidenceHash });
          return { outcome: result.outcome, deduplicated: true };
        }
        throw err;
      }

      logger.info(
        `[T+0 Verification] ${finding.fingerprint}: ${result.outcome} ` +
        `(${result.passedCount}/${result.totalCount} criteria passed, ${result.durationMs}ms)`,
      );

      return { outcome: result.outcome, passedCount: result.passedCount };
    });

    if (result.outcome === "TECHNICALLY_VERIFIED" || result.outcome === "PARTIALLY_VERIFIED") {
      await step.sendEvent("schedule-t7", {
        name: "seo/fix.t0-verified",
        data: {
          siteId,
          findingDbId,
          url,
          t0Outcome: result.outcome,
          deployedAt: new Date().toISOString(),
          deploymentRevision: deploymentRevision ?? null,
        },
      });
    }

    return {
      findingDbId,
      outcome: result.outcome,
      passedCount: result.passedCount,
      totalCount: result.totalCount,
      durationMs: result.durationMs,
    };
  },
);

export const verifyFixT7Job = inngest.createFunction(
  {
    id: "verify-fix-t7-search",
    name: "T+7 Search Verification",
    retries: 1,
    concurrency: { limit: 3 },
    triggers: [{ event: "seo/fix.t0-verified" as const }],
  },
  async ({ event, step }: { event: { data: T7EventData }; step: any }) => {
    const { siteId, findingDbId, url, deployedAt, deploymentRevision } = event.data;

    const t7IdempotencyKey = computeVerificationIdempotencyKey(findingDbId, "T7", deploymentRevision ?? "unknown");

    const existingT7 = await step.run("check-t7-idempotency", async () => {
      const existing = await prisma.sEOEvidenceRecord.findFirst({
        where: {
          findingId: findingDbId,
          evidenceHash: t7IdempotencyKey,
        },
        select: { id: true },
      });
      return !!existing;
    });

    if (existingT7) {
      logger.info("[T+7 Verification] Skipped — duplicate event", { findingDbId, t7IdempotencyKey });
      return { skipped: true, reason: "duplicate_event" };
    }

    await step.sleep("wait-for-search-verification", "7d");

    const result = await step.run("check-gsc-indexing", async () => {
      const finding = await getFindingByDbId(findingDbId);
      if (!finding) {
        return { outcome: "UNKNOWN" as const, reason: "finding_not_found" };
      }

      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: {
          domain: true,
          userId: true,
          user: { select: { gscConnected: true } },
        },
      });

      if (!site?.user?.gscConnected) {
        return { outcome: "INSUFFICIENT_DATA" as const, reason: "GSC not connected" };
      }

      const account = await prisma.account.findFirst({
        where: { userId: site.userId, provider: "google" },
        select: { access_token: true },
      });

      if (!account?.access_token) {
        return { outcome: "INSUFFICIENT_DATA" as const, reason: "No Google access token" };
      }

      try {
        const { fetchGSCKeywordsByDateRange, normaliseSiteUrl } = await import("@/lib/gsc");
        const siteUrl = normaliseSiteUrl(site.domain);

        const targetUrl = normalizeTargetUrl(url, site.domain);

        const deployDate = new Date(deployedAt);
        const baselineEnd = new Date(deployDate);
        const baselineStart = new Date(deployDate);
        baselineStart.setDate(baselineStart.getDate() - 7);

        const postEnd = new Date();
        const postStart = new Date();
        postStart.setDate(postStart.getDate() - 7);

        const [baselineRows, postRows] = await Promise.all([
          fetchGSCKeywordsByDateRange(account.access_token, siteUrl, baselineStart, baselineEnd),
          fetchGSCKeywordsByDateRange(account.access_token, siteUrl, postStart, postEnd),
        ]);

        const filterByUrl = (rows: any[]) => {
          const normalized = normalizeTargetUrl(targetUrl, site.domain);
          return rows.filter((r: any) => {
            const rowUrl = normalizeTargetUrl(r.page ?? r.url ?? "", site.domain);
            return rowUrl === normalized;
          });
        };

        const filteredBaseline = filterByUrl(baselineRows);
        const filteredPost = filterByUrl(postRows);

        const baselineData = aggregateGSCRows(filteredBaseline);
        const postData = aggregateGSCRows(filteredPost);

        const baselineImpressions = baselineData?.impressions ?? 0;
        const postImpressions = postData?.impressions ?? 0;
        const baselineClicks = baselineData?.clicks ?? 0;
        const postClicks = postData?.clicks ?? 0;
        const baselineAvgPosition = baselineData?.position ?? null;
        const postAvgPosition = postData?.position ?? null;
        const baselineCtr = baselineData?.ctr ?? null;
        const postCtr = postData?.ctr ?? null;

        let outcome: string;
        if (baselineImpressions === 0 && postImpressions === 0) {
          outcome = "INSUFFICIENT_DATA";
        } else if (postImpressions > baselineImpressions * 1.1) {
          outcome = "SEARCH_VERIFIED";
        } else if (postImpressions < baselineImpressions * 0.8) {
          outcome = "REGRESSED";
        } else if (postImpressions > 0) {
          outcome = "NO_MEASURABLE_CHANGE";
        } else {
          outcome = "INEFFECTIVE";
        }

        return {
          outcome: outcome as any,
          targetUrl,
          baselinePeriod: { start: baselineStart.toISOString(), end: baselineEnd.toISOString() },
          postPeriod: { start: postStart.toISOString(), end: postEnd.toISOString() },
          baselineImpressions,
          postImpressions,
          baselineClicks,
          postClicks,
          baselineCtr,
          postCtr,
          baselineAvgPosition: baselineAvgPosition ? parseFloat(Number(baselineAvgPosition).toFixed(2)) : null,
          postAvgPosition: postAvgPosition ? parseFloat(Number(postAvgPosition).toFixed(2)) : null,
        };
      } catch (err) {
        return {
          outcome: "UNKNOWN" as const,
          reason: (err as Error)?.message ?? "GSC fetch failed",
        };
      }
    });

    await step.run("persist-t7-result", async () => {
      const finding = await getFindingByDbId(findingDbId);
      if (!finding) return;

      const evidenceHash = t7IdempotencyKey;

      try {
        await persistDiagnosticEvidence(
          siteId,
          finding.dbId,
          [{
            source: "GSC",
            url,
            observedAt: new Date().toISOString(),
            observedValue: {
              verificationType: "T7_SEARCH",
              outcome: result.outcome,
              targetUrl: "targetUrl" in result ? result.targetUrl : url,
              baselinePeriod: "baselinePeriod" in result ? result.baselinePeriod : null,
              postPeriod: "postPeriod" in result ? result.postPeriod : null,
              baselineImpressions: "baselineImpressions" in result ? result.baselineImpressions : null,
              postImpressions: "postImpressions" in result ? result.postImpressions : null,
              baselineClicks: "baselineClicks" in result ? result.baselineClicks : null,
              postClicks: "postClicks" in result ? result.postClicks : null,
              baselineCtr: "baselineCtr" in result ? result.baselineCtr : null,
              postCtr: "postCtr" in result ? result.postCtr : null,
              baselineAvgPosition: "baselineAvgPosition" in result ? result.baselineAvgPosition : null,
              postAvgPosition: "postAvgPosition" in result ? result.postAvgPosition : null,
              deploymentRevision: deploymentRevision ?? null,
            },
            confidence: result.outcome === "SEARCH_VERIFIED" ? 0.85 : 0.5,
            confidenceKind: "DIRECTLY_OBSERVED" as const,
            evidenceHash,
          }],
        );
      } catch (err) {
        if (isExpectedEvidenceConflict(err)) {
          logger.info("[T+7 Verification] Duplicate evidence skipped", { findingDbId, evidenceHash });
          return;
        }
        throw err;
      }

      if (result.outcome === "SEARCH_VERIFIED") {
        await transitionLifecycleState(finding.dbId, LIFECYCLE_STATE.RESOLVED);
      } else if (result.outcome === "REGRESSED") {
        await transitionLifecycleState(finding.dbId, LIFECYCLE_STATE.REGRESSED);
      }

      logger.info(`[T+7 Verification] ${finding.fingerprint}: ${result.outcome}`);
    });

    return { findingDbId, ...result };
  },
);

export async function linkHealingOutcomeToFinding(params: {
  siteId: string;
  findingFingerprint: string;
  impactScore: number;
  outcome: "improved" | "neutral" | "degraded";
  deploymentRevision?: string;
}): Promise<void> {
  const finding = await prisma.diagnosticFindingRecord.findUnique({
    where: {
      siteId_fingerprint: {
        siteId: params.siteId,
        fingerprint: params.findingFingerprint,
      },
    },
    select: { id: true, fingerprint: true },
  });

  if (!finding) return;

  const t28IdempotencyKey = computeVerificationIdempotencyKey(
    finding.id,
    "T28",
    params.deploymentRevision ?? "unknown",
  );

  const evidenceHash = t28IdempotencyKey;

  try {
    await persistDiagnosticEvidence(
      params.siteId,
      finding.id,
      [{
        source: "GSC",
        url: undefined,
        observedAt: new Date().toISOString(),
        observedValue: {
          verificationType: "T28_BUSINESS",
          outcome: params.outcome,
          impactScore: params.impactScore,
          findingDbId: finding.id,
          deploymentRevision: params.deploymentRevision ?? null,
        },
        confidence: params.outcome === "improved" ? 0.95 : 0.7,
        confidenceKind: "DIRECTLY_OBSERVED" as const,
        evidenceHash,
      }],
    );
  } catch (err) {
    if (isExpectedEvidenceConflict(err)) {
      return;
    }
    throw err;
  }

  if (params.outcome === "improved") {
    await transitionLifecycleState(finding.id, LIFECYCLE_STATE.RESOLVED);
    logger.info(`[T+28 Verification] ${finding.fingerprint}: OUTCOME_MEASURED (improved)`);
  } else if (params.outcome === "degraded") {
    await transitionLifecycleState(finding.id, LIFECYCLE_STATE.REGRESSED);
    logger.warn(`[T+28 Verification] ${finding.fingerprint}: REGRESSED`);
  }
}

export async function linkHealingOutcomeToFindingById(params: {
  siteId: string;
  findingDbId: string;
  impactScore: number;
  outcome: "improved" | "neutral" | "degraded";
  deploymentRevision?: string;
}): Promise<void> {
  const finding = await prisma.diagnosticFindingRecord.findUnique({
    where: { id: params.findingDbId },
    select: { id: true, siteId: true, fingerprint: true },
  });

  if (!finding || finding.siteId !== params.siteId) return;

  const t28IdempotencyKey = computeVerificationIdempotencyKey(
    finding.id,
    "T28",
    params.deploymentRevision ?? "unknown",
  );

  try {
    await persistDiagnosticEvidence(
      params.siteId,
      finding.id,
      [{
        source: "GSC",
        url: undefined,
        observedAt: new Date().toISOString(),
        observedValue: {
          verificationType: "T28_BUSINESS",
          outcome: params.outcome,
          impactScore: params.impactScore,
          findingDbId: finding.id,
          deploymentRevision: params.deploymentRevision ?? null,
          attributionPath: "diagnosticFindingId",
        },
        confidence: params.outcome === "improved" ? 0.95 : 0.7,
        confidenceKind: "DIRECTLY_OBSERVED" as const,
        evidenceHash: t28IdempotencyKey,
      }],
    );
  } catch (err) {
    if (isExpectedEvidenceConflict(err)) {
      return;
    }
    throw err;
  }

  if (params.outcome === "improved") {
    await transitionLifecycleState(finding.id, LIFECYCLE_STATE.RESOLVED);
    logger.info(`[T+28 Verification] ${finding.fingerprint}: OUTCOME_MEASURED via ID (improved)`);
  } else if (params.outcome === "degraded") {
    await transitionLifecycleState(finding.id, LIFECYCLE_STATE.REGRESSED);
    logger.warn(`[T+28 Verification] ${finding.fingerprint}: REGRESSED via ID`);
  }
}

function normalizeTargetUrl(url: string, domain: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    parsed.hash = "";
    let normalized = parsed.origin.toLowerCase() + parsed.pathname + parsed.search;
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

function aggregateGSCRows(rows: any[]): { clicks: number; impressions: number; ctr: number | null; position: number | null } {
  if (rows.length === 0) return { clicks: 0, impressions: 0, ctr: null, position: null };
  const clicks = rows.reduce((sum: number, r: any) => sum + (r.clicks ?? 0), 0);
  const impressions = rows.reduce((sum: number, r: any) => sum + (r.impressions ?? 0), 0);
  const ctr = impressions > 0 ? clicks / impressions : null;
  const totalWeightedPosition = rows.reduce((sum: number, r: any) => sum + ((r.position ?? 0) * (r.impressions ?? 0)), 0);
  const position = impressions > 0 ? totalWeightedPosition / impressions : null;
  return { clicks, impressions, ctr, position };
}
