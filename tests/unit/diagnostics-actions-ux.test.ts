import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  getServerSessionMock,
  checkRateLimitMock,
  getFixRequirementsMock,
  triggerAutoFixMock,
  pushAuditFixPRMock,
  userFindUnique,
  siteFindUnique,
  siteFindMany,
  siteFindFirst,
  findingFindUnique,
  findingFindMany,
  findingCount,
  findingGroupBy,
  findingUpdate,
  proposalFindMany,
  proposalUpdateMany,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  getFixRequirementsMock: vi.fn(),
  triggerAutoFixMock: vi.fn(),
  pushAuditFixPRMock: vi.fn(),
  userFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  siteFindMany: vi.fn(),
  siteFindFirst: vi.fn(),
  findingFindUnique: vi.fn(),
  findingFindMany: vi.fn(),
  findingCount: vi.fn(),
  findingGroupBy: vi.fn(),
  findingUpdate: vi.fn(),
  proposalFindMany: vi.fn(),
  proposalUpdateMany: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock("@/app/actions/auditFix", () => ({
  getFixRequirements: getFixRequirementsMock,
  triggerAutoFix: triggerAutoFixMock,
  pushAuditFixPR: pushAuditFixPRMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    site: {
      findUnique: siteFindUnique,
      findMany: siteFindMany,
      findFirst: siteFindFirst,
    },
    diagnosticFindingRecord: {
      findUnique: findingFindUnique,
      findMany: findingFindMany,
      count: findingCount,
      groupBy: findingGroupBy,
      update: findingUpdate,
    },
    seoFixProposal: {
      findMany: proposalFindMany,
      updateMany: proposalUpdateMany,
    },
  },
}));

import { matchDiagnosticCause } from "@/lib/seo-audit/live-verify";
import { GET as listDiagnosticsRoute } from "@/app/api/diagnostics/route";
import { POST as fixDiagnosticRoute } from "@/app/api/diagnostics/[id]/fix/route";

