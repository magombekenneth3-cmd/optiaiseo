import { describe, it, expect, vi, beforeEach } from "vitest";

const {
    getServerSessionMock,
    userFindUnique,
    siteFindUnique,
    findingFindUnique,
    evidenceFindMany,
    healingLogFindMany,
    proposalFindMany,
} = vi.hoisted(() => ({
    getServerSessionMock: vi.fn(),
    userFindUnique: vi.fn(),
    siteFindUnique: vi.fn(),
    findingFindUnique: vi.fn(),
    evidenceFindMany: vi.fn(),
    healingLogFindMany: vi.fn(),
    proposalFindMany: vi.fn(),
}));

vi.mock("next-auth", () => ({
    getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/auth", () => ({
    authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: userFindUnique },
        site: { findUnique: siteFindUnique },
        diagnosticFindingRecord: { findUnique: findingFindUnique },
        sEOEvidenceRecord: { findMany: evidenceFindMany },
        selfHealingLog: { findMany: healingLogFindMany },
        seoFixProposal: { findMany: proposalFindMany },
    },
}));

import { GET } from "@/app/api/diagnostics/[id]/timeline/route";
import { NextRequest } from "next/server";


function makeRequest(id: string): [NextRequest, { params: Promise<{ id: string }> }] {
    const req = new NextRequest(`http://localhost/api/diagnostics/${id}/timeline`);
    return [req, { params: Promise.resolve({ id }) }];
}

const mockUser = { id: "user-1" };
const mockSite = { userId: "user-1", domain: "example.com" };

const baseFinding = {
    id: "finding-1",
    siteId: "site-1",
    fingerprint: "fp-123",
    issueType: "missing_meta_description",
    status: "FAIL",
    severity: "high",
    scopeType: "PAGE",
    scopeUrls: ["https://example.com/page1"],
    rootCause: "Missing meta description tag",
    confidence: 0.95,
    expectedOutcome: "Meta description present",
    remediationType: "DETERMINISTIC",
    verificationCriteria: null,
    lifecycleState: "OPEN",
    resolvedAt: null,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
};

