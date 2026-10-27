import { createHash } from "node:crypto";
import type { RawDiscoverySignal, DiscoveryEvidence } from "../types";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

function createFingerprint(siteId: string, category: string, resourceType: string, resourceId: string): string {
  const canonical = [siteId, category, resourceType, resourceId].join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function detectCrawlSignals(
  siteId: string,
  sourceRunId: string,
  options?: { since?: Date }
): Promise<RawDiscoverySignal[]> {
  logger.info("[CrawlDetector] Starting crawl detection", { siteId });

  const since = options?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const pageAudits = await prisma.pageAudit.findMany({
    where: {
      siteId,
      runTimestamp: { gte: since },
      overallScore: { lt: 70 },
    },
    select: {
      id: true,
      pageUrl: true,
      overallScore: true,
      runTimestamp: true,
    },
    orderBy: { runTimestamp: "desc" },
    take: 100,
  });

  const signals: RawDiscoverySignal[] = [];
  const seenUrls = new Set<string>();

  for (const page of pageAudits) {
    if (!page.pageUrl || seenUrls.has(page.pageUrl)) continue;
    seenUrls.add(page.pageUrl);

    const isCritical = page.overallScore < 50;
    const evidence: DiscoveryEvidence = {
      sourceType: "CRAWL",
      metric: "overallScore",
      value: String(page.overallScore),
      observedAt: page.runTimestamp,
      metadata: { pageAuditId: page.id },
    };

    signals.push({
      siteId,
      source: "CRAWL",
      sourceRunId,
      fingerprint: createFingerprint(siteId, "STALE", "PAGE", page.pageUrl),
      category: "STALE",
      suggestedAction: "REFRESH_CONTENT",
      resourceType: "PAGE",
      resourceId: page.pageUrl,
      url: page.pageUrl,
      confidence: isCritical ? 0.9 : 0.75,
      evidence: [evidence],
    });
  }

  logger.info("[CrawlDetector] Completed crawl detection", {
    siteId,
    signalsCount: signals.length,
  });

  return signals;
}