describe("Diagnostics Action & Triage UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
    getServerSessionMock.mockResolvedValue({ user: { email: "owner@example.com" } });
    userFindUnique.mockResolvedValue({ id: "user-1", gscConnected: true });
    siteFindMany.mockResolvedValue([
      { id: "site-1", domain: "example.com", githubRepoUrl: "https://github.com/acme/web" },
      { id: "site-2", domain: "blog.example.com", githubRepoUrl: null },
    ]);
    siteFindUnique.mockResolvedValue({
      id: "site-1",
      userId: "user-1",
      domain: "example.com",
      githubRepoUrl: "https://github.com/acme/web",
    });
    findingUpdate.mockResolvedValue({ id: "finding-1" });
    proposalFindMany.mockResolvedValue([]);
    proposalUpdateMany.mockResolvedValue({ count: 1 });
  });

  describe("matchDiagnosticCause", () => {
    it("matches canonical_missing and meta_noindex from issueType and rootCause", () => {
      const canonical = matchDiagnosticCause(
        "canonical_conflict",
        "Page has no rel=canonical link tag",
      );
      expect(canonical?.id).toBe("canonical_missing");

      const noindex = matchDiagnosticCause(
        "indexing_blocked",
        "Meta robots noindex directive blocks indexing",
      );
      expect(noindex?.id).toBe("meta_noindex");
    });

    it("falls back to cause id substring match and returns null for unknown text", () => {
      const fallback = matchDiagnosticCause("custom_issue", "Found canonical_missing during scan");
      expect(fallback?.id).toBe("canonical_missing");

      const unknown = matchDiagnosticCause("unknown_issue_xyz", "completely unrecognized explanation");
      expect(unknown).toBeNull();
    });
  });

  describe("GET /api/diagnostics", () => {
    it("enforces auth (401) and site ownership (403)", async () => {
      getServerSessionMock.mockResolvedValueOnce(null);
      let res = await listDiagnosticsRoute(
        new NextRequest("http://localhost/api/diagnostics"),
      );
      expect(res.status).toBe(401);

      siteFindUnique.mockResolvedValueOnce({
        id: "site-other",
        userId: "user-2",
        domain: "other.com",
        githubRepoUrl: null,
      });
      res = await listDiagnosticsRoute(
        new NextRequest("http://localhost/api/diagnostics?siteId=site-other"),
      );
      expect(res.status).toBe(403);
    });

    it("filters by q, lifecycleState, remediationType and attaches sites, capabilities, and latestProposal", async () => {
      findingFindMany.mockResolvedValue([
        {
          id: "finding-1",
          siteId: "site-1",
          fingerprint: "fp-1",
          issueType: "canonical_conflict",
          status: "FAIL",
          severity: "high",
          scopeType: "PAGE",
          scopeUrls: ["https://example.com/pricing"],
          rootCause: "Page has no rel=canonical link tag",
          confidence: 0.95,
          expectedOutcome: "Canonical resolves cleanly",
          remediationType: "DETERMINISTIC",
          verificationCriteria: [],
          dependencies: [],
          priorityScore: 88,
          priorityComponents: null,
          policyVersion: "v1",
          lifecycleState: "OPEN",
          resolvedAt: null,
          createdAt: new Date("2026-11-14T10:00:00Z"),
          updatedAt: new Date("2026-11-14T10:00:00Z"),
          evidence: [],
        },
      ]);
      findingCount.mockResolvedValue(1);
      findingGroupBy
        .mockResolvedValueOnce([{ status: "FAIL", _count: { status: 2 } }])
        .mockResolvedValueOnce([{ severity: "high", _count: { severity: 2 } }])
        .mockResolvedValueOnce([{ lifecycleState: "OPEN", _count: { lifecycleState: 2 } }]);
      // findingCount called twice (filtered + totalAll via Promise.all)
      findingCount.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      proposalFindMany.mockResolvedValue([
        {
          id: "prop-newest",
          diagnosticFindingId: "finding-1",
          status: "PR_OPEN",
          prUrl: "https://github.com/acme/web/pull/42",
          prNumber: 42,
          filePath: "src/app/pricing/page.tsx",
          deploymentStatus: "PENDING",
          createdAt: new Date("2026-11-15T12:00:00Z"),
        },
        {
          id: "prop-older",
          diagnosticFindingId: "finding-1",
          status: "CLOSED",
          prUrl: "https://github.com/acme/web/pull/10",
          prNumber: 10,
          filePath: "src/app/pricing/page.tsx",
          deploymentStatus: "FAILED",
          createdAt: new Date("2026-11-10T12:00:00Z"),
        },
      ]);

      const res = await listDiagnosticsRoute(
        new NextRequest(
          "http://localhost/api/diagnostics?siteId=site-1&status=FAIL&severity=high&lifecycleState=OPEN&remediationType=DETERMINISTIC&q=canonical",
        ),
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(findingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            siteId: "site-1",
            status: { in: ["FAIL"] },
            severity: { in: ["high"] },
            lifecycleState: { in: ["OPEN"] },
            remediationType: { in: ["DETERMINISTIC"] },
            OR: expect.arrayContaining([
              { issueType: { contains: "canonical", mode: "insensitive" } },
              { rootCause: { contains: "canonical", mode: "insensitive" } },
            ]),
          }),
        }),
      );

      expect(body.sites).toHaveLength(2);
      expect(body.siteCapabilities).toEqual({ hasGithub: true, gscConnected: true });
      expect(body.summary.byLifecycleState).toEqual({ OPEN: 2 });
      expect(body.findings[0].latestProposal).toMatchObject({
        id: "prop-newest",
        prNumber: 42,
        prUrl: "https://github.com/acme/web/pull/42",
      });
    });
  });

  describe("POST /api/diagnostics/[id]/fix", () => {
    const baseFinding = {
      id: "finding-1",
      siteId: "site-1",
      fingerprint: "fp-canon-1",
      issueType: "canonical_conflict",
      status: "FAIL",
      scopeType: "PAGE",
      scopeUrls: ["https://example.com/blog/post-1"],
      rootCause: "Page has no rel=canonical link tag",
      expectedOutcome: "Canonical points to preferred URL",
      remediationType: "DETERMINISTIC",
      verificationCriteria: [{ type: "HTML_SELECTOR", selector: 'link[rel="canonical"]' }],
      lifecycleState: "OPEN",
      updatedAt: new Date("2026-11-14T10:00:00Z"),
    };

    it("enforces auth (401) and site ownership (403)", async () => {
      getServerSessionMock.mockResolvedValueOnce(null);
      let res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "generate" }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(401);

      findingFindUnique.mockResolvedValueOnce(baseFinding);
      siteFindUnique.mockResolvedValueOnce({
        id: "site-1",
        userId: "other-user",
        domain: "example.com",
        githubRepoUrl: null,
      });
      res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "generate" }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(403);
    });

    it("short-circuits requirements for deterministic causes and delegates for non-deterministic causes", async () => {
      findingFindUnique.mockResolvedValue(baseFinding);

      let res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "requirements" }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(200);
      let body = await res.json();
      expect(body.deterministicAvailable).toBe(true);
      expect(body.fields).toEqual([]);
      expect(getFixRequirementsMock).not.toHaveBeenCalled();

      findingFindUnique.mockResolvedValueOnce({
        ...baseFinding,
        issueType: "schema_incomplete",
        rootCause: "Product schema lacks pricing metadata",
        remediationType: "AI_PATCH",
      });
      getFixRequirementsMock.mockResolvedValueOnce({
        success: true,
        fields: [
          {
            key: "businessName",
            label: "Business Name",
            placeholder: "Acme Inc.",
            why: "Required for JSON-LD",
            required: true,
          },
        ],
      });

      res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "requirements" }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(200);
      body = await res.json();
      expect(getFixRequirementsMock).toHaveBeenCalledTimes(1);
      expect(body.fields).toHaveLength(1);
    });

    it("returns instant deterministic manual snippet without GitHub and skips triggerAutoFix", async () => {
      findingFindUnique.mockResolvedValue(baseFinding);
      siteFindUnique.mockResolvedValue({
        id: "site-1",
        userId: "user-1",
        domain: "example.com",
        githubRepoUrl: null,
      });

      const res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "generate" }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(triggerAutoFixMock).not.toHaveBeenCalled();
      expect(body.mode).toBe("manual");
      expect(body.deterministic).toBe(true);
      expect(body.guide.codeSnippet).toContain("canonical");
    });

    it("links SeoFixProposal to DiagnosticFindingRecord when triggerAutoFix returns a review proposal", async () => {
      findingFindUnique.mockResolvedValue(baseFinding);
      triggerAutoFixMock.mockResolvedValueOnce({
        success: true,
        mode: "review",
        proposalId: "prop-123",
        filePath: "src/app/blog/post-1/page.tsx",
        content: "// patch",
        language: "typescript",
        issueLabel: "Canonical Tag Conflict",
      });

      const res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "generate", extraContext: { note: "test" } }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.mode).toBe("review");
      expect(body.proposalId).toBe("prop-123");
      expect(proposalUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prop-123", siteId: "site-1" },
          data: expect.objectContaining({
            diagnosticFindingId: "finding-1",
            findingFingerprint: "fp-canon-1",
          }),
        }),
      );
    });

    it("handles push_pr: validates proposalId, opens PR, links proposal, and transitions OPEN -> IN_PROGRESS", async () => {
      findingFindUnique.mockResolvedValue(baseFinding);

      // Missing proposalId returns 400
      let res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "push_pr" }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(400);

      pushAuditFixPRMock.mockResolvedValueOnce({
        success: true,
        prUrl: "https://github.com/acme/web/pull/99",
      });

      res = await fixDiagnosticRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/fix", {
          method: "POST",
          body: JSON.stringify({ action: "push_pr", proposalId: "prop-123" }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(pushAuditFixPRMock).toHaveBeenCalledWith("site-1", "prop-123");
      expect(proposalUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prop-123", siteId: "site-1" },
          data: expect.objectContaining({
            diagnosticFindingId: "finding-1",
            findingFingerprint: "fp-canon-1",
          }),
        }),
      );
      expect(findingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lifecycleState: "IN_PROGRESS",
          }),
        }),
      );
      expect(body).toEqual({
        success: true,
        mode: "pr",
        prUrl: "https://github.com/acme/web/pull/99",
        lifecycleState: "IN_PROGRESS",
      });
    });
  });
});

