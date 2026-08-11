import { describe, it, expect } from "vitest";
import { hasPermission, verifyCustomDomainCname } from "@/lib/agency/rbac";
import { buildAgencyWhiteLabelReportHtml } from "@/lib/pdf/agency-report";

describe("Agency White-Label & Client Portal System", () => {
    it("should enforce RBAC permissions strictly for ADMIN, EDITOR, and AGENCY_CLIENT", () => {
        expect(hasPermission("ADMIN", "org:manage")).toBe(true);
        expect(hasPermission("EDITOR", "org:manage")).toBe(false);
        expect(hasPermission("EDITOR", "content:publish")).toBe(true);
        expect(hasPermission("AGENCY_CLIENT", "content:publish")).toBe(false);
        expect(hasPermission("AGENCY_CLIENT", "reports:view")).toBe(true);
    });

    it("should verify custom CNAME domains", async () => {
        const res = await verifyCustomDomainCname("seo.agencyclient.com");
        expect(res.active).toBe(true);
        expect(res.targetCname).toBe("cname.optiaiseo.com");
    });

    it("should generate white-label client PDF HTML with agency branding", () => {
        const html = buildAgencyWhiteLabelReportHtml({
            clientSiteName: "Acme Corp",
            clientSiteUrl: "https://acme.com",
            overallScore: 92,
            aeoCitationRate: 88,
            informationGainScore: 95,
            totalPublishedArticles: 48,
            topKeywords: [
                { keyword: "best enterprise saas", position: 1, citations: 12 },
            ],
            whiteLabel: {
                companyName: "Apex Digital SEO Agency",
                logoUrl: "https://apex.com/logo.png",
                primaryColor: "#06b6d4",
            },
        });

        expect(html).toContain("Acme Corp");
        expect(html).toContain("Apex Digital SEO Agency");
        expect(html).toContain("best enterprise saas");
        expect(html).toContain("AEO & Generative Search Visibility Executive Audit");
    });
});
