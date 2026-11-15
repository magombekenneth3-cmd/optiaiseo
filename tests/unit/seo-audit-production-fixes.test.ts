import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checklistItemToEvidence,
  categoryResultToEvidence,
  extractDiagnosticFindings,
} from "@/lib/seo-audit/evidence-collector";
import { diagnose } from "@/lib/seo-audit/root-cause-engine";
import { parseRobotsForBot } from "@/lib/seo-audit/modules/ai-visibility";
import { assertSafeAuditUrl, safeAuditFetch } from "@/lib/seo-audit/utils/fetch-html";
import { extractAuditVitalsAndSchema } from "@/lib/audit";
import { parseAuditResult } from "@/lib/seo-audit/parse-audit-result";
import { BasicsAnalyticsModule } from "@/lib/seo-audit/modules/basics";
import type { AuditCategoryResult } from "@/lib/seo-audit/types";

const mockAuditFindUnique = vi.fn();
const mockAuditUpdate = vi.fn();
const mockPageAuditFindMany = vi.fn();
const mockDiagnosticUpdateMany = vi.fn();
const mockWriteMetricSnapshot = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    audit: {
      findUnique: (...args: unknown[]) => mockAuditFindUnique(...args),
      update: (...args: unknown[]) => mockAuditUpdate(...args),
    },
    pageAudit: {
      findMany: (...args: unknown[]) => mockPageAuditFindMany(...args),
    },
    diagnosticFindingRecord: {
      updateMany: (...args: unknown[]) => mockDiagnosticUpdateMany(...args),
    },
  },
}));

vi.mock("@/lib/metrics/metric-snapshot", () => ({
  writeMetricSnapshot: (...args: unknown[]) => mockWriteMetricSnapshot(...args),
}));

