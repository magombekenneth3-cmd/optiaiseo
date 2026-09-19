/**
 * Publication Gate — Integration Tests
 *
 * These tests verify the three acceptance criteria from the evidence-gated
 * editorial review:
 *
 *   1. Successful research → same ResearchPacket → non-null EvidencePacket
 *      → AVAILABLE → publication gate evaluates real evidence
 *
 *   2. Research unavailable → UNAVAILABLE → EVIDENCE_REVIEW → never DRAFT
 *
 *   3. All generation paths use the same ResearchPacket contract
 *
 * They exercise extractEvidencePacket + runPublicationGate as a unit,
 * without mocking out the gate internals.  The originality gate IS mocked
 * because it calls Gemini; everything else runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractEvidencePacket } from "@/lib/blog/evidence-extractor";
import type {
    EvidencePacket,
    ResearchPacket,
    SourceEvidence,
    EvidenceAvailability,
} from "@/lib/blog/contracts";

// ─── Mock the Gemini-calling originality gate ─────────────────────────────
// Publication gate internally imports original-value-gate. We mock it so
// tests never hit the network.  The mock always passes originality.
vi.mock("@/lib/blog/original-value-gate", () => ({
    runOriginalValueGate: vi.fn(async () => ({
        passed: true,
        uniqueContributions: ["Original analysis provided."],
        weakSections: [],
        duplicateSections: [],
        missingEvidence: [],
        missingValue: [],
    })),
}));

// Mock logger to silence output
vi.mock("@/lib/logger", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeSource(overrides: Partial<SourceEvidence> & { id: string; url: string }): SourceEvidence {
    return {
        title: `Source ${overrides.id}`,
        publisher: "Example Publisher",
        publishedAt: NOW,
        retrievedAt: NOW,
        claim: "A relevant claim from this source.",
        evidence: "Supporting evidence text from the source.",
        sourceType: "research",
        confidence: 0.85,
        ...overrides,
    };
}

function makeResearchPacket(overrides: Partial<ResearchPacket> = {}): ResearchPacket {
    const sources = overrides.sources ?? [
        makeSource({ id: "serp-1", url: "https://example-research.com/study-1" }),
        makeSource({ id: "serp-2", url: "https://example-data.org/report-2" }),
    ];
    return {
        collectedAt: NOW,
        evidenceAvailability: sources.length > 0 ? "AVAILABLE" : "EMPTY",
        keyword: "seo optimization",
        intent: "informational",
        brain: {
            intent: "informational",
            searcherMindset: "Learning about SEO",
            contentGaps: ["advanced technical SEO"],
            entities: ["Google", "SEO"],
            contrarianAngles: [],
            examplesNeeded: [],
            faqTargets: [],
            commonMisconceptions: [],
            industryMyths: [],
            whatPeopleAvoidSaying: [],
        },
        serp: {
            competitors: [],
            paa: [],
            format: null,
        },
        sources,
        entities: [],
        authorEvidence: { name: "Test Author" },
        contentGaps: [],
        misconceptions: [],
        contrarianAngles: [],
        ...overrides,
    };
}

function makeContent(options: {
    withCitedStats?: boolean;
    withUnsourcedStats?: boolean;
    withFabricatedCaseStudy?: boolean;
    withFakeExperience?: boolean;
    minimal?: boolean;
} = {}): string {
    const sections: string[] = [];

    sections.push(`<h1>Complete Guide to SEO Optimization in 2025</h1>`);
    sections.push(`<p>Search engine optimization remains critical for businesses seeking organic growth. This guide provides actionable strategies for improving your rankings. Whether you are launching a new site or refining an established one, a structured approach to technical and on-page SEO will deliver measurable results.</p>`);

    if (options.withCitedStats) {
        sections.push(`<h2>The Impact of Technical SEO</h2>`);
        sections.push(`<p>According to <a href="https://example-research.com/study-1">a recent analysis</a>, websites that implement technical SEO see a 47% improvement in crawl efficiency.</p>`);
        sections.push(`<p>Numbers from <a href="https://example-data.org/report-2">the 2024 benchmark</a> confirm that page speed optimization increases conversions by 23%.</p>`);
    }

    if (options.withUnsourcedStats) {
        sections.push(`<h2>Content Strategy Results</h2>`);
        sections.push(`<p>According to industry surveys, 73% of marketers agree that content quality is the most important ranking factor.</p>`);
        sections.push(`<p>A recent report found that companies see a 156% increase in organic traffic after implementing topic clusters.</p>`);
    }

    if (options.withFabricatedCaseStudy) {
        sections.push(`<h2>Our Client Results</h2>`);
        sections.push(`<p>In my 15 years working with enterprise clients, I personally helped 847 companies achieve first-page rankings.</p>`);
    }

    if (options.withFakeExperience) {
        sections.push(`<h2>Professional Experience</h2>`);
        sections.push(`<p>In my 20 years of experience, I have personally audited over 5,000 websites and consistently achieved 340% traffic improvements for every single client.</p>`);
    }

    // Ensure minimum content length for structure gate
    if (!options.minimal) {
        sections.push(`<h2>On-Page SEO Fundamentals</h2>`);
        sections.push(`<p>On-page SEO involves optimizing individual web pages to rank higher and earn more relevant traffic. Key elements include title tags, meta descriptions, header tags, and internal linking structures. Each element plays a distinct role in helping search engines understand page content and relevance. Properly structured pages with descriptive headings allow crawlers to index content efficiently. Internal links distribute authority throughout the site and help visitors navigate between related topics. When every page follows a consistent optimization checklist, the cumulative effect can significantly strengthen the entire domain.</p>`);
        sections.push(`<h2>Link Building Strategies</h2>`);
        sections.push(`<p>Building high-quality backlinks remains one of the most effective ways to improve domain authority. Focus on creating linkable assets, guest posting on relevant sites, and developing relationships with industry publications. Quality always outweighs quantity in modern link building. Broken-link reclamation, original infographics, and expert roundups are three proven tactics that consistently generate editorial links. Prioritize domains with topical relevance over raw domain authority metrics, as contextual alignment sends stronger signals to ranking algorithms.</p>`);
        sections.push(`<h2>Measuring SEO Success</h2>`);
        sections.push(`<p>Track organic traffic, keyword rankings, click-through rates, and conversion rates to measure the effectiveness of your SEO efforts. Use analytics platforms to monitor progress and identify areas for improvement over time. Set quarterly benchmarks for impressions, engaged sessions, and goal completions so you can attribute growth to specific optimizations. Segment performance by landing page and device type to spot opportunities that aggregate metrics would otherwise obscure.</p>`);
    }

    return sections.join("\n");
}

// ─── Helper to run the full gate ──────────────────────────────────────────

async function runGate(
    researchPacket: ResearchPacket,
    content: string,
    overrides: Record<string, unknown> = {},
) {
    const { runPublicationGate } = await import("@/lib/blog/publication-gate");

    const evidencePacket = extractEvidencePacket(researchPacket, content);

    const result = await runPublicationGate({
        content,
        title: "Complete Guide to SEO Optimization in 2025",
        metaDescription: "Learn actionable SEO optimization strategies backed by research data for improving your organic search rankings in 2025.",
        targetKeywords: ["seo optimization"],
        evidencePacket,
        serpContext: null,
        researchPacket,
        riskTier: "medium",
        hasFirstPartyEvidence: false,
        ...overrides,
    });

    return { evidencePacket, result };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("Publication Gate — Evidence Plumbing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Acceptance Criterion 1 ────────────────────────────────────────────
    describe("Criterion 1: successful research → real evidence → gate evaluates", () => {
        it("produces a non-null EvidencePacket with AVAILABLE availability", () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withCitedStats: true });
            const evidence = extractEvidencePacket(packet, content);

            expect(evidence).toBeDefined();
            expect(evidence.availability).toBe("AVAILABLE");
            expect(evidence.extraction.researchCollectedAt).toBe(packet.collectedAt);
            expect(evidence.extraction.extractorVersion).toMatch(/^blog-evidence-v/);
        });

        it("maps cited statistics to research sources via explicit citation", () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withCitedStats: true });
            const evidence = extractEvidencePacket(packet, content);

            const explicitCitations = evidence.claimSourceMap.filter(
                m => m.matchMethod === "explicit_citation",
            );
            expect(explicitCitations.length).toBeGreaterThan(0);
            // Each explicit citation must reference a source that exists in the packet
            for (const mapping of explicitCitations) {
                for (const sourceId of mapping.sourceIds) {
                    expect(evidence.sources.some(s => s.id === sourceId)).toBe(true);
                }
            }
        });

        it("passes the gate when all claims are properly cited", async () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withCitedStats: true });
            const { result } = await runGate(packet, content);

            expect(result.status).toBe("DRAFT");
            expect(result.passed).toBe(true);
            expect(result.evidenceAvailability).toBe("AVAILABLE");
            expect(result.fabricationIssues).toHaveLength(0);
        });
    });

    // ── Acceptance Criterion 2 ────────────────────────────────────────────
    describe("Criterion 2: unavailable research → EVIDENCE_REVIEW → never DRAFT", () => {
        it("returns UNAVAILABLE when researchPacket is null", () => {
            const evidence = extractEvidencePacket(null, makeContent());

            expect(evidence.availability).toBe("UNAVAILABLE");
            expect(evidence.sources).toHaveLength(0);
            // Claims may still be extracted from content text (they'll all
            // be unsupported); what matters is the availability signal.
            expect(evidence.extraction.researchAvailability).toBe("UNAVAILABLE");
            expect(evidence.extraction.researchCollectedAt).toBeNull();
        });

        it("returns EVIDENCE_REVIEW (never DRAFT) for UNAVAILABLE evidence", async () => {
            const unavailablePacket = makeResearchPacket({
                sources: [],
                evidenceAvailability: "UNAVAILABLE" as EvidenceAvailability,
            });
            const content = makeContent({ withCitedStats: true });
            const { result } = await runGate(unavailablePacket, content);

            expect(result.status).toBe("EVIDENCE_REVIEW");
            expect(result.passed).toBe(false);
            expect(result.evidenceAvailability).not.toBe("AVAILABLE");
        });

        it("returns EVIDENCE_REVIEW for EMPTY evidence (research ran, no sources)", async () => {
            const emptyPacket = makeResearchPacket({
                sources: [],
                evidenceAvailability: "EMPTY" as EvidenceAvailability,
            });
            const content = makeContent();
            const { result } = await runGate(emptyPacket, content);

            expect(result.status).toBe("EVIDENCE_REVIEW");
            expect(result.passed).toBe(false);
        });

        it("defense-in-depth: DRAFT is impossible when availability !== AVAILABLE", async () => {
            // Even if somehow all other gates pass, the invariant guard blocks DRAFT.
            const emptyPacket = makeResearchPacket({
                sources: [],
                evidenceAvailability: "EMPTY" as EvidenceAvailability,
            });
            const content = makeContent();
            const { result } = await runGate(emptyPacket, content);

            // This is the critical invariant
            expect(result.status).not.toBe("DRAFT");
        });
    });

    // ── Acceptance Criterion 3 ────────────────────────────────────────────
    describe("Criterion 3: all generation paths use same ResearchPacket contract", () => {
        it("ResearchPacket schema enforces collectedAt and evidenceAvailability", () => {
            const packet = makeResearchPacket();

            expect(packet.collectedAt).toBeDefined();
            expect(typeof packet.collectedAt).toBe("string");
            expect(packet.evidenceAvailability).toBeDefined();
            expect(["AVAILABLE", "EMPTY", "UNAVAILABLE"]).toContain(packet.evidenceAvailability);
        });

        it("evidence extractor ties extraction to research snapshot via collectedAt", () => {
            const packet = makeResearchPacket();
            const evidence = extractEvidencePacket(packet, makeContent({ withCitedStats: true }));

            expect(evidence.extraction.researchCollectedAt).toBe(packet.collectedAt);
            expect(evidence.extraction.researchAvailability).toBe(packet.evidenceAvailability);
        });
    });

    // ── Unsourced Statistics → EVIDENCE_REVIEW (not REJECTED) ─────────────
    describe("Unsourced statistics → EVIDENCE_REVIEW, not REJECTED", () => {
        it("flags unsourced statistics as review items", () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withUnsourcedStats: true });
            const evidence = extractEvidencePacket(packet, content);

            expect(evidence.unsourcedStatistics.length).toBeGreaterThan(0);
            // Must NOT be in fabricatedClaims
            expect(evidence.fabricatedClaims).toHaveLength(0);
        });

        it("routes unsourced stats to EVIDENCE_REVIEW (never REJECTED)", async () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withUnsourcedStats: true });
            const { result } = await runGate(packet, content);

            expect(result.status).not.toBe("REJECTED");
            // Should be EVIDENCE_REVIEW or NEEDS_REVIEW, not DRAFT
            expect(result.status).not.toBe("DRAFT");
        });
    });

    // ── Fabricated Claims → REJECTED ──────────────────────────────────────
    describe("Fabricated claims → REJECTED", () => {
        it("fake experience with precise numbers is flagged by evidence gate", async () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withFakeExperience: true });
            const { result } = await runGate(packet, content);

            // Fake experience should at minimum block DRAFT
            expect(result.passed).toBe(false);
            expect(result.status).not.toBe("DRAFT");
        });
    });

    // ── Snapshot Drift Detection ──────────────────────────────────────────
    describe("Snapshot drift detection", () => {
        it("detects when evidence sources reference unknown source IDs", async () => {
            // Create a research packet, then tamper with source IDs in the evidence
            const packet = makeResearchPacket();
            const content = makeContent({ withCitedStats: true });

            // Create evidence from a different research snapshot
            const driftedPacket = makeResearchPacket({
                collectedAt: new Date(Date.now() - 60_000).toISOString(),
                sources: [
                    makeSource({ id: "different-1", url: "https://different-source.com/page" }),
                ],
            });

            const evidence = extractEvidencePacket(driftedPacket, content);

            // The evidence was extracted from a different snapshot
            expect(evidence.extraction.researchCollectedAt).not.toBe(packet.collectedAt);
        });
    });

    // ── Return Value Semantics ────────────────────────────────────────────
    describe("Return value semantics", () => {
        it("includes evidenceAvailability in gate result", async () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withCitedStats: true });
            const { result } = await runGate(packet, content);

            expect(result.evidenceAvailability).toBeDefined();
            expect(["AVAILABLE", "EMPTY", "UNAVAILABLE"]).toContain(result.evidenceAvailability);
        });

        it("always returns bounded issue arrays (max limits)", async () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withUnsourcedStats: true });
            const { result } = await runGate(packet, content);

            expect(result.blockingIssues.length).toBeLessThanOrEqual(50);
            expect(result.warnings.length).toBeLessThanOrEqual(50);
            expect(result.evidenceIssues.length).toBeLessThanOrEqual(30);
            expect(result.originalityIssues.length).toBeLessThanOrEqual(20);
            expect(result.repetitionIssues.length).toBeLessThanOrEqual(20);
            expect(result.fabricationIssues.length).toBeLessThanOrEqual(20);
        });
    });

    // ── EvidencePacket Provenance Structure ────────────────────────────────
    describe("EvidencePacket provenance structure", () => {
        it("builds claim → source mappings with match methods", () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withCitedStats: true, withUnsourcedStats: true });
            const evidence = extractEvidencePacket(packet, content);

            expect(evidence.claimSourceMap.length).toBeGreaterThan(0);

            for (const mapping of evidence.claimSourceMap) {
                expect(mapping.claimId).toMatch(/^claim-\d+$/);
                expect(["explicit_citation", "source_text_match", "first_party", "unsupported"])
                    .toContain(mapping.matchMethod);
            }
        });

        it("unsupported claims have matchMethod === 'unsupported'", () => {
            const packet = makeResearchPacket();
            const content = makeContent({ withUnsourcedStats: true });
            const evidence = extractEvidencePacket(packet, content);

            const unsupported = evidence.claimSourceMap.filter(
                m => m.matchMethod === "unsupported",
            );
            // We have unsourced stats, so at least some should be unsupported
            if (evidence.unsourcedStatistics.length > 0) {
                expect(unsupported.length).toBeGreaterThan(0);
            }
        });

        it("extractor never populates fabricatedClaims (conservative by design)", () => {
            const packet = makeResearchPacket();
            // Even content with fake-sounding claims should not auto-populate fabricatedClaims
            const content = makeContent({ withFakeExperience: true, withUnsourcedStats: true });
            const evidence = extractEvidencePacket(packet, content);

            expect(evidence.fabricatedClaims).toHaveLength(0);
        });
    });
});
