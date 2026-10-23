import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    redisEval: vi.fn(),
    googleSubmit: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
    getRedis: () => ({ eval: mocks.redisEval }),
    redisErrorCode: vi.fn(() => "ETIMEDOUT"),
}));
vi.mock("@/lib/gsc/indexing", () => ({ pingGoogleIndexingApi: mocks.googleSubmit }));
vi.mock("@/lib/indexnow-config", () => ({ getIndexNowConfig: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    formatError: vi.fn(() => "sanitized"),
}));

import { submitGoogleIndexingApi } from "@/lib/indexing/indexnow";

describe("Google indexing quota Redis outage", () => {
    it("does not submit URLs when quota reservation fails", async () => {
        mocks.redisEval.mockRejectedValueOnce(new Error("ETIMEDOUT"));

        const result = await submitGoogleIndexingApi("site-1", ["https://example.com/a"], "user-1");

        expect(result.status).toBe("QUOTA_CHECK_UNAVAILABLE");
        expect(mocks.googleSubmit).not.toHaveBeenCalled();
    });
});