describe("SEO Audit Production Fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. EvidenceCollector & Root-Cause Engine Mappings", () => {
    it("maps redirect-chain hops and loop flags so REDIRECT_CHAIN rules fire", () => {
      const ev = checklistItemToEvidence(
        {
          id: "redirect-chain",
          label: "Redirect Chain",
          status: "Warning",
          finding: "Redirect chain: 4 hops",
          details: { hops: 4, hasLoop: false },
        },
        "https://example.com/page",
      );

      const findings = diagnose({
        siteId: "site-1",
        url: "https://example.com/page",
        evidence: [ev],
      });

      expect(findings.some((f) => f.issueType === "redirect_chain" && f.rootCauseId === "long_redirect_chain")).toBe(true);
    });

    it("maps robots-directive-check invalid XML sitemap and URL blocks to SITEMAP_INCOMPLETE and INDEXING_BLOCKED", () => {
      const cat: AuditCategoryResult = {
        id: "technical-seo",
        label: "Technical SEO",
        score: 50,
        passed: 1,
        failed: 1,
        warnings: 0,
        items: [
          {
            id: "robots-directive-check",
            label: "Robots.txt Directive & Sitemap Validation",
            status: "Fail",
            finding: "Blocked and invalid sitemap",
            details: {
              urlBlocked: true,
              validXml: false,
            },
          },
        ],
      };

      const { findings } = extractDiagnosticFindings("site-1", "https://example.com", [cat]);
      expect(findings.some((f) => f.issueType === "indexing_blocked" && f.rootCauseId === "robots_txt_block")).toBe(true);
      expect(findings.some((f) => f.issueType === "sitemap_incomplete" && f.rootCauseId === "sitemap_invalid")).toBe(true);
    });

    it("maps schema-missing-faq to SCHEMA_MISSING.missing_faq with synthetic HTML QA evidence", () => {
      const cat: AuditCategoryResult = {
        id: "schema-markup",
        label: "Schema Markup",
        score: 80,
        passed: 2,
        failed: 0,
        warnings: 0,
        items: [
          {
            id: "schema-missing-faq",
            label: "Schema: FAQPage (Restricted)",
            status: "Info",
            finding: "FAQ pattern detected",
          },
        ],
      };

      const evidence = categoryResultToEvidence(cat, "https://example.com/faq");
      const findings = diagnose({
        siteId: "site-1",
        url: "https://example.com/faq",
        evidence,
      });

      expect(findings.some((f) => f.issueType === "schema_missing" && f.rootCauseId === "missing_faq")).toBe(true);
    });

    it("does not bloat finding.evidence with unrelated HTML checklist items", () => {
      const cat: AuditCategoryResult = {
        id: "on-page-seo",
        label: "On-Page SEO",
        score: 50,
        passed: 5,
        failed: 1,
        warnings: 0,
        items: [
          {
            id: "robots-meta",
            label: "Robots Meta Tag",
            status: "Fail",
            finding: "noindex present",
            details: { robotsContent: "noindex, nofollow" },
          },
          { id: "h1-tag", label: "H1", status: "Pass", finding: "1 H1" },
          { id: "title-tag", label: "Title", status: "Pass", finding: "Good title" },
          { id: "meta-description", label: "Meta Desc", status: "Pass", finding: "Good desc" },
          { id: "og-title", label: "OG Title", status: "Pass", finding: "Present" },
        ],
      };

      const { findings } = extractDiagnosticFindings("site-1", "https://example.com", [cat]);
      const noindexFinding = findings.find((f) => f.rootCauseId === "meta_noindex");
      expect(noindexFinding).toBeDefined();
      expect(noindexFinding!.evidence).toHaveLength(1);
    });
  });

  describe("2. RFC 9309 robots.txt Parser in AiVisibilityModule", () => {
    it("handles stacked User-agent lines in the same group", () => {
      const robotsTxt = [
        "User-agent: GPTBot",
        "User-agent: ClaudeBot",
        "Disallow: /",
      ].join("\n");

      expect(parseRobotsForBot(robotsTxt, "gptbot")).toBe(true);
      expect(parseRobotsForBot(robotsTxt, "claudebot")).toBe(true);
      expect(parseRobotsForBot(robotsTxt, "perplexitybot")).toBe(false);
    });

    it("gives specific User-agent block precedence over trailing wildcard Allow", () => {
      const robotsTxt = [
        "User-agent: GPTBot",
        "Disallow: /",
        "",
        "User-agent: *",
        "Allow: /",
      ].join("\n");

      expect(parseRobotsForBot(robotsTxt, "gptbot")).toBe(true);
      expect(parseRobotsForBot(robotsTxt, "claudebot")).toBe(false);
    });
  });

  describe("3. SSRF Protection in assertSafeAuditUrl & safeAuditFetch", () => {
    it("blocks private IPs, localhost, and non-http protocols before network calls", async () => {
      await expect(assertSafeAuditUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/Blocked SSRF/);
      await expect(assertSafeAuditUrl("http://127.0.0.1:6379/")).rejects.toThrow(/Blocked SSRF/);
      await expect(assertSafeAuditUrl("http://localhost:3000/")).rejects.toThrow(/Blocked SSRF/);
      await expect(assertSafeAuditUrl("file:///etc/passwd")).rejects.toThrow(/Blocked SSRF/);
    });

    it("blocks redirect hops that point to internal metadata endpoints", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
      );

      await expect(safeAuditFetch("https://example.com/redirect")).rejects.toThrow(/Blocked SSRF/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });
  });

  describe("4. Scoring, Vitals & Analytics Fixes", () => {
    it("extractAuditVitalsAndSchema prefers weighted report.aeoScore over raw ai-visibility category score", () => {
      const vitals = extractAuditVitalsAndSchema({
        aeoScore: 84,
        categories: [
          { id: "ai-visibility", score: 60, items: [] },
          { id: "schema-markup", score: 90, items: [] },
        ],
      });

      expect(vitals.aeoScore).toBe(84);
      expect(vitals.schemaScore).toBe(90);
    });

    it("parseAuditResult excludes NotApplicable and Error from fallback category score calculation", () => {
      const parsed = parseAuditResult([
        {
          id: "local-seo",
          label: "Local SEO",
          items: [
            { id: "c1", label: "Check 1", status: "Pass", finding: "ok" },
            { id: "c2", label: "Check 2", status: "NotApplicable", finding: "n/a" },
            { id: "c3", label: "Check 3", status: "Error", finding: "err" },
          ],
        },
      ]);

      expect(parsed.categories[0].score).toBe(100);
    });

    it("BasicsAnalyticsModule recognizes privacy-first analytics (Plausible) without failing", async () => {
      const res = await BasicsAnalyticsModule.run({
        url: "https://example.com",
        html: '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script></head><body></body></html>',
        frameworkHints: [],
      });

      const gaItem = res.items.find((i) => i.id === "google-analytics-ga4");
      const gtmItem = res.items.find((i) => i.id === "gtm-setup");
      expect(gaItem?.status).toBe("Pass");
      expect(gtmItem?.status).toBe("Info");
      expect(res.failed).toBe(0);
    });
  });

  describe("5. Multi-Page Aggregation & Diagnostic Finding Reconciliation", () => {
    it("aggregateMultiPageAuditResults blends homepage and sub-page scores and updates MetricSnapshot", async () => {
      mockAuditFindUnique.mockResolvedValueOnce({
        id: "audit-1",
        categoryScores: { "on-page-seo": 90, "technical-seo": 80 },
        issueList: {
          overallScore: 85,
          categories: [
            { id: "on-page-seo", score: 90, items: [] },
            { id: "technical-seo", score: 80, items: [] },
          ],
          recommendations: [
            { itemId: "meta-description", label: "Meta Description", priority: "High", finding: "Missing on home" },
          ],
        },
        lcp: 1.8,
        cls: 0.05,
        inp: 120,
      });

      mockPageAuditFindMany.mockResolvedValueOnce([
        {
          pageUrl: "https://example.com/pricing",
          overallScore: 55,
          categoryScores: { "on-page-seo": 50 },
          issueList: {
            recommendations: [
              { itemId: "h1-tag", label: "H1 Tag", priority: "High", finding: "Missing H1 on pricing" },
            ],
          },
        },
      ]);

      const { aggregateMultiPageAuditResults } = await import("@/lib/inngest/functions/page-audit");
      await aggregateMultiPageAuditResults("audit-1", "site-1");

      expect(mockAuditUpdate).toHaveBeenCalledTimes(1);
      const updateArg = mockAuditUpdate.mock.calls[0][0];
      expect(updateArg.data.categoryScores["on-page-seo"]).toBe(70); // 50% of 90 + 50% of 50
      expect(updateArg.data.categoryScores["technical-seo"]).toBe(80);
      expect(updateArg.data.issueList.overallScore).toBe(70); // 50% of 85 + 50% of 55
      expect(updateArg.data.issueList.recommendations).toHaveLength(2);
      expect(updateArg.data.issueList.recommendations[1].label).toContain("(/pricing)");
      expect(updateArg.data.issueList.subPageSummary.pagesAudited).toBe(1);
      expect(mockWriteMetricSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: "site-1",
          overallScore: 70,
        }),
      );
    });

    it("reconcileResolvedFindings marks absent fingerprints as PASS with resolvedAt", async () => {
      mockDiagnosticUpdateMany.mockResolvedValueOnce({ count: 2 });
      const { reconcileResolvedFindings } = await import("@/lib/seo-audit/diagnostic-persistence");

      const count = await reconcileResolvedFindings("site-1", ["fp-keep"], "https://example.com");
      expect(count).toBe(2);
      expect(mockDiagnosticUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            siteId: "site-1",
            status: { in: ["FAIL", "WARNING", "UNKNOWN"] },
            fingerprint: { notIn: ["fp-keep"] },
            scopeUrls: { has: "https://example.com" },
          },
          data: expect.objectContaining({
            status: "PASS",
          }),
        }),
      );
    });
  });
});

