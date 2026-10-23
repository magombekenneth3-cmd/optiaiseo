import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    loggerDebug: vi.fn(),
    loggerWarn: vi.fn(),
    loggerInfo: vi.fn(),
    evict: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
    redis: {
        get: mocks.get,
        set: mocks.set,
        del: mocks.del,
    },
    redisErrorCode: vi.fn(() => "REDIS_TEST_ERROR"),
}));

vi.mock("@/lib/logger", () => ({
    logger: {
        debug: mocks.loggerDebug,
        warn: mocks.loggerWarn,
        info: mocks.loggerInfo,
        error: vi.fn(),
    },
}));

vi.mock("@/lib/cache/eviction", () => ({
    evictPrefixIfOverBudget: mocks.evict,
}));

import { cachedMentionCheck } from "@/lib/aeo/response-cache";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe("AEO response cache", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockResolvedValue(null);
        mocks.set.mockResolvedValue("OK");
        mocks.del.mockResolvedValue(1);
        mocks.evict.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns cached mention results without calling the provider", async () => {
        mocks.get.mockResolvedValueOnce(JSON.stringify({
            model: "Gemini",
            mentioned: true,
            confidence: 0.9,
        }));

        const provider = vi.fn();

        const result = await cachedMentionCheck(
            "Gemini",
            "example.com",
            null,
            provider,
        );

        expect(result).toMatchObject({
            model: "Gemini",
            mentioned: true,
            confidence: 0.9,
            fromCache: true,
        });
        expect(provider).not.toHaveBeenCalled();
    });

    it("stores a fresh mention result when Redis has a cache miss", async () => {
        const provider = vi.fn().mockResolvedValue({
            model: "Gemini",
            mentioned: true,
            confidence: 0.8,
        });

        const result = await cachedMentionCheck(
            "Gemini",
            "example.com",
            null,
            provider,
        );

        expect(provider).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            model: "Gemini",
            mentioned: true,
            fromCache: false,
        });
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it("shares one provider call between concurrent requests for the same key", async () => {
        const pending = deferred<{
            model: string;
            mentioned: boolean;
            confidence: number;
        }>();

        const provider = vi.fn(() => pending.promise);

        const first = cachedMentionCheck(
            "Gemini",
            "example.com",
            null,
            provider,
        );
        const second = cachedMentionCheck(
            "Gemini",
            "example.com",
            null,
            provider,
        );

        // Let both calls finish their initial Redis lookup.
        await Promise.resolve();
        await Promise.resolve();

        expect(provider).toHaveBeenCalledTimes(1);

        pending.resolve({
            model: "Gemini",
            mentioned: true,
            confidence: 0.8,
        });

        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult.mentioned).toBe(true);
        expect(secondResult.mentioned).toBe(true);
        expect(provider).toHaveBeenCalledTimes(1);
    });

    it("allows a later request to retry after a provider failure", async () => {
        const provider = vi.fn()
            .mockRejectedValueOnce(new Error("provider unavailable"))
            .mockResolvedValueOnce({
                model: "Gemini",
                mentioned: false,
                confidence: 0.7,
            });

        await expect(cachedMentionCheck(
            "Gemini",
            "example.com",
            null,
            provider,
        )).rejects.toThrow("provider unavailable");

        await expect(cachedMentionCheck(
            "Gemini",
            "example.com",
            null,
            provider,
        )).resolves.toMatchObject({
            model: "Gemini",
            mentioned: false,
            fromCache: false,
        });

        expect(provider).toHaveBeenCalledTimes(2);
    });
});
