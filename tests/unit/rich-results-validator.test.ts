import { describe, it, expect } from "vitest";
import { autoFixSchemaMarkup, validateRichResultsWithGoogleApi } from "@/lib/schema/rich-results-validator";

describe("Google Rich Results API Pre-Flight Validator", () => {
    it("should auto-correct invalid schema markup JSON-LD fields", () => {
        const invalidSchema = JSON.stringify({
            "@context": "http://schema.org",
            headline: "My Article",
        });

        const result = autoFixSchemaMarkup(invalidSchema);

        expect(result.fixesApplied.length).toBeGreaterThan(0);
        expect(result.fixedJson).toContain('"@context": "https://schema.org"');
        expect(result.fixedJson).toContain('"@type": "Article"');
        expect(result.fixedJson).toContain("OptiAISEO Editorial Team");
    });

    it("should run pre-flight validation and return fallback report when offline", async () => {
        const report = await validateRichResultsWithGoogleApi("https://example.com/blog/test");

        expect(report.verdict).toBeDefined();
        expect(report.detectedItems).toBeDefined();
    });
});
