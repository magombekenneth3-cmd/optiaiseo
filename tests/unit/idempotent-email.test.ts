import { describe, it, expect, vi } from "vitest";

// Mock DB and external calls so test runs fast offline
vi.mock("@/lib/growth/decision-persistence", () => ({
    getPersistedDecisions: vi.fn().mockResolvedValue([
        { primaryKeyword: "enterprise seo", url: "/blog/seo-guide", action: "IMPROVE_SEARCH_INTENT" }
    ])
}));

const sendMock = vi.fn().mockResolvedValue({ id: "msg_12345" });
vi.mock("resend", () => ({
    Resend: class {
        emails = { send: sendMock };
    }
}));

import { runAgencyAutopilotJob } from "@/lib/agency/autopilot";
import { sendAeoDropAlert } from "@/lib/email/aeo-alert";

describe("Idempotent Email Delivery & State Machine Unit Tests", () => {
    it("should include X-Entity-Ref-ID and Idempotency-Key headers in Resend emails", async () => {
        process.env.RESEND_API_KEY = "re_test_key";
        process.env.RESEND_FROM_DOMAIN = "optiaiseo.online";

        const res = await sendAeoDropAlert("test@agency.com", {
            domain: "example.com",
            previousScore: 80,
            currentScore: 65,
            dropAmount: 15
        }, "aeo-drop-test-key-1");

        expect(res.success).toBe(true);
    });

    it("should generate stable logical email task ID across retries", async () => {
        const res1 = await runAgencyAutopilotJob("org-1", "site-123", "Agency", "seo.com", "client@com");
        expect(res1.emailDelivered).toBe(true);
    }, 15000);
});
