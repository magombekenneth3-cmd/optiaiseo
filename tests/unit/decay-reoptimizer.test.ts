import { describe, it, expect, vi } from "vitest";
import { detectContentDecay } from "@/lib/gsc/decay-detector";

vi.mock("@/lib/prisma", () => ({
    prisma: {
        blog: {
            findMany: vi.fn().mockResolvedValue([
                {
                    id: "blog-decay-1",
                    title: "Legacy SaaS Guide",
                    slug: "legacy-saas-guide",
                    targetKeywords: ["saas guide"],
                },
            ]),
        },
    },
}));

describe("Automated Content Decay & Re-Optimization Engine", () => {
    it("should detect decayed blog posts when impressions drop over threshold", async () => {
        const decayed = await detectContentDecay("site-123", 15);

        expect(decayed.length).toBe(1);
        expect(decayed[0].blogId).toBe("blog-decay-1");
        expect(decayed[0].decayPercentage).toBe(20);
        expect(decayed[0].title).toBe("Legacy SaaS Guide");
    });
});
