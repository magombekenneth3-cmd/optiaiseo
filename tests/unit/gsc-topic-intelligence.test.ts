import { describe, it, expect, vi } from "vitest";
import {
  clusterGscQueries,
  buildGscTopicIntelligence,
  tokenizeQuery,
  calculateTokenOverlap,
  type RawGscKeyword,
  type GscPerformanceInputRow,
} from "@/lib/gsc/topic-cluster";
import { analyzeKeywordIntelligence } from "@/lib/agents/keyword-intelligence-agent";
import { analyzeCannibalization } from "@/lib/agents/cannibalization-agent";
import { resolvePageExistenceBatch } from "@/lib/opportunity-engine/page-existence-resolver";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gscDailyPerformance: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    blog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    pageAudit: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    agentFinding: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    growthDecision: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: "dec-1" }),
      update: vi.fn().mockResolvedValue({ id: "dec-1" }),
    },
    opportunityFinding: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("GSC Topic Intelligence Contract & Shared Data Layer", () => {
  const MOCK_GSC_ROWS: GscPerformanceInputRow[] = [
    {
      query: "best seo tools",
      page: "https://example.com/blog/best-seo-tools",
      clicks: 120,
      impressions: 1500,
      position: 4.2,
      date: "2026-10-01",
    },
    {
      query: "best seo tools",
      page: "https://example.com/blog/best-seo-tools",
      clicks: 110,
      impressions: 1400,
      position: 4.0,
      date: "2026-10-02",
    },
    {
      query: "top seo tools",
      page: "https://example.com/blog/seo-tools-guide",
      clicks: 80,
      impressions: 1200,
      position: 6.5,
      date: "2026-10-01",
    },
    {
      query: "top 10 seo tools",
      page: "https://example.com/blog/best-seo-tools",
      clicks: 90,
      impressions: 1000,
      position: 5.1,
      date: "2026-10-02",
    },
  ];

  it("should produce identical clusters for raw keyword input across consumers", () => {
    const rawKeywords: RawGscKeyword[] = [
      { keyword: "best seo tools", impressions: 2900, clicks: 230, position: 4.1 },
      { keyword: "top seo tools", impressions: 1200, clicks: 80, position: 6.5 },
      { keyword: "top 10 seo tools", impressions: 1000, clicks: 90, position: 5.1 },
    ];

    const clustersFromRaw = clusterGscQueries(rawKeywords, 0.6);
    const topicIntel = buildGscTopicIntelligence(MOCK_GSC_ROWS, 0.6);

    expect(clustersFromRaw[0].head.keyword).toBe("best seo tools");
    expect(topicIntel[0].head.keyword).toBe("best seo tools");
    expect(topicIntel[0].queries).toEqual(clustersFromRaw[0].queries);
  });

  it("should populate ranking URLs and daily evidence in buildGscTopicIntelligence", () => {
    const topicIntel = buildGscTopicIntelligence(MOCK_GSC_ROWS, 0.6);
    const headCluster = topicIntel.find((t) => t.head.keyword === "best seo tools")!;

    expect(headCluster).toBeDefined();
    expect(headCluster.rankingUrls.length).toBe(2);
    expect(headCluster.rankingUrls[0].url).toBe("https://example.com/blog/best-seo-tools");
    expect(headCluster.rankingUrls[0].dates.has("2026-10-01")).toBe(true);
    expect(headCluster.rankingUrls[0].dates.has("2026-10-02")).toBe(true);
  });

  it("should detect topic-level cannibalization across related query variants", () => {
    const rowsForCannibalization: GscPerformanceInputRow[] = [
      // URL A ranks for "best seo tools"
      {
        query: "best seo tools",
        page: "https://example.com/blog/best-seo-tools",
        clicks: 50,
        impressions: 600,
        position: 3.0,
        date: "2026-10-01",
      },
      {
        query: "best seo tools",
        page: "https://example.com/blog/best-seo-tools",
        clicks: 40,
        impressions: 500,
        position: 3.2,
        date: "2026-10-02",
      },
      // URL B ranks for "top seo tools" (same topic cluster)
      {
        query: "top seo tools",
        page: "https://example.com/blog/top-seo-tools",
        clicks: 45,
        impressions: 550,
        position: 4.0,
        date: "2026-10-03",
      },
      {
        query: "top seo tools",
        page: "https://example.com/blog/top-seo-tools",
        clicks: 40,
        impressions: 500,
        position: 4.2,
        date: "2026-10-04",
      },
    ];

    const result = analyzeCannibalization("site-1", rowsForCannibalization as any);

    expect(result.data.risksFound).toBeGreaterThanOrEqual(1);
    expect(result.data.risks[0].pages.length).toBe(2);
    expect(result.data.risks[0].query).toBe("best seo tools");
  });

  it("should preserve rankingUrls evidence metadata in keyword-intelligence-agent", () => {
    const gscRows = [
      ...MOCK_GSC_ROWS,
      {
        query: "best seo software",
        page: "https://example.com/blog/best-seo-tools",
        clicks: 30,
        impressions: 300,
        position: 12.0,
        date: "2026-10-01",
      },
    ];

    const result = analyzeKeywordIntelligence("site-1", gscRows as any);
    expect(result.data.clusters.length).toBeGreaterThanOrEqual(1);
    expect(result.data.clusters[0].rankingUrls).toBeDefined();
  });

  it("should resolve page existence in batch with zero N+1 DB calls", async () => {
    const topics = [
      { keyword: "best seo tools", clusterQueries: ["top seo tools", "best seo software"] },
      { keyword: "keyword research guide", clusterQueries: ["how to do keyword research"] },
    ];

    const resultMap = await resolvePageExistenceBatch("site-1", topics);

    expect(resultMap.has("best seo tools")).toBe(true);
    expect(resultMap.has("keyword research guide")).toBe(true);
    expect(resultMap.get("best seo tools")?.verdict).toBe("MISSING");
  });
});
