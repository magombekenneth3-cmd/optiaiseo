import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SerpContext } from "@/lib/blog/serp";
import type { ConsolidatedOpportunity } from "@/lib/opportunity-engine/types";
import { prisma } from "@/lib/prisma";
import { buildOpportunityIntelligence } from "@/lib/opportunity-engine/serp-intelligence";

vi.mock("@/lib/blog/serp", () => ({
  getSerpContextForKeyword: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    site: { findUnique: vi.fn() },
    keywordSerpSnapshot: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  formatError: (error: unknown) => String(error),
}));

function opportunity(keyword: string, impressions: number): ConsolidatedOpportunity {
  return {
    url: `https://example.com/${keyword.toLowerCase().replace(/\s+/g, "-")}`,
    keyword,
    primaryCategory: "QUICK_WIN",
    categories: ["QUICK_WIN"],
    impressions,
    clicks: 25,
    position: 8,
    inboundInternalLinksCount: 1,
    signals: [],
  };
}

function serpContext(keyword: string): SerpContext {
  return {
    keyword,
    results: [
      {
        title: "Best AEO Tools: A Comparison",
        link: "https://competitor.example/tools",
        snippet: "Compare the best platforms and alternatives.",
      },
      {
        title: "Top AEO Software Compared",
        link: "https://competitor.example/software",
        snippet: "A comparison of the available tools.",
      },
    ],
    peopleAlsoAsk: [],
    featuredSnippet: null,
    relatedSearches: [],
    formattedContext: "",
    opportunityAnalysis: {
      tableStakes: [],
      opportunities: [],
      unansweredQuestions: [],
    },
  };
}

describe("growth opportunity SERP evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      location: "United States",
      localContext: null,
    } as never);
    vi.mocked(prisma.keywordSerpSnapshot.findMany).mockResolvedValue([] as never);
  });

  it("loads a keyword once and passes its actual SERP results to the profiler", async () => {
    const loader = vi.fn(async (keyword: string) => serpContext(keyword));
    const intelligence = await buildOpportunityIntelligence(
      "site-1",
      [
        opportunity("best AEO tools", 800),
        opportunity("best AEO tools", 250),
        opportunity("technical SEO audit", 500),
      ],
      { serpConfigured: true, loadSerpContext: loader, maxLookups: 5 },
    );

    expect(loader).toHaveBeenCalledTimes(2);
    expect(intelligence.get("best AEO tools")?.serpEvidenceStatus).toBe("AVAILABLE");
    expect(intelligence.get("best AEO tools")?.serpResultCount).toBe(2);
    expect(intelligence.get("best AEO tools")?.serpConsensus?.dominantType).toBe(
      "COMPARISON_PAGE",
    );
  });

  it("uses cautious alignment when a requested SERP lookup returns no evidence", async () => {
    const intelligence = await buildOpportunityIntelligence(
      "site-1",
      [opportunity("best SEO tools", 900)],
      {
        serpConfigured: true,
        loadSerpContext: async () => null,
      },
    );

    expect(intelligence.get("best SEO tools")?.serpEvidenceStatus).toBe("UNAVAILABLE");
    expect(intelligence.get("best SEO tools")?.serpResultCount).toBe(0);
    expect(intelligence.get("best SEO tools")?.intentAlignment).toBe(50);
    expect(intelligence.get("best SEO tools")?.serpConsensus).toBeUndefined();
  });

  it("caps lookups and labels lower-priority keywords as not requested", async () => {
    const loader = vi.fn(async (keyword: string) => serpContext(keyword));
    const intelligence = await buildOpportunityIntelligence(
      "site-1",
      [
        opportunity("keyword one", 100),
        opportunity("keyword two", 200),
        opportunity("keyword three", 900),
        opportunity("keyword four", 700),
      ],
      { serpConfigured: true, loadSerpContext: loader, maxLookups: 2 },
    );

    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls.map(([keyword]) => keyword).sort()).toEqual(
      ["keyword three", "keyword four"].sort(),
    );
    expect(intelligence.get("keyword three")?.serpEvidenceStatus).toBe("AVAILABLE");
    expect(intelligence.get("keyword four")?.serpEvidenceStatus).toBe("AVAILABLE");
    expect(intelligence.get("keyword one")?.serpEvidenceStatus).toBe("NOT_REQUESTED");
    expect(intelligence.get("keyword one")?.intentAlignment).toBe(50);
  });


  it("reuses fresh site- and market-scoped snapshots before making live requests", async () => {
    vi.mocked(prisma.keywordSerpSnapshot.findMany).mockResolvedValue([
      {
        keyword: "best seo tools",
        results: [
          {
            title: "Best SEO Tools Compared",
            url: "https://competitor.example/seo-tools",
            domain: "competitor.example",
            rank: 1,
          },
          {
            title: "SEO Tool Comparison",
            url: "https://other.example/comparison",
            domain: "other.example",
            rank: 2,
          },
        ],
        observedAt: new Date("2026-10-12T10:00:00.000Z"),
      },
    ] as never);
    const loader = vi.fn(async (keyword: string) => serpContext(keyword));

    const intelligence = await buildOpportunityIntelligence(
      "site-1",
      [opportunity("best SEO tools", 900)],
      { serpConfigured: true, loadSerpContext: loader },
    );

    expect(loader).not.toHaveBeenCalled();
    expect(intelligence.get("best SEO tools")?.serpEvidenceStatus).toBe("AVAILABLE");
    expect(intelligence.get("best SEO tools")?.serpSource).toBe("CACHED_KEYWORD_SNAPSHOT");
    expect(intelligence.get("best SEO tools")?.serpObservedAt).toBe(
      "2026-10-12T10:00:00.000Z",
    );
    expect(intelligence.get("best SEO tools")?.serpResultCount).toBe(2);
  });

  it("does not call a SERP provider when SERP credentials are not configured", async () => {
    const loader = vi.fn(async (keyword: string) => serpContext(keyword));
    const intelligence = await buildOpportunityIntelligence(
      "site-1",
      [opportunity("best SEO tools", 900)],
      { serpConfigured: false, loadSerpContext: loader },
    );

    expect(loader).not.toHaveBeenCalled();
    expect(intelligence.get("best SEO tools")?.serpEvidenceStatus).toBe("UNAVAILABLE");
    expect(intelligence.get("best SEO tools")?.intentAlignment).toBe(50);
  });
});
