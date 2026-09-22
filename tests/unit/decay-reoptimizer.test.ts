import { describe, it, expect, vi } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
    prisma: {
        blog: {
            findUnique: vi.fn().mockResolvedValue({
                id: "blog-decay-1",
                title: "Legacy SaaS Guide",
                slug: "legacy-saas-guide",
                content: "<p>Existing content</p>",
                metaDescription: "A guide to SaaS",
                targetKeywords: ["saas guide"],
                site: {
                    id: "site-123",
                    domain: "example.com",
                    wordPressConfig: null,
                },
            }),
            update: vi.fn().mockResolvedValue({}),
        },
    },
}));

vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/blog/information-gain", () => ({
    runInformationGainAlgorithm: vi.fn().mockResolvedValue({
        uniqueContentGaps: ["New SaaS pricing models in 2026", "AI-powered onboarding trends"],
    }),
}));

vi.mock("@/lib/blog/image-evidence", () => ({
    injectVisualEvidenceIntoBlog: vi.fn((content: string) => content),
}));

vi.mock("@/lib/publishers", () => ({
    dispatchMultiCmsPublish: vi.fn().mockResolvedValue({ publishedUrl: "" }),
}));

import { reoptimizeDecayedPost, type DecayEvidence } from "@/lib/gsc/decay-reoptimizer";

const VALID_EVIDENCE: DecayEvidence = {
    source: "gsc",
    property: "https://example.com/",
    url: "https://example.com/blog/legacy-saas-guide",
    comparisonStart: "2026-06-25",
    comparisonEnd: "2026-09-22",
    baselineStart: "2026-03-27",
    baselineEnd: "2026-06-24",
    clicksBefore: 500,
    clicksAfter: 200,
    impressionsBefore: 5000,
    impressionsAfter: 3000,
    capturedAt: new Date().toISOString(),
};

describe("Decay Reoptimizer — DecayEvidence contract", () => {
    it("should accept valid GSC decay evidence and reoptimize", async () => {
        const result = await reoptimizeDecayedPost("blog-decay-1", VALID_EVIDENCE);

        expect(result.blogId).toBe("blog-decay-1");
        expect(result.title).toBe("Legacy SaaS Guide");
        expect(result.addedContentGaps.length).toBe(2);
        expect(result.decayEvidence).toEqual(VALID_EVIDENCE);
    });

    it("should reject evidence with wrong source", async () => {
        const badEvidence = { ...VALID_EVIDENCE, source: "audit" as const };

        // @ts-expect-error — testing invalid source at runtime
        await expect(reoptimizeDecayedPost("blog-decay-1", badEvidence))
            .rejects.toThrow("source must be 'gsc'");
    });

    it("should reject evidence with missing property", async () => {
        const badEvidence = { ...VALID_EVIDENCE, property: "" };

        await expect(reoptimizeDecayedPost("blog-decay-1", badEvidence))
            .rejects.toThrow("GSC property and URL");
    });

    it("should reject evidence with zero baseline impressions", async () => {
        const badEvidence = { ...VALID_EVIDENCE, impressionsBefore: 0 };

        await expect(reoptimizeDecayedPost("blog-decay-1", badEvidence))
            .rejects.toThrow("baseline impressions must be positive");
    });

    it("should reject evidence with missing date ranges", async () => {
        const badEvidence = { ...VALID_EVIDENCE, comparisonStart: "" };

        await expect(reoptimizeDecayedPost("blog-decay-1", badEvidence))
            .rejects.toThrow("complete date ranges");
    });

    it("should reject evidence with missing capturedAt", async () => {
        const badEvidence = { ...VALID_EVIDENCE, capturedAt: "" };

        await expect(reoptimizeDecayedPost("blog-decay-1", badEvidence))
            .rejects.toThrow("capturedAt timestamp");
    });

    it("should reject evidence with non-numeric metrics", async () => {
        const badEvidence = { ...VALID_EVIDENCE, clicksBefore: "many" as unknown as number };

        await expect(reoptimizeDecayedPost("blog-decay-1", badEvidence))
            .rejects.toThrow("numeric click and impression metrics");
    });
});
