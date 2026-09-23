import { describe, expect, it } from "vitest";
import { buildClaimLedger } from "@/lib/blog/claim-ledger";
import type { EvidencePacket } from "@/lib/blog/contracts";

function packet(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
    const source = {
        id: "source-1",
        url: "https://developers.google.com/search/docs",
        title: "Google Search documentation",
        publisher: "developers.google.com",
        publishedAt: new Date(Date.now() - 800 * 86_400_000).toISOString(),
        retrievedAt: new Date().toISOString(),
        claim: "Google documents how search systems work.",
        evidence: "Google documents how search systems work and provides guidance for search visibility.",
        sourceType: "official" as const,
        confidence: 0.95,
        authorityScore: 0.95,
    };
    return {
        availability: "AVAILABLE",
        claims: [
            { text: "Google changed its pricing in 2026.", sourceIds: ["source-1"], type: "statistic" },
            { text: "This claim has no source.", sourceIds: [], type: "fact" },
            { text: "A fabricated claim.", sourceIds: ["source-1"], type: "fact" },
        ],
        sources: [source],
        claimSourceMap: [
            { claim: "Google changed its pricing in 2026.", sourceIds: ["source-1"], matchMethod: "explicit_citation" },
            { claim: "This claim has no source.", sourceIds: [], matchMethod: "unsupported" },
            { claim: "A fabricated claim.", sourceIds: ["source-1"], matchMethod: "explicit_citation" },
        ],
        examples: [],
        caseStudies: [],
        visuals: [],
        unsupportedClaims: ["This claim has no source."],
        unsourcedStatistics: ["Google changed its pricing in 2026."],
        unverifiedCaseStudies: [],
        fabricatedClaims: ["A fabricated claim."],
        extraction: {
            extractedAt: new Date().toISOString(),
            extractorVersion: "test",
            researchAvailability: "AVAILABLE",
            researchCollectedAt: new Date().toISOString(),
            sourceCitationCount: 2,
            claimCount: 3,
        },
        ...overrides,
    };
}

describe("claim ledger governance", () => {
    it("routes stale factual evidence to rewrite", () => {
        const ledger = buildClaimLedger(packet());
        const claim = ledger[0];
        expect(claim.verificationStatus).toBe("unsupported");
        expect(claim.action).toBe("REMOVE");
        expect(claim.freshnessStatus).toBe("stale");
    });

    it("routes uncited claims to removal", () => {
        const ledger = buildClaimLedger(packet());
        expect(ledger[1].verificationStatus).toBe("unsupported");
        expect(ledger[1].action).toBe("REMOVE");
    });

    it("routes independently fabricated claims to block", () => {
        const ledger = buildClaimLedger(packet());
        expect(ledger[2].verificationStatus).toBe("blocked");
        expect(ledger[2].action).toBe("BLOCK");
    });
});
