/**
 * tests/unit/queue-and-sse.test.ts
 *
 * Queue, SSE Streaming & PDF Theme Builder unit tests.
 *
 * All external I/O (Redis, auth, Prisma, growth engine) is mocked with
 * vi.hoisted so the production safety checks remain in place and the tests
 * exercise real code paths through isolated boundaries.
 */
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
    // Redis — returns a client with a passing lpush
    redisPush: vi.fn().mockResolvedValue(1),
    // Auth — returns a valid user
    getAuthUser: vi.fn().mockResolvedValue({ id: "user-test-1", email: "test@example.com" }),
    // Prisma — growthDecision lookup
    growthDecisionFindUnique: vi.fn().mockResolvedValue({ id: "d1", siteId: "s1" }),
    // Site access guard — returns a resolved site object (EDIT permission granted)
    assertSiteAccess: vi.fn().mockResolvedValue({ id: "s1", domain: "example.com" }),
    // Growth execution engine — returns a simple success
    executeGrowthDecision: vi.fn().mockResolvedValue({ success: true, details: "Executed." }),
}));

vi.mock("@/lib/redis", () => ({
    getRedis: () => ({ lpush: mocks.redisPush, rpop: vi.fn().mockResolvedValue(null) }),
    redisErrorCode: vi.fn(() => "ETIMEDOUT"),
}));

vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/auth/get-auth-user", () => ({
    getAuthUser: mocks.getAuthUser,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        growthDecision: { findUnique: mocks.growthDecisionFindUnique },
    },
}));

vi.mock("@/lib/auth/require-user", () => ({
    assertSiteAccess: mocks.assertSiteAccess,
}));

vi.mock("@/lib/growth/execution-engine", () => ({
    executeGrowthDecision: mocks.executeGrowthDecision,
}));

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------
import { enqueueTask } from "@/lib/queue/queue";
import { processNextJob } from "@/lib/queue/worker";
import { GET as streamRoute } from "@/app/api/growth/stream-execution/route";
import { buildAgencyWhiteLabelReportHtml } from "@/lib/pdf/agency-report";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Queue, SSE Streaming & PDF Theme Builder Unit Tests", () => {

    it("should enqueue tasks cleanly", async () => {
        const job = await enqueueTask("AEO_AUDIT", { siteId: "site-q-1" });
        expect(job).toBeDefined();
        expect(job.type).toBe("AEO_AUDIT");
        // Confirm Redis lpush was actually called with the right queue name
        expect(mocks.redisPush).toHaveBeenCalledWith(
            "aiseo:queue:aeo_audit",
            expect.stringContaining("\"type\":\"AEO_AUDIT\""),
        );
    });

    it("should process next job from queue safely", async () => {
        // worker returns null when the queue is empty — that is the valid safe path
        const job = await processNextJob("aiseo:queue:aeo_audit");
        expect(job === null || typeof job === "object").toBe(true);
    });

    it("should return readable SSE stream response from API route", async () => {
        const req = new NextRequest(
            "http://localhost:3000/api/growth/stream-execution?decisionId=d1&siteId=s1",
        );
        const res = await streamRoute(req);

        expect(res).toBeDefined();
        // The route must produce an SSE stream when auth + site access pass
        expect(res.headers.get("Content-Type")).toBe("text/event-stream");
        // Confirm the security checks were invoked (not bypassed)
        expect(mocks.getAuthUser).toHaveBeenCalled();
        expect(mocks.assertSiteAccess).toHaveBeenCalledWith("s1", "user-test-1", "EDIT");
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
