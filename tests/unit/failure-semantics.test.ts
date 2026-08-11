import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/redis", () => ({
    getRedis: vi.fn()
}));

vi.mock("@/lib/growth/decision-persistence", () => ({
    getPersistedDecisions: vi.fn().mockResolvedValue([
        { id: "dec-fail-1", siteId: "site-1", action: "IMPROVE_SEARCH_INTENT", url: "/blog/missing-post", primaryKeyword: "test" }
    ])
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        $transaction: vi.fn().mockImplementation((cb) => cb({
            growthDecision: {
                update: vi.fn().mockResolvedValue({})
            }
        })),
        growthDecision: {
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({})
        },
        blog: {
            findFirst: vi.fn().mockResolvedValue(null) // Simulates missing blog / DB offline
        }
    }
}));

import { executeGrowthDecision } from "@/lib/growth/execution-engine";
import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";

describe("Strict Failure Semantics & Error Handling Unit Tests", () => {
    it("1. Redis lock error should abort execution and return success: false with LOCK_UNAVAILABLE", async () => {
        vi.mocked(getRedis).mockReturnValue({
            set: vi.fn().mockRejectedValue(new Error("Redis connection dropped"))
        } as any);

        const result = await executeGrowthDecision("dec-fail-1", "site-1");
        expect(result.success).toBe(false);
        expect(result.actionExecuted).toBe("LOCK_UNAVAILABLE");
    });

    it("2. Missing blog record on blog-level action should return success: false (preventing false success)", async () => {
        vi.mocked(getRedis).mockReturnValue(null); // Offline Redis to test DB lookup directly
        vi.mocked(prisma.blog.findFirst).mockResolvedValue(null);

        const result = await executeGrowthDecision("dec-fail-1", "site-1");
        expect(result.success).toBe(false);
        expect(result.details).toContain("Target blog content missing");
    });

    it("3. Database query exception during blog lookup should return success: false", async () => {
        vi.mocked(getRedis).mockReturnValue(null);
        vi.mocked(prisma.blog.findFirst).mockRejectedValue(new Error("PostgreSQL connection timeout"));

        const result = await executeGrowthDecision("dec-fail-1", "site-1");
        expect(result.success).toBe(false);
        expect(result.details).toContain("Database query failed");
    });

    it("4. Already executed decision should early return success: true without re-running transforms", async () => {
        vi.mocked(getRedis).mockReturnValue(null);
        vi.mocked(((prisma as any).growthDecision.findUnique) as any).mockResolvedValue({
            id: "dec-already-exec",
            siteId: "site-1",
            url: "/blog/post-1",
            action: "REFRESH_CONTENT",
            status: "EXECUTED"
        });

        const result = await executeGrowthDecision("dec-already-exec", "site-1");
        expect(result.success).toBe(true);
        expect(result.details).toBe("Decision already executed.");
    });
});
