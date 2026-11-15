import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetServerSession,
  mockRateLimit,
  mockGetRepositoryFile,
  mockCreateAutoFixPR,
  mockPrisma,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRateLimit: vi.fn(),
  mockGetRepositoryFile: vi.fn(),
  mockCreateAutoFixPR: vi.fn(),
  mockPrisma: {
    site: { findFirst: vi.fn() },
    audit: { findFirst: vi.fn() },
    pageAudit: { findMany: vi.fn() },
    blog: { findMany: vi.fn() },
    brandFact: { findMany: vi.fn() },
    gscDailyPerformance: { findMany: vi.fn() },
    aeoReport: { findFirst: vi.fn() },
    account: { findFirst: vi.fn() },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mockRateLimit,
}));

vi.mock("@/lib/github", () => ({
  getRepositoryFile: mockGetRepositoryFile,
  createAutoFixPR: mockCreateAutoFixPR,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  buildLlmsTxtMarkdown,
  extractFaqEntriesFromJsonLd,
  validateLlmsTxtCompliance,
} from "@/lib/seo-audit/llms-txt";
import { DETERMINISTIC_FIXES } from "@/lib/seo-audit/deterministic-fixes";
import { applyAstFixPlan } from "@/lib/ast/executor";
import {
  generateLlmsTxtForSite,
  normalizeDomainLookup,
} from "@/lib/aeo/llms-txt-generator";
import { GET as getLlmsTxtRoute } from "@/app/api/llms-txt/route";
import {
  createLlmsTxtPR,
  getLlmsTxtExportData,
} from "@/app/actions/llmsTxt";

function seedFullSiteData(overrides?: {
  site?: Partial<{
    id: string;
    domain: string;
    brandName: string | null;
    targetKeyword: string | null;
    coreServices: string | null;
    techStack: string | null;
    niche: string | null;
    githubRepoUrl: string | null;
  }>;
}) {
  mockPrisma.site.findFirst.mockResolvedValue({
    id: "site-123",
    domain: "example.com",
    brandName: "Acme AI",
    targetKeyword: "ai visibility",
    coreServices: "Automated SEO and Answer Engine Optimization",
    techStack: "Next.js",
    niche: "SaaS",
    githubRepoUrl: "https://github.com/acme/web",
    ...overrides?.site,
  });

  mockPrisma.audit.findFirst.mockResolvedValue({
    id: "audit-1",
    issueList: {
      pageGraph: {
        url: "https://example.com/",
        title: "Acme AI — Visibility Platform",
        metaDescription: "Measure and improve citations in ChatGPT and Perplexity.",
        h1: "Own Your AI Search Presence",
        isNoindex: false,
        outboundInternalLinks: [],
      },
      issues: [],
      modules: {},
    },
  });

  mockPrisma.pageAudit.findMany.mockResolvedValue([
    {
      pageUrl: "https://example.com/pricing?utm_source=test",
      issueList: {
        pageGraph: {
          url: "https://example.com/pricing?utm_source=test",
          title: "Pricing — Acme AI",
          metaDescription: "Transparent plans for startups and agencies.",
          h1: "Simple Pricing",
          isNoindex: false,
          outboundInternalLinks: [],
        },
        issues: [],
      },
    },
    {
      pageUrl: "https://example.com/internal-admin",
      issueList: {
        pageGraph: {
          url: "https://example.com/internal-admin",
          title: "Admin Panel",
          metaDescription: "Private internal dashboard",
          h1: "Admin",
          isNoindex: true,
          outboundInternalLinks: [],
        },
        issues: [],
      },
    },
    {
      pageUrl: "https://example.com/blog/aeo-checklist",
      issueList: {
        pageGraph: {
          url: "https://example.com/blog/aeo-checklist",
          title: "AEO Checklist Guide (From Crawl)",
          metaDescription: "Updated meta description from crawl",
          h1: "AEO Checklist",
          isNoindex: false,
          outboundInternalLinks: [],
        },
        issues: [],
      },
    },
  ]);

  const faqSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is llms.txt?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "<p>A structured markdown file helping AI assistants index canonical site knowledge accurately.</p>",
        },
      },
    ],
  });

  mockPrisma.blog.findMany.mockResolvedValue([
    {
      title: "Complete AEO Checklist",
      slug: "aeo-checklist",
      content:
        "# Complete AEO Checklist\n\nAnswer Engine Optimization ensures AI assistants cite your **verified** data accurately across ChatGPT, Perplexity, and Gemini.",
      metaDescription: "Step-by-step guide to improving AI engine citations.",
      targetKeywords: "answer engine optimization, aeo checklist",
      schemaMarkup: faqSchema,
      wordPressUrl: null,
      ghostUrl: null,
    },
    {
      title: "Hidden Draft Post",
      slug: "internal-admin",
      content: "Should be skipped if slug matches noindex URL? Note path differs (/blog/internal-admin).",
      metaDescription: "Visible post because path differs from /internal-admin.",
      targetKeywords: "ai indexing",
      schemaMarkup: null,
      wordPressUrl: "https://example.com/internal-admin",
      ghostUrl: null,
    },
  ]);

  mockPrisma.brandFact.findMany.mockResolvedValue([
    {
      factType: "Founded",
      value: "2024 in San Francisco",
      sourceUrl: "https://example.com/about",
      verified: true,
    },
    {
      factType: "Founded",
      value: "2024 in San Francisco",
      sourceUrl: "https://example.com/duplicate",
      verified: false,
    },
  ]);

  mockPrisma.gscDailyPerformance.findMany.mockResolvedValue([
    {
      keyword: "answer engine optimization",
      url: "https://example.com/blog/aeo-checklist",
      clicks: 42,
      impressions: 900,
    },
    {
      keyword: "answer engine optimization",
      url: "https://example.com/pricing",
      clicks: 8,
      impressions: 120,
    },
  ]);

  mockPrisma.aeoReport.findFirst.mockResolvedValue({
    score: 84,
    grade: "A-",
    citationLikelihood: 0.78,
    generativeShareOfVoice: 64,
  });
}

