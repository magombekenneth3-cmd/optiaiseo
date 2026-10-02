import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getServerSessionMock,
  userFindUnique,
  siteFindUnique,
  siteFindFirst,
  aeoReportFindFirst,
  aeoSnapshotFindFirst,
  aeoSnapshotFindMany,
  aeoEventCount,
  findingCount,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  siteFindFirst: vi.fn(),
  aeoReportFindFirst: vi.fn(),
  aeoSnapshotFindFirst: vi.fn(),
  aeoSnapshotFindMany: vi.fn(),
  aeoEventCount: vi.fn(),
  findingCount: vi.fn(),
}));

let eventCountCallIndex = 0;

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    site: { findUnique: siteFindUnique, findFirst: siteFindFirst },
    aeoReport: { findFirst: aeoReportFindFirst },
    aeoSnapshot: { findFirst: aeoSnapshotFindFirst, findMany: aeoSnapshotFindMany },
    aeoEvent: {
      count: (...args: unknown[]) => {
        const idx = eventCountCallIndex++;
        return aeoEventCount(...args);
      },
    },
    diagnosticFindingRecord: { count: findingCount },
  },
}));

import { GET } from "@/app/api/diagnostics/ai-readiness/route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/diagnostics/ai-readiness");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

const mockUser = { id: "user-1" };
const mockSite = { id: "site-1", userId: "user-1", domain: "example.com" };

const mockReport = {
  id: "rpt-1",
  score: 72,
  grade: "B",
  citationScore: 45,
  citationLikelihood: 60,
  generativeShareOfVoice: 38,
  schemaTypes: ["Organization", "FAQ"],
  topRecommendations: ["Add FAQ schema"],
  layerScores: { aeo: 75, geo: 62, aio: 55 },
  dimensions: { technicalReadiness: 80, contentReadiness: 70, aiVisibility: 65, citationQuality: 50 },
  auditConfidence: { level: "high", score: 85, successfulProviders: 5, totalProviders: 6 },
  createdAt: new Date("2026-09-30T12:00:00Z"),
};

const mockSnapshot = {
  score: 72,
  grade: "B",
  citationScore: 45,
  generativeShareOfVoice: 38,
  citationLikelihood: 60,
  perplexityScore: 80,
  chatgptScore: 65,
  claudeScore: 70,
  googleAioScore: 55,
  grokScore: 40,
  copilotScore: 30,
  technicalReadiness: 80,
  contentReadiness: 70,
  aiVisibility: 65,
  citationQuality: 50,
  confidenceLevel: "high",
  confidenceScore: 85,
  successfulProviders: 5,
  totalProviders: 6,
  failedChecks: [{ id: "missing-faq", label: "FAQ Schema" }],
  createdAt: new Date("2026-09-30T12:00:00Z"),
};

