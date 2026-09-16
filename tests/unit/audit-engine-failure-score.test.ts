import { describe, expect, it } from "vitest";
import { AuditEngine, type AuditModule } from "@/lib/seo-audit";

describe("AuditEngine failure scoring", () => {
  it("does not turn a complete module outage into a perfect score", async () => {
    const unavailableModule: AuditModule = {
      id: "unavailable-service",
      label: "Unavailable service",
      requiresHtml: false,
      run: async () => {
        throw new Error("upstream unavailable");
      },
    };

    const report = await new AuditEngine([unavailableModule]).runAudit("https://example.com");

    expect(report.overallScore).toBe(0);
    expect(report.categories[0]).toMatchObject({ id: "unavailable-service", crashed: true });
  });

  it("caps health when an indexability blocker is found", async () => {
    const module: AuditModule = {
      id: "technical-seo",
      label: "Technical SEO",
      requiresHtml: false,
      run: async () => ({
        id: "technical-seo", label: "Technical SEO", score: 95,
        passed: 9, failed: 1, warnings: 0,
        items: [{ id: "indexability", label: "Indexability", status: "Fail", finding: "noindex" }],
      }),
    };
    const report = await new AuditEngine([module]).runAudit("https://example.com");
    expect(report.indexingBlocked).toBe(true);
    expect(report.overallScore).toBe(20);
    expect(report.coverage).toEqual({ completed: 1, expected: 1, percent: 100 });
  });
});
