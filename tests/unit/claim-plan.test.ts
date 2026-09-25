import { describe, it, expect } from "vitest";
import {
    buildClaimPlan,
    renderClaimPlanForSection,
    renderFullClaimPlan,
} from "@/lib/blog/claim-plan";
import type { ResearchPacket } from "@/lib/blog/contracts";
import type { ResearchEvidenceLedger } from "@/lib/blog/evidence-ledger";
import type { OutlineSection } from "@/lib/blog/pipeline";

function makeSection(overrides: Partial<OutlineSection> = {}): OutlineSection {
    return {
        heading: "How SEO Audits Improve Organic Traffic",
        goal: "Explain why SEO audits drive organic traffic growth",
        tone: "analytical",
        evidenceType: "data",
        wordTarget: 400,
        keyEntities: ["SEO audit", "organic traffic"],
        ...overrides,
    };
}

function makePacket(sources: ResearchPacket["sources"] = []): ResearchPacket {
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
        serp: { competitors: [], paa: [], format: null },
        sources,
        entities: [],
        authorEvidence: { name: "Test Author" },
        contentGaps: [],
        misconceptions: [],
        contrarianAngles: [],
    };
}

function makeLedger(items: ResearchEvidenceLedger["evidenceItems"] = []): ResearchEvidenceLedger {
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

describe("buildClaimPlan", () => {
    it("builds a plan with sections matching outline", () => {
        const sections = [
            makeSection({ heading: "SEO Audit Basics" }),
            makeSection({ heading: "Advanced Techniques" }),
        ];
        const plan = buildClaimPlan(sections, makePacket(), null, "seo audit");
        expect(plan.sectionPlans).toHaveLength(2);
        expect(plan.sectionPlans[0].sectionHeading).toBe("SEO Audit Basics");
        expect(plan.sectionPlans[1].sectionHeading).toBe("Advanced Techniques");
        expect(plan.topic).toBe("seo audit");
    });

    it("maps evidence items to sections by keyword overlap", () => {
        const sections = [makeSection({ heading: "How SEO Audits Improve Organic Traffic" })];
        const ledger = makeLedger([{
            id: "ev-1",
            content: "SEO audits identify technical issues that block organic traffic growth and improve rankings.",
            excerpt: "SEO audit organic traffic growth",
            category: "seo",
            provenance: {
                sourceType: "EXTERNAL_SOURCE",
                sourceUrl: "https://example.com/seo-study",
                sourceTitle: "SEO Study",
                sourcePublisher: "Example",
                sourcePublishedAt: null,
                capturedAt: new Date().toISOString(),
                retrievalMethod: "serp_api",
                confidence: 0.9,
                authorityScore: null,
            },
            metadata: {},
        }]);
        const plan = buildClaimPlan(sections, makePacket(), ledger, "seo audit");
        expect(plan.sectionPlans[0].claims.length).toBeGreaterThan(0);
        expect(plan.sectionPlans[0].claims[0].evidenceIds).toContain("ev-1");
        expect(plan.evidenceBackedCount).toBeGreaterThan(0);
    });

    it("excludes LLM_GENERATED evidence from claim plans", () => {
        const sections = [makeSection()];
        const ledger = makeLedger([{
            id: "ev-llm",
            content: "SEO audits improve organic traffic by identifying technical issues.",
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
        const plan = buildClaimPlan(sections, makePacket(), ledger, "seo audit");
        const llmClaims = plan.sectionPlans[0].claims.filter(
            c => c.evidenceIds.includes("ev-llm"),
        );
        expect(llmClaims).toHaveLength(0);
    });

    it("maps research packet sources to sections", () => {
        const sections = [makeSection({ heading: "How SEO Audits Drive Results" })];
        const packet = makePacket([{
            id: "src-1",
            url: "https://example.com/audit-study",
            title: "Audit Study",
            retrievedAt: new Date().toISOString(),
            claim: "SEO audits drive measurable improvements in organic search results.",
            evidence: "A study found that sites completing full audits saw 25% traffic growth.",
            sourceType: "research",
            confidence: 0.85,
        }]);
        const plan = buildClaimPlan(sections, packet, null, "seo audit");
        expect(plan.sectionPlans[0].claims.length).toBeGreaterThan(0);
        const srcClaim = plan.sectionPlans[0].claims.find(c => c.evidenceIds.includes("src-1"));
        expect(srcClaim).toBeDefined();
    });

    it("classifies claim types correctly from evidence", () => {
        const sections = [makeSection()];
        const ledger = makeLedger([{
            id: "ev-stat",
            content: "Sites that run quarterly SEO audits see 25% more organic traffic growth on average.",
            excerpt: "25% more organic traffic",
            category: "seo",
            provenance: {
                sourceType: "EXTERNAL_SOURCE",
                sourceUrl: "https://example.com",
                sourceTitle: "Study",
                sourcePublisher: "Publisher",
                sourcePublishedAt: null,
                capturedAt: new Date().toISOString(),
                retrievalMethod: "serp_api",
                confidence: 0.9,
                authorityScore: null,
            },
            metadata: {},
        }]);
        const plan = buildClaimPlan(sections, makePacket(), ledger, "seo audit");
        const statClaim = plan.sectionPlans[0].claims.find(c => c.evidenceIds.includes("ev-stat"));
        expect(statClaim?.type).toBe("STATISTIC");
        expect(statClaim?.evidenceRequired).toBe(true);
        expect(statClaim?.allowedInterpretation).toBe("VERBATIM");
    });

    it("adds opinion claim for opinion sections", () => {
        const sections = [makeSection({ evidenceType: "opinion" })];
        const plan = buildClaimPlan(sections, makePacket(), null, "seo audit");
        const opinionClaims = plan.sectionPlans[0].claims.filter(c => c.type === "OPINION");
        expect(opinionClaims.length).toBeGreaterThan(0);
        expect(opinionClaims[0].evidenceRequired).toBe(false);
    });

    it("counts claim types in plan summary", () => {
        const sections = [makeSection(), makeSection({ evidenceType: "opinion" })];
        const ledger = makeLedger([{
            id: "ev-fp",
            content: "Our team tested this organic traffic audit approach over six months.",
            excerpt: "Our team tested organic traffic audit",
            category: "seo",
            provenance: {
                sourceType: "FIRST_PARTY_EXPERIENCE",
                sourceUrl: null,
                sourceTitle: null,
                sourcePublisher: null,
                sourcePublishedAt: null,
                capturedAt: new Date().toISOString(),
                retrievalMethod: "author_profile",
                confidence: 0.95,
                authorityScore: null,
            },
            metadata: {},
        }]);
        const plan = buildClaimPlan(sections, makePacket(), ledger, "seo audit");
        expect(plan.firstPartyCount).toBeGreaterThanOrEqual(1);
        expect(plan.opinionCount).toBeGreaterThanOrEqual(1);
    });
});

describe("renderClaimPlanForSection", () => {
    it("renders empty plan with instructions", () => {
        const rendered = renderClaimPlanForSection({
            sectionHeading: "Test",
            sectionGoal: "Test goal",
            claims: [],
            evidenceInstructions: "No evidence available.",
        });
        expect(rendered).toContain("No pre-planned claims");
        expect(rendered).toContain("No evidence available.");
    });

    it("renders claims with evidence IDs and interpretation", () => {
        const rendered = renderClaimPlanForSection({
            sectionHeading: "SEO Audit Results",
            sectionGoal: "Show audit outcomes",
            claims: [{
                id: "plan-s0-0",
                claim: "Sites see 25% traffic growth after audits.",
                type: "STATISTIC",
                importance: "CRITICAL",
                evidenceIds: ["ev-1"],
                evidenceRequired: true,
                allowedInterpretation: "VERBATIM",
                sectionId: "s0",
                sourceExcerpt: "25% traffic growth study data",
                sourceUrl: "https://example.com/study",
            }],
            evidenceInstructions: "1 evidence-backed claim available.",
        });
        expect(rendered).toContain("STATISTIC");
        expect(rendered).toContain("CRITICAL");
        expect(rendered).toContain("VERBATIM");
        expect(rendered).toContain("ev-1");
        expect(rendered).toContain("https://example.com/study");
    });
});

describe("renderFullClaimPlan", () => {
    it("renders complete plan summary", () => {
        const sections = [makeSection()];
        const plan = buildClaimPlan(sections, makePacket(), null, "seo audit");
        const rendered = renderFullClaimPlan(plan);
        expect(rendered).toContain("CLAIM PLAN SUMMARY:");
        expect(rendered).toContain("seo audit");
        expect(rendered).toContain("CLAIM PLAN GUARDRAILS");
        expect(rendered).toContain("Do NOT invent");
    });
});
