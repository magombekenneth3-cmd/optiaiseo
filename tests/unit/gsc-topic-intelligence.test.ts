import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  clusterGscQueries,
  buildGscTopicIntelligence,
  inferQueryIntent,
  tokenizeQuery,
  calculateTokenOverlap,
  type RawGscKeyword,
  type GscPerformanceInputRow,
} from "@/lib/gsc/topic-cluster";
import { classifyIntent } from "@/lib/gsc";
import { analyzeKeywordIntelligence } from "@/lib/agents/keyword-intelligence-agent";
import { analyzeCannibalization } from "@/lib/agents/cannibalization-agent";
import {
  resolvePageExistenceBatch,
  resolvePageExistence,
} from "@/lib/opportunity-engine/page-existence-resolver";
import { generateOpportunitiesFromFindings } from "@/lib/opportunity-engine/findings-to-opportunities";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("should enforce search intent matching during cluster formation and not merge mixed-intent queries", () => {
    const rawKeywords: RawGscKeyword[] = [
      { keyword: "best seo tools", impressions: 2900, clicks: 230, position: 4.1 }, // Commercial
      { keyword: "best seo tools login", impressions: 800, clicks: 50, position: 2.1 }, // Navigational
      { keyword: "buy best seo tools", impressions: 500, clicks: 40, position: 3.5 }, // Transactional
    ];

    const clusters = clusterGscQueries(rawKeywords, 0.6);

    expect(clusters.length).toBe(3);
    expect(clusters.find((c) => c.head.keyword === "best seo tools")?.intent).toBe("Commercial");
    expect(clusters.find((c) => c.head.keyword === "best seo tools login")?.intent).toBe("Navigational");
    expect(clusters.find((c) => c.head.keyword === "buy best seo tools")?.intent).toBe("Transactional");
  });

  it("should classify navigational login terms prior to commercial terms", () => {
    expect(inferQueryIntent("best login software")).toBe("Navigational");
    expect(inferQueryIntent("top app portal")).toBe("Navigational");
    expect(inferQueryIntent("best software platform")).toBe("Commercial");
    expect(inferQueryIntent("buy software plan")).toBe("Transactional");
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

  it("should resolve page existence in batch with exactly 1 set of DB queries (zero N+1 calls)", async () => {
    const topics = [
      { keyword: "best seo tools", clusterQueries: ["top seo tools", "best seo software"] },
      { keyword: "keyword research guide", clusterQueries: ["how to do keyword research"] },
      { keyword: "technical seo checklist", clusterQueries: ["seo audit steps"] },
    ];

    const resultMap = await resolvePageExistenceBatch("site-1", topics);

    expect(resultMap.has("best seo tools")).toBe(true);
    expect(resultMap.has("keyword research guide")).toBe(true);
    expect(resultMap.has("technical seo checklist")).toBe(true);
    expect(resultMap.get("best seo tools")?.verdict).toBe("MISSING");

    // Cardinality assertions proving zero N+1 database queries
    expect(prisma.gscDailyPerformance.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.blog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.pageAudit.findMany).toHaveBeenCalledTimes(1);
  });

  it("should preserve uncorrupted original URLs in page existence candidates without leading slash corruption", async () => {
    const mockGscRow = {
      keyword: "best seo tools",
      url: "https://example.com/blog/best-seo-tools",
      impressions: 500,
      clicks: 40,
      position: 3.5,
    };
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValueOnce([mockGscRow]);

    const topics = [
      { keyword: "best seo tools", clusterQueries: ["top seo tools"] },
    ];

    const resultMap = await resolvePageExistenceBatch("site-1", topics);
    const result = resultMap.get("best seo tools");

    expect(result).toBeDefined();
    expect(result?.verdict).toBe("EXISTING_HEALTHY");
    expect(result?.existingPage?.url).toBe("https://example.com/blog/best-seo-tools");
    expect(result?.existingPage?.url).not.toMatch(/^\/example\.com/);
  });

  it("should maintain single-source-of-truth intent parity across all consumers", () => {
    const testQueries = [
      { q: "best seo tools login", expected: "Navigational" },
      { q: "buy seo software plan", expected: "Transactional" },
      { q: "best seo keyword research tool", expected: "Commercial" },
      { q: "how to do technical seo audit", expected: "Informational" },
    ];

    for (const { q, expected } of testQueries) {
      const topicClusterIntent = inferQueryIntent(q);
      const legacyGscIntent = classifyIntent(q);

      expect(topicClusterIntent).toBe(expected);
      expect(legacyGscIntent.toLowerCase()).toBe(expected.toLowerCase());
    }
  });

  it("should treat single-page clusters with avgPosition <= 10 as healthy topical consolidation and not emit CONTENT_GAP", () => {
    const healthyClusterGscRows: GscPerformanceInputRow[] = [
      { query: "best seo tools", page: "https://example.com/blog/seo-tools", clicks: 100, impressions: 1000, position: 3.0, date: "2026-10-01" },
      { query: "top seo tools", page: "https://example.com/blog/seo-tools", clicks: 80, impressions: 800, position: 4.2, date: "2026-10-01" },
      { query: "top 10 seo tools", page: "https://example.com/blog/seo-tools", clicks: 50, impressions: 500, position: 5.1, date: "2026-10-01" },
    ];

    const healthyResult = analyzeKeywordIntelligence("site-1", healthyClusterGscRows as any);
    const healthyContentGap = healthyResult.findings.find((f) => f.type === "CONTENT_GAP");
    expect(healthyContentGap).toBeUndefined();

    const strugglingClusterGscRows: GscPerformanceInputRow[] = [
      { query: "best seo tools", page: "https://example.com/blog/seo-tools", clicks: 5, impressions: 1000, position: 14.0, date: "2026-10-01" },
      { query: "top seo tools", page: "https://example.com/blog/seo-tools", clicks: 3, impressions: 800, position: 16.2, date: "2026-10-01" },
      { query: "top 10 seo tools", page: "https://example.com/blog/seo-tools", clicks: 2, impressions: 500, position: 18.1, date: "2026-10-01" },
    ];

    const strugglingResult = analyzeKeywordIntelligence("site-1", strugglingClusterGscRows as any);
    const strugglingContentGap = strugglingResult.findings.find((f) => f.type === "CONTENT_GAP");
    expect(strugglingContentGap).toBeDefined();
    expect(strugglingContentGap?.type).toBe("CONTENT_GAP");
  });

  it("should guarantee every topic contributes to prefetch tokens in resolvePageExistenceBatch", async () => {
    // Generate 35 distinct topics, each with unique terms
    const topics = Array.from({ length: 35 }, (_, i) => ({
      keyword: `topic term${i} specialty${i}`,
      clusterQueries: [`subterm${i} detail${i}`],
    }));

    // Mock blog search to capture the query parameters passed to Prisma
    let capturedBlogQuery: any = null;
    (prisma.blog.findMany as any).mockImplementationOnce((query: any) => {
      capturedBlogQuery = query;
      return Promise.resolve([]);
    });

    await resolvePageExistenceBatch("site-1", topics);

    expect(capturedBlogQuery).toBeDefined();
    expect(capturedBlogQuery.where.OR).toBeDefined();

    // Verify that the 35th topic's unique term ("term34") was included in the OR slug/title filters
    const hasLastTopicToken = capturedBlogQuery.where.OR.some(
      (cond: any) => cond.slug?.contains === "term34" || cond.title?.contains === "term34"
    );
    expect(hasLastTopicToken).toBe(true);
  });

  it("should ensure duplicate/shared tokens do not consume a topic's 2 new-token quota", async () => {
    const topics = [
      { keyword: "shared audit guide", clusterQueries: [] },
      { keyword: "shared analysis report", clusterQueries: [] },
    ];

    let capturedQuery: any = null;
    (prisma.blog.findMany as any).mockImplementationOnce((query: any) => {
      capturedQuery = query;
      return Promise.resolve([]);
    });

    await resolvePageExistenceBatch("site-1", topics);

    expect(capturedQuery).toBeDefined();
    const orConditions = capturedQuery.where.OR;

    // "shared" is present from Topic 0.
    // Topic 1 has "shared", "analysis", "report".
    // Duplicate "shared" must NOT consume Topic 1's quota, so BOTH "analysis" and "report" must be in OR filters!
    const hasAnalysis = orConditions.some((c: any) => c.slug?.contains === "analysis" || c.title?.contains === "analysis");
    const hasReport = orConditions.some((c: any) => c.slug?.contains === "report" || c.title?.contains === "report");

    expect(hasAnalysis).toBe(true);
    expect(hasReport).toBe(true);
  });

  it("should perform two-pass round-robin allocation so all topics receive Pass 1 token before Pass 2 tokens", async () => {
    // 50 topics with 2 tokens each
    const topics = Array.from({ length: 50 }, (_, i) => ({
      keyword: `alpha${i} beta${i}`,
      clusterQueries: [],
    }));

    let capturedQuery: any = null;
    (prisma.blog.findMany as any).mockImplementationOnce((query: any) => {
      capturedQuery = query;
      return Promise.resolve([]);
    });

    await resolvePageExistenceBatch("site-1", topics);

    const orConditions = capturedQuery.where.OR;

    // Verify Pass 1 token of the last topic ("alpha49") is present in OR conditions
    const hasPass1LastTopic = orConditions.some(
      (c: any) => c.slug?.contains === "alpha49" || c.title?.contains === "alpha49"
    );
    expect(hasPass1LastTopic).toBe(true);
  });

  it("should scale to 100 topics without positionally starving late topics in Prisma queries", async () => {
    const topics = Array.from({ length: 100 }, (_, i) => ({
      keyword: `batchterm${i} detail${i}`,
      clusterQueries: [],
    }));

    let capturedQuery: any = null;
    (prisma.blog.findMany as any).mockImplementationOnce((query: any) => {
      capturedQuery = query;
      return Promise.resolve([]);
    });

    await resolvePageExistenceBatch("site-1", topics);

    const orConditions = capturedQuery.where.OR;

    // Verify late topic ("batchterm99") is represented in Prisma OR filter
    const hasLateTopic = orConditions.some(
      (c: any) => c.slug?.contains === "batchterm99" || c.title?.contains === "batchterm99"
    );
    expect(hasLateTopic).toBe(true);
  });

  it("should produce deterministic token prefetch queries across multiple invocations with identical inputs", async () => {
    const topics = [
      { keyword: "deterministic topic one", clusterQueries: ["query alpha"] },
      { keyword: "deterministic topic two", clusterQueries: ["query beta"] },
      { keyword: "deterministic topic three", clusterQueries: ["query gamma"] },
    ];

    let query1: any = null;
    let query2: any = null;

    (prisma.blog.findMany as any).mockImplementationOnce((q: any) => {
      query1 = q;
      return Promise.resolve([]);
    });

    await resolvePageExistenceBatch("site-1", topics);

    (prisma.blog.findMany as any).mockImplementationOnce((q: any) => {
      query2 = q;
      return Promise.resolve([]);
    });

    await resolvePageExistenceBatch("site-1", topics);

    expect(query1).toBeDefined();
    expect(query2).toBeDefined();
    expect(query1.where.OR).toEqual(query2.where.OR);
  });

  describe("Failure-Path Hardening & Zero-N+1 Fallback Integrity", () => {
    const build50TopicFindings = (): any[] =>
      Array.from({ length: 50 }, (_, i) => ({
        type: "TOPIC_OPPORTUNITY",
        severity: "MEDIUM",
        confidence: 0.8,
        title: `Topic opportunity ${i}`,
        description: `Description ${i}`,
        fingerprint: `fp-${i}`,
        affectedResource: { type: "KEYWORD", id: `topic-keyword-${i}` },
        evidence: [{ sourceType: "GSC", metric: "clusterSize", value: "3", metadata: { queries: [`query-${i}`] } }],
      }));

    it("should resolve 50 TOPIC_OPPORTUNITY findings with 1 batch call and 0 individual resolver calls", async () => {
      const findings = build50TopicFindings();

      (prisma.agentFinding.findMany as any).mockResolvedValueOnce([]);
      (prisma.gscDailyPerformance.findMany as any).mockResolvedValueOnce([]);
      (prisma.blog.findMany as any).mockResolvedValueOnce([]);
      (prisma.pageAudit.findMany as any).mockResolvedValueOnce([]);

      const createdCount = await generateOpportunitiesFromFindings("site-1", findings);

      expect(createdCount).toBe(50);
      // Batch resolver performs 1 findMany on gscDailyPerformance, 1 on blog, 1 on pageAudit
      expect(prisma.gscDailyPerformance.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.blog.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.pageAudit.findMany).toHaveBeenCalledTimes(1);
    });

    it("should retry batch resolution once when first batch attempt fails, avoiding per-topic resolver calls", async () => {
      const findings = build50TopicFindings();

      (prisma.agentFinding.findMany as any).mockResolvedValue([]);
      (prisma.blog.findMany as any).mockResolvedValue([]);
      (prisma.pageAudit.findMany as any).mockResolvedValue([]);

      // Mock GSC findMany to throw on 1st call, succeed on 2nd call (retry)
      (prisma.gscDailyPerformance.findMany as any)
        .mockRejectedValueOnce(new Error("Transient DB Timeout"))
        .mockResolvedValueOnce([]);

      const createdCount = await generateOpportunitiesFromFindings("site-1", findings);

      expect(createdCount).toBe(50);
      // Retried once -> 2 calls total to gscDailyPerformance
      expect(prisma.gscDailyPerformance.findMany).toHaveBeenCalledTimes(2);
    });

    it("should fail-safe to NEEDS_REVIEW when batch resolution fails after retry without N+1 per-finding calls", async () => {
      const findings = build50TopicFindings();

      (prisma.agentFinding.findMany as any).mockResolvedValue([]);
      (prisma.blog.findMany as any).mockResolvedValue([]);
      (prisma.pageAudit.findMany as any).mockResolvedValue([]);

      // Mock GSC findMany to throw on both 1st and 2nd calls
      (prisma.gscDailyPerformance.findMany as any)
        .mockRejectedValueOnce(new Error("Persistent DB Error"))
        .mockRejectedValueOnce(new Error("Persistent DB Error"));

      const createdCount = await generateOpportunitiesFromFindings("site-1", findings);

      expect(createdCount).toBe(50);
      // Exactly 2 attempts total (1 initial + 1 retry) on gscDailyPerformance, zero individual per-finding calls
      expect(prisma.gscDailyPerformance.findMany).toHaveBeenCalledTimes(2);

      // Verify that decisions created failed safe to action "NEEDS_REVIEW" and NEVER "CREATE_NEW_CONTENT"
      const upsertCalls = (prisma.growthDecision.upsert as any).mock.calls;
      expect(upsertCalls.length).toBeGreaterThan(0);

      for (const call of upsertCalls) {
        const createData = call[0].create;
        expect(createData.action).toBe("NEEDS_REVIEW");
        expect(createData.action).not.toBe("CREATE_NEW_CONTENT");
        expect(createData.primaryCategory).toBe("QUICK_WIN");
        expect(createData.whyNow.signals.some((s: any) => s.signal === "PAGE_EXISTENCE_CHECK")).toBe(true);
      }
    });
  });
});
