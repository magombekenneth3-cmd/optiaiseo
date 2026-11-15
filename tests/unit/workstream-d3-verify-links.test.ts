import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  getServerSessionMock,
  checkRateLimitMock,
  inngestSendMock,
  getUserGscTokenMock,
  fetchHtmlMock,
  safeAuditFetchMock,
  userFindUnique,
  siteFindUnique,
  findingFindUnique,
  findingUpdate,
  evidenceFindMany,
  evidenceCreateMany,
  healingLogFindMany,
  proposalFindMany,
  blogFindMany,
  pageAuditFindMany,
  gscDailyPerformanceFindMany,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  inngestSendMock: vi.fn(),
  getUserGscTokenMock: vi.fn(),
  fetchHtmlMock: vi.fn(),
  safeAuditFetchMock: vi.fn(),
  userFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  findingFindUnique: vi.fn(),
  findingUpdate: vi.fn(),
  evidenceFindMany: vi.fn(),
  evidenceCreateMany: vi.fn(),
  healingLogFindMany: vi.fn(),
  proposalFindMany: vi.fn(),
  blogFindMany: vi.fn(),
  pageAuditFindMany: vi.fn(),
  gscDailyPerformanceFindMany: vi.fn(),
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

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: inngestSendMock },
}));

vi.mock("@/lib/gsc/token", () => ({
  getUserGscToken: getUserGscTokenMock,
}));

vi.mock("@/lib/seo-audit/utils/fetch-html", () => ({
  fetchHtml: fetchHtmlMock,
  safeAuditFetch: safeAuditFetchMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    site: { findUnique: siteFindUnique },
    diagnosticFindingRecord: {
      findUnique: findingFindUnique,
      update: findingUpdate,
    },
    sEOEvidenceRecord: {
      findMany: evidenceFindMany,
      createMany: evidenceCreateMany,
    },
    selfHealingLog: { findMany: healingLogFindMany },
    seoFixProposal: { findMany: proposalFindMany },
    blog: { findMany: blogFindMany },
    pageAudit: { findMany: pageAuditFindMany },
    gscDailyPerformance: { findMany: gscDailyPerformanceFindMany },
  },
}));

import {
  findInternalLinkOpportunitiesForTopic,
  resolveCanonicalInternalLinks,
  injectSpecificInternalLink,
} from "@/lib/blog/internalLinks";
import { inspectGscUrl } from "@/lib/gsc/indexing";
import {
  resolveFindingVerificationCriteria,
  resolveVerificationTargetUrl,
  verifyFindingLiveAndPersist,
} from "@/lib/seo-audit/live-verify";
import { POST as verifyLiveRoute } from "@/app/api/diagnostics/[id]/verify/route";
import { GET as getTimelineRoute } from "@/app/api/diagnostics/[id]/timeline/route";

