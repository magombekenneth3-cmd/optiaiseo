import { describe, it, expect } from "vitest";
import {
    extractMaterialClaims,
    classifyClaim,
    findEvidenceForClaim,
    verifyClaim,
    verifyClaims,
    getClaimVerificationReport,
} from "@/lib/blog/claim-verification";
import type { MaterialClaim } from "@/lib/blog/claim-verification";
import type { ResearchPacket } from "@/lib/blog/contracts";
import type { ResearchEvidenceLedger } from "@/lib/blog/evidence-ledger";

function makeClaim(overrides: Partial<MaterialClaim> = {}): MaterialClaim {
    return {
        id: "claim-0-test",
        text: "Studies show that 40% of users abandon within 30 days.",
        type: "STATISTIC",
        sectionHint: null,
        sentenceIndex: 0,
        ...overrides,
    };
}

function makeMinimalPacket(sources: ResearchPacket["sources"] = []): ResearchPacket {
    return {
        collectedAt: new Date().toISOString(),
        evidenceAvailability: "AVAILABLE",
        keyword: "seo audit",
        intent: "informational",
        brain: {
            intent: "informational",
            searcherMindset: "learning",
            contentGaps: [],
            entities: [],
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
    };
}

function makeMinimalLedger(items: ResearchEvidenceLedger["evidenceItems"] = []): ResearchEvidenceLedger {
    return {
        id: "ledger-test",
        blogId: "blog-1",
        topic: "seo audit",
        searchIntent: "informational",
        collectedAt: new Date().toISOString(),
        serpObservations: [],
        competitorObservations: [],
        gscObservations: [],
        firstPartyContext: {
            authorName: "Test Author",
            authorRole: null,
            authorBio: null,
            realExperience: null,
            realNumbers: null,
            localContext: null,
            siteTitle: null,
            siteDescription: null,
            siteHeadings: [],
            siteKeywords: [],
            brandFacts: [],
        },
        evidenceItems: items,
        researchPacketRef: null,
    };
}

describe("classifyClaim", () => {
    it("detects STATISTIC", () => {
        expect(classifyClaim("Users abandon at a rate of 40% within the first month.")).toBe("STATISTIC");
    });

    it("detects CASE_STUDY", () => {
        expect(classifyClaim("The company saw a 15% increase in traffic after migration.")).toBe("CASE_STUDY");
    });

    it("detects FIRST_PARTY_EXPERIENCE", () => {
        expect(classifyClaim("Our team tested this approach over six months and found improvements.")).toBe("FIRST_PARTY_EXPERIENCE");
    });

    it("detects GSC_OBSERVATION", () => {
        expect(classifyClaim("The keyword position dropped from 3 to 12 in Google Search Console.")).toBe("GSC_OBSERVATION");
    });

    it("detects SERP_OBSERVATION", () => {
        expect(classifyClaim("The featured snippet for this query shows a comparison table.")).toBe("SERP_OBSERVATION");
    });

    it("detects INFERENCE", () => {
        expect(classifyClaim("This likely means that the algorithm prioritizes recency.")).toBe("INFERENCE");
    });

    it("detects OPINION", () => {
        expect(classifyClaim("In our view, this strategy is the best approach for small teams.")).toBe("OPINION");
    });

    it("detects RECOMMENDATION", () => {
        expect(classifyClaim("We recommend starting with a technical audit before content planning.")).toBe("RECOMMENDATION");
    });

    it("detects FACT from vague authority signal", () => {
        expect(classifyClaim("Studies show that backlinks remain the strongest ranking factor.")).toBe("FACT");
    });

    it("returns null for ordinary non-claim sentence", () => {
        expect(classifyClaim("The quick brown fox jumped over the lazy dog quickly.")).toBeNull();
    });
});

describe("extractMaterialClaims", () => {
    it("extracts statistics from HTML content", () => {
        const html = "<p>According to research, 60% of websites fail their first audit. This is a normal sentence. Another report found that conversion rates improve by 3x with A/B testing.</p>";
        const claims = extractMaterialClaims(html);
        expect(claims.length).toBe(2);
        expect(claims[0].type).toBe("STATISTIC");
        expect(claims[1].type).toBe("STATISTIC");
    });

    it("skips opinions and recommendations", () => {
        const html = "<p>We recommend using a CDN for faster load times. In our view, caching is critical. Start with Cloudflare for free-tier users.</p>";
        const claims = extractMaterialClaims(html);
        expect(claims.length).toBe(0);
    });

    it("returns empty for content without material claims", () => {
        const html = "<p>This is a normal paragraph about everyday topics without any numbers or case studies.</p>";
        expect(extractMaterialClaims(html)).toHaveLength(0);
    });
});

describe("findEvidenceForClaim", () => {
    it("matches claim to research packet source by keyword overlap", () => {
        const claim = makeClaim({ text: "Users abandon at a rate of 40% within the first month after signup." });
        const packet = makeMinimalPacket([{
            id: "src-1",
            url: "https://example.com/churn-study",
            title: "User Churn Study",
            retrievedAt: new Date().toISOString(),
            claim: "Users frequently abandon products within the first month after signup.",
            evidence: "A study by ProductBoard found that user abandonment peaks in the first 30 days.",
            sourceType: "research",
            confidence: 0.85,
        }]);
        const matches = findEvidenceForClaim(claim, packet, null);
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].sourceType).toBe("EXTERNAL_SOURCE");
    });

    it("matches claim to ledger evidence items", () => {
        const claim = makeClaim({ text: "Search engine optimization audits improve organic traffic performance." });
        const ledger = makeMinimalLedger([{
            id: "ev-1",
            content: "SEO audits help identify technical issues that block organic traffic growth.",
            excerpt: "SEO audit organic traffic",
            category: "seo",
            provenance: {
                sourceType: "EXTERNAL_SOURCE",
                sourceUrl: "https://example.com/seo",
                sourceTitle: "SEO Guide",
                sourcePublisher: "Example",
                sourcePublishedAt: null,
                capturedAt: new Date().toISOString(),
                retrievalMethod: "serp_api",
                confidence: 0.9,
                authorityScore: null,
            },
            metadata: {},
        }]);
        const matches = findEvidenceForClaim(claim, null, ledger);
        expect(matches.length).toBeGreaterThan(0);
    });

    it("excludes LLM_GENERATED evidence from matching", () => {
        const claim = makeClaim({ text: "Search engine optimization audits improve organic traffic performance." });
        const ledger = makeMinimalLedger([{
            id: "ev-llm",
            content: "SEO audits help identify technical issues that block organic traffic growth.",
            excerpt: null,
            category: "seo",
            provenance: {
                sourceType: "LLM_GENERATED",
                sourceUrl: null,
                sourceTitle: null,
                sourcePublisher: null,
                sourcePublishedAt: null,
                capturedAt: new Date().toISOString(),
                retrievalMethod: "llm",
                confidence: 0.5,
                authorityScore: null,
            },
            metadata: {},
        }]);
        const matches = findEvidenceForClaim(claim, null, ledger);
        expect(matches.length).toBe(0);
    });

    it("excludes INFERENCE evidence from matching", () => {
        const claim = makeClaim({ text: "Search engine optimization audits improve organic traffic performance." });
        const ledger = makeMinimalLedger([{
            id: "ev-inf",
            content: "SEO audits help identify technical issues that block organic traffic growth.",
            excerpt: null,
            category: "seo",
            provenance: {
                sourceType: "INFERENCE",
                sourceUrl: null,
                sourceTitle: null,
                sourcePublisher: null,
                sourcePublishedAt: null,
                capturedAt: new Date().toISOString(),
                retrievalMethod: "inference",
                confidence: 0.6,
                authorityScore: null,
            },
            metadata: {},
        }]);
        const matches = findEvidenceForClaim(claim, null, ledger);
        expect(matches.length).toBe(0);
    });
});

