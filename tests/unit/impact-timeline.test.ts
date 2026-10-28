import { describe, it, expect, vi } from "vitest";
import { getImpactTimeline } from "@/lib/impact";

const { mockProposalFindMany, mockDecisionFindMany, mockGscFindMany } = vi.hoisted(() => ({
  mockProposalFindMany: vi.fn(),
  mockDecisionFindMany: vi.fn(),
  mockGscFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    seoFixProposal: { findMany: mockProposalFindMany },
    growthDecision: { findMany: mockDecisionFindMany },
    gscDailyPerformance: { findMany: mockGscFindMany },
  },
}));

describe("Impact Timeline & Attribution Tests", () => {
  it("marks fixes dispatched less than 14 days ago as PENDING_ATTRIBUTION with EVALUATING confidence", async () => {
    const now = new Date();
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

    mockProposalFindMany.mockResolvedValueOnce([
      {
        id: "prop-1",
        issueLabel: "Add speakable specification",
        filePath: "src/app/page.tsx",
        dispatchedAt: fourDaysAgo,
        deployedAt: fourDaysAgo,
        prUrl: "https://github.com/org/repo/pull/1",
      },
    ]);
    mockDecisionFindMany.mockResolvedValueOnce([]);
    mockGscFindMany.mockResolvedValueOnce([]);

    const res = await getImpactTimeline("site-1");
    expect(res.totalFixesDispatched).toBe(1);
    expect(res.totalPendingAttribution).toBe(1);
    expect(res.totalMeasured).toBe(0);
    expect(res.events[0].status).toBe("PENDING_ATTRIBUTION");
    expect(res.events[0].confidence).toBe("EVALUATING");
    expect(res.events[0].delta).toBeNull();
    expect(res.events[0].attributionNote).toContain("Search engine re-indexing & attribution requires");
  });

  it("calculates truthful before/after lift when >= 14 days of data are available", async () => {
    const now = new Date();
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    mockProposalFindMany.mockResolvedValueOnce([]);
    mockDecisionFindMany.mockResolvedValueOnce([
      {
        id: "dec-1",
        action: "IMPROVE_SEARCH_INTENT",
        url: "https://example.com/blog/guide",
        primaryKeyword: "seo guide",
        approvedAt: twentyDaysAgo,
      },
    ]);

    const gscData = [];
    // Before window (-34d to -20d): 100 clicks
    for (let i = 21; i <= 34; i++) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
      gscData.push({
        url: "https://example.com/blog/guide",
        keyword: "seo guide",
        date: d,
        clicks: 10,
        impressions: 100,
        position: 12.0,
      });
    }
    // After window (-20d to -6d): 180 clicks
    for (let i = 7; i <= 20; i++) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
      gscData.push({
        url: "https://example.com/blog/guide",
        keyword: "seo guide",
        date: d,
        clicks: 18,
        impressions: 150,
        position: 8.0,
      });
    }

    mockGscFindMany.mockResolvedValueOnce(gscData);

    const res = await getImpactTimeline("site-1");
    expect(res.totalFixesDispatched).toBe(1);
    expect(res.totalMeasured).toBe(1);
    expect(res.totalPendingAttribution).toBe(0);
    expect(res.events[0].status).toBe("MEASURED");
    expect(res.events[0].confidence).toBe("HIGH");
    expect(res.events[0].before?.clicks).toBe(140);
    expect(res.events[0].after?.clicks).toBe(252);
    expect(res.events[0].delta?.clicksDiff).toBe(112);
    expect(res.events[0].delta?.clicksLiftPercent).toBe(80.0);
    expect(res.events[0].delta?.positionDiff).toBe(4.0); // 12.0 - 8.0 = +4 positions gained
  });
});
