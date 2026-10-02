import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getServerSessionMock,
  userFindUnique,
  siteFindUnique,
  siteFindFirst,
  findingFindMany,
  findingCount7,
  findingCount30,
  findingCount90,
  findingCountAll,
  evidenceFindMany,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  siteFindFirst: vi.fn(),
  findingFindMany: vi.fn(),
  findingCount7: vi.fn(),
  findingCount30: vi.fn(),
  findingCount90: vi.fn(),
  findingCountAll: vi.fn(),
  evidenceFindMany: vi.fn(),
}));

let countCallIndex = 0;

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
    diagnosticFindingRecord: {
      findMany: findingFindMany,
      count: (...args: unknown[]) => {
        const fns = [findingCount7, findingCount30, findingCount90, findingCountAll];
        return fns[countCallIndex++](...args);
      },
    },
    sEOEvidenceRecord: { findMany: evidenceFindMany },
  },
}));

import { GET } from "@/app/api/diagnostics/health/route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/diagnostics/health");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

const mockUser = { id: "user-1" };
const mockSite = { id: "site-1", userId: "user-1", domain: "example.com" };

function makeFinding(overrides: Partial<{
  id: string;
  status: string;
  severity: string;
  lifecycleState: string;
  resolvedAt: Date | null;
}> = {}) {
  return {
    id: overrides.id ?? "f-1",
    status: overrides.status ?? "FAIL",
    severity: overrides.severity ?? "high",
    lifecycleState: overrides.lifecycleState ?? "OPEN",
    resolvedAt: overrides.resolvedAt !== undefined ? overrides.resolvedAt : null,
  };
}

function makeEvidence(findingId: string, verificationType: string | null, outcome: string | null) {
  return {
    findingId,
    observedValue: verificationType
      ? { verificationType, outcome }
      : { someField: "value" },
  };
}

