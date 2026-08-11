import { describe, it, expect } from "vitest";
import { performOneClickAutoFix } from "@/lib/autofix/fixer";

describe("One-Click Auto-Fix Engine", () => {
    it("should fix missing alt text on images", () => {
        const inputHtml = `<html><body><img src="/assets/hero-banner.png" /></body></html>`;
        const result = performOneClickAutoFix(inputHtml, "https://example.com");

        expect(result.fixedHtml).toContain('alt="Image depicting hero banner.png"');
        expect(result.changes).toContainEqual(
            expect.objectContaining({
                type: "ALT_TEXT",
            })
        );
    });

    it("should inject missing canonical tag", () => {
        const inputHtml = `<html><head><title>Test Page</title></head><body></body></html>`;
        const targetUrl = "https://example.com/test-page";
        const result = performOneClickAutoFix(inputHtml, targetUrl);

        expect(result.fixedHtml).toContain(`href="${targetUrl}"`);
        expect(result.changes).toContainEqual(
            expect.objectContaining({
                type: "CANONICAL",
            })
        );
    });

    it("should inject missing OpenGraph tags", () => {
        const inputHtml = `<html><head><title>My Article</title><meta name="description" content="Article summary" /></head><body></body></html>`;
        const targetUrl = "https://example.com/my-article";
        const result = performOneClickAutoFix(inputHtml, targetUrl);

        expect(result.fixedHtml).toContain('property="og:title" content="My Article"');
        expect(result.fixedHtml).toContain('property="og:description" content="Article summary"');
        expect(result.changes).toContainEqual(
            expect.objectContaining({
                type: "OPEN_GRAPH",
            })
        );
    });

    it("should resolve heading hierarchy errors (multiple H1s & skipped levels)", () => {
        const inputHtml = `<html><body><h1>First H1</h1><h1>Second H1</h1><h4>Skipped H4</h4></body></html>`;
        const result = performOneClickAutoFix(inputHtml, "https://example.com");

        expect(result.fixedHtml).toContain("<h1>First H1</h1>");
        expect(result.fixedHtml).toContain("<h2>Second H1</h2>");
        expect(result.fixedHtml).toContain("<h3>Skipped H4</h3>");
        expect(result.changes).toContainEqual(
            expect.objectContaining({
                type: "HEADING_HIERARCHY",
            })
        );
    });

    it("should fix broken 404 links", () => {
        const inputHtml = `<html><body><a href="#">Broken link</a></body></html>`;
        const targetUrl = "https://example.com";
        const result = performOneClickAutoFix(inputHtml, targetUrl);

        expect(result.fixedHtml).toContain(`href="${targetUrl}"`);
        expect(result.changes).toContainEqual(
            expect.objectContaining({
                type: "REDIRECT_404",
            })
        );
    });
});
