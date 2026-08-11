import { describe, it, expect } from "vitest";

import { enqueueTask } from "@/lib/queue/queue";
import { processNextJob } from "@/lib/queue/worker";
import { GET as streamRoute } from "@/app/api/growth/stream-execution/route";
import { buildAgencyWhiteLabelReportHtml } from "@/lib/pdf/agency-report";
import { NextRequest } from "next/server";

describe("Queue, SSE Streaming & PDF Theme Builder Unit Tests", () => {
    it("should enqueue tasks cleanly", async () => {
        const job = await enqueueTask("AEO_AUDIT", { siteId: "site-q-1" });
        expect(job).toBeDefined();
        expect(job.type).toBe("AEO_AUDIT");
    });

    it("should process next job from queue safely", async () => {
        const job = await processNextJob("aiseo:queue:aeo_audit");
        expect(job === null || typeof job === "object").toBe(true);
    });

    it("should return readable SSE stream response from API route", async () => {
        const req = new NextRequest("http://localhost:3000/api/growth/stream-execution?decisionId=d1&siteId=s1");
        const res = await streamRoute(req);

        expect(res).toBeDefined();
        expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("should generate light and dark themed PDF HTML reports", () => {
        const data = {
            clientSiteName: "Acme Corp",
            clientSiteUrl: "https://acme.com",
            overallScore: 92,
            aeoCitationRate: 88,
            informationGainScore: 90,
            totalPublishedArticles: 24,
            topKeywords: [{ keyword: "saas tool", position: 1, citations: 10 }],
            whiteLabel: { companyName: "Agency", primaryColor: "#3b82f6" },
        };

        const darkHtml = buildAgencyWhiteLabelReportHtml({ ...data, theme: "DARK" });
        const lightHtml = buildAgencyWhiteLabelReportHtml({ ...data, theme: "LIGHT" });

        expect(darkHtml).toContain("#0b0f19");
        expect(lightHtml).toContain("#ffffff");
    });
});
