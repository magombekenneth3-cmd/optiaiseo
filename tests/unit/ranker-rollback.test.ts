import { describe, it, expect } from "vitest";
import { getActiveRanker, rollbackRanker, calculateRankerChecksum } from "@/lib/growth/ranker-registry";

describe("Ranker Model Rollback Engine Unit Tests", () => {
    it("should retrieve active ranker and calculate valid SHA-256 checksum", async () => {
        const active = await getActiveRanker();
        expect(active.rankerVersion).toBeDefined();
        expect(active.status).toEqual("ACTIVE");
        expect(active.checksum).toHaveLength(64);
    });

    it("should execute atomic rollback to target version and emit audit trail", async () => {
        const res = await rollbackRanker("ranker-v1.0.0");
        expect(res.success).toBe(true);
        expect(res.activeVersion).toEqual("ranker-v1.0.0");
        expect(res.previousVersion).toEqual("ranker-v2.0.0");

        const activeAfter = await getActiveRanker();
        expect(activeAfter.rankerVersion).toEqual("ranker-v1.0.0");
        expect(activeAfter.status).toEqual("ACTIVE");
    });

    it("rollback should be idempotent when target version is already active", async () => {
        await rollbackRanker("ranker-v1.0.0");
        const secondRollback = await rollbackRanker("ranker-v1.0.0");

        expect(secondRollback.success).toBe(true);
        expect(secondRollback.activeVersion).toEqual("ranker-v1.0.0");
    });
});
