import { describe, expect, it } from "vitest";
import {
    UNSPLASH_UTM_SOURCE,
    selectDistinctUnsplashPhotos,
    type UnsplashCandidate,
} from "@/lib/blog";
import {
    ensureHeadingIdsInHtml,
    formatKeywordDisplay,
    slugifyHeading,
} from "@/lib/blog/markdown";
import {
    auditSubheadingQuality,
    detectUnsourcedStatistics,
    validateInteractiveWidgetHtml,
} from "@/lib/blog/validators";
import { getFunnelForIntent } from "@/lib/aeo/funnels";
import { sanitizeHtml } from "@/lib/sanitize-html";

function candidate(id: string, photographer = "Merakist"): UnsplashCandidate {
    return {
        id,
        urls: {
            regular: `https://images.unsplash.com/photo-${id}?w=1080`,
            small: `https://images.unsplash.com/photo-${id}?w=400`,
        },
        alt_description: `Photo ${id}`,
        user: {
            name: photographer,
            links: { html: `https://unsplash.com/@${photographer.toLowerCase()}` },
        },
        links: { html: `https://unsplash.com/photos/${id}` },
    };
}

describe("Phase 3 — Media, Links, Theme & Prose Discipline", () => {
    describe("1. Unsplash photo deduplication and UTM attribution", () => {
        it("assigns distinct photos across hero and inline slots when queries share top results", () => {
            const shared = candidate("l5if0iQfV4c", "Merakist");
            const second = candidate("ZPOoDQc8yMw", "Steve");
            const third = candidate("x90123abc", "Alice");

            const picked = selectDistinctUnsplashPhotos([
                { candidates: [shared, second, third], fallbackAlt: "seo hero" },
                { candidates: [shared, second, third], fallbackAlt: "section 1" },
                { candidates: [shared, second, third], fallbackAlt: "section 2" },
                { candidates: [shared], fallbackAlt: "section 3" },
            ]);

            expect(picked[0]?.id).toBe("l5if0iQfV4c");
            expect(picked[1]?.id).toBe("ZPOoDQc8yMw");
            expect(picked[2]?.id).toBe("x90123abc");
            // When no distinct photo remains for a slot, omit duplicate rather than repeating
            expect(picked[3]).toBeNull();
        });

        it("stamps utm_source=optiaiseo instead of legacy seoTool", () => {
            const picked = selectDistinctUnsplashPhotos([
                { candidates: [candidate("abc123")], fallbackAlt: "seo analytics" },
            ]);

            expect(UNSPLASH_UTM_SOURCE).toBe("optiaiseo");
            expect(picked[0]?.photographerUrl).toContain("utm_source=optiaiseo&utm_medium=referral");
            expect(picked[0]?.unsplashUrl).toContain("utm_source=optiaiseo&utm_medium=referral");
            expect(picked[0]?.photographerUrl).not.toContain("seoTool");
        });
    });

    describe("2. TOC anchor IDs and sanitizer preservation", () => {
        it("assigns deterministic unique heading IDs even when H2 elements carry existing attributes", () => {
            const raw = `
                <h2 class="section-title">What Is an SEO Tool?</h2>
                <p>Body 1</p>
                <h2 id="custom-id">Choosing Criteria</h2>
                <p>Body 2</p>
                <h2>Choosing Criteria</h2>
            `;
            const { html, headings } = ensureHeadingIdsInHtml(raw);

            expect(headings).toEqual([
                { id: "what-is-an-seo-tool", text: "What Is an SEO Tool?" },
                { id: "custom-id", text: "Choosing Criteria" },
                { id: "choosing-criteria", text: "Choosing Criteria" },
            ]);
            expect(html).toContain('<h2 id="what-is-an-seo-tool" class="section-title">What Is an SEO Tool?</h2>');
            expect(sanitizeHtml(html)).toContain('id="what-is-an-seo-tool"');
            expect(slugifyHeading("The Shift from Keyword Tracking to AI Search Visibility")).toBe(
                "the-shift-from-keyword-tracking-to-ai-search-visibility",
            );
        });
    });

    describe("3. Acronym-preserving keyword display & theme-safe funnel styling", () => {
        it("fixes broken acronym casing such as 'Seo tool' and 'ai seo api'", () => {
            expect(formatKeywordDisplay("Seo tool")).toBe("SEO tool");
            expect(formatKeywordDisplay("seo tool")).toBe("SEO tool");
            expect(formatKeywordDisplay("ai seo api guide")).toBe("AI SEO API guide");
            expect(formatKeywordDisplay("b2b saas cro checklist")).toBe("B2B SaaS CRO checklist");
        });

        it("uses theme-adaptive translucent surface styles instead of jarring light-only hex backgrounds", () => {
            for (const intent of ["transactional", "commercial", "informational", "navigational"] as const) {
                const funnel = getFunnelForIntent(intent, "site-1", "https://optiaiseo.online", "OptiAISEO");
                expect(funnel.htmlSnippet).toContain('data-funnel-cta="true"');
                expect(funnel.htmlSnippet).not.toMatch(/#f8fafc|#eff6ff|#ecfdf5|#f0f9ff/i);
                // Safe background-color survives HTML sanitization
                const sanitized = sanitizeHtml(funnel.htmlSnippet);
                expect(sanitized).toContain("OptiAISEO");
                if (intent !== "navigational") {
                    expect(sanitized).toContain("background-color:");
                }
            }
        });
    });

    describe("4. Editorial prose and interactive widget discipline", () => {
        it("catches whitespace-preceded unsourced dollar pricing ranges in FAQ prose", () => {
            const faqHtml = `<p>Most plans cost $49 to $250 per month while enterprise tiers cost $500 or more.</p>`;
            const issues = detectUnsourcedStatistics(faqHtml);
            expect(issues.length).toBeGreaterThanOrEqual(2);
            expect(issues.some((msg) => msg.includes("$49"))).toBe(true);
            expect(issues.some((msg) => msg.includes("$500"))).toBe(true);
        });

        it("warns on bare two-word person-name H3 subheadings while allowing topic H3s", () => {
            const warnings = auditSubheadingQuality(`
                <h3>Karsten Madsen</h3>
                <p>Summary of findings.</p>
                <h3>Technical Audit Depth</h3>
                <p>Analysis.</p>
            `);
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain("Karsten Madsen");
        });

        it("rejects non-functional buttons, placeholders, and invented stats in interactive widgets", () => {
            expect(
                validateInteractiveWidgetHtml(
                    `<div id="blog-interactive-widget"><h3>ROI Calculator</h3><button onclick="calc()">Calculate</button></div>`,
                ),
            ).toBeNull();

            expect(
                validateInteractiveWidgetHtml(
                    `<div id="blog-interactive-widget"><p>Expected uplift: 42% for {{COMPANY_NAME}}</p></div>`,
                ),
            ).toBeNull();

            const validDetailsWidget = `<div id="blog-interactive-widget" style="background-color:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);padding:16px;color:inherit;"><h3>SEO Tool Evaluation Checklist</h3><details><summary>Verify JavaScript rendering</summary><p>Test a dynamic product page before committing.</p></details></div>`;
            expect(validateInteractiveWidgetHtml(validDetailsWidget)).not.toBeNull();
            expect(sanitizeHtml(validDetailsWidget)).toContain("<details>");
        });
    });
});