describe("Workstream D3 — Pre-Publish Internal Links, GSC Inspection & Live Verification", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 5, resetAt: new Date() });
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
    evidenceFindMany.mockResolvedValue([]);
    evidenceCreateMany.mockResolvedValue({ count: 1 });
    healingLogFindMany.mockResolvedValue([]);
    proposalFindMany.mockResolvedValue([]);
    blogFindMany.mockResolvedValue([]);
    pageAuditFindMany.mockResolvedValue([]);
    gscDailyPerformanceFindMany.mockResolvedValue([]);
    getUserGscTokenMock.mockRejectedValue(new Error("GSC_NOT_CONNECTED"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("D3.1: PageAudit & GSC inventory internal link discovery and injection", () => {
    it("discovers verified same-origin PageAudit and GSC pages and excludes unhealthy or external URLs", async () => {
      blogFindMany.mockResolvedValue([
        {
          id: "entity-1",
          slug: "seo-consulting",
          title: "Enterprise SEO Consulting",
          targetKeywords: ["enterprise seo consulting"],
          pipelineType: "ENTITY_PAGE",
        },
      ]);

      pageAuditFindMany.mockResolvedValue([
        {
          pageUrl: "https://example.com/solutions/technical-seo-audit",
          overallScore: 91,
          issueList: [],
        },
        {
          pageUrl: "https://example.com/blocked-noindex-page",
          overallScore: 45,
          issueList: [{ id: "meta_noindex", label: "noindex tag found" }],
        },
        {
          pageUrl: "https://example.com/assets/seo-audit-brochure.pdf",
          overallScore: 100,
          issueList: [],
        },
      ]);

      gscDailyPerformanceFindMany.mockResolvedValue([
        {
          url: "https://example.com/features/schema-markup-generator",
          keyword: "schema markup generator",
          clicks: 42,
          impressions: 1200,
        },
        {
          url: "https://external-competitor.com/features/schema-markup-generator",
          keyword: "schema markup generator",
          clicks: 900,
          impressions: 25000,
        },
      ]);

      const opps = await findInternalLinkOpportunitiesForTopic(
        "technical seo audit",
        "site-1",
        "example.com",
        {
          secondaryKeywords: ["schema markup generator", "enterprise seo consulting"],
          title: "Complete Technical SEO Audit Checklist",
        },
      );

      const destinations = opps.map((o) => o.destination);
      expect(destinations).toContain("https://example.com/solutions/technical-seo-audit");
      expect(destinations).toContain("https://example.com/features/schema-markup-generator");
      expect(destinations).toContain("https://example.com/services/seo-consulting");
      expect(destinations).not.toContain("https://example.com/blocked-noindex-page");
      expect(destinations).not.toContain("https://example.com/assets/seo-audit-brochure.pdf");
      expect(destinations.some((d) => d.includes("external-competitor.com"))).toBe(false);
    });

    it("resolves verified PageAudit/GSC URLs alongside Blogs and injects contextual links into draft HTML", async () => {
      blogFindMany.mockResolvedValue([]);
      pageAuditFindMany.mockResolvedValue([
        {
          pageUrl: "https://example.com/solutions/technical-seo-audit",
          overallScore: 93,
          issueList: [],
        },
      ]);
      gscDailyPerformanceFindMany.mockResolvedValue([]);

      const canonical = await resolveCanonicalInternalLinks(
        "site-1",
        [
          {
            destination: "https://example.com/solutions/technical-seo-audit",
            relationship: "keyword",
            anchorConcept: "technical seo audit",
            relevance: 90,
            reason: "verified crawled site page (PageAudit)",
          },
          {
            destination: "https://unverified-external.com/solutions/technical-seo-audit",
            relationship: "keyword",
            anchorConcept: "technical seo audit",
            relevance: 95,
            reason: "external",
          },
        ],
        "new-article-slug",
        "example.com",
      );

      expect(canonical).toHaveLength(1);
      expect(canonical[0].url).toBe("https://example.com/solutions/technical-seo-audit");

      const draftHtml = "<p>Running a thorough technical seo audit before shipping helps catch regressions early.</p>";
      const injected = injectSpecificInternalLink(draftHtml, canonical[0], "example.com");

      expect(injected.linked).toBe(true);
      expect(injected.html).toContain('href="https://example.com/solutions/technical-seo-audit"');
    });
  });

  describe("D3.2: inspectGscUrl wrapper", () => {
    it("returns indexStatusResult details on 200 and falls back to sc-domain on URL-prefix 403", async () => {
      getUserGscTokenMock.mockResolvedValue("ya29.valid-token");

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { status: "PERMISSION_DENIED", message: "User does not own site https://example.com/" },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              inspectionResult: {
                inspectionResultLink: "https://search.google.com/search-console/inspect?...",
                indexStatusResult: {
                  verdict: "PASS",
                  coverageState: "Submitted and indexed",
                  robotsTxtState: "ALLOWED",
                  indexingState: "INDEXING_ALLOWED",
                  lastCrawlTime: "2026-11-10T12:00:00Z",
                  googleCanonical: "https://example.com/pricing",
                  userCanonical: "https://example.com/pricing",
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await inspectGscUrl("user-1", "example.com", "https://example.com/pricing");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.coverageState).toBe("Submitted and indexed");
        expect(result.data.googleCanonical).toBe("https://example.com/pricing");
        expect(result.data.inspectedSiteUrl).toBe("sc-domain:example.com");
      }
    });

    it("handles missing webmasters.readonly scope 403 cleanly without throwing", async () => {
      getUserGscTokenMock.mockResolvedValue("ya29.limited-token");
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              status: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              message: "Request had insufficient authentication scopes (webmasters.readonly required).",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await inspectGscUrl("user-1", "example.com", "https://example.com/pricing");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("PERMISSION_DENIED");
        expect(result.message).toMatch(/webmasters\.readonly/i);
      }
    });

    it("returns AUTH_FAILED when GSC is disconnected", async () => {
      getUserGscTokenMock.mockRejectedValue(new Error("GSC_NOT_CONNECTED"));

      const result = await inspectGscUrl("user-1", "example.com", "https://example.com/pricing");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("AUTH_FAILED");
      }
    });
  });

  describe("D3.3: Live diagnostic verification & T+7 scheduling", () => {
    it("reconstructs criteria from DIAGNOSTIC_RULES when finding.verificationCriteria is empty", () => {
      const reconstructed = resolveFindingVerificationCriteria(
        {
          issueType: "aeo_readiness_llms_txt",
          rootCause: "No /llms.txt file found for AI crawler content discovery",
          verificationCriteria: null,
          scopeUrls: ["https://example.com/"],
        },
        "example.com",
      );

      expect(reconstructed).toEqual([{ type: "HTTP_STATUS", url: "/llms.txt", expected: 200 }]);
    });

    it("blocks cross-origin verification URLs in resolveVerificationTargetUrl", () => {
      expect(() =>
        resolveVerificationTargetUrl("example.com", ["https://example.com/"], "https://attacker.com/steal"),
      ).toThrow(/must belong to the site/i);

      expect(resolveVerificationTargetUrl("example.com", ["/pricing"])).toBe("https://example.com/pricing");
    });

    it("runs live checks, persists T0 evidence, transitions OPEN -> IN_PROGRESS, and schedules T+7", async () => {
      getUserGscTokenMock.mockResolvedValue("ya29.valid-token");
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            inspectionResult: {
              indexStatusResult: {
                verdict: "PASS",
                coverageState: "Submitted and indexed",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as unknown as typeof fetch;

      const updatedAt = new Date("2026-11-14T10:00:00Z");
      findingFindUnique.mockResolvedValue({
        id: "finding-canon-1",
        lifecycleState: "OPEN",
        updatedAt,
      });
      findingUpdate.mockResolvedValue({ id: "finding-canon-1" });

      const fetcher = {
        fetchHtml: vi.fn().mockResolvedValue('<html><head><link rel="canonical" href="https://example.com/post" /></head><body>ok</body></html>'),
        fetchHeaders: vi.fn().mockResolvedValue({}),
        getStatus: vi.fn().mockResolvedValue(200),
      };

      const res = await verifyFindingLiveAndPersist({
        finding: {
          id: "finding-canon-1",
          siteId: "site-1",
          fingerprint: "fp-canon",
          issueType: "canonical_conflict",
          status: "FAIL",
          scopeUrls: ["https://example.com/post"],
          rootCause: "Page has no rel=canonical link tag",
          verificationCriteria: null,
          lifecycleState: "OPEN",
        },
        site: { id: "site-1", userId: "user-1", domain: "example.com" },
        fetcher,
      });

      expect(res.verified).toBe(true);
      expect(res.outcome).toBe("TECHNICALLY_VERIFIED");
      expect(res.status).toBe("WARNING");
      expect(res.lifecycleState).toBe("IN_PROGRESS");
      expect(res.t7Scheduled).toBe(true);
      expect(res.gscInspection?.success).toBe(true);

      expect(evidenceCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              findingId: "finding-canon-1",
              siteId: "site-1",
              source: "HTML",
            }),
          ],
        }),
      );
      expect(inngestSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "seo/fix.t0-verified",
          data: expect.objectContaining({
            siteId: "site-1",
            findingDbId: "finding-canon-1",
            url: "https://example.com/post",
            t0Outcome: "TECHNICALLY_VERIFIED",
          }),
        }),
      );
    });

    it("POST /api/diagnostics/[id]/verify enforces auth, ownership, rate limits, and returns live verification", async () => {
      // 401 when unauthenticated
      getServerSessionMock.mockResolvedValueOnce(null);
      let res = await verifyLiveRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/verify", { method: "POST" }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(401);

      // 403 when finding belongs to a different user
      getServerSessionMock.mockResolvedValue({ user: { email: "owner@example.com" } });
      userFindUnique.mockResolvedValue({ id: "user-1", gscConnected: false });
      findingFindUnique.mockResolvedValue({
        id: "finding-1",
        siteId: "site-other",
        fingerprint: "fp-1",
        issueType: "aeo_readiness_llms_txt",
        status: "FAIL",
        scopeUrls: ["https://other.com/"],
        rootCause: "llms_txt_missing",
        verificationCriteria: null,
        lifecycleState: "OPEN",
      });
      siteFindUnique.mockResolvedValueOnce({ id: "site-other", userId: "user-2", domain: "other.com" });

      res = await verifyLiveRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/verify", { method: "POST" }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(403);

      // 429 when rate limited
      checkRateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: new Date() });
      res = await verifyLiveRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/verify", { method: "POST" }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(429);

      // 200 on valid owner request when live criterion passes
      findingFindUnique.mockResolvedValue({
        id: "finding-1",
        siteId: "site-1",
        fingerprint: "fp-1",
        issueType: "aeo_readiness_llms_txt",
        status: "FAIL",
        scopeUrls: ["https://example.com/"],
        rootCause: "No /llms.txt file found for AI crawler content discovery",
        verificationCriteria: null,
        lifecycleState: "OPEN",
        updatedAt: new Date(),
      });
      siteFindUnique.mockResolvedValue({ id: "site-1", userId: "user-1", domain: "example.com" });
      findingUpdate.mockResolvedValue({ id: "finding-1" });
      safeAuditFetchMock.mockResolvedValue(new Response("# Example\n", { status: 200 }));

      res = await verifyLiveRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/verify", {
          method: "POST",
          body: JSON.stringify({ includeGscInspection: false }),
        }),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.verified).toBe(true);
      expect(body.outcome).toBe("TECHNICALLY_VERIFIED");
      expect(body.t7Scheduled).toBe(true);
    });

    it("timeline API reflects TECHNICALLY_VERIFIED and SEARCH_VERIFIED outcomes as passed", async () => {
      getServerSessionMock.mockResolvedValue({ user: { email: "owner@example.com" } });
      userFindUnique.mockResolvedValue({ id: "user-1" });
      findingFindUnique.mockResolvedValue({
        id: "finding-1",
        siteId: "site-1",
        fingerprint: "fp-1",
        issueType: "canonical_conflict",
        status: "WARNING",
        severity: "high",
        scopeType: "PAGE",
        scopeUrls: ["https://example.com/post"],
        rootCause: "Missing canonical",
        confidence: 0.9,
        expectedOutcome: "Canonical resolves",
        remediationType: "DETERMINISTIC",
        verificationCriteria: [],
        lifecycleState: "RESOLVED",
        resolvedAt: new Date("2026-11-15T12:00:00Z"),
        createdAt: new Date("2026-11-01T10:00:00Z"),
        updatedAt: new Date("2026-11-15T12:00:00Z"),
      });
      siteFindUnique.mockResolvedValue({ userId: "user-1", domain: "example.com" });
      evidenceFindMany.mockResolvedValue([
        {
          id: "ev-t0",
          source: "HTML",
          url: "https://example.com/post",
          observedAt: new Date("2026-11-08T10:00:00Z"),
          observedValue: { verificationType: "T0_TECHNICAL", outcome: "TECHNICALLY_VERIFIED" },
          confidence: 1,
        },
        {
          id: "ev-t7",
          source: "GSC",
          url: "https://example.com/post",
          observedAt: new Date("2026-11-15T12:00:00Z"),
          observedValue: { verificationType: "T7_SEARCH", outcome: "SEARCH_VERIFIED" },
          confidence: 0.85,
        },
      ]);

      const res = await getTimelineRoute(
        new NextRequest("http://localhost/api/diagnostics/finding-1/timeline"),
        { params: Promise.resolve({ id: "finding-1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stages.t0Verification.status).toBe("passed");
      expect(body.stages.t7Verification.status).toBe("passed");
    });
  });
});

