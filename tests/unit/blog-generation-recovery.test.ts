import { describe, expect, it, vi } from "vitest";
import { blogGenerationEventId, replayGenerationOutbox } from "@/lib/blog/generation-recovery";

describe("blog generation outbox recovery", () => {
    it("replays the same event ID and payload for the same attempt", async () => {
        const row = {
            id: "blog-1",
            generationAttemptId: "attempt-1",
            generationInput: { userId: "user-1", siteId: "site-1", pipelineType: "USER_KEYWORD" },
        };
        const ensureCharge = vi.fn().mockResolvedValue(true);
        const dispatch = vi.fn().mockResolvedValue(undefined);
        const markFailed = vi.fn();
        const deps = { ensureCharge, dispatch, markFailed };

        await replayGenerationOutbox(row, deps);
        await replayGenerationOutbox(row, deps);

        expect(ensureCharge).toHaveBeenCalledTimes(2);
        expect(ensureCharge).toHaveBeenCalledWith("user-1", "blog-generation:blog-1:attempt-1");
        expect(dispatch).toHaveBeenNthCalledWith(1, blogGenerationEventId("blog-1", "attempt-1"), {
            userId: "user-1", siteId: "site-1", pipelineType: "USER_KEYWORD", attemptId: "attempt-1",
        });
        expect(dispatch.mock.calls[0]).toEqual(dispatch.mock.calls[1]);
        expect(markFailed).not.toHaveBeenCalled();
    });

    it("does not dispatch when the persisted payload is invalid", async () => {
        const dispatch = vi.fn();
        const markFailed = vi.fn().mockResolvedValue(undefined);
        const result = await replayGenerationOutbox(
            { id: "blog-1", generationAttemptId: "attempt-1", generationInput: null },
            { ensureCharge: vi.fn(), dispatch, markFailed },
        );

        expect(result).toBe("skipped");
        expect(dispatch).not.toHaveBeenCalled();
        expect(markFailed).toHaveBeenCalledWith("blog-1", "attempt-1", expect.stringContaining("payload"));
    });

    it("does not dispatch an attempt that cannot be charged", async () => {
        const dispatch = vi.fn();
        const markFailed = vi.fn().mockResolvedValue(undefined);
        const result = await replayGenerationOutbox(
            { id: "blog-1", generationAttemptId: "attempt-2", generationInput: { userId: "user-1" } },
            { ensureCharge: vi.fn().mockResolvedValue(false), dispatch, markFailed },
        );

        expect(result).toBe("skipped");
        expect(dispatch).not.toHaveBeenCalled();
        expect(markFailed).toHaveBeenCalledWith("blog-1", "attempt-2", expect.stringContaining("charged"));
    });

    it("a deliberate retry has a distinct dispatch id from recovery of the prior attempt", () => {
        expect(blogGenerationEventId("blog-1", "attempt-2"))
            .not.toBe(blogGenerationEventId("blog-1", "attempt-1"));
    });
});
