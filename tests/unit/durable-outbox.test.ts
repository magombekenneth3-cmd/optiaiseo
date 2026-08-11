import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    enqueueOutboxJob,
    processOutboxBatch,
    clearOutboxStore,
    getOutboxRecord,
    getOutboxStats
} from "@/lib/outbox/engine";

describe("Durable Outbox & Failure Injection Unit Tests", () => {
    beforeEach(() => {
        clearOutboxStore();
    });

    it("1. Database-level UNIQUE(type, deduplicationKey) prevents duplicate outbox entries", async () => {
        const payload = { url: "https://site.com/page-1", decisionId: "dec-1" };

        const first = await enqueueOutboxJob("GOOGLE_INDEXING", "dec-1:page-1", payload);
        const second = await enqueueOutboxJob("GOOGLE_INDEXING", "dec-1:page-1", payload);

        expect(first.isDuplicate).toBe(false);
        expect(second.isDuplicate).toBe(true);

        const stats = getOutboxStats();
        expect(stats.total).toBe(1);
        expect(stats.pending).toBe(1);
    });

    it("2. Worker Crash & Lease Expiration Recovery (Worker A crashes -> Worker B retries)", async () => {
        const payload = { url: "https://site.com/page-1" };
        await enqueueOutboxJob("INDEXNOW", "dec-crash-1:page-1", payload);

        // Worker A claims job lease, then crashes mid-execution (SIGKILL / OOM)
        const record = getOutboxRecord("INDEXNOW", "dec-crash-1:page-1");
        if (record) {
            record.status = "PROCESSING";
            record.leaseUntil = new Date(Date.now() - 10); // Expired lease
        }

        const recordAfterCrash = getOutboxRecord("INDEXNOW", "dec-crash-1:page-1");
        expect(recordAfterCrash?.status).toBe("PROCESSING");

        // Wait 15ms for lease to expire
        await new Promise((resolve) => setTimeout(resolve, 15));

        // Worker B arrives and re-claims the expired lease
        let workerBExecuted = false;
        const resultB = await processOutboxBatch(
            "INDEXNOW",
            10,
            async (rec) => {
                expect(rec.deduplicationKey).toBe("dec-crash-1:page-1");
                workerBExecuted = true;
                return true; // Worker B succeeds
            }
        );

        expect(workerBExecuted).toBe(true);
        expect(resultB.succeeded).toBe(1);

        const finalRecord = getOutboxRecord("INDEXNOW", "dec-crash-1:page-1");
        expect(finalRecord?.status).toBe("COMPLETED");
    });

    it("3. Provider HTTP 429 Quota Rate-Limit Backoff (Job stays PENDING, zero decision rollback)", async () => {
        await enqueueOutboxJob("GOOGLE_INDEXING", "dec-429:page-1", { url: "/page-1" });

        const result = await processOutboxBatch(
            "GOOGLE_INDEXING",
            10,
            async () => {
                const err: any = new Error("Quota exceeded");
                err.status = 429;
                throw err;
            }
        );

        expect(result.rateLimited).toBe(1);

        const record = getOutboxRecord("GOOGLE_INDEXING", "dec-429:page-1");
        expect(record?.status).toBe("PENDING");
        expect(record?.lastError).toContain("429");
        expect(record?.availableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("4. 10,000 Decisions Quota Protection (200 quota dispatched, 9,800 safely remain queued)", async () => {
        // Enqueue 10,000 outbox jobs
        for (let i = 0; i < 10000; i++) {
            await enqueueOutboxJob("GOOGLE_INDEXING", `dec-${i}:page-${i}`, { url: `/page-${i}` });
        }

        expect(getOutboxStats().total).toBe(10000);

        // Dispatch batch matching Google Daily Quota limit (200)
        const batchResult = await processOutboxBatch(
            "GOOGLE_INDEXING",
            200, // Quota limit
            async () => true
        );

        expect(batchResult.processed).toBe(200);
        expect(batchResult.succeeded).toBe(200);

        const stats = getOutboxStats();
        expect(stats.completed).toBe(200);
        expect(stats.pending).toBe(9800);
        expect(stats.failed).toBe(0); // Zero data loss, zero decision rollback!
    });
});