describe("verifyClaim", () => {
    it("marks claim as VERIFIED with strong evidence", () => {
        const claim = makeClaim({ text: "Users abandon at a rate of 40% within the first month.", type: "STATISTIC" });
        const result = verifyClaim(claim, [{
            evidenceId: "src-1",
            sourceType: "EXTERNAL_SOURCE",
            supportLevel: "STRONG",
            matchedOn: "keyword",
            excerpt: "40% abandon in first month",
            sourceUrl: "https://example.com",
            confidence: 0.9,
        }], false, false);
        expect(result.status).toBe("VERIFIED");
    });

    it("marks claim as FIRST_PARTY when first-party signal present", () => {
        const claim = makeClaim({
            text: "Our team tested this approach over six months and found 25% improvements.",
            type: "FIRST_PARTY_EXPERIENCE",
        });
        const result = verifyClaim(claim, [], true, true);
        expect(result.status).toBe("FIRST_PARTY");
        expect(result.isFirstParty).toBe(true);
    });

    it("marks claim as FABRICATION_RISK with vague authority and no evidence", () => {
        const claim = makeClaim({
            text: "Studies show that backlinks remain the strongest ranking factor in modern SEO algorithms.",
            type: "FACT",
        });
        const result = verifyClaim(claim, [], false, false);
        expect(result.status).toBe("FABRICATION_RISK");
    });

    it("marks claim as UNSUPPORTED with no evidence and no first-party", () => {
        const claim = makeClaim({
            text: "Conversion rates improved by 200% after migration to the new platform.",
            type: "STATISTIC",
        });
        const result = verifyClaim(claim, [], false, false);
        expect(result.status).toBe("UNSUPPORTED");
    });

    it("marks claim as NEEDS_REVIEW with only weak evidence", () => {
        const claim = makeClaim({ text: "Page speed affects 30% of ranking factors.", type: "STATISTIC" });
        const result = verifyClaim(claim, [{
            evidenceId: "src-1",
            sourceType: "EXTERNAL_SOURCE",
            supportLevel: "WEAK",
            matchedOn: "keyword",
            excerpt: "Page speed is important",
            sourceUrl: null,
            confidence: 0.3,
        }], false, false);
        expect(result.status).toBe("NEEDS_REVIEW");
    });
});

