import { describe, expect, it } from "vitest";
import {
  buildResearchEvidenceLedger,
  collectSerpObservations,
  collectGscObservations,
  collectFirstPartyContext,
  collectCompetitorObservations,
  validateLedger,
  ledgerEvidenceSummary,
} from "@/lib/blog/evidence-ledger";
import type { ResearchPacket } from "@/lib/blog/contracts";
import type { AuthorProfile } from "@/lib/blog";
import type { SerpContext } from "@/lib/blog/serp";

const TIMESTAMP = new Date("2026-09-24T12:00:00.000Z").toISOString();

const researchPacket: ResearchPacket = {
  collectedAt: TIMESTAMP,
  evidenceAvailability: "AVAILABLE",
  keyword: "seo audit tools",
  intent: "Find and compare SEO audit tools",
  brain: {
    intent: "Find and compare SEO audit tools",
    searcherMindset: "Evaluating options",
    contentGaps: ["pricing comparison"],
    entities: ["Ahrefs", "Semrush"],
    contrarianAngles: [],
    examplesNeeded: [],
    faqTargets: [],
    commonMisconceptions: [],
    industryMyths: [],
    whatPeopleAvoidSaying: [],
  },
  serp: {
    competitors: [
      { title: "Ahrefs Blog", url: "https://ahrefs.com/blog", snippet: "SEO tools and resources", headings: ["Features"] },
      { title: "Semrush Blog", url: "https://semrush.com/blog", snippet: "Marketing toolkit", headings: ["Overview"] },
    ],
    paa: [{ question: "What is an SEO audit?", answer: "An evaluation of website SEO health." }],
    format: "comparison",
  },
  sources: [
    {
      id: "src-1",
      url: "https://ahrefs.com/blog/seo-audit",
      title: "How to Do an SEO Audit",
      publisher: "ahrefs.com",
      retrievedAt: TIMESTAMP,
      claim: "An SEO audit reveals technical issues affecting rankings.",
      evidence: "A complete SEO audit checks crawlability, indexing, and on-page factors.",
      sourceType: "company",
      confidence: 0.85,
    },
    {
      id: "src-2",
      url: "https://research.google/pubs/core-web-vitals",
      title: "Core Web Vitals Report",
      publisher: "Google Research",
      publishedAt: "2026-01-15",
      retrievedAt: TIMESTAMP,
      claim: "53% of visits are abandoned if a page takes more than 3 seconds to load.",
      evidence: "53% of visits are abandoned if a page takes more than 3 seconds to load.",
      sourceType: "research",
      confidence: 0.95,
      authorityScore: 0.98,
    },
  ],
  entities: [
    { entity: "Ahrefs", reason: "Major competitor", sourceIds: ["src-1"] },
  ],
  authorEvidence: { name: "Test Author" },
  contentGaps: ["pricing comparison"],
  misconceptions: [],
  contrarianAngles: [],
};

const author: AuthorProfile = {
  name: "Kenneth M.",
  role: "SEO Consultant",
  bio: "10 years in technical SEO for SaaS companies.",
  realExperience: "Audited 200+ enterprise sites including Fortune 500 companies. Typical audit takes 3-5 days.",
  realNumbers: "Average improvement: 34% organic traffic increase within 90 days post-audit.",
  localContext: "Based in Kampala, Uganda — specializing in East African market SEO.",
};