describe("Workstream D1 — Full-Site llms.txt & llms-full.txt Generator & Export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue(null);
  });

  describe("Pure builder, FAQ extractor, and compliance validation", () => {
    it("produces AiVisibilityModule-compliant output even for an un-crawled starter site", () => {
      const md = buildLlmsTxtMarkdown({
        domain: "starter.dev",
        generatedDate: "2026-11-15",
      });
      const compliance = validateLlmsTxtCompliance(md);

      expect(compliance.valid).toBe(true);
      expect(compliance.quality).toBe("good");
      expect(compliance.hasSiteHeader).toBe(true);
      expect(compliance.hasDescription).toBe(true);
      expect(compliance.pageEntries).toBeGreaterThanOrEqual(3);
      expect(md).toContain("> https://starter.dev");
    });

    it("deduplicates tracking variants, rejects foreign domains, and renders full abstracts when full=true", () => {
      const mdFull = buildLlmsTxtMarkdown({
        domain: "example.com",
        brandName: "Acme AI",
        full: true,
        generatedDate: "2026-11-15",
        pages: [
          {
            url: "https://example.com/pricing?utm_medium=cpc",
            title: "Pricing",
            summary: "Plans and tiers",
            section: "core",
          },
          {
            url: "https://example.com/pricing/",
            title: "Pricing Plans",
            summary: "Full transparent plans for startups and agencies.",
            section: "core",
          },
          {
            url: "https://evil-competitor.com/spam",
            title: "Foreign Domain",
            summary: "Must be excluded",
            section: "core",
          },
          {
            url: "https://example.com/blog/guide",
            title: "AEO Guide",
            summary: "Deep dive on AEO",
            abstract:
              "Comprehensive guide covering schema markup, verified brand facts, and llms.txt indexing for LLMs.",
            section: "blog",
          },
        ],
        faqs: [
          {
            question: "How often is llms.txt refreshed?",
            answer: "Automatically whenever new pages or blogs are published.",
          },
        ],
      });

      const pricingOccurrences = mdFull.match(/https:\/\/example\.com\/pricing/g) ?? [];
      expect(pricingOccurrences.length).toBe(1);
      expect(mdFull).not.toContain("evil-competitor.com");
      expect(mdFull).toContain("(Full index: llms-full.txt)");
      expect(mdFull).toContain("## Frequently Asked Questions (Full)");
      expect(mdFull).toContain("## Page Abstracts & Key Context");
      expect(mdFull).toContain("Comprehensive guide covering schema markup");
    });

    it("extracts FAQPage Q&A pairs cleanly from @graph JSON-LD", () => {
      const faqs = extractFaqEntriesFromJsonLd(
        JSON.stringify({
          "@graph": [
            { "@type": "Organization", name: "Acme" },
            {
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "Does RankPulse support llms-full.txt?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "<strong>Yes</strong>, both standard and full files are generated.",
                  },
                },
              ],
            },
          ],
        }),
      );

      expect(faqs).toEqual([
        {
          question: "Does RankPulse support llms-full.txt?",
          answer: "Yes, both standard and full files are generated.",
        },
      ]);
    });
  });

  describe("DETERMINISTIC_FIXES.llms_txt_missing & AST execution", () => {
    it("unifies deterministic fix output with AST language llms_txt and validates on reparse", () => {
      const fix = DETERMINISTIC_FIXES.llms_txt_missing({
        url: "https://example.com/pricing",
        domain: "example.com",
        title: "Acme AI",
        metaDescription: "AI Visibility Software",
        discoveredUrls: ["https://example.com/pricing", "https://example.com/docs"],
      });

      expect(fix).not.toBeNull();
      if (!fix) return;

      const ops = fix.astOperations ?? [];
      expect(fix.filePath).toBe("public/llms.txt");
      expect(fix.astLanguage).toBe("llms_txt");
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("setLlmsTxtDocument");

      const prepared = applyAstFixPlan("", {
        version: 1,
        findingFingerprint: "llms_txt_missing",
        filePath: fix.filePath!,
        baseBlobSha: "NEW_FILE",
        language: fix.astLanguage!,
        operations: ops,
        rationale: fix.description,
        risk: fix.risk,
        verification: fix.verification,
      });

      expect(prepared.serializedContent).toBe(fix.patch);
      expect(prepared.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(validateLlmsTxtCompliance(prepared.serializedContent).valid).toBe(true);
    });

    it("fails closed when AST plan for llms_txt has empty or unsupported operations", () => {
      expect(() =>
        applyAstFixPlan("", {
          version: 1,
          findingFingerprint: "llms_txt_missing",
          filePath: "public/llms.txt",
          baseBlobSha: "NEW_FILE",
          language: "llms_txt",
          operations: [],
          rationale: "Empty",
          risk: "SAFE",
          verification: [],
        }),
      ).toThrow(/AST_MUTATION_FAILED/);

      expect(() =>
        applyAstFixPlan("", {
          version: 1,
          findingFingerprint: "llms_txt_missing",
          filePath: "public/llms.txt",
          baseBlobSha: "NEW_FILE",
          language: "llms_txt",
          operations: [
            { kind: "setObjectProperty", target: "metadata", property: "title", value: "Acme" },
          ],
          rationale: "Wrong op kind",
          risk: "SAFE",
          verification: [],
        }),
      ).toThrow(/AST_MUTATION_UNSUPPORTED/);
    });
  });

  describe("generateLlmsTxtForSite & GET /api/llms-txt route", () => {
    it("normalizes domains safely and aggregates Crawl, Blog, BrandFact, GSC, FAQ, and AEO data while excluding noindex", async () => {
      expect(normalizeDomainLookup("HTTPS://WWW.Example.com/pricing?a=1")).toBe("example.com");

      seedFullSiteData();
      const result = await generateLlmsTxtForSite("site-123", { full: true });

      expect(result).not.toBeNull();
      expect(result!.compliance.valid).toBe(true);
      expect(result!.stats).toEqual({
        corePages: 2,
        blogPosts: 1,
        brandFacts: 1,
        faqs: 1,
        topQueries: 1,
        hasAeoSummary: true,
      });

      expect(result!.content).toContain("# Acme AI");
      expect(result!.content).toContain("https://example.com/pricing");
      expect(result!.content).toContain("https://example.com/blog/aeo-checklist");
      expect(result!.content).not.toContain("/internal-admin");
      expect(result!.content).toContain("Founded: 2024 in San Francisco [Verified]");
      expect(result!.content).toContain("What is llms.txt?");
      expect(result!.content).toContain(
        "[answer engine optimization](https://example.com/blog/aeo-checklist)",
      );
      expect(result!.content).toContain("AEO Score: 84/100 (Grade: A-)");
    });

    it("enforces domain validation (400/404) and serves standard, ?format=full, and ?download=1 responses", async () => {
      const missingRes = await getLlmsTxtRoute(
        new NextRequest("http://localhost:3000/api/llms-txt"),
      );
      expect(missingRes.status).toBe(400);

      const shortRes = await getLlmsTxtRoute(
        new NextRequest("http://localhost:3000/api/llms-txt?domain=ai"),
      );
      expect(shortRes.status).toBe(400);
      expect(mockPrisma.site.findFirst).not.toHaveBeenCalled();

      mockPrisma.site.findFirst.mockResolvedValueOnce(null);
      const notFoundRes = await getLlmsTxtRoute(
        new NextRequest("http://localhost:3000/api/llms-txt?domain=missing-domain.io"),
      );
      expect(notFoundRes.status).toBe(404);

      seedFullSiteData();
      const fullDownloadRes = await getLlmsTxtRoute(
        new NextRequest(
          "http://localhost:3000/api/llms-txt?domain=https://www.Example.com&format=full&download=1",
        ),
      );
      expect(fullDownloadRes.status).toBe(200);
      expect(fullDownloadRes.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(fullDownloadRes.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(fullDownloadRes.headers.get("Cache-Control")).toBe("private, no-store");
      expect(fullDownloadRes.headers.get("Content-Disposition")).toBe(
        'attachment; filename="llms-full.txt"',
      );

      const body = await fullDownloadRes.text();
      expect(body).toContain("(Full index: llms-full.txt)");
      expect(body).toContain("## Page Abstracts & Key Context");
    });
  });

  describe("Server Actions: getLlmsTxtExportData & createLlmsTxtPR", () => {
    it("enforces auth, site ownership, repo config, GitHub token, and rate limit", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const unauth = await getLlmsTxtExportData("site-123");
      expect(unauth).toEqual({ success: false, error: "Unauthorized" });

      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "dev@example.com" },
      });
      mockRateLimit.mockResolvedValueOnce(new Response("Too many", { status: 429 }));
      const limitedRes = await createLlmsTxtPR({ siteId: "site-123" });
      expect(limitedRes.success).toBe(false);
      if (!limitedRes.success) {
        expect(limitedRes.error).toMatch(/Rate limit/i);
      }

      mockPrisma.site.findFirst.mockResolvedValueOnce({
        id: "site-123",
        domain: "example.com",
        githubRepoUrl: null,
      });
      const noRepoRes = await createLlmsTxtPR({ siteId: "site-123" });
      expect(noRepoRes.success).toBe(false);
      if (!noRepoRes.success) {
        expect(noRepoRes.error).toMatch(/No GitHub repository connected/i);
      }

      mockPrisma.site.findFirst.mockResolvedValueOnce({
        id: "site-123",
        domain: "example.com",
        githubRepoUrl: "https://github.com/acme/web",
      });
      mockPrisma.account.findFirst.mockResolvedValueOnce(null);
      const noTokenRes = await createLlmsTxtPR({ siteId: "site-123" });
      expect(noTokenRes.success).toBe(false);
      if (!noTokenRes.success) {
        expect(noTokenRes.error).toMatch(/GitHub account not connected/i);
      }
    });

    it("prepares AST-verified public/llms.txt and public/llms-full.txt changes and creates a PR", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "dev@example.com" },
      });
      seedFullSiteData();
      mockPrisma.account.findFirst.mockResolvedValue({
        access_token: "gho_test_token",
      });

      mockGetRepositoryFile
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({
          exists: true,
          sha: "blob-full-existing-1",
          content: "# Outdated llms-full.txt",
        });

      mockCreateAutoFixPR.mockResolvedValue({
        success: true,
        prUrl: "https://github.com/acme/web/pull/42",
        prNumber: 42,
      });

      const prResult = await createLlmsTxtPR({ siteId: "site-123", includeFull: true });

      expect(prResult).toEqual({
        success: true,
        prUrl: "https://github.com/acme/web/pull/42",
        files: ["public/llms.txt", "public/llms-full.txt"],
      });

      expect(mockCreateAutoFixPR).toHaveBeenCalledTimes(1);
      const [repoUrl, files, domain, token, email, , passedSiteId] =
        mockCreateAutoFixPR.mock.calls[0];
      expect(repoUrl).toBe("https://github.com/acme/web");
      expect(domain).toBe("example.com");
      expect(token).toBe("gho_test_token");
      expect(email).toBe("dev@example.com");
      expect(passedSiteId).toBe("site-123");
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe("public/llms.txt");
      expect(files[0].astPreparedChange.baseBlobSha).toBe("NEW_FILE");
      expect(files[0].astPreparedChange.language).toBe("llms_txt");
      expect(files[1].path).toBe("public/llms-full.txt");
      expect(files[1].astPreparedChange.baseBlobSha).toBe("blob-full-existing-1");
      expect(files[1].astPreparedChange.language).toBe("llms_txt");
    });

    it("skips empty PR creation when repository files already match generated content", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-1", email: "dev@example.com" },
      });
      seedFullSiteData();

      const preview = await getLlmsTxtExportData("site-123");
      expect(preview.success).toBe(true);
      if (!preview.success) return;

      mockPrisma.account.findFirst.mockResolvedValue({
        access_token: "gho_test_token",
      });

      mockGetRepositoryFile
        .mockResolvedValueOnce({
          exists: true,
          sha: "sha-1",
          content: preview.data.standardContent,
        })
        .mockResolvedValueOnce({
          exists: true,
          sha: "sha-2",
          content: preview.data.fullContent,
        });

      const prResult = await createLlmsTxtPR({ siteId: "site-123", includeFull: true });
      expect(prResult).toEqual({
        success: true,
        alreadyUpToDate: true,
        files: [],
      });
      expect(mockCreateAutoFixPR).not.toHaveBeenCalled();
    });
  });
});

