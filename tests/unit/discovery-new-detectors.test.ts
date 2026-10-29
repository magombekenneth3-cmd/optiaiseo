import { describe, it, expect, vi } from "vitest";
import { detectPerformanceSignals } from "@/lib/discovery/source-detectors/performance-detector";
import { detectCompetitorSignals } from "@/lib/discovery/source-detectors/competitor-detector";
import { detectCrawlSignals } from "@/lib/discovery/source-detectors/crawl-detector";
import { validateSignal } from "@/lib/discovery/validators";

const { mockAuditFindMany, mockMetricSnapshotFindMany, mockAlertFindMany, mockCompetitorFindMany, mockPageAuditFindMany } = vi.hoisted(() => ({
  mockAuditFindMany: vi.fn(),
  mockMetricSnapshotFindMany: vi.fn(),
  mockAlertFindMany: vi.fn(),
  mockCompetitorFindMany: vi.fn(),
  mockPageAuditFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    audit: { findMany: mockAuditFindMany },
    metricSnapshot: { findMany: mockMetricSnapshotFindMany },
    competitorAlertLog: { findMany: mockAlertFindMany },
    competitor: { findMany: mockCompetitorFindMany },
    pageAudit: { findMany: mockPageAuditFindMany },
  },
}));

describe("Discovery New Detectors Unit Tests", () => {
  it("detectPerformanceSignals detects LCP, CLS, INP and score drops", async () => {
    const now = new Date();
    mockAuditFindMany.mockResolvedValueOnce([
      {
        id: "audit-1",
        lcp: 4200,
        cls: 0.18,
        inp: 320,
        runTimestamp: now,
      },
    ]);
    mockMetricSnapshotFindMany.mockResolvedValueOnce([
      { id: "snap-1", coreWebVitals: 65, overallScore: 70, capturedAt: now, createdAt: now },
      { id: "snap-2", coreWebVitals: 85, overallScore: 82, capturedAt: new Date(now.getTime() - 86400000), createdAt: new Date(now.getTime() - 86400000) },
    ]);

    const signals = await detectPerformanceSignals("site-1", "run-1");
    expect(signals.length).toBe(4);

    for (const signal of signals) {
      expect(signal.source).toBe("PERFORMANCE");
      expect(signal.sourceRunId).toBe("run-1");
      expect(signal.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      const validation = validateSignal(signal, now);
      expect(validation.valid).toBe(true);
    }
  });

  it("detectCompetitorSignals detects ranking movements and competitor top keywords", async () => {
    const now = new Date();
    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert-1",
        siteId: "site-1",
        competitor: "rival.com",
        keyword: "best seo tool",
        delta: -4,
        oldPos: 8,
        newPos: 4,
        sentAt: now,
      },
    ]);
    mockCompetitorFindMany.mockResolvedValueOnce([
      {
        id: "comp-1",
        domain: "rival.com",
        keywords: [
          {
            id: "kw-1",
            keyword: "ai rank tracker",
            position: 2,
            searchVolume: 1200,
            difficulty: 35,
            fetchedAt: now,
          },
        ],
      },
    ]);

    const signals = await detectCompetitorSignals("site-1", "run-2");
    expect(signals.length).toBe(2);

    for (const signal of signals) {
      expect(signal.source).toBe("COMPETITOR");
      expect(signal.sourceRunId).toBe("run-2");
      expect(signal.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      const validation = validateSignal(signal, now);
      expect(validation.valid).toBe(true);
    }
  });

  it("detectCrawlSignals detects underperforming crawled pages", async () => {
    const now = new Date();
    mockPageAuditFindMany.mockResolvedValueOnce([
      {
        id: "pa-1",
        pageUrl: "https://example.com/blog/stale-guide",
        overallScore: 42,
        runTimestamp: now,
      },
    ]);

    const signals = await detectCrawlSignals("site-1", "run-3");
    expect(signals.length).toBe(1);
    expect(signals[0].source).toBe("CRAWL");
    expect(signals[0].resourceId).toBe("https://example.com/blog/stale-guide");
    expect(signals[0].suggestedAction).toBe("REFRESH_CONTENT");
    const validation = validateSignal(signals[0], now);
    expect(validation.valid).toBe(true);
  });
});
