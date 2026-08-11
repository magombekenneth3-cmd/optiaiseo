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

    it("should inject visual evidence figure into blog text", () => {
        const blogText = "<p>First paragraph explaining topic.</p><p>Second paragraph with data points.</p>";
        const enriched = injectVisualEvidenceIntoBlog(blogText, "AI Citation Rates");

        expect(enriched).toContain("<figure class=");
        expect(enriched).toContain("Figure 1:");
        expect(enriched).toContain("Source: OptiAISEO AEO Intelligence Index 2026");
    });
});
