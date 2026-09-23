import { describe, expect, it } from "vitest";
import { runContentLint } from "@/lib/blog/content-lint";

describe("final content lint", () => {
    it("blocks duplicate headings and placeholders", () => {
        const result = runContentLint(
            "<h1>Article</h1><h2>First</h2><p>Useful content with enough detail to pass.</p><h2>First</h2><p>More useful content with enough detail to pass.</p><p>[EDITOR: fix this]</p>"
        );
        expect(result.passed).toBe(false);
        expect(result.blockingIssues.some(issue => /duplicate h2/i.test(issue))).toBe(true);
        expect(result.blockingIssues.some(issue => /placeholder/i.test(issue))).toBe(true);
    });

    it("passes balanced, cited article markup", () => {
        const result = runContentLint(
            '<h1>Article</h1><h2>Research</h2><p>This is a sufficiently detailed paragraph with a concrete claim and a source.</p><h2>How it works</h2><p>Another sufficiently detailed paragraph explains the process.</p><h2>Sources</h2><p>Read <a href="https://developers.google.com/search/docs">the documentation</a>.</p>'
        );
        expect(result.passed).toBe(true);
    });
});
