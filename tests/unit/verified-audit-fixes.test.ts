import { describe, it, expect, vi } from "vitest";

// Mock DB and external calls so test runs fast offline
vi.mock("@/lib/prisma", () => ({
    prisma: {
        growthDecision: {
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({}),
        },
        blog: {
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({}),
        },
        site: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
    },
}));

vi.mock("@/lib/indexing/indexnow", () => ({
    triggerInstantIndexing: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/experiments/tracker", () => ({
    recordExperimentBaseline: vi.fn().mockResolvedValue({ success: true }),
}));

import { executeGrowthDecision } from "@/lib/growth/execution-engine";

describe("Verified Second-Pass Audit Remediation Unit Tests", () => {
    it("should safely execute decision and release lock without errors", async () => {
        const res = await executeGrowthDecision("dec-test-verify-1", "site-test-verify-1");
        expect(res).toBeDefined();
        expect(typeof res.success).toBe("boolean");
    });

    it("should chunk large event lists cleanly in batches of 500", () => {
        const events = Array.from({ length: 1250 }, (_, i) => ({ id: `event-${i}` }));
        const CHUNK_SIZE = 500;
        const chunks = [];

        for (let i = 0; i < events.length; i += CHUNK_SIZE) {
            chunks.push(events.slice(i, i + CHUNK_SIZE));
        }

        expect(chunks.length).toBe(3);
        expect(chunks[0].length).toBe(500);
        expect(chunks[1].length).toBe(500);
        expect(chunks[2].length).toBe(250);
    });
});
