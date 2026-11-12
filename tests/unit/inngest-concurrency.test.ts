import { describe, it, expect } from "vitest";
import { generateBlogJob } from "@/lib/inngest/functions/blog";
import * as allFns from "@/lib/inngest/functions/index";

describe("Inngest Concurrency Guardrail Tests", () => {
    it("generateBlogJob ('Generate SEO Blog Post') should have concurrency <= 5", () => {
        expect(generateBlogJob.opts.id).toBe("generate-blog");
        expect(generateBlogJob.opts.name).toBe("Generate SEO Blog Post");
        expect(generateBlogJob.opts.concurrency).toBeDefined();

        const concurrency = generateBlogJob.opts.concurrency;
        expect(Array.isArray(concurrency)).toBe(true);

        const configs = concurrency as Array<{ limit: number; key?: string }>;
        expect(configs).toEqual([
            { limit: 2, key: "event.data.userId" },
            { limit: 5 },
        ]);

        for (const c of configs) {
            expect(c.limit).toBeGreaterThan(0);
            expect(c.limit).toBeLessThanOrEqual(5);
        }
    });

    it("no registered Inngest function in functions/index should request concurrency limit > 5", () => {
        for (const [exportName, fn] of Object.entries(allFns)) {
            if (fn && typeof fn === "object" && (fn as any).opts) {
                const c = (fn as any).opts.concurrency;
                if (c) {
                    const list = Array.isArray(c) ? c : [c];
                    for (const entry of list) {
                        if (typeof entry.limit === "number") {
                            expect(
                                entry.limit,
                                `Function ${exportName} (${(fn as any).opts.id}) requested concurrency ${entry.limit} > 5`
                            ).toBeLessThanOrEqual(5);
                            expect(
                                entry.limit,
                                `Function ${exportName} (${(fn as any).opts.id}) requested concurrency <= 0`
                            ).toBeGreaterThan(0);
                        }
                    }
                }
            }
        }
    });

    it("preserves triggers, retries, and rateLimit on generateBlogJob", () => {
        expect(generateBlogJob.opts.retries).toBe(2);
        expect(generateBlogJob.opts.idempotency).toBe("event.data.attemptId");
        expect(generateBlogJob.opts.rateLimit).toEqual({
            limit: 10,
            period: "1m",
            key: "event.data.userId",
        });
    });
});

