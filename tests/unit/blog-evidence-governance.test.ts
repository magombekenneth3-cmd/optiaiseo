import { describe, expect, it } from "vitest";
import { extractEvidencePacket } from "@/lib/blog/evidence-extractor";
import type { ResearchPacket } from "@/lib/blog/contracts";

const packet: ResearchPacket = {
    collectedAt: new Date("2026-09-23T00:00:00.000Z").toISOString(),
    evidenceAvailability: "AVAILABLE",
    keyword: "seo tools",
    intent: "Compare SEO tools",
    brain: {
        intent: "Compare SEO tools",
        searcherMindset: "Evaluating options",
        contentGaps: [],
        entities: ["Example Study"],
        contrarianAngles: [],
        examplesNeeded: [],
        faqTargets: [],
        commonMisconceptions: [],
        industryMyths: [],
        whatPeopleAvoidSaying: [],
    },
    serp: { competitors: [], paa: [], format: "comparison" },
    sources: [{
        id: "source-1",
        url: "https://example.com/study",
        title: "Example Study",
        publisher: "example.com",
        retrievedAt: new Date("2026-09-23T00:00:00.000Z").toISOString(),
        claim: "The study reports that 34% of respondents use SEO tools.",
        evidence: "The study reports that 34% of respondents use SEO tools.",
        sourceType: "other",
        confidence: 0.8,
    }],
    entities: [{
        entity: "Example Study",
        reason: "Research source",
        sourceIds: ["source-1"],
    }],
    authorEvidence: { name: "Test Author" },
    contentGaps: [],
    misconceptions: [],
    contrarianAngles: [],
};

describe("blog evidence governance", () => {
    it("does not infer provenance for an uncited statistic that merely matches source data", () => {
        const content = [
            '<p>The study reports that 34% of respondents use SEO tools. <a href="https://example.com/study">Example Study</a>.</p>',
            "<p>A second claim says 34% of teams use SEO tools, but it has no citation.</p>",
        ].join("");

        const packetResult = extractEvidencePacket(packet, content);
        const second = packetResult.claimSourceMap.find((claim) => claim.claim.includes("A second claim says"));

        expect(second).toBeDefined();
        expect(second?.matchMethod).toBe("unsupported");
        expect(second?.sourceIds).toEqual([]);
        expect(packetResult.unsourcedStatistics).toHaveLength(1);
    });
});
