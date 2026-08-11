import { describe, it, expect } from "vitest";
import { getActiveRanker, rollbackRanker } from "@/lib/growth/ranker-registry";

describe("Immutable Ranker Registry & Rollback Unit Tests (Gate 5)", () => {
    it("should start with ranker-v2.0.0 as active ranker", () => {
        const active = getActiveRanker();
        expect(active.rankerVersion).toEqual("ranker-v2.0.0");
        expect(active.status).toEqual("ACTIVE");
        expect(active.checksum).toBeDefined();
    });

    it("should perform atomic rollback to ranker-v1.0.0", () => {
        const res = rollbackRanker("ranker-v1.0.0");

        expect(res.success).toBe(true);
        expect(res.activeVersion).toEqual("ranker-v1.0.0");
        expect(res.previousVersion).toEqual("ranker-v2.0.0");

        const newActive = getActiveRanker();
        expect(newActive.rankerVersion).toEqual("ranker-v1.0.0");
        expect(newActive.status).toEqual("ACTIVE");
    });

    it("should be idempotent when rolling back to already active version", () => {
        const res1 = rollbackRanker("ranker-v1.0.0");
        expect(res1.activeVersion).toEqual("ranker-v1.0.0");

        const res2 = rollbackRanker("ranker-v1.0.0");
        expect(res2.success).toBe(true);
        expect(res2.activeVersion).toEqual("ranker-v1.0.0");
    });
});