describe("GET /api/diagnostics/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countCallIndex = 0;
    getServerSessionMock.mockResolvedValue({
      user: { email: "test@example.com" },
    });
    userFindUnique.mockResolvedValue(mockUser);
    siteFindUnique.mockResolvedValue(mockSite);
    siteFindFirst.mockResolvedValue({ id: "site-1" });
    findingFindMany.mockResolvedValue([]);
    findingCount7.mockResolvedValue(0);
    findingCount30.mockResolvedValue(0);
    findingCount90.mockResolvedValue(0);
    findingCountAll.mockResolvedValue(0);
    evidenceFindMany.mockResolvedValue([]);
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

  it("4. returns zero-state for user with no sites", async () => {
    siteFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.totalFindings).toBe(0);
    expect(body.siteId).toBeNull();
    expect(body.severity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it("5. aggregates severity distribution for active findings only", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ id: "f1", status: "FAIL", severity: "critical" }),
      makeFinding({ id: "f2", status: "FAIL", severity: "high" }),
      makeFinding({ id: "f3", status: "WARNING", severity: "medium" }),
      makeFinding({ id: "f4", status: "PASS", severity: "low" }),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.severity.critical).toBe(1);
    expect(body.severity.high).toBe(1);
    expect(body.severity.medium).toBe(1);
    expect(body.severity.low).toBe(0);
  });

  it("6. aggregates lifecycle distribution for all findings", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ lifecycleState: "OPEN" }),
      makeFinding({ id: "f2", lifecycleState: "OPEN" }),
      makeFinding({ id: "f3", lifecycleState: "IN_PROGRESS" }),
      makeFinding({ id: "f4", lifecycleState: "RESOLVED" }),
      makeFinding({ id: "f5", lifecycleState: "REGRESSED" }),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.lifecycle.OPEN).toBe(2);
    expect(body.lifecycle.IN_PROGRESS).toBe(1);
    expect(body.lifecycle.RESOLVED).toBe(1);
    expect(body.lifecycle.REGRESSED).toBe(1);
    expect(body.lifecycle.UNKNOWN).toBe(0);
  });

  it("7. returns resolution velocity counts", async () => {
    findingCount7.mockResolvedValue(2);
    findingCount30.mockResolvedValue(5);
    findingCount90.mockResolvedValue(12);
    findingCountAll.mockResolvedValue(15);
    findingFindMany.mockResolvedValue([makeFinding()]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.resolution.last7d).toBe(2);
    expect(body.resolution.last30d).toBe(5);
    expect(body.resolution.last90d).toBe(12);
    expect(body.resolution.total).toBe(15);
  });

  it("8. aggregates T+0 verification outcomes", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    evidenceFindMany.mockResolvedValue([
      makeEvidence("f1", "T0_CHECK", "improved"),
      makeEvidence("f2", "T0_CHECK", "degraded"),
      makeEvidence("f3", "T0_CHECK", null),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.verification.t0.passed).toBe(1);
    expect(body.verification.t0.failed).toBe(1);
    expect(body.verification.t0.pending).toBe(1);
    expect(body.verification.t0.total).toBe(3);
  });

  it("9. aggregates T+7 verification outcomes", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    evidenceFindMany.mockResolvedValue([
      makeEvidence("f1", "T7_STABILITY", "passed"),
      makeEvidence("f2", "T7_STABILITY", "inconclusive"),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.verification.t7.passed).toBe(1);
    expect(body.verification.t7.insufficient).toBe(1);
    expect(body.verification.t7.total).toBe(2);
  });

  it("10. aggregates T+28 verification outcomes", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    evidenceFindMany.mockResolvedValue([
      makeEvidence("f1", "T28_IMPACT", "failed"),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.verification.t28.failed).toBe(1);
    expect(body.verification.t28.total).toBe(1);
  });

  it("11. handles insufficient/inconclusive verification data correctly", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    evidenceFindMany.mockResolvedValue([
      makeEvidence("f1", "T0_CHECK", "neutral"),
      makeEvidence("f2", "T7_STABILITY", "inconclusive"),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.verification.t0.insufficient).toBe(1);
    expect(body.verification.t7.insufficient).toBe(1);
  });

  it("12. returns zero verification when no evidence exists (not failed)", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    evidenceFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.verification.t0.total).toBe(0);
    expect(body.verification.t7.total).toBe(0);
    expect(body.verification.t28.total).toBe(0);
    expect(body.verification.t0.failed).toBe(0);
  });

  it("13. counts REGRESSED findings in lifecycle (not as resolved)", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ id: "f1", lifecycleState: "REGRESSED", status: "FAIL" }),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.lifecycle.REGRESSED).toBe(1);
    expect(body.lifecycle.RESOLVED).toBe(0);
    expect(body.severity.high).toBe(1);
  });

  it("14. exposes sample size alongside verification totals", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    evidenceFindMany.mockResolvedValue([
      makeEvidence("f1", "T0_CHECK", "improved"),
      makeEvidence("f2", "T0_CHECK", "improved"),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.verification.t0.total).toBe(2);
    expect(body.verification.t0.passed).toBe(2);
    expect(body.verification.t0.total).toBeGreaterThan(0);
  });

  it("15. returns zero-findings state distinctly from error", async () => {
    findingFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalFindings).toBe(0);
    expect(body.severity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it("16. scopes queries to authenticated user's site only", async () => {
    findingFindMany.mockResolvedValue([]);
    await GET(makeRequest({ siteId: "site-1" }));

    expect(siteFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "site-1" } })
    );
    expect(findingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: "site-1" } })
    );
  });

  it("17. does not fabricate a composite health score", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ id: "f1", severity: "critical" }),
      makeFinding({ id: "f2", severity: "high" }),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.healthScore).toBeUndefined();
    expect(body.score).toBeUndefined();
    expect(body.compositeScore).toBeUndefined();
  });

  it("18. uses deterministic date windows for resolution velocity", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    await GET(makeRequest({ siteId: "site-1" }));

    expect(findingCount7).toHaveBeenCalledTimes(1);
    expect(findingCount30).toHaveBeenCalledTimes(1);
    expect(findingCount90).toHaveBeenCalledTimes(1);
    expect(findingCountAll).toHaveBeenCalledTimes(1);

    const args7 = findingCount7.mock.calls[0][0];
    expect(args7.where.resolvedAt).toBeDefined();
    expect(args7.where.resolvedAt.gte).toBeInstanceOf(Date);
  });

  it("19. ignores non-verification evidence in verification aggregation", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    evidenceFindMany.mockResolvedValue([
      makeEvidence("f1", null, null),
      makeEvidence("f1", null, null),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.verification.t0.total).toBe(0);
    expect(body.verification.t7.total).toBe(0);
    expect(body.verification.t28.total).toBe(0);
  });
});
