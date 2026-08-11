import { describe, it, expect } from "vitest";
import { getActiveRanker, rollbackRanker } from "@/lib/growth/ranker-registry";

describe("Durable Ranker Registry & Idempotent Rollback Unit Tests (Phase B)", () => {
    it("should retrieve active ranker and execute idempotent rollback", async () => {
        const activeBefore = await getActiveRanker();
        expect(activeBefore.status).toEqual("ACTIVE");

        const rollbackRes = await rollbackRanker("ranker-v1.0.0");
        expect(rollbackRes.success).toBe(true);
        expect(rollbackRes.activeVersion).toEqual("ranker-v1.0.0");

        const activeAfter = await getActiveRanker();
        expect(activeAfter.rankerVersion).toEqual("ranker-v1.0.0");

        // Second rollback attempt is idempotent
        const secondRollback = await rollbackRanker("ranker-v1.0.0");
        expect(secondRollback.success).toBe(true);
        expect(secondRollback.activeVersion).toEqual("ranker-v1.0.0");
    });
});