const serpContext: SerpContext = {
  keyword: "seo audit tools",
  results: [
    {
      title: "Best SEO Audit Tools in 2026",
      link: "https://ahrefs.com/blog/seo-audit-tools",
      snippet: "Compare the top SEO audit tools for technical SEO, including Ahrefs, Semrush, and Screaming Frog.",
      scrapedHeadings: ["What is an SEO Audit?", "Top 10 Tools", "Pricing Comparison"],
      wordCount: 3500,
    },
    {
      title: "How to Perform a Technical SEO Audit",
      link: "https://semrush.com/blog/seo-audit",
      snippet: "Step-by-step guide to performing a comprehensive SEO audit using Semrush.",
      scrapedHeadings: ["Step 1: Crawl Your Site", "Step 2: Check Indexing"],
      wordCount: 2800,
    },
  ],
  peopleAlsoAsk: [{ question: "What is an SEO audit?", answer: "An SEO audit evaluates website health." }],
  featuredSnippet: "An SEO audit is a process of evaluating how well your site is optimized for search engines.",
  relatedSearches: ["seo audit checklist", "free seo audit tool"],
  formattedContext: "",
  opportunityAnalysis: {
    tableStakes: [],
    opportunities: [],
    unansweredQuestions: [],
  },
};

const brandFacts = [
  { factType: "pricing", value: "Starter plan: $29/mo" },
  { factType: "customer_count", value: "4,200+ active users" },
];

