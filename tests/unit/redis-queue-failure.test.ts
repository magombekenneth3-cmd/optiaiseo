import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redis: { lpush: vi.fn() } }));
vi.mock("@/lib/redis", () => ({
    getRedis: () => mocks.redis,
    redisErrorCode: vi.fn(() => "ETIMEDOUT"),
}));
vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { enqueueTask } from "@/lib/queue/queue";

describe("Redis-backed task queue", () => {
    it("does not report a job accepted when Redis enqueue fails", async () => {
        mocks.redis.lpush.mockRejectedValueOnce(new Error("ETIMEDOUT"));

        await expect(enqueueTask("AEO_AUDIT", { siteId: "site-1" }))
            .rejects.toThrow("The task was not accepted");
        expect(mocks.redis.lpush).toHaveBeenCalledTimes(1);
    });
});
