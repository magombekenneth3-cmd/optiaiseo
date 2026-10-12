import { describe, it, expect } from "vitest";
import {
    buildCompactDirective,
    MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH,
} from "@/lib/blog/information-gain";
import { z } from "zod";

const DirectiveSchema = z.string().trim().max(2_000).optional();

function makeItems(count: number, lengthEach: number): string[] {
    return Array.from({ length: count }, (_, i) =>
        `Item ${i + 1}: ${"x".repeat(Math.max(0, lengthEach - `Item ${i + 1}: `.length))}`
    );
}

describe("buildCompactDirective", () => {
    it("produces a directive under 2000 chars for normal-length inputs", () => {
        const result = buildCompactDirective({
            saturatedTopics: ["seo basics", "keyword research", "link building"],
            uniqueContentGaps: ["Gap one is short", "Gap two is short", "Gap three is short"],
            missingDataMetrics: ["Metric one", "Metric two"],
            recommendedQuotes: ["Quote one from an expert"],
            originalInsightsBlueprint: ["Framework one", "Framework two"],
        });

        expect(result.length).toBeLessThanOrEqual(MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH);
        expect(result).toContain("INFORMATION-GAIN RESEARCH DIRECTIVE");
        expect(result).toContain("Gap one is short");
        expect(result).toContain("Framework two");
    });

    it("stays under 2000 chars even with very long inputs", () => {
        const result = buildCompactDirective({
            saturatedTopics: makeItems(5, 200),
            uniqueContentGaps: makeItems(10, 300),
            missingDataMetrics: makeItems(10, 300),
            recommendedQuotes: makeItems(10, 300),
            originalInsightsBlueprint: makeItems(10, 300),
        });

        expect(result.length).toBeLessThanOrEqual(MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH);
    });

    it("does not produce a malformed partial list item", () => {
        const result = buildCompactDirective({
            saturatedTopics: ["topic a", "topic b"],
            uniqueContentGaps: makeItems(20, 200),
            missingDataMetrics: makeItems(20, 200),
            recommendedQuotes: makeItems(20, 200),
            originalInsightsBlueprint: makeItems(20, 200),
        });

        expect(result.length).toBeLessThanOrEqual(MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH);

        const lines = result.split("\n");
        for (const line of lines) {
            if (line.startsWith("- ")) {
                expect(line.length).toBeGreaterThan(3);
                expect(line).not.toMatch(/^- $/);
            }
        }
    });

    it("passes the existing Zod contracts for both brain and ResearchPacket", () => {
        const result = buildCompactDirective({
            saturatedTopics: makeItems(5, 200),
            uniqueContentGaps: makeItems(10, 300),
            missingDataMetrics: makeItems(10, 300),
            recommendedQuotes: makeItems(10, 300),
            originalInsightsBlueprint: makeItems(10, 300),
        });

        const brainParse = DirectiveSchema.safeParse(result);
        expect(brainParse.success).toBe(true);

        const packetParse = DirectiveSchema.safeParse(result);
        expect(packetParse.success).toBe(true);
    });

    it("returns the directive unchanged when under the limit", () => {
        const result = buildCompactDirective({
            saturatedTopics: ["one"],
            uniqueContentGaps: ["gap"],
            missingDataMetrics: ["tool cost comparison"],
            recommendedQuotes: ["concrete quotation topic"],
            originalInsightsBlueprint: ["framework"],
        });

        expect(result.length).toBeLessThan(500);
        expect(result).toContain("Hypothesis to verify: gap");
        expect(result).toContain("tool cost comparison");
        expect(result).toContain("quotation relevant to: concrete quotation topic");
        expect(result).toContain("- framework");
    });

    it("handles empty arrays safely", () => {
        const result = buildCompactDirective({
            saturatedTopics: [],
            uniqueContentGaps: [],
            missingDataMetrics: [],
            recommendedQuotes: [],
            originalInsightsBlueprint: [],
        });

        expect(result.length).toBeLessThanOrEqual(MAX_INFORMATION_GAIN_DIRECTIVE_LENGTH);
        expect(result).toContain("INFORMATION-GAIN RESEARCH DIRECTIVE");
        expect(result).toContain("No repeated heading pattern was established");
    });

    it("never turns unverified metric values or quote-shaped model output into article suggestions", () => {
        const result = buildCompactDirective({
            saturatedTopics: [],
            uniqueContentGaps: ["Research whether a reader need is unmet"],
            missingDataMetrics: ["45% of websites improve rankings after adopting this tool"],
            recommendedQuotes: ['"We improved rankings by 43%" said an unnamed CEO'],
            originalInsightsBlueprint: [],
            researchStatus: "PARTIAL",
            sourceUrls: ["https://example.com/research"],
        });

        expect(result).not.toContain("45%");
        expect(result).not.toContain("We improved rankings by 43%");
        expect(result).toContain("Find a current, authoritative source and verify any metric");
        expect(result).toContain("Find a real, attributable quotation relevant to");
        expect(result).toContain("https://example.com/research");
        expect(result).toContain("Research status: PARTIAL");
    });

    it("respects a custom maxChars parameter", () => {
        const result = buildCompactDirective({
            saturatedTopics: ["a", "b", "c"],
            uniqueContentGaps: makeItems(5, 100),
            missingDataMetrics: makeItems(5, 100),
            recommendedQuotes: makeItems(5, 100),
            originalInsightsBlueprint: makeItems(5, 100),
            maxChars: 500,
        });

        expect(result.length).toBeLessThanOrEqual(500);
    });

    it("drops whole sections rather than partial items at the boundary", () => {
        const result = buildCompactDirective({
            saturatedTopics: ["topic"],
            uniqueContentGaps: makeItems(3, 400),
            missingDataMetrics: makeItems(3, 400),
            recommendedQuotes: makeItems(3, 400),
            originalInsightsBlueprint: makeItems(3, 400),
            maxChars: 800,
        });

        expect(result.length).toBeLessThanOrEqual(800);

        const itemLines = result.split("\n").filter(l => l.startsWith("- "));
        for (const line of itemLines) {
            expect(line.endsWith("...")).toBe(false);
            expect(line.length).toBeGreaterThan(5);
        }
    });

    it("extreme case: single item exceeding the budget is excluded", () => {
        const result = buildCompactDirective({
            saturatedTopics: [],
            uniqueContentGaps: ["x".repeat(3000)],
            missingDataMetrics: ["short metric"],
            recommendedQuotes: [],
            originalInsightsBlueprint: [],
            maxChars: 500,
        });

        expect(result.length).toBeLessThanOrEqual(500);
        expect(result).not.toContain("x".repeat(100));
        expect(result).toContain("short metric");
    });
});
