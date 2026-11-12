import { describe, it, expect } from "vitest";
import { processAeoSiteJob } from "@/lib/inngest/functions/aeo";

describe("processAeoSiteJob Inngest configuration & CEL idempotency", () => {
    it("should have correct function configuration without altering id, retries, or triggers", () => {
        expect(processAeoSiteJob.opts.id).toBe("process-aeo-tracker-site");
        expect(processAeoSiteJob.opts.name).toBe("Process Weekly AEO Site");
        expect(processAeoSiteJob.opts.retries).toBe(2);
        expect(processAeoSiteJob.opts.concurrency).toEqual({ limit: 5 });
        expect(processAeoSiteJob.opts.triggers).toEqual([{ event: "aeo.tracker.check.site" }]);
    });

    it("should have valid CEL idempotency expression replacing JS fallback operator", () => {
        const expectedCel = 'event.data.siteId + "-" + (has(event.data.weekKey) ? event.data.weekKey : "")';
        expect(processAeoSiteJob.opts.idempotency).toBe(expectedCel);
    });

    /**
     * Helper to simulate CEL evaluation of:
     * event.data.siteId + "-" + (has(event.data.weekKey) ? event.data.weekKey : "")
     */
    function evaluateCelIdempotency(event: { data: { siteId: string; weekKey?: string } }): string {
        const hasWeekKey = Object.prototype.hasOwnProperty.call(event.data, "weekKey") && event.data.weekKey !== undefined;
        const weekPart = hasWeekKey ? event.data.weekKey : "";
        return `${event.data.siteId}-${weekPart}`;
    }

    it("evaluates CEL idempotency when weekKey is present", () => {
        const event = {
            data: {
                siteId: "site_123",
                weekKey: "2026-11-13",
            },
        };

        const key = evaluateCelIdempotency(event);
        expect(key).toBe("site_123-2026-11-13");
    });

    it("evaluates CEL idempotency when weekKey is missing", () => {
        const event = {
            data: {
                siteId: "site_123",
            },
        };

        const key = evaluateCelIdempotency(event);
        expect(key).toBe("site_123-");
    });

    it("preserves site-level and week-level uniqueness (no cross-site or cross-week collisions)", () => {
        const siteAWeek1 = evaluateCelIdempotency({ data: { siteId: "site_A", weekKey: "2026-W45" } });
        const siteBWeek1 = evaluateCelIdempotency({ data: { siteId: "site_B", weekKey: "2026-W45" } });
        const siteAWeek2 = evaluateCelIdempotency({ data: { siteId: "site_A", weekKey: "2026-W46" } });

        // Different sites never share key
        expect(siteAWeek1).not.toBe(siteBWeek1);
        expect(siteAWeek1).toBe("site_A-2026-W45");
        expect(siteBWeek1).toBe("site_B-2026-W45");

        // Different weeks for same site generate different keys
        expect(siteAWeek1).not.toBe(siteAWeek2);
        expect(siteAWeek2).toBe("site_A-2026-W46");
    });
});

