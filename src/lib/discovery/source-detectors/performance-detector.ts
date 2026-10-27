import { createHash } from "node:crypto";
import type { RawDiscoverySignal, DiscoveryEvidence } from "../types";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

function createFingerprint(siteId: string, category: string, resourceType: string, resourceId: string): string {
  const canonical = [siteId, category, resourceType, resourceId].join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function detectPerformanceSignals(
  siteId: string,
  sourceRunId: string,
  options?: { since?: Date }
): Promise<RawDiscoverySignal[]> {
  logger.info("[PerformanceDetector] Starting performance detection", { siteId });

  const since = options?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [recentAudits, recentSnapshots] = await Promise.all([
    prisma.audit.findMany({
      where: {
        siteId,
        runTimestamp: { gte: since },
      },
      select: {
        id: true,
        lcp: true,
        cls: true,
        inp: true,
        runTimestamp: true,
      },
      orderBy: { runTimestamp: "desc" },
      take: 2,
    }),
    prisma.metricSnapshot.findMany({
      where: {
        siteId,
        createdAt: { gte: since },
      },
      select: {
        id: true,
        coreWebVitals: true,
        overallScore: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 2,
    }),
  ]);

  const signals: RawDiscoverySignal[] = [];

  const latestAudit = recentAudits[0];
  if (latestAudit) {
    if (typeof latestAudit.lcp === "number" && latestAudit.lcp > 2500) {
      const isCritical = latestAudit.lcp > 4000;
      const evidence: DiscoveryEvidence = {
        sourceType: "PERFORMANCE",
        metric: "lcp",
        value: `${Math.round(latestAudit.lcp)}ms`,
        observedAt: latestAudit.runTimestamp,
        metadata: { thresholdMs: 2500, criticalMs: 4000 },
      };

      signals.push({
        siteId,
        source: "PERFORMANCE",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "QUICK_WIN", "PAGE", "/_perf_lcp"),
        category: "QUICK_WIN",
        suggestedAction: "OPTIMIZE_CONTENT_DEPTH",
        resourceType: "PAGE",
        resourceId: "/",
        url: "/",
        confidence: isCritical ? 0.9 : 0.75,
        evidence: [evidence],
      });
    }

    if (typeof latestAudit.cls === "number" && latestAudit.cls > 0.1) {
      const isCritical = latestAudit.cls > 0.25;
      const evidence: DiscoveryEvidence = {
        sourceType: "PERFORMANCE",
        metric: "cls",
        value: latestAudit.cls.toFixed(3),
        observedAt: latestAudit.runTimestamp,
        metadata: { threshold: 0.1, critical: 0.25 },
      };

      signals.push({
        siteId,
        source: "PERFORMANCE",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "QUICK_WIN", "PAGE", "/_perf_cls"),
        category: "QUICK_WIN",
        suggestedAction: "OPTIMIZE_CONTENT_DEPTH",
        resourceType: "PAGE",
        resourceId: "/",
        url: "/",
        confidence: isCritical ? 0.9 : 0.75,
        evidence: [evidence],
      });
    }

    if (typeof latestAudit.inp === "number" && latestAudit.inp > 200) {
      const isCritical = latestAudit.inp > 500;
      const evidence: DiscoveryEvidence = {
        sourceType: "PERFORMANCE",
        metric: "inp",
        value: `${Math.round(latestAudit.inp)}ms`,
        observedAt: latestAudit.runTimestamp,
        metadata: { thresholdMs: 200, criticalMs: 500 },
      };

      signals.push({
        siteId,
        source: "PERFORMANCE",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "QUICK_WIN", "PAGE", "/_perf_inp"),
        category: "QUICK_WIN",
        suggestedAction: "OPTIMIZE_CONTENT_DEPTH",
        resourceType: "PAGE",
        resourceId: "/",
        url: "/",
        confidence: isCritical ? 0.85 : 0.7,
        evidence: [evidence],
      });
    }
  }

  if (recentSnapshots.length >= 2) {
    const [current, previous] = recentSnapshots;
    if (
      current.coreWebVitals != null &&
      previous.coreWebVitals != null &&
      previous.coreWebVitals - current.coreWebVitals >= 10
    ) {
      const evidence: DiscoveryEvidence = {
        sourceType: "PERFORMANCE",
        metric: "coreWebVitals",
        value: `${previous.coreWebVitals} -> ${current.coreWebVitals}`,
        observedAt: current.createdAt,
        metadata: { drop: previous.coreWebVitals - current.coreWebVitals },
      };

      signals.push({
        siteId,
        source: "PERFORMANCE",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "DECLINING", "SITE", siteId),
        category: "DECLINING",
        suggestedAction: "REFRESH_CONTENT",
        resourceType: "SITE",
        resourceId: siteId,
        confidence: 0.85,
        evidence: [evidence],
      });
    }
  }

  logger.info("[PerformanceDetector] Completed performance detection", {
    siteId,
    signalsCount: signals.length,
  });

  return signals;
}
