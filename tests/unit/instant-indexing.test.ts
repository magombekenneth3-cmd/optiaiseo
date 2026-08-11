import { describe, it, expect } from "vitest";
import { submitIndexNow, triggerInstantIndexing } from "@/lib/indexing/indexnow";

describe("Instant Indexing Protocol Unit Tests", () => {
    it("should format IndexNow request payload and handle execution cleanly", async () => {
        const result = await submitIndexNow(
            "optiaiseo.com",
            ["/blog/semrush-alternatives", "/blog/aeo-guide"]
        );

        expect(result).toBe(true);
    });

    it("should trigger unified instant indexing pipeline for a site", async () => {
        const result = await triggerInstantIndexing("site-123", ["/blog/test-article"]);

        expect(result).toBeDefined();
        expect(result.siteId).toBe("site-123");
        expect(result.domain).toBeDefined();
        expect(result.indexNowSuccess).toBe(true);
        expect(result.googleIndexingSuccess).toBe(true);
    }, 15000);
});
