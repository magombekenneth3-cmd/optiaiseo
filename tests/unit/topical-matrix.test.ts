import { describe, it, expect } from "vitest";
import { buildTopicalAuthorityMatrix } from "@/lib/blog/topical-matrix";

describe("Visual Topic Authority Matrix Unit Tests", () => {
    it("should return empty topical authority report when site has no published blogs", async () => {
        const report = await buildTopicalAuthorityMatrix("non-existent-site-123");

        expect(report).toBeDefined();
        expect(report.overallAuthorityScore).toBe(0);
        expect(report.totalClustersCount).toBe(0);
        expect(report.clusters).toEqual([]);
    });
});
