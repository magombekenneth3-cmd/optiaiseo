import { describe, it, expect } from "vitest";
import {
  htmlObservationToEvidence,
  httpObservationToEvidence,
  robotsObservationToEvidence,
  sitemapObservationToEvidence,
  checklistItemToCanonicalEvidence,
} from "@/lib/seo-audit/observation-adapters";
import {
  EvidenceCollector,
  checklistItemToEvidence,
  extractDiagnosticFindings,
} from "@/lib/seo-audit/evidence-collector";
import type { HtmlObservation, HttpObservation, RobotsObservation, SitemapObservation } from "@/lib/seo-audit/contracts";

describe("observation adapters", () => {
  describe("htmlObservationToEvidence", () => {
    it("produces DIRECTLY_OBSERVED for real HTML data", () => {
      const obs: HtmlObservation = {
        metaRobots: "index,follow",
        canonicalHref: "https://example.com/",
        canonicalIsSelf: true,
        hasQaContent: false,
        jsonldCount: 2,
        microdataPresent: false,
        hasOrganization: true,
        hasFaq: false,
        hasBreadcrumb: true,
        schemaTypes: ["Organization", "BreadcrumbList"],
        schemaErrors: [],
      };
      const ev = htmlObservationToEvidence(obs, "https://example.com/");
      expect(ev.source).toBe("HTML");
      expect(ev.confidenceKind).toBe("DIRECTLY_OBSERVED");
      expect(ev.confidence).toBe(1.0);
      expect(ev.evidenceHash).toBeDefined();
    });
  });

  describe("httpObservationToEvidence", () => {
    it("produces DIRECTLY_OBSERVED for non-zero status", () => {
      const obs: HttpObservation = {
        status: 200,
        xRobotsTag: null,
        redirectCount: 0,
        redirectLoop: false,
        protocol: "https",
        finalUrl: "https://example.com/",
      };
      const ev = httpObservationToEvidence(obs, "https://example.com/");
      expect(ev.source).toBe("HTTP_HEADERS");
      expect(ev.confidenceKind).toBe("DIRECTLY_OBSERVED");
      expect(ev.httpStatus).toBe(200);
    });

    it("produces UNAVAILABLE for zero status", () => {
      const obs: HttpObservation = {
        status: 0,
        xRobotsTag: null,
        redirectCount: 0,
        redirectLoop: false,
        protocol: "https",
        finalUrl: "",
      };
      const ev = httpObservationToEvidence(obs, "https://example.com/");
      expect(ev.confidenceKind).toBe("UNAVAILABLE");
      expect(ev.confidence).toBe(0);
    });
  });

  describe("robotsObservationToEvidence", () => {
    it("captures robots.txt state", () => {
      const obs: RobotsObservation = {
        exists: true,
        disallowed: false,
        disallowsRoot: false,
        blocksGooglebot: false,
        hasSitemapDirective: true,
        content: "User-agent: *\nAllow: /\nSitemap: /sitemap.xml",
      };
      const ev = robotsObservationToEvidence(obs, "https://example.com/robots.txt");
      expect(ev.source).toBe("ROBOTS");
      expect(ev.confidenceKind).toBe("DIRECTLY_OBSERVED");
    });
  });

  describe("sitemapObservationToEvidence", () => {
    it("captures sitemap state", () => {
      const obs: SitemapObservation = {
        exists: true,
        validXml: true,
        urlCount: 42,
        containsUrl: true,
        url: "https://example.com/sitemap.xml",
      };
      const ev = sitemapObservationToEvidence(obs, "https://example.com/sitemap.xml");
      expect(ev.source).toBe("SITEMAP");
      expect(ev.confidence).toBe(1.0);
    });
  });

  describe("checklistItemToCanonicalEvidence (legacy adapter)", () => {
    it("maps Pass status to DIRECTLY_OBSERVED confidence", () => {
      const ev = checklistItemToCanonicalEvidence(
        {
          id: "canonical-check",
          label: "Canonical Tag",
          status: "Pass",
          finding: "Self-referencing canonical present",
        },
        "https://example.com/",
      );
      expect(ev.confidenceKind).toBe("DIRECTLY_OBSERVED");
      expect(ev.confidence).toBe(1.0);
    });

    it("maps Skipped status to UNAVAILABLE", () => {
      const ev = checklistItemToCanonicalEvidence(
        {
          id: "gsc-check",
          label: "GSC Data",
          status: "Skipped",
          finding: "GSC not connected",
        },
        "https://example.com/",
      );
      expect(ev.confidenceKind).toBe("UNAVAILABLE");
      expect(ev.confidence).toBe(0);
    });

    it("infers correct source from item ID", () => {
      const robotsEv = checklistItemToCanonicalEvidence(
        { id: "robots-txt-check", label: "Robots", status: "Pass", finding: "ok" },
        "https://example.com/",
      );
      expect(robotsEv.source).toBe("ROBOTS");

      const schemaEv = checklistItemToCanonicalEvidence(
        { id: "schema-jsonld-check", label: "Schema", status: "Pass", finding: "ok" },
        "https://example.com/",
      );
      expect(schemaEv.source).toBe("SCHEMA");
    });
  });
});

describe("EvidenceCollector", () => {
  it("captures evidence with explicit confidence kind", () => {
    const collector = new EvidenceCollector("site-1", "https://example.com");
    const ev = collector.collect("HTML", { test: true }, {
      confidenceKind: "DERIVED",
      confidence: 0.75,
    });
    expect(ev.confidenceKind).toBe("DERIVED");
    expect(ev.confidence).toBe(0.75);
  });

  it("defaults to DIRECTLY_OBSERVED when no kind specified", () => {
    const collector = new EvidenceCollector("site-1", "https://example.com");
    const ev = collector.collect("HTML", { test: true });
    expect(ev.confidenceKind).toBe("DIRECTLY_OBSERVED");
    expect(ev.confidence).toBe(1.0);
  });

  it("getEvidence returns a copy", () => {
    const collector = new EvidenceCollector("site-1", "https://example.com");
    collector.collect("HTML", { a: 1 });
    const ev1 = collector.getEvidence();
    const ev2 = collector.getEvidence();
    expect(ev1).toEqual(ev2);
    expect(ev1).not.toBe(ev2);
  });
});

describe("evidence-collector legacy adapter", () => {
  it("checklistItemToEvidence maps Warning to DERIVED confidence", () => {
    const ev = checklistItemToEvidence(
      {
        id: "test-check",
        label: "Test",
        status: "Warning",
        finding: "Almost there",
      },
      "https://example.com",
    );
    expect(ev.confidenceKind).toBe("DERIVED");
    expect(ev.confidence).toBe(0.75);
  });
});

describe("extractDiagnosticFindings", () => {
  it("deduplicates findings by fingerprint", () => {
    const { findings } = extractDiagnosticFindings(
      "site-1",
      "https://example.com",
      [
        {
          id: "cat-1",
          label: "Category 1",
          score: 50,
          passed: 0,
          failed: 1,
          warnings: 0,
          items: [
            { id: "canonical-check", label: "Canonical", status: "Fail", finding: "Missing canonical" },
          ],
        },
        {
          id: "cat-2",
          label: "Category 2",
          score: 50,
          passed: 0,
          failed: 1,
          warnings: 0,
          items: [
            { id: "canonical-check", label: "Canonical", status: "Fail", finding: "Missing canonical" },
          ],
        },
      ],
    );

    const fingerprints = findings.map((f) => f.fingerprint);
    const uniqueFingerprints = new Set(fingerprints);
    expect(fingerprints.length).toBe(uniqueFingerprints.size);
  });
});
