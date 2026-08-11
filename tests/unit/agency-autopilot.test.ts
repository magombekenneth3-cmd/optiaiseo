import { describe, it, expect } from "vitest";
import { runAgencyAutopilotJob } from "@/lib/agency/autopilot";

describe("Autonomous White-Label Agency Autopilot Unit Tests", () => {
    it("should execute agency autopilot job, auto-fix site issues, and generate white-label PDF digest", async () => {
        const result = await runAgencyAutopilotJob(
            "org-123",
            "site-123",
            "Apex Digital SEO Agency",
            "seo.agencyclient.com"
        );

        expect(result).toBeDefined();
        expect(result.organizationId).toBe("org-123");
        expect(result.siteId).toBe("site-123");
        expect(result.customDomain).toBe("seo.agencyclient.com");
        expect(result.pdfReportGenerated).toBe(true);
        expect(result.pdfBufferLength).toBeGreaterThan(0);
        expect(result.routineFixesApplied).toBeGreaterThan(0);
        expect(result.emailDelivered).toBe(true);
    }, 15000);
});
