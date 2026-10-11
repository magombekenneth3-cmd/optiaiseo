/**
 * Regression tests for tenant-isolation defects found during the route /
 * server-action audit (see docs/security/tenant-isolation-audit.md):
 *
 *   1. /api/growth/stream-execution was unauthenticated and executed any
 *      decision against a query-string siteId.
 *   2. /api/pseo/batch-generate was unauthenticated and accepted an arbitrary
 *      siteId/domain for LLM batch generation.
 *   3. executeGrowthDecision executed without a DB approval record and did not
 *      bind the decision to the site being mutated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    getAuthUser: vi.fn(),
    assertSiteAccess: vi.fn(),
    decisionFindUnique: vi.fn(),
    decisionUpdateMany: vi.fn(),
    blogFindFirst: vi.fn(),
    blogCount: vi.fn(),
    inngestSend: vi.fn(),
    executeSpy: vi.fn(),
    createOperation: vi.fn(),
}));

vi.mock("@/lib/auth/get-auth-user", () => ({ getAuthUser: h.getAuthUser }));
vi.mock("@/lib/auth/require-user", () => ({ assertSiteAccess: h.assertSiteAccess }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: h.inngestSend } }));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/growth/decision-lock", () => ({
    acquireSyncLock: vi.fn().mockResolvedValue(true),
    releaseSyncLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/growth/decision-persistence", () => ({
    // A cached list entry exists for both decisions — this must NOT be treated as approval.
    getPersistedDecisions: vi.fn().mockResolvedValue([
        { id: "dec-a", siteId: "site-a", action: "REFRESH_CONTENT", url: "/blog/post-a", primaryKeyword: "k" },
        { id: "dec-cached-only", siteId: "site-b", action: "REFRESH_CONTENT", url: "/blog/post-b", primaryKeyword: "k" },
    ]),
}));
vi.mock("@/lib/experiments/tracker", () => ({ recordExperimentBaseline: vi.fn() }));
vi.mock("@/lib/autofix/fixer", () => ({ performOneClickAutoFix: vi.fn() }));
vi.mock("@/lib/mutations", () => {
    class E extends Error {}
    return {
        createOperation: h.createOperation,
        executeOperation: vi.fn(),
        registerEffect: vi.fn(),
        ExecutionClaimError: E,
        MutationBlockedError: E,
        ConcurrentModificationError: E,
    };
});
vi.mock("@/lib/prisma", () => ({
    prisma: {
        growthDecision: { findUnique: h.decisionFindUnique, updateMany: h.decisionUpdateMany },
        blog: { findFirst: h.blogFindFirst, count: h.blogCount },
        $transaction: (cb: (tx: unknown) => unknown) => cb({ growthDecision: { updateMany: h.decisionUpdateMany } }),
    },
}));

import { NextRequest } from "next/server";
import { executeGrowthDecision } from "@/lib/growth/execution-engine";
import { GET as streamExecution } from "@/app/api/growth/stream-execution/route";
import { POST as pseoBatch } from "@/app/api/pseo/batch-generate/route";

const DECISION_A = { id: "dec-a", siteId: "site-a", url: "/blog/post-a", action: "REFRESH_CONTENT", primaryKeyword: "k", status: "APPROVED" };

beforeEach(() => {
    vi.clearAllMocks();
    h.decisionFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
        where.id === "dec-a" ? DECISION_A : null,
    );
    h.decisionUpdateMany.mockResolvedValue({ count: 1 });
    h.blogFindFirst.mockResolvedValue(null);
});

describe("executeGrowthDecision — approval integrity and site binding", () => {
    it("refuses a decision that belongs to a different site and does not mark it EXECUTED", async () => {
        const res = await executeGrowthDecision("dec-a", "site-b");
        expect(res.success).toBe(false);
        expect(res.details).toMatch(/not found for this site/i);
        expect(h.blogFindFirst).not.toHaveBeenCalled();
        expect(h.createOperation).not.toHaveBeenCalled();
        expect(h.decisionUpdateMany).not.toHaveBeenCalled();
    });

    it("refuses a decision that exists only in the cached list (no DB approval record)", async () => {
        const res = await executeGrowthDecision("dec-cached-only", "site-b");
        expect(res.success).toBe(false);
        expect(h.blogFindFirst).not.toHaveBeenCalled();
        expect(h.createOperation).not.toHaveBeenCalled();
    });

    it("fails closed when the decision lookup itself throws", async () => {
        h.decisionFindUnique.mockRejectedValue(new Error("db down"));
        const res = await executeGrowthDecision("dec-a", "site-a");
        expect(res.success).toBe(false);
        expect(h.blogFindFirst).not.toHaveBeenCalled();
    });

    it("proceeds to target resolution for an APPROVED same-site decision", async () => {
        const res = await executeGrowthDecision("dec-a", "site-a");
        // Blog is absent in this fixture, so it stops at target resolution — but it got past the gate.
        expect(h.blogFindFirst).toHaveBeenCalledWith({ where: { siteId: "site-a", slug: "post-a" } });
        expect(res.success).toBe(false);
    });
});

describe("GET /api/growth/stream-execution — authorization", () => {
    const req = (qs: string) => new NextRequest(`http://localhost/api/growth/stream-execution?${qs}`);

    it("401 when unauthenticated", async () => {
        h.getAuthUser.mockResolvedValue(null);
        const res = await streamExecution(req("decisionId=dec-a&siteId=site-a"));
        expect(res.status).toBe(401);
        expect(h.decisionFindUnique).not.toHaveBeenCalled();
    });

    it("400 without decisionId (no demo defaults)", async () => {
        h.getAuthUser.mockResolvedValue({ id: "user-a" });
        const res = await streamExecution(req(""));
        expect(res.status).toBe(400);
    });

    it("404 when the caller lacks EDIT access to the decision's site", async () => {
        h.getAuthUser.mockResolvedValue({ id: "user-b" });
        h.assertSiteAccess.mockResolvedValue(null);
        const res = await streamExecution(req("decisionId=dec-a"));
        expect(res.status).toBe(404);
        expect(h.assertSiteAccess).toHaveBeenCalledWith("site-a", "user-b", "EDIT");
    });

    it("404 when the query-string siteId disagrees with the decision's site", async () => {
        h.getAuthUser.mockResolvedValue({ id: "user-a" });
        h.assertSiteAccess.mockResolvedValue({ id: "site-b" });
        const res = await streamExecution(req("decisionId=dec-a&siteId=site-b"));
        expect(res.status).toBe(404);
    });

    it("streams for an authorized editor", async () => {
        h.getAuthUser.mockResolvedValue({ id: "user-a" });
        h.assertSiteAccess.mockResolvedValue({ id: "site-a" });
        const res = await streamExecution(req("decisionId=dec-a"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        await res.body?.cancel();
    });
});

describe("POST /api/pseo/batch-generate — authorization", () => {
    const req = (body: unknown) =>
        new NextRequest("http://localhost/api/pseo/batch-generate", {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
        });
    const valid = { siteId: "site-a", pattern: "Best {x}", dataset: [{ x: "a" }], siteDomain: "attacker.example" };

    it("401 when unauthenticated and nothing is enqueued", async () => {
        h.getAuthUser.mockResolvedValue(null);
        const res = await pseoBatch(req(valid));
        expect(res.status).toBe(401);
        expect(h.inngestSend).not.toHaveBeenCalled();
    });

    it("404 for a site the caller cannot edit", async () => {
        h.getAuthUser.mockResolvedValue({ id: "user-b" });
        h.assertSiteAccess.mockResolvedValue(null);
        const res = await pseoBatch(req(valid));
        expect(res.status).toBe(404);
        expect(h.inngestSend).not.toHaveBeenCalled();
    });

    it("400 for oversized batches", async () => {
        h.getAuthUser.mockResolvedValue({ id: "user-a" });
        const res = await pseoBatch(req({ ...valid, dataset: Array.from({ length: 201 }, () => ({ x: "a" })) }));
        expect(res.status).toBe(400);
    });

    it("202 for an editor; domain comes from the site record, not the body", async () => {
        h.getAuthUser.mockResolvedValue({ id: "user-a" });
        h.assertSiteAccess.mockResolvedValue({ id: "site-a", domain: "a.example.com" });
        const res = await pseoBatch(req(valid));
        expect(res.status).toBe(202);
        expect(h.inngestSend).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ siteId: "site-a", siteDomain: "a.example.com" }),
            }),
        );
    });
});