describe("verifyClaims", () => {
    it("processes multiple claims and returns verification results", () => {
        const claims: MaterialClaim[] = [
            makeClaim({ id: "c-1", text: "Studies show that 40% of users abandon within 30 days.", type: "FACT" }),
            makeClaim({ id: "c-2", text: "Our team tested this approach over six months.", type: "FIRST_PARTY_EXPERIENCE" }),
        ];
        const results = verifyClaims(claims, null, null, true, false);
        expect(results).toHaveLength(2);
        expect(results[0].status).toBe("FABRICATION_RISK");
        expect(results[1].status).toBe("FIRST_PARTY");
    });
});

describe("getClaimVerificationReport", () => {
    it("returns PASS for empty claims", () => {
        const report = getClaimVerificationReport([]);
        expect(report.overallStatus).toBe("PASS");
        expect(report.coveragePct).toBe(100);
    });

    it("returns FAIL when fabrication risk exists", () => {
        const claims = verifyClaims(
            [makeClaim({ text: "Studies show that 40% of users abandon within 30 days.", type: "FACT" })],
            null, null, false, false,
        );
        const report = getClaimVerificationReport(claims);
        expect(report.overallStatus).toBe("FAIL");
        expect(report.fabricationRiskCount).toBe(1);
    });

    it("returns NEEDS_REVIEW when unsupported claims exist", () => {
        const claims = verifyClaims(
            [makeClaim({ text: "Conversion rates improved by 200% after the migration to production.", type: "STATISTIC" })],
            null, null, false, false,
        );
        const report = getClaimVerificationReport(claims);
        expect(report.overallStatus).toBe("NEEDS_REVIEW");
        expect(report.unsupportedCount).toBe(1);
    });

    it("returns PASS when all claims are verified or first-party", () => {
        const claims: MaterialClaim[] = [
            makeClaim({ id: "c-1", text: "Our team found that 25% of audits reveal critical issues.", type: "FIRST_PARTY_EXPERIENCE" }),
        ];
        const verified = verifyClaims(claims, null, null, true, true);
        const report = getClaimVerificationReport(verified);
        expect(report.overallStatus).toBe("PASS");
        expect(report.firstPartyCount).toBe(1);
        expect(report.coveragePct).toBe(100);
    });

    it("computes coverage percentage correctly", () => {
        const verified = [
            { claim: makeClaim({ id: "c-1" }), status: "VERIFIED" as const, supportLevel: "STRONG" as const, evidenceMatches: [], reasoning: "", requiresSource: true, isFirstParty: false, isInference: false },
            { claim: makeClaim({ id: "c-2" }), status: "FIRST_PARTY" as const, supportLevel: "NONE" as const, evidenceMatches: [], reasoning: "", requiresSource: false, isFirstParty: true, isInference: false },
            { claim: makeClaim({ id: "c-3" }), status: "UNSUPPORTED" as const, supportLevel: "NONE" as const, evidenceMatches: [], reasoning: "", requiresSource: true, isFirstParty: false, isInference: false },
            { claim: makeClaim({ id: "c-4" }), status: "INFERRED" as const, supportLevel: "NONE" as const, evidenceMatches: [], reasoning: "", requiresSource: false, isFirstParty: false, isInference: true },
        ];
        const report = getClaimVerificationReport(verified);
        expect(report.totalClaims).toBe(4);
        expect(report.coveragePct).toBe(75);
        expect(report.overallStatus).toBe("NEEDS_REVIEW");
    });
});