describe("evidence-ledger", () => {
  describe("collectSerpObservations", () => {
    it("extracts observations from SERP results", () => {
      const observations = collectSerpObservations(serpContext);
      expect(observations).toHaveLength(2);
      expect(observations[0].rank).toBe(1);
      expect(observations[0].url).toBe("https://ahrefs.com/blog/seo-audit-tools");
      expect(observations[0].sourceType).toBe("SERP_OBSERVATION");
      expect(observations[0].headings).toHaveLength(3);
      expect(observations[1].rank).toBe(2);
    });

    it("returns empty array for null context", () => {
      expect(collectSerpObservations(null)).toEqual([]);
    });
  });

  describe("collectGscObservations", () => {
    it("captures GSC evidence as GSC_DATA observations", () => {
      const gscEvidence = {
        generationId: "blog-123",
        siteId: "site-1",
        property: "https://example.com/",
        sourceStatus: "AVAILABLE" as const,
        query: "seo audit tools",
        url: "https://example.com/seo-audit",
        dateRange: { startDate: "2026-06-01", endDate: "2026-08-30" },
        position: 14.2,
        impressions: 520,
        clicks: 18,
        ctr: 3.5,
        opportunityScore: 85,
        opportunityType: "quick-win",
        reason: "Position #14 — just off page 1.",
        capturedAt: TIMESTAMP,
      };
      const observations = collectGscObservations(gscEvidence, [], "https://example.com/");
      expect(observations).toHaveLength(1);
      expect(observations[0].query).toBe("seo audit tools");
      expect(observations[0].position).toBe(14.2);
      expect(observations[0].dateRange.startDate).toBe("2026-06-01");
      expect(observations[0].property).toBe("https://example.com/");
    });

    it("deduplicates opportunities already in gscEvidence", () => {
      const gscEvidence = {
        generationId: "blog-123",
        siteId: "site-1",
        property: "https://example.com/",
        sourceStatus: "AVAILABLE" as const,
        query: "seo audit tools",
        dateRange: { startDate: "2026-06-01", endDate: "2026-08-30" },
        position: 14.2,
        impressions: 520,
        clicks: 18,
        ctr: 3.5,
        opportunityScore: 85,
        opportunityType: "quick-win",
        reason: "Position #14",
        capturedAt: TIMESTAMP,
      };
      const opportunities = [
        {
          keyword: "seo audit tools",
          avgPosition: 14.2,
          impressions: 520,
          clicks: 18,
          ctr: 3.5,
          opportunityScore: 85,
          opportunityType: "quick-win",
          reason: "Position #14",
        },
        {
          keyword: "technical seo checklist",
          avgPosition: 22,
          impressions: 300,
          clicks: 5,
          ctr: 1.7,
          opportunityScore: 60,
          opportunityType: "new-content",
          reason: "Position #22",
        },
      ];
      const observations = collectGscObservations(gscEvidence, opportunities);
      expect(observations).toHaveLength(2);
      expect(observations[0].query).toBe("seo audit tools");
      expect(observations[1].query).toBe("technical seo checklist");
    });
  });

  describe("collectFirstPartyContext", () => {
    it("captures author profile and brand facts", () => {
      const ctx = collectFirstPartyContext(author, null, brandFacts);
      expect(ctx.authorName).toBe("Kenneth M.");
      expect(ctx.authorRole).toBe("SEO Consultant");
      expect(ctx.realExperience).toContain("200+ enterprise sites");
      expect(ctx.realNumbers).toContain("34% organic traffic");
      expect(ctx.localContext).toContain("Kampala");
      expect(ctx.brandFacts).toHaveLength(2);
    });

    it("captures site context when available", () => {
      const siteContext = {
        title: "OptiAISEO",
        description: "AI-powered SEO platform",
        headings: ["Features", "Pricing"],
        category: "SaaS",
        keywords: ["seo", "ai"],
        domain: "optiaiseo",
      };
      const ctx = collectFirstPartyContext(author, siteContext, []);
      expect(ctx.siteTitle).toBe("OptiAISEO");
      expect(ctx.siteHeadings).toEqual(["Features", "Pricing"]);
    });
  });

  describe("collectCompetitorObservations", () => {
    it("extracts competitor data from SERP results", () => {
      const observations = collectCompetitorObservations(serpContext);
      expect(observations).toHaveLength(2);
      expect(observations[0].domain).toBe("ahrefs.com");
      expect(observations[0].headings).toHaveLength(3);
      expect(observations[1].domain).toBe("semrush.com");
    });
  });

  describe("buildResearchEvidenceLedger", () => {
    it("builds a complete ledger with all evidence types", () => {
      const ledger = buildResearchEvidenceLedger({
        topic: "seo audit tools",
        searchIntent: "comparison",
        blogId: "blog-test-1",
        researchPacket,
        serpContext,
        gscEvidence: null,
        gscOpportunities: [],
        author,
        siteContext: null,
        brandFacts,
      });

      expect(ledger.topic).toBe("seo audit tools");
      expect(ledger.searchIntent).toBe("comparison");
      expect(ledger.blogId).toBe("blog-test-1");
      expect(ledger.serpObservations).toHaveLength(2);
      expect(ledger.competitorObservations).toHaveLength(2);
      expect(ledger.gscObservations).toHaveLength(0);

      const sourceTypes = new Set(ledger.evidenceItems.map(i => i.provenance.sourceType));
      expect(sourceTypes.has("EXTERNAL_SOURCE")).toBe(true);
      expect(sourceTypes.has("FIRST_PARTY_EXPERIENCE")).toBe(true);
      expect(sourceTypes.has("FIRST_PARTY_DATA")).toBe(true);
      expect(sourceTypes.has("SERP_OBSERVATION")).toBe(true);

      for (const item of ledger.evidenceItems) {
        expect(item.provenance.capturedAt).toBeTruthy();
        expect(item.provenance.sourceType).toBeTruthy();
        expect(item.provenance.retrievalMethod).toBeTruthy();
        expect(item.content.length).toBeGreaterThan(0);
      }
    });

    it("includes GSC evidence items when GSC data is available", () => {
      const gscEvidence = {
        generationId: "blog-123",
        siteId: "site-1",
        property: "https://example.com/",
        sourceStatus: "AVAILABLE" as const,
        query: "seo audit tools",
        dateRange: { startDate: "2026-06-01", endDate: "2026-08-30" },
        position: 14.2,
        impressions: 520,
        clicks: 18,
        ctr: 3.5,
        opportunityScore: 85,
        opportunityType: "quick-win",
        reason: "Position #14 — just off page 1.",
        capturedAt: TIMESTAMP,
      };

      const ledger = buildResearchEvidenceLedger({
        topic: "seo audit tools",
        searchIntent: "comparison",
        blogId: "blog-test-2",
        researchPacket,
        serpContext: null,
        gscEvidence,
        gscOpportunities: [],
        gscProperty: "https://example.com/",
        author,
        siteContext: null,
        brandFacts: [],
      });

      expect(ledger.gscObservations).toHaveLength(1);
      const gscItems = ledger.evidenceItems.filter(i => i.provenance.sourceType === "GSC_DATA");
      expect(gscItems.length).toBeGreaterThan(0);
      expect(gscItems[0].provenance.sourcePublisher).toBe("Google Search Console");
      expect(gscItems[0].provenance.confidence).toBe(1.0);
      expect(gscItems[0].provenance.retrievalMethod).toBe("gsc_api");
    });

    it("keeps first-party evidence explicitly typed", () => {
      const ledger = buildResearchEvidenceLedger({
        topic: "seo audit tools",
        searchIntent: "comparison",
        blogId: null,
        researchPacket,
        serpContext: null,
        gscEvidence: null,
        gscOpportunities: [],
        author,
        siteContext: null,
        brandFacts,
      });

      const experienceItems = ledger.evidenceItems.filter(
        i => i.provenance.sourceType === "FIRST_PARTY_EXPERIENCE"
      );
      expect(experienceItems.length).toBe(2);
      const hasAuditExperience = experienceItems.some(i => i.content.includes("200+ enterprise sites"));
      expect(hasAuditExperience).toBe(true);

      const dataItems = ledger.evidenceItems.filter(
        i => i.provenance.sourceType === "FIRST_PARTY_DATA"
      );
      expect(dataItems.length).toBeGreaterThanOrEqual(2);
      const hasPricing = dataItems.some(i => i.content.includes("$29/mo"));
      expect(hasPricing).toBe(true);
    });
  });

  describe("validateLedger", () => {
    it("validates a well-formed ledger", () => {
      const ledger = buildResearchEvidenceLedger({
        topic: "seo audit tools",
        searchIntent: "comparison",
        blogId: "blog-1",
        researchPacket,
        serpContext,
        gscEvidence: null,
        gscOpportunities: [],
        author,
        siteContext: null,
        brandFacts,
      });
      const result = validateLedger(ledger);
      expect(result.success).toBe(true);
    });
  });

  describe("ledgerEvidenceSummary", () => {
    it("summarizes evidence by source type", () => {
      const ledger = buildResearchEvidenceLedger({
        topic: "seo audit tools",
        searchIntent: "comparison",
        blogId: "blog-1",
        researchPacket,
        serpContext,
        gscEvidence: null,
        gscOpportunities: [],
        author,
        siteContext: null,
        brandFacts,
      });
      const summary = ledgerEvidenceSummary(ledger);
      expect(summary.totalItems).toBeGreaterThan(0);
      expect(summary.serpObservations).toBe(2);
      expect(summary.competitorObservations).toBe(2);
      expect(summary.hasFristPartyExperience).toBe(true);
      expect(summary.hasFirstPartyData).toBe(true);
      expect(summary.brandFactCount).toBe(2);
      expect(summary.bySourceType["EXTERNAL_SOURCE"]).toBeGreaterThanOrEqual(1);
    });
  });

  describe("provenance completeness", () => {
    it("every evidence item answers: where, when, type, excerpt", () => {
      const ledger = buildResearchEvidenceLedger({
        topic: "seo audit tools",
        searchIntent: "comparison",
        blogId: "blog-1",
        researchPacket,
        serpContext,
        gscEvidence: null,
        gscOpportunities: [],
        author,
        siteContext: null,
        brandFacts,
      });

      for (const item of ledger.evidenceItems) {
        expect(item.provenance.capturedAt).toBeTruthy();
        expect(typeof item.provenance.capturedAt).toBe("string");

        expect(item.provenance.sourceType).toBeTruthy();
        expect([
          "EXTERNAL_SOURCE",
          "FIRST_PARTY_EXPERIENCE",
          "FIRST_PARTY_DATA",
          "GSC_DATA",
          "SERP_OBSERVATION",
          "INFERENCE",
          "LLM_GENERATED",
        ]).toContain(item.provenance.sourceType);

        expect(item.provenance.retrievalMethod).toBeTruthy();

        expect(item.content.length).toBeGreaterThan(0);
      }
    });
  });
});
