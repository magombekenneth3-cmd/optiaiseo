import { createHash } from "node:crypto";
import type { RawDiscoverySignal, DiscoveryEvidence } from "../types";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

function createFingerprint(siteId: string, category: string, resourceType: string, resourceId: string): string {
  const canonical = [siteId, category, resourceType, resourceId].join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function detectCompetitorSignals(
  siteId: string,
  sourceRunId: string,
  options?: { since?: Date }
): Promise<RawDiscoverySignal[]> {
  logger.info("[CompetitorDetector] Starting competitor detection", { siteId });

  const since = options?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [alerts, competitors] = await Promise.all([
    prisma.competitorAlertLog.findMany({
      where: {
        siteId,
        sentAt: { gte: since },
      },
      orderBy: { sentAt: "desc" },
      take: 100,
    }),
    prisma.competitor.findMany({
      where: { siteId },
      include: {
        keywords: {
          where: {
            position: { lte: 10 },
            fetchedAt: { gte: since },
          },
          orderBy: { fetchedAt: "desc" },
          take: 50,
        },
      },
      take: 20,
    }),
  ]);

  const signals: RawDiscoverySignal[] = [];
  const seenKeywords = new Set<string>();

  for (const alert of alerts) {
    if (!alert.keyword || seenKeywords.has(alert.keyword)) continue;
    seenKeywords.add(alert.keyword);

    const evidence: DiscoveryEvidence = {
      sourceType: "COMPETITOR",
      metric: "position",
      value: `${alert.oldPos} -> ${alert.newPos}`,
      observedAt: alert.sentAt,
      metadata: {
        competitor: alert.competitor,
        delta: alert.delta,
        newPos: alert.newPos,
        oldPos: alert.oldPos,
      },
    };

    signals.push({
      siteId,
      source: "COMPETITOR",
      sourceRunId,
      fingerprint: createFingerprint(siteId, "ALMOST_RANKING", "KEYWORD", alert.keyword),
      category: "ALMOST_RANKING",
      suggestedAction: "IMPROVE_SEARCH_INTENT",
      resourceType: "KEYWORD",
      resourceId: alert.keyword,
      keyword: alert.keyword,
      confidence: 0.8,
      evidence: [evidence],
    });
  }

  for (const comp of competitors) {
    for (const kw of comp.keywords) {
      if (!kw.keyword || seenKeywords.has(kw.keyword)) continue;
      seenKeywords.add(kw.keyword);

      const evidence: DiscoveryEvidence = {
        sourceType: "COMPETITOR",
        metric: "searchVolume",
        value: String(kw.searchVolume ?? 0),
        observedAt: kw.fetchedAt,
        metadata: {
          competitorDomain: comp.domain,
          position: kw.position,
          difficulty: kw.difficulty,
        },
      };

      signals.push({
        siteId,
        source: "COMPETITOR",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "QUICK_WIN", "KEYWORD", kw.keyword),
        category: "QUICK_WIN",
        suggestedAction: "CREATE_NEW_CONTENT",
        resourceType: "KEYWORD",
        resourceId: kw.keyword,
        keyword: kw.keyword,
        confidence: 0.75,
        evidence: [evidence],
      });
    }
  }

  logger.info("[CompetitorDetector] Completed competitor detection", {
    siteId,
    signalsCount: signals.length,
  });

  return signals;
}
