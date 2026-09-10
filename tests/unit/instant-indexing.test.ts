import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderResult } from "@/lib/indexing/indexnow";

describe("Instant Indexing Protocol Unit Tests", () => {
    beforeEach(() => {
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            return new Response(JSON.stringify({ success: true }), { status: 200, statusText: "OK" });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("submitIndexNow returns NOT_CONFIGURED when no IndexNow config exists", async () => {
        // Import dynamically to allow module mocking
        const { submitIndexNow } = await import("@/lib/indexing/indexnow");

        // submitIndexNow now takes siteId, not raw hostname
        // Without a real DB config, it should return NOT_CONFIGURED
        const result: ProviderResult = await submitIndexNow(
            "nonexistent-site",
            ["/blog/test-article"]
        );

        expect(result.provider).toBe("INDEXNOW");
        expect(result.status).toBe("NOT_CONFIGURED");
    });

    it("triggerInstantIndexing returns structured result with provider statuses", async () => {
        const { triggerInstantIndexing } = await import("@/lib/indexing/indexnow");

        const result = await triggerInstantIndexing("site-123", ["/blog/test-article"]);

        expect(result).toBeDefined();
        expect(result.siteId).toBe("site-123");
        // Without DB, site won't be found → both providers NOT_CONFIGURED
        expect(result.success).toBe(false);
        expect(result.google.provider).toBe("GOOGLE");
        expect(result.indexNow.provider).toBe("INDEXNOW");
    }, 15000);
});
