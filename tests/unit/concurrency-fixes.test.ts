import { describe, it, expect } from "vitest";

import { executeGrowthDecision } from "@/lib/growth/execution-engine";
import { recordExperimentBaseline, getSiteExperimentSummary } from "@/lib/experiments/tracker";
import { runAgencyAutopilotJob } from "@/lib/agency/autopilot";
import { auditCompetitorWeaknesses } from "@/lib/intelligence/competitor-interceptor";
import { triggerInstantIndexing } from "@/lib/indexing/indexnow";

describe("Backend Concurrency & Race Condition Fixes Unit Tests", () => {
    it("should handle decision execution gracefully without throwing", async () => {
        const res = await executeGrowthDecision("dec-conc-1", "site-conc-1");
        expect(res).toBeDefined();
        expect(res.decisionId).toBe("dec-conc-1");
    }, 30000);



    it("should record experiment baseline and persist data", async () => {
        const exp = await recordExperimentBaseline("dec-conc-2", "site-conc-2", "/blog/concurrency-post", "REFRESH_CONTENT");
        expect(exp).toBeDefined();
        expect(exp.decisionId).toBe("dec-conc-2");

        const summary = await getSiteExperimentSummary("site-conc-2");
        expect(summary).toBeDefined();
        expect(summary.totalExperimentsExecuted).toBeGreaterThanOrEqual(1);
    }, 15000);

    it("should execute agency autopilot job cleanly", async () => {
        const res = await runAgencyAutopilotJob("org-1", "site-conc-3", "Test Agency", "seo.testagency.com", "test@client.com");
        expect(res).toBeDefined();
        expect(res.pdfReportGenerated).toBe(true);
        expect(res.customDomain).toBe("seo.testagency.com");
    }, 15000);

    it("should generate competitor steal report", async () => {
        const report = await auditCompetitorWeaknesses("site-conc-4", "competitor.com", "best seo tool");
        expect(report).toBeDefined();
        expect(report.overallStealabilityScore).toBeGreaterThan(0);
    }, 15000);

    it("should handle chunked instant indexing without error", async () => {
        const urls = Array.from({ length: 25 }, (_, i) => `/blog/page-${i + 1}`);
        const res = await triggerInstantIndexing("site-conc-5", urls);
        expect(res).toBeDefined();
        expect(res.urls.length).toBe(25);
    }, 15000);
});

