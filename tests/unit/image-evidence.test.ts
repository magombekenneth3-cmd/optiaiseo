import { describe, it, expect } from "vitest";
import { generateSvgDataGraphic, injectVisualEvidenceIntoBlog } from "@/lib/blog/image-evidence";

describe("Visual Evidence Engine for Blogs", () => {
    it("should generate SVG data chart graphics with source attribution", () => {
        const result = generateSvgDataGraphic({
            title: "Generative Engine Optimization Impact",
            type: "COMPARISON_BAR",
            dataPoints: [
                { label: "Legacy Keyword SEO", value: 32, unit: "%" },
                { label: "AEO Citation Rate", value: 91, unit: "%" },
            ],
            sourceAttribution: "OptiAISEO Benchmark Study 2026",
        });

        expect(result.svgContent).toContain("Generative Engine Optimization Impact");
        expect(result.svgContent).toContain("Legacy Keyword SEO");
        expect(result.svgContent).toContain("OptiAISEO Benchmark Study 2026");
        expect(result.figureHtml).toContain("<figure class=");
        expect(result.figureHtml).toContain("Figure 1:");
    });

    it("should NOT inject visual evidence when no dataPoints are supplied", () => {
        const blogText = "<p>First paragraph explaining topic.</p><p>Second paragraph with data points.</p>";
        const result = injectVisualEvidenceIntoBlog(blogText, "AI Citation Rates");

        // No chart should be injected — fabricated data was removed (P0-2)
        expect(result).not.toContain("<figure class=");
        expect(result).toBe(blogText);
    });

    it("should NOT inject visual evidence when dataPoints exist but sourceAttribution is missing", () => {
        const blogText = "<p>First paragraph.</p><p>Second paragraph.</p>";
        const dataPoints = [{ label: "Test Metric", value: 75, unit: "%" }];
        const result = injectVisualEvidenceIntoBlog(blogText, "Test Topic", dataPoints);

        expect(result).not.toContain("<figure class=");
        expect(result).toBe(blogText);
    });

    it("should inject visual evidence when real dataPoints AND sourceAttribution are supplied", () => {
        const blogText = "<p>First paragraph explaining topic.</p><p>Second paragraph with data points.</p>";
        const dataPoints = [
            { label: "Industry Average", value: 35, unit: "%" },
            { label: "After Optimization", value: 78, unit: "%" },
        ];
        const enriched = injectVisualEvidenceIntoBlog(blogText, "AI Citation Rates", dataPoints, "Ahrefs Study 2026");

        expect(enriched).toContain("<figure class=");
        expect(enriched).toContain("Figure 1:");
        expect(enriched).toContain("Source: Ahrefs Study 2026");
    });
});
