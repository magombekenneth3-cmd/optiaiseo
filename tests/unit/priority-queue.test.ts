import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getServerSessionMock,
  userFindUnique,
  siteFindUnique,
  siteFindFirst,
  findingFindMany,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  siteFindFirst: vi.fn(),
  findingFindMany: vi.fn(),
}));

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
    diagnosticFindingRecord: { findMany: findingFindMany },
  },
}));

import { GET } from "@/app/api/diagnostics/priority/route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/diagnostics/priority");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

const mockUser = { id: "user-1" };
const mockSite = { id: "site-1", userId: "user-1", domain: "example.com" };

const makeFinding = (overrides: Partial<{
  id: string;
  status: string;
  severity: string;
  lifecycleState: string;
  priorityScore: number | null;
  createdAt: Date;
}> = {}) => ({
  id: overrides.id ?? "finding-1",
  fingerprint: "fp-1",
  issueType: "missing_meta_description",
  status: overrides.status ?? "FAIL",
  severity: overrides.severity ?? "high",
  rootCause: "Missing meta description",
  confidence: 0.9,
  expectedOutcome: "Meta description present",
  remediationType: "DETERMINISTIC",
  priorityScore: overrides.priorityScore !== undefined ? overrides.priorityScore : 85,
  lifecycleState: overrides.lifecycleState ?? "OPEN",
  createdAt: overrides.createdAt ?? new Date("2026-09-01"),
});

describe("GET /api/diagnostics/priority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: { email: "test@example.com" },
    });
    userFindUnique.mockResolvedValue(mockUser);
    siteFindUnique.mockResolvedValue(mockSite);
    siteFindFirst.mockResolvedValue({ id: "site-1" });
    findingFindMany.mockResolvedValue([]);
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

  it("4. returns empty findings for user with no sites", async () => {
    siteFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.findings).toEqual([]);
    expect(body.siteId).toBeNull();
  });

  it("5. returns findings ordered by priorityScore DESC", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ id: "f1", priorityScore: 95 }),
      makeFinding({ id: "f2", priorityScore: 80 }),
      makeFinding({ id: "f3", priorityScore: 60 }),
    ]);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.findings).toHaveLength(3);
    expect(body.findings[0].id).toBe("f1");
    expect(body.findings[1].id).toBe("f2");
    expect(body.findings[2].id).toBe("f3");
  });

  it("6. excludes RESOLVED findings via WHERE clause", async () => {
    await GET(makeRequest({ siteId: "site-1" }));

    const callArgs = findingFindMany.mock.calls[0][0];
    expect(callArgs.where.lifecycleState).toEqual({ not: "RESOLVED" });
  });

  it("7. only includes FAIL and WARNING status", async () => {
    await GET(makeRequest({ siteId: "site-1" }));

    const callArgs = findingFindMany.mock.calls[0][0];
    expect(callArgs.where.status).toEqual({ in: ["FAIL", "WARNING"] });
  });

  it("8. uses deterministic ordering with priorityScore DESC and createdAt DESC in query", async () => {
    await GET(makeRequest({ siteId: "site-1" }));

    const callArgs = findingFindMany.mock.calls[0][0];
    expect(callArgs.orderBy).toEqual([
      { priorityScore: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ]);
  });

  it("8b. applies correct severity weight for tied priority scores", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ id: "f-low", priorityScore: 50, severity: "low" }),
      makeFinding({ id: "f-critical", priorityScore: 50, severity: "critical" }),
      makeFinding({ id: "f-medium", priorityScore: 50, severity: "medium" }),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.findings[0].id).toBe("f-critical");
    expect(body.findings[1].id).toBe("f-medium");
    expect(body.findings[2].id).toBe("f-low");
  });

  it("9. includes findings with null priority scores without error", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ id: "f1", priorityScore: 85 }),
      makeFinding({ id: "f2", priorityScore: null }),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.findings).toHaveLength(2);
    expect(body.findings[0].priorityScore).toBe(85);
    expect(body.findings[1].priorityScore).toBeNull();
  });

  it("10. defaults to limit=5 and caps at 10", async () => {
    await GET(makeRequest({ siteId: "site-1" }));
    let callArgs = findingFindMany.mock.calls[0][0];
    expect(callArgs.take).toBe(5);

    findingFindMany.mockClear();
    await GET(makeRequest({ siteId: "site-1", limit: "20" }));
    callArgs = findingFindMany.mock.calls[0][0];
    expect(callArgs.take).toBe(10);
  });

  it("11. falls back to first site when no siteId provided", async () => {
    siteFindFirst.mockResolvedValue({ id: "fallback-site" });
    siteFindUnique.mockResolvedValue({ id: "fallback-site", userId: "user-1", domain: "fallback.com" });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(siteFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" },
    }));
    expect(body.siteId).toBe("fallback-site");
  });

  it("12. returns siteId and domain in response", async () => {
    findingFindMany.mockResolvedValue([makeFinding()]);
    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.siteId).toBe("site-1");
    expect(body.domain).toBe("example.com");
  });

  it("13. preserves existing attention queue items (non-interference test)", async () => {
    findingFindMany.mockResolvedValue([
      makeFinding({ id: "diag-1" }),
    ]);

    const res = await GET(makeRequest({ siteId: "site-1" }));
    const body = await res.json();

    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].id).toBe("diag-1");
  });
});
