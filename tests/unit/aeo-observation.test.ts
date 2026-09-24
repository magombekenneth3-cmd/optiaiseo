import { describe, it, expect } from "vitest";
import {
    classifyCitationPosition,
    createObservation,
    isDirectCitation,
    summarizeObservations,
    type CitationObservation,
} from "@/lib/aeo/observation";
import type { MentionResult } from "@/lib/aeo/multi-model";

function makeMention(overrides: Partial<MentionResult> = {}): MentionResult {
    return {
        model: "TestModel",
        mentioned: true,
        confidence: 80,
        providerStatus: "SUCCESS",
        snippet: "brand is great",
        ...overrides,
    };
}

describe("classifyCitationPosition", () => {
    it("returns absent when not mentioned", () => {
        expect(classifyCitationPosition(false, null, 1000)).toBe("absent");
        expect(classifyCitationPosition(null, null, 1000)).toBe("absent");
    });

    it("returns primary when mention is in the first 25%", () => {
        expect(classifyCitationPosition(true, 100, 1000)).toBe("primary");
        expect(classifyCitationPosition(true, 0, 1000)).toBe("primary");
    });

    it("returns supporting when mention is between 25-50%", () => {
        expect(classifyCitationPosition(true, 300, 1000)).toBe("supporting");
    });

    it("returns mentioned when mention is after 50%", () => {
        expect(classifyCitationPosition(true, 600, 1000)).toBe("mentioned");
    });

    it("returns mentioned when response length is 0", () => {
        expect(classifyCitationPosition(true, 0, 0)).toBe("mentioned");
    });
});

describe("createObservation", () => {
    it("creates a well-formed observation from a MentionResult", () => {
        const result = makeMention();
        const obs = createObservation(result, "best tools for SEO?");

        expect(obs.model).toBe("TestModel");
        expect(obs.query).toBe("best tools for SEO?");
        expect(obs.confidence).toBe(80);
        expect(obs.observedAt).toBeInstanceOf(Date);
    });

    it("sets position to absent for failed providers", () => {
        const result = makeMention({ mentioned: null, providerStatus: "PROVIDER_ERROR" });
        const obs = createObservation(result, "test query");

        expect(obs.position).toBe("absent");
    });

    it("computes mentionOffset from responseText and snippet", () => {
        const result = makeMention({ snippet: "brand is great" });
        const responseText = "Some intro text. brand is great for SEO.";
        const obs = createObservation(result, "test", responseText);

        expect(obs.mentionOffset).toBe(17);
        expect(obs.responseLength).toBe(responseText.length);
    });
});

describe("isDirectCitation", () => {
    it("returns true when source URL matches brand domain", () => {
        expect(isDirectCitation("https://example.com/page", "example.com")).toBe(true);
        expect(isDirectCitation("https://www.example.com/page", "example.com")).toBe(true);
    });

    it("returns true for subdomains", () => {
        expect(isDirectCitation("https://blog.example.com/post", "example.com")).toBe(true);
    });

    it("returns false for different domains", () => {
        expect(isDirectCitation("https://competitor.com/page", "example.com")).toBe(false);
    });

    it("handles malformed URLs gracefully", () => {
        expect(isDirectCitation("not-a-url", "example.com")).toBe(false);
    });

    it("strips protocol and www from brand domain", () => {
        expect(isDirectCitation("https://example.com/", "https://www.example.com")).toBe(true);
    });
});

describe("summarizeObservations", () => {
    it("returns zeroed summary for empty observations", () => {
        const summary = summarizeObservations([]);
        expect(summary.totalObservations).toBe(0);
        expect(summary.mentionRate).toBe(0);
    });

    it("computes correct rates", () => {
        const obs: CitationObservation[] = [
            {
                model: "A", query: "q", observedAt: new Date(),
                position: "primary", confidence: 90, snippet: "s", mentionOffset: 0,
                responseLength: 100, isAuthoritative: true, sourceUrls: ["https://example.com"],
                directCitation: true, competitorsMentioned: ["Comp1"], totalBrandsMentioned: 2,
            },
            {
                model: "B", query: "q", observedAt: new Date(),
                position: "absent", confidence: 0, snippet: null, mentionOffset: null,
                responseLength: 100, isAuthoritative: false, sourceUrls: [],
                directCitation: false, competitorsMentioned: ["Comp1", "Comp2"], totalBrandsMentioned: 2,
            },
        ];

        const summary = summarizeObservations(obs);
        expect(summary.totalObservations).toBe(2);
        expect(summary.mentionRate).toBe(50);
        expect(summary.primaryRate).toBe(50);
        expect(summary.authoritativeRate).toBe(50);
        expect(summary.directCitationRate).toBe(50);
        expect(summary.avgConfidence).toBe(90);
    });

    it("aggregates competitors correctly", () => {
        const obs: CitationObservation[] = [
            {
                model: "A", query: "q", observedAt: new Date(),
                position: "mentioned", confidence: 50, snippet: "s", mentionOffset: 50,
                responseLength: 100, isAuthoritative: false, sourceUrls: [],
                directCitation: false, competitorsMentioned: ["Ahrefs", "Semrush"], totalBrandsMentioned: 3,
            },
            {
                model: "B", query: "q", observedAt: new Date(),
                position: "supporting", confidence: 60, snippet: "s", mentionOffset: 30,
                responseLength: 100, isAuthoritative: false, sourceUrls: [],
                directCitation: false, competitorsMentioned: ["Ahrefs"], totalBrandsMentioned: 2,
            },
        ];

        const summary = summarizeObservations(obs);
        expect(summary.topCompetitors[0].name).toBe("Ahrefs");
        expect(summary.topCompetitors[0].count).toBe(2);
    });
});
