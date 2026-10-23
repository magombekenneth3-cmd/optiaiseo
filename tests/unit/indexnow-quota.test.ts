import { describe, it, expect } from "vitest";
import { reserveGoogleQuotaAtomic } from "@/lib/indexing/indexnow-lua";

describe("Atomic Google Indexing Quota Reservation Unit Tests", () => {
    it("should reserve requested quota when below daily limit", async () => {
        const memoryStore = new Map<string, string>();

        const mockRedis = {
            eval: async (_script: string, keys: string[], args: Array<string | number>) => {
                const key = keys[0];
                const current = parseInt(memoryStore.get(key) || "0", 10);
                const limit = Number(args[0]);
                const requested = Number(args[1]);
                const remaining = limit - current;
                if (remaining <= 0) return 0;
                const reserved = Math.min(requested, remaining);
                memoryStore.set(key, (current + reserved).toString());
                return reserved;
            }
        } as unknown as import("@upstash/redis").Redis;

        const key = "indexing:google:quota:2026-08-11";
        const reserved1 = await reserveGoogleQuotaAtomic(mockRedis, key, 200, 150);
        expect(reserved1).toEqual(150);

        const reserved2 = await reserveGoogleQuotaAtomic(mockRedis, key, 200, 100);
        expect(reserved2).toEqual(50); // Only 50 remaining out of 200

        const reserved3 = await reserveGoogleQuotaAtomic(mockRedis, key, 200, 20);
        expect(reserved3).toEqual(0); // Quota exhausted
    });
});