describe("GET /api/diagnostics/ai-readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCountCallIndex = 0;
    getServerSessionMock.mockResolvedValue({
      user: { email: "test@example.com" },
    });
    userFindUnique.mockResolvedValue(mockUser);
    siteFindUnique.mockResolvedValue(mockSite);
    siteFindFirst.mockResolvedValue({ id: "site-1" });
    aeoReportFindFirst.mockResolvedValue(null);
    aeoSnapshotFindFirst.mockResolvedValue(null);
    aeoSnapshotFindMany.mockResolvedValue([]);
    aeoEventCount.mockResolvedValue(0);
    findingCount.mockResolvedValue(0);
  });

  it("1. returns 401 for unauthenticated requests", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    expect(res.status).toBe(401);
  });

  it("2. returns 404 for nonexistent user", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    expect(res.status).toBe(404);
  });

  it("3. returns 403 when user does not own the site", async () => {
    siteFindUnique.mockResolvedValue({ id: "site-2", userId: "other-user", domain: "evil.com" });
    const res = await GET(makeRequest({ siteId: "site-2" }));
    expect(res.status).toBe(403);
  });

  it("4. returns null-state for user with no sites", async () => {
    siteFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.aeoReport).toBeNull();
    expect(body.snapshot).toBeNull();
    expect(body.siteId).toBeNull();
  });

  it("5. returns existing AEO report data without modification", async () => {
    aeoReportFindFirst.mockResolvedValue(mockReport);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.aeoReport.score).toBe(72);
    expect(body.aeoReport.grade).toBe("B");
    expect(body.aeoReport.citationScore).toBe(45);
    expect(body.aeoReport.generativeShareOfVoice).toBe(38);
    expect(body.aeoReport.layerScores).toEqual({ aeo: 75, geo: 62, aio: 55 });
  });

  it("6. returns existing snapshot with per-platform scores", async () => {
    aeoSnapshotFindFirst.mockResolvedValue(mockSnapshot);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.snapshot.platforms.perplexity).toBe(80);
    expect(body.snapshot.platforms.chatgpt).toBe(65);
    expect(body.snapshot.platforms.claude).toBe(70);
    expect(body.snapshot.platforms.googleAio).toBe(55);
    expect(body.snapshot.platforms.grok).toBe(40);
    expect(body.snapshot.platforms.copilot).toBe(30);
  });

  it("7. returns 4-dimensional readiness from snapshot", async () => {
    aeoSnapshotFindFirst.mockResolvedValue(mockSnapshot);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.snapshot.dimensions.technicalReadiness).toBe(80);
    expect(body.snapshot.dimensions.contentReadiness).toBe(70);
    expect(body.snapshot.dimensions.aiVisibility).toBe(65);
    expect(body.snapshot.dimensions.citationQuality).toBe(50);
  });

  it("8. returns confidence metadata", async () => {
    aeoSnapshotFindFirst.mockResolvedValue(mockSnapshot);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.snapshot.confidence.level).toBe("high");
    expect(body.snapshot.confidence.score).toBe(85);
    expect(body.snapshot.confidence.successfulProviders).toBe(5);
    expect(body.snapshot.confidence.totalProviders).toBe(6);
  });

  it("9. returns citation counts", async () => {
    aeoEventCount
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(45);
    aeoReportFindFirst.mockResolvedValue(mockReport);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.citations.thisMonth).toBe(12);
    expect(body.citations.total).toBe(45);
  });

  it("10. returns AEO trend data in chronological order", async () => {
    aeoSnapshotFindMany.mockResolvedValue([
      { score: 72, citationScore: 45, technicalReadiness: 80, contentReadiness: 70, aiVisibility: 65, citationQuality: 50, createdAt: new Date("2026-09-30") },
      { score: 65, citationScore: 40, technicalReadiness: 75, contentReadiness: 65, aiVisibility: 60, citationQuality: 45, createdAt: new Date("2026-09-01") },
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.trend).toHaveLength(2);
    expect(body.trend[0].score).toBe(65);
    expect(body.trend[1].score).toBe(72);
  });

  it("11. counts unresolved AI-related diagnostic findings", async () => {
    findingCount.mockResolvedValue(3);
    aeoReportFindFirst.mockResolvedValue(mockReport);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.diagnosticReadiness.unresolvedAiFindings).toBe(3);
  });

  it("12. returns null diagnosticReadiness when no AI findings exist", async () => {
    findingCount.mockResolvedValue(0);
    aeoReportFindFirst.mockResolvedValue(mockReport);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.diagnosticReadiness).toBeNull();
  });

  it("13. scopes all queries to authenticated user's site", async () => {
    aeoReportFindFirst.mockResolvedValue(null);
    await GET(makeRequest({ siteId: "site-1" }));

    expect(siteFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "site-1" } })
    );

    const reportCall = aeoReportFindFirst.mock.calls[0][0];
    expect(reportCall.where.siteId).toBe("site-1");
  });

  it("14. does not fabricate a new AI readiness score", async () => {
    aeoReportFindFirst.mockResolvedValue(mockReport);
    aeoSnapshotFindFirst.mockResolvedValue(mockSnapshot);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.aiReadinessScore).toBeUndefined();
    expect(body.readinessScore).toBeUndefined();
    expect(body.compositeScore).toBeUndefined();
  });

  it("15. returns report dimensions when present", async () => {
    aeoReportFindFirst.mockResolvedValue(mockReport);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.aeoReport.dimensions).toEqual({
      technicalReadiness: 80,
      contentReadiness: 70,
      aiVisibility: 65,
      citationQuality: 50,
    });
  });

  it("16. handles empty state when no AEO data exists", async () => {
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.aeoReport).toBeNull();
    expect(body.snapshot).toBeNull();
    expect(body.trend).toEqual([]);
    expect(body.siteId).toBe("site-1");
    expect(body.domain).toBe("example.com");
  });

  it("17. filters unresolved AI findings by specific issue types", async () => {
    findingCount.mockResolvedValue(2);
    aeoReportFindFirst.mockResolvedValue(mockReport);
    await GET(makeRequest({ siteId: "site-1" }));

    const countCall = findingCount.mock.calls[0][0];
    expect(countCall.where.siteId).toBe("site-1");
    expect(countCall.where.lifecycleState).toEqual({ not: "RESOLVED" });
    expect(countCall.where.issueType.in).toContain("MISSING_SCHEMA_MARKUP");
    expect(countCall.where.issueType.in).toContain("THIN_CONTENT");
  });
});