describe("GET /api/diagnostics/[id]/timeline", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getServerSessionMock.mockResolvedValue({
            user: { email: "test@example.com" },
        });
        userFindUnique.mockResolvedValue(mockUser);
        siteFindUnique.mockResolvedValue(mockSite);
        findingFindUnique.mockResolvedValue(baseFinding);
        evidenceFindMany.mockResolvedValue([]);
        healingLogFindMany.mockResolvedValue([]);
        proposalFindMany.mockResolvedValue([]);
    });

    it("1. returns 401 for unauthenticated requests", async () => {
        getServerSessionMock.mockResolvedValue(null);
        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        expect(res.status).toBe(401);
    });

    it("2. returns 404 for nonexistent user", async () => {
        userFindUnique.mockResolvedValue(null);
        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        expect(res.status).toBe(404);
    });

    it("3. returns 404 for nonexistent finding", async () => {
        findingFindUnique.mockResolvedValue(null);
        const [req, ctx] = makeRequest("nonexistent");
        const res = await GET(req, ctx);
        expect(res.status).toBe(404);
    });

    it("4. returns 403 when user does not own the site", async () => {
        siteFindUnique.mockResolvedValue({ userId: "other-user", domain: "evil.com" });
        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        expect(res.status).toBe(403);
    });

    it("5. returns complete timeline with all stages for a minimal finding", async () => {
        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.finding.id).toBe("finding-1");
        expect(body.finding.lifecycleState).toBe("OPEN");
        expect(body.domain).toBe("example.com");

        expect(body.stages.discovery.status).toBe("completed");
        expect(body.stages.evidence.status).toBe("pending");
        expect(body.stages.remediation.status).toBe("unavailable");
        expect(body.stages.deployment.status).toBe("unavailable");
        expect(body.stages.t0Verification.status).toBe("unavailable");
        expect(body.stages.t7Verification.status).toBe("unavailable");
        expect(body.stages.t28Outcome.status).toBe("unavailable");
        expect(body.stages.resolution.status).toBe("pending");
    });

    it("6. classifies diagnostic evidence separately from verification evidence", async () => {
        evidenceFindMany.mockResolvedValue([
            {
                id: "ev-1",
                source: "HTML",
                url: "https://example.com/page1",
                observedAt: new Date("2026-09-01"),
                observedValue: { hasMetaDescription: false },
                confidence: 0.9,
            },
            {
                id: "ev-2",
                source: "HTML",
                url: "https://example.com/page1",
                observedAt: new Date("2026-09-05"),
                observedValue: { verificationType: "T0_IMMEDIATE", outcome: "passed" },
                confidence: 0.95,
            },
        ]);

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.evidence.count).toBe(1);
        expect(body.stages.evidence.items).toHaveLength(1);
        expect(body.stages.evidence.items[0].id).toBe("ev-1");
        expect(body.stages.t0Verification.evidence).toHaveLength(1);
        expect(body.stages.t0Verification.evidence[0].id).toBe("ev-2");
    });

    it("7. returns passed status for T+7 with improved outcome", async () => {
        evidenceFindMany.mockResolvedValue([
            {
                id: "ev-t7",
                source: "GSC",
                url: null,
                observedAt: new Date("2026-09-08"),
                observedValue: { verificationType: "T7_STABILITY", outcome: "improved" },
                confidence: 0.8,
            },
        ]);
        proposalFindMany.mockResolvedValue([{
            id: "prop-1",
            issueLabel: "Fix meta",
            status: "DEPLOYED",
            prUrl: null,
            prNumber: null,
            deploymentUrl: "https://deploy.example.com",
            deploymentStatus: "DEPLOYED",
            deployedAt: new Date("2026-09-04"),
            verificationStatus: "VERIFIED",
            createdAt: new Date("2026-09-03"),
        }]);

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.t7Verification.status).toBe("passed");
        expect(body.stages.deployment.status).toBe("completed");
    });

    it("8. returns failed status for T+28 with degraded outcome", async () => {
        evidenceFindMany.mockResolvedValue([
            {
                id: "ev-t28",
                source: "GSC",
                url: null,
                observedAt: new Date("2026-09-29"),
                observedValue: { verificationType: "T28_BUSINESS", outcome: "degraded" },
                confidence: 0.7,
            },
        ]);
        proposalFindMany.mockResolvedValue([{
            id: "prop-1",
            issueLabel: "Fix meta",
            status: "DEPLOYED",
            prUrl: null,
            prNumber: null,
            deploymentUrl: null,
            deploymentStatus: "DEPLOYED",
            deployedAt: new Date("2026-09-01"),
            verificationStatus: "PENDING",
            createdAt: new Date("2026-09-01"),
        }]);

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.t28Outcome.status).toBe("failed");
    });

    it("9. returns insufficient_data for inconclusive verification outcome", async () => {
        evidenceFindMany.mockResolvedValue([
            {
                id: "ev-t0",
                source: "HTML",
                url: null,
                observedAt: new Date("2026-09-05"),
                observedValue: { verificationType: "T0_IMMEDIATE", outcome: "inconclusive" },
                confidence: 0.3,
            },
        ]);
        proposalFindMany.mockResolvedValue([{
            id: "prop-1",
            issueLabel: "Fix meta",
            status: "DEPLOYED",
            prUrl: null,
            prNumber: null,
            deploymentUrl: null,
            deploymentStatus: "DEPLOYED",
            deployedAt: new Date("2026-09-04"),
            verificationStatus: "PENDING",
            createdAt: new Date("2026-09-03"),
        }]);

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.t0Verification.status).toBe("insufficient_data");
    });

    it("10. returns unavailable (not failed) when no verification evidence exists and no deployment", async () => {
        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.t0Verification.status).toBe("unavailable");
        expect(body.stages.t7Verification.status).toBe("unavailable");
        expect(body.stages.t28Outcome.status).toBe("unavailable");
    });

    it("11. returns pending (not failed) when deployment exists but verification has not run", async () => {
        proposalFindMany.mockResolvedValue([{
            id: "prop-1",
            issueLabel: "Fix meta",
            status: "DEPLOYED",
            prUrl: null,
            prNumber: null,
            deploymentUrl: null,
            deploymentStatus: "DEPLOYED",
            deployedAt: new Date("2026-09-04"),
            verificationStatus: "PENDING",
            createdAt: new Date("2026-09-03"),
        }]);

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.t0Verification.status).toBe("pending");
        expect(body.stages.t7Verification.status).toBe("pending");
        expect(body.stages.t28Outcome.status).toBe("pending");
    });

    it("12. includes linked healing logs with provenance", async () => {
        healingLogFindMany.mockResolvedValue([
            {
                id: "log-1",
                issueType: "missing_meta_description",
                description: "Added meta description to /page1",
                actionTaken: "inject_meta_tag",
                status: "COMPLETED",
                impactScore: 5,
                createdAt: new Date("2026-09-02"),
            },
        ]);

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.remediation.status).toBe("completed");
        expect(body.stages.remediation.healingLogs).toHaveLength(1);
        expect(body.stages.remediation.healingLogs[0].id).toBe("log-1");
    });

    it("13. shows no linked remediation when diagnosticFindingId is absent", async () => {
        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.remediation.status).toBe("unavailable");
        expect(body.stages.remediation.healingLogs).toHaveLength(0);
        expect(body.stages.remediation.proposals).toHaveLength(0);
    });

    it("14. returns resolved status when finding has resolvedAt", async () => {
        findingFindUnique.mockResolvedValue({
            ...baseFinding,
            lifecycleState: "RESOLVED",
            resolvedAt: new Date("2026-09-30"),
        });

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.finding.lifecycleState).toBe("RESOLVED");
        expect(body.stages.resolution.status).toBe("completed");
        expect(body.stages.resolution.resolvedAt).toBeTruthy();
    });

    it("15. deterministic timeline ordering — evidence is ordered by observedAt ASC", async () => {
        const [req, ctx] = makeRequest("finding-1");
        await GET(req, ctx);

        const evidenceCall = evidenceFindMany.mock.calls[0];
        expect(evidenceCall[0].orderBy).toEqual({ observedAt: "asc" });
    });

    it("16. rejects invalid finding ID", async () => {
        const longId = "x".repeat(51);
        const [req, ctx] = makeRequest(longId);
        const res = await GET(req, ctx);
        expect(res.status).toBe(400);
    });

    it("17. returns full lifecycle with all stages populated", async () => {
        findingFindUnique.mockResolvedValue({
            ...baseFinding,
            lifecycleState: "RESOLVED",
            resolvedAt: new Date("2026-09-30"),
        });

        evidenceFindMany.mockResolvedValue([
            { id: "ev-diag", source: "HTML", url: null, observedAt: new Date("2026-09-01"), observedValue: { found: false }, confidence: 0.9 },
            { id: "ev-t0", source: "HTML", url: null, observedAt: new Date("2026-09-05"), observedValue: { verificationType: "T0_IMMEDIATE", outcome: "passed" }, confidence: 0.95 },
            { id: "ev-t7", source: "GSC", url: null, observedAt: new Date("2026-09-12"), observedValue: { verificationType: "T7_STABILITY", outcome: "improved" }, confidence: 0.85 },
            { id: "ev-t28", source: "GSC", url: null, observedAt: new Date("2026-09-29"), observedValue: { verificationType: "T28_BUSINESS", outcome: "improved", impactScore: 8 }, confidence: 0.8 },
        ]);

        healingLogFindMany.mockResolvedValue([
            { id: "log-1", issueType: "missing_meta_description", description: "Added meta description", actionTaken: "inject", status: "COMPLETED", impactScore: 5, createdAt: new Date("2026-09-02") },
        ]);

        proposalFindMany.mockResolvedValue([{
            id: "prop-1",
            issueLabel: "Fix meta description",
            status: "DEPLOYED",
            prUrl: "https://github.com/repo/pull/42",
            prNumber: 42,
            deploymentUrl: "https://deploy.example.com",
            deploymentStatus: "DEPLOYED",
            deployedAt: new Date("2026-09-04"),
            verificationStatus: "VERIFIED",
            createdAt: new Date("2026-09-03"),
        }]);

        const [req, ctx] = makeRequest("finding-1");
        const res = await GET(req, ctx);
        const body = await res.json();

        expect(body.stages.discovery.status).toBe("completed");
        expect(body.stages.evidence.status).toBe("completed");
        expect(body.stages.evidence.count).toBe(1);
        expect(body.stages.remediation.status).toBe("completed");
        expect(body.stages.deployment.status).toBe("completed");
        expect(body.stages.deployment.deployments).toHaveLength(1);
        expect(body.stages.t0Verification.status).toBe("passed");
        expect(body.stages.t7Verification.status).toBe("passed");
        expect(body.stages.t28Outcome.status).toBe("passed");
        expect(body.stages.resolution.status).toBe("completed");
    });
});
