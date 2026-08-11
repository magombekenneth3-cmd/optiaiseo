import { describe, it, expect } from "vitest";
import { auditLlmBrandHallucinations } from "@/lib/gsov/hallucination-defense";

describe("Generative Citation & Hallucination Defense Engine Unit Tests", () => {
    it("should audit LLM probe network for brand hallucinations and generate Entity Schema + sameAs Wikidata declarations", async () => {
        const report = await auditLlmBrandHallucinations(
            "site-123",
            "OptiAISEO",
            "best aeo software",
            "optiaiseo.com"
        );

        expect(report).toBeDefined();
        expect(report.siteId).toBe("site-123");
        expect(report.brandName).toBe("OptiAISEO");
        expect(report.targetDomain).toBe("optiaiseo.com");
        expect(report.overallAccuracyScore).toBeGreaterThanOrEqual(0);
        expect(report.overallAccuracyScore).toBeLessThanOrEqual(100);

        expect(report.entitySchemaCorrection).toBeDefined();
        expect(report.entitySchemaCorrection.organizationSchema).toContain("OptiAISEO");
        expect(report.entitySchemaCorrection.organizationSchema).toContain("sameAs");
        expect(report.entitySchemaCorrection.wikidataSameAsDeclarations.length).toBeGreaterThan(0);
        expect(report.entitySchemaCorrection.faqOverrideSchema).toContain("FAQPage");
    }, 15000);
});
