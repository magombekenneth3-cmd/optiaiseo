/**
 * src/lib/inngest/functions/diagnostic-verification.ts
 *
 * Inngest jobs for the 3-window verification lifecycle:
 *
 *   T+0   — Technical verification: re-crawl and check VerificationCriteria
 *   T+7   — Search verification: check GSC indexing and impressions
 *   T+28  — Business verification: bridges to existing healing-outcomes cron
 *
 * The jobs are triggered by events:
 *   "seo/fix.deployed"    → T+0
 *   "seo/fix.t0-verified" → T+7
 */

import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  runTechnicalVerification,
} from "@/lib/seo-audit/verification-runner";
import type { VerificationCriterion } from "@/lib/seo-audit/diagnostic-types";

// ── T+0 Technical Verification ──────────────────────────────────────────────

export const verifyFixT0Job = inngest.createFunction(
  {
    id: "verify-fix-t0-technical",
    name: "T+0 Technical Verification",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: "seo/fix.deployed" as const }],
  },
  async ({ event, step }: { event: { data: { siteId: string; findingId: string; url: string; verificationCriteria: VerificationCriterion[] } }; step: any }) => {
    const { siteId, findingId, url, verificationCriteria } = event.data;

    // Wait 2 minutes for deployment propagation (CDN, SSG rebuild, etc.)
    await step.sleep("wait-for-deploy", "2m");

    // Run T+0 verification
    const result = await step.run("run-t0-verification", async () => {
      return await runTechnicalVerification(url, verificationCriteria);
    });

    // Persist verification result
    await step.run("persist-t0-result", async () => {
      const newStatus =
        result.outcome === "TECHNICALLY_VERIFIED" ? "PASS" :
        result.outcome === "PARTIALLY_VERIFIED" ? "WARNING" :
        "FAIL";

      try {
        await (prisma as any).diagnosticFindingRecord.updateMany({
          where: { id: findingId, siteId },
          data: {
            status: newStatus,
            ...(newStatus === "PASS" ? { resolvedAt: new Date() } : {}),
          },
        });

        await (prisma as any).sEOEvidenceRecord.create({
          data: {
            siteId,
            findingId,
            source: "HTML",
            url,
            observedValue: {
              verificationType: "T0_TECHNICAL",
              outcome: result.outcome,
              passedCount: result.passedCount,
              totalCount: result.totalCount,
              criteria: result.criteria.map((c: any) => ({
                type: c.criterion.type,
                passed: c.passed,
                actual: c.actual,
                error: c.error,
              })),
            },
            confidence: result.passedCount / Math.max(1, result.totalCount),
            evidenceHash: `t0-${findingId}-${Date.now()}`,
          },
        });
      } catch (dbErr) {
        // Tables may not exist if migration hasn't been run yet — non-fatal
        logger.warn("[T+0 Verification] DB persist failed (run prisma migrate):", {
          error: (dbErr as Error)?.message,
        });
      }

      logger.info(
        `[T+0 Verification] ${findingId}: ${result.outcome} ` +
        `(${result.passedCount}/${result.totalCount} criteria passed, ${result.durationMs}ms)`,
      );

      return { outcome: result.outcome, passedCount: result.passedCount };
    });

    // If T+0 passed, schedule T+7 search verification
    if (result.outcome === "TECHNICALLY_VERIFIED" || result.outcome === "PARTIALLY_VERIFIED") {
      await step.sendEvent("schedule-t7", {
        name: "seo/fix.t0-verified",
        data: {
          siteId,
          findingId,
          url,
          t0Outcome: result.outcome,
          deployedAt: new Date().toISOString(),
        },
      });
    }

    return {
      findingId,
      outcome: result.outcome,
      passedCount: result.passedCount,
      totalCount: result.totalCount,
      durationMs: result.durationMs,
    };
  },
);

// ── T+7 Search Verification ─────────────────────────────────────────────────

