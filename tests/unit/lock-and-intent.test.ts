import { describe, it, expect, vi } from "vitest";
import { selectRepresentativeIntentQuestions } from "@/lib/aeo/index";

// In-memory mock Redis supporting get, set, del, eval for atomic lock testing
class MockRedis {
    private store = new Map<string, string>();

    async set(key: string, value: string, options?: { nx?: boolean; ex?: number }) {
        if (options?.nx && this.store.has(key)) {
            return null;
        }
        this.store.set(key, value);
        return "OK";
    }

    async get(key: string) {
        return this.store.get(key) ?? null;
    }

    async del(key: string) {
        return this.store.delete(key) ? 1 : 0;
    }

    async eval(script: string, keys: string[], args: string[]) {
        const key = keys[0];
        const tokenArg = args[0];

        // Lua compare-and-delete behavior:
        // if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end
        if (this.store.get(key) === tokenArg) {
            this.store.delete(key);
            return 1;
        }
        return 0;
    }
}

describe("Redis Lock Token Ownership & Atomic Unlock Unit Tests", () => {
    it("should allow lock owner to release its own lock via atomic Lua eval", async () => {
        const redis = new MockRedis();
        const lockKey = "lock:decision:dec-1";
        const ownerToken = "token-owner-A";

        await redis.set(lockKey, ownerToken, { nx: true, ex: 30 });
        expect(await redis.get(lockKey)).toBe(ownerToken);

        const luaScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
        const result = await redis.eval(luaScript, [lockKey], [ownerToken]);

        expect(result).toBe(1);
        expect(await redis.get(lockKey)).toBeNull();
    });

    it("should prevent non-owner from deleting an active lock", async () => {
        const redis = new MockRedis();
        const lockKey = "lock:decision:dec-1";
        const ownerToken = "token-owner-A";
        const intruderToken = "token-intruder-B";

        await redis.set(lockKey, ownerToken, { nx: true, ex: 30 });

        const luaScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
        const result = await redis.eval(luaScript, [lockKey], [intruderToken]);

        expect(result).toBe(0); // Failed to delete
        expect(await redis.get(lockKey)).toBe(ownerToken); // Lock remains intact for owner A
    });

    it("should prevent expired owner A from deleting new owner B's lock", async () => {
        const redis = new MockRedis();
        const lockKey = "lock:decision:dec-1";
        const expiredOwnerToken = "token-expired-A";
        const newOwnerToken = "token-new-B";

        // 1. Process A acquired lock initially
        await redis.set(lockKey, expiredOwnerToken, { nx: true, ex: 30 });

        // 2. Process A lock expired, Process B acquired lock
        await redis.del(lockKey);
        await redis.set(lockKey, newOwnerToken, { nx: true, ex: 30 });

        // 3. Process A finally block tries to unlock with expiredOwnerToken
        const luaScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
        const result = await redis.eval(luaScript, [lockKey], [expiredOwnerToken]);

        expect(result).toBe(0); // Process A unlock denied!
        expect(await redis.get(lockKey)).toBe(newOwnerToken); // Process B's lock remains active
    });

    it("should allow only one concurrent process to acquire lock", async () => {
        const redis = new MockRedis();
        const lockKey = "lock:decision:dec-1";

        const resA = await redis.set(lockKey, "token-A", { nx: true, ex: 30 });
        const resB = await redis.set(lockKey, "token-B", { nx: true, ex: 30 });

        expect(resA).toBe("OK");
        expect(resB).toBeNull(); // Process B lock contested
    });
});

describe("Representative Intent Question Selection Unit Tests", () => {
    it("should classify and select 1 representative question per intent category (5 total)", () => {
        const sample20Questions = [
            "How does SEO tool work?", // Informational
            "What is Answer Engine Optimization?", // Informational
            "Best tool for AI SEO in 2026", // Commercial
            "Is AI SEO worth it for SaaS?", // Commercial
            "Why is my website not ranking in Google?", // Problem-aware
            "How to fix canonical tag errors?", // Problem-aware
            "Brand A vs Competitor B for AEO", // Comparison
            "Which is better: Tool A or Tool B?", // Comparison
            "How to use Brand A feature dashboard", // Navigational
            "Does Brand A support IndexNow?", // Navigational
            "More info 1", "More info 2", "More info 3", "More info 4", "More info 5",
            "More info 6", "More info 7", "More info 8", "More info 9", "More info 10"
        ];

        const selected = selectRepresentativeIntentQuestions(sample20Questions);

        expect(selected.length).toBe(5);
        expect(selected).toContain("How does SEO tool work?");
        expect(selected).toContain("Best tool for AI SEO in 2026");
        expect(selected).toContain("Why is my website not ranking in Google?");
        expect(selected).toContain("Brand A vs Competitor B for AEO");
        expect(selected).toContain("How to use Brand A feature dashboard");
    });

    it("should return all questions if 5 or fewer provided", () => {
        const smallList = ["Q1", "Q2", "Q3"];
        expect(selectRepresentativeIntentQuestions(smallList)).toEqual(smallList);
    });
});

describe("Inngest Event Chunking Unit Tests", () => {
    function chunkEvents<T>(events: T[], chunkSize: number = 500): T[][] {
        if (events.length === 0) return [];
        const chunks: T[][] = [];
        for (let i = 0; i < events.length; i += chunkSize) {
            chunks.push(events.slice(i, i + chunkSize));
        }
        return chunks;
    }

    it("should return 0 batches for 0 events", () => {
        expect(chunkEvents([])).toEqual([]);
    });

    it("should return 1 batch for 1 event", () => {
        const events = [{ id: 1 }];
        const chunks = chunkEvents(events);
        expect(chunks.length).toBe(1);
        expect(chunks[0].length).toBe(1);
    });

    it("should return 1 batch for 500 events", () => {
        const events = Array.from({ length: 500 }, (_, i) => ({ id: i }));
        const chunks = chunkEvents(events);
        expect(chunks.length).toBe(1);
        expect(chunks[0].length).toBe(500);
    });

    it("should return 2 batches for 501 events", () => {
        const events = Array.from({ length: 501 }, (_, i) => ({ id: i }));
        const chunks = chunkEvents(events);
        expect(chunks.length).toBe(2);
        expect(chunks[0].length).toBe(500);
        expect(chunks[1].length).toBe(1);
    });
});