export const verifyFixT7Job = inngest.createFunction(
  {
    id: "verify-fix-t7-search",
    name: "T+7 Search Verification",
    retries: 1,
    concurrency: { limit: 3 },
    triggers: [{ event: "seo/fix.t0-verified" as const }],
  },
  async ({ event, step }: { event: { data: { siteId: string; findingId: string; url: string; t0Outcome: string; deployedAt: string } }; step: any }) => {
    const { siteId, findingId, url } = event.data;

    // Wait 7 days for search engine re-crawl and re-indexing
    await step.sleep("wait-for-search-verification", "7d");

    const result = await step.run("check-gsc-indexing", async () => {
      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: {
          domain: true,
          userId: true,
          user: { select: { gscConnected: true } },
        },
      });

      if (!site?.user?.gscConnected) {
        return { outcome: "UNKNOWN" as const, reason: "GSC not connected" };
      }

      const account = await prisma.account.findFirst({
        where: { userId: site.userId, provider: "google" },
        select: { access_token: true },
      });

      if (!account?.access_token) {
        return { outcome: "UNKNOWN" as const, reason: "No Google access token" };
      }

      try {
        const { fetchGSCKeywordsByDateRange, normaliseSiteUrl } = await import("@/lib/gsc");
        const siteUrl = normaliseSiteUrl(site.domain);

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);

        const rows = await fetchGSCKeywordsByDateRange(
          account.access_token,
          siteUrl,
          startDate,
          endDate,
        );

        const totalClicks = rows.reduce((sum: number, r: any) => sum + r.clicks, 0);
        const totalImpressions = rows.reduce((sum: number, r: any) => sum + r.impressions, 0);
        const avgPosition = rows.length > 0
          ? rows.reduce((sum: number, r: any) => sum + r.position, 0) / rows.length
          : null;

        const isSearchVerified = totalImpressions > 0;

        return {
          outcome: isSearchVerified ? "SEARCH_VERIFIED" as const : "PENDING" as const,
          clicks: totalClicks,
          impressions: totalImpressions,
          avgPosition: avgPosition ? parseFloat(avgPosition.toFixed(2)) : null,
        };
      } catch (err) {
        return {
          outcome: "UNKNOWN" as const,
          reason: (err as Error)?.message ?? "GSC fetch failed",
        };
      }
    });

    // Persist T+7 result
    await step.run("persist-t7-result", async () => {
      if (result.outcome === "SEARCH_VERIFIED") {
        try {
          await (prisma as any).sEOEvidenceRecord.create({
            data: {
              siteId,
              findingId,
              source: "GSC",
              url,
              observedValue: {
                verificationType: "T7_SEARCH",
                outcome: result.outcome,
                clicks: "clicks" in result ? result.clicks : 0,
                impressions: "impressions" in result ? result.impressions : 0,
                avgPosition: "avgPosition" in result ? result.avgPosition : null,
              },
              confidence: 0.85,
              evidenceHash: `t7-${findingId}-${Date.now()}`,
            },
          });
          logger.info(`[T+7 Verification] ${findingId}: SEARCH_VERIFIED`);
        } catch (dbErr) {
          logger.warn("[T+7 Verification] DB persist failed:", {
            error: (dbErr as Error)?.message,
          });
        }
      }
    });

    return { findingId, ...result };
  },
);

// ── T+28 Business Verification Bridge ───────────────────────────────────────
//
// The T+28 window is handled by the existing measureHealingOutcomesJob.
// This bridge function links HealingOutcome results to DiagnosticFindingRecords.

/**
 * Link a verified healing outcome back to a diagnostic finding.
 */
export async function linkHealingOutcomeToFinding(params: {
  siteId: string;
  findingFingerprint: string;
  impactScore: number;
  outcome: "improved" | "neutral" | "degraded";
}): Promise<void> {
  try {
    const finding = await (prisma as any).diagnosticFindingRecord.findFirst({
      where: {
        siteId: params.siteId,
        fingerprint: params.findingFingerprint,
      },
    });

    if (!finding) return;

    await (prisma as any).sEOEvidenceRecord.create({
      data: {
        siteId: params.siteId,
        findingId: finding.id,
        source: "GSC",
        observedValue: {
          verificationType: "T28_BUSINESS",
          outcome: params.outcome,
          impactScore: params.impactScore,
        },
        confidence: params.outcome === "improved" ? 0.95 : 0.7,
        evidenceHash: `t28-${finding.id}-${Date.now()}`,
      },
    });

    if (params.outcome === "improved") {
      await (prisma as any).diagnosticFindingRecord.update({
        where: { id: finding.id },
        data: { status: "PASS", resolvedAt: new Date() },
      });
      logger.info(`[T+28 Verification] ${finding.fingerprint}: OUTCOME_MEASURED (improved)`);
    } else if (params.outcome === "degraded") {
      await (prisma as any).diagnosticFindingRecord.update({
        where: { id: finding.id },
        data: { status: "FAIL" },
      });
      logger.warn(`[T+28 Verification] ${finding.fingerprint}: REGRESSED`);
    }
  } catch (err) {
    logger.warn("[T+28 Verification] Failed to link outcome to finding:", {
      error: (err as Error)?.message,
    });
  }
}

/**
 * Persist a diagnostic finding to the database (upserts by fingerprint).
 */
export async function persistFindingAndScheduleVerification(params: {
  siteId: string;
  findingId: string;
  fingerprint: string;
  issueType: string;
  status: string;
  severity: string;
  scopeType: string;
  scopeUrls: string[];
  rootCause: string;
  confidence: number;
  expectedOutcome: string;
  remediationType: string;
  verificationCriteria: unknown;
  dependencies: string[];
  priorityScore?: number;
  priorityComponents?: unknown;
  policyVersion?: string;
  url: string;
}): Promise<void> {
  try {
    await (prisma as any).diagnosticFindingRecord.upsert({
      where: {
        siteId_fingerprint: {
          siteId: params.siteId,
          fingerprint: params.fingerprint,
        },
      },
      create: {
        siteId: params.siteId,
        fingerprint: params.fingerprint,
        issueType: params.issueType,
        status: params.status,
        severity: params.severity,
        scopeType: params.scopeType,
        scopeUrls: params.scopeUrls,
        rootCause: params.rootCause,
        confidence: params.confidence,
        expectedOutcome: params.expectedOutcome,
        remediationType: params.remediationType,
        verificationCriteria: params.verificationCriteria as any,
        dependencies: params.dependencies,
        priorityScore: params.priorityScore,
        priorityComponents: params.priorityComponents as any,
        policyVersion: params.policyVersion,
      },
      update: {
        status: params.status,
        severity: params.severity,
        confidence: params.confidence,
        priorityScore: params.priorityScore,
        priorityComponents: params.priorityComponents as any,
      },
    });
  } catch (err) {
    logger.warn("[DiagnosticVerification] Failed to persist finding:", {
      error: (err as Error)?.message,
      fingerprint: params.fingerprint,
    });
  }
}
