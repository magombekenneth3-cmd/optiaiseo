/**
 * PR 4 — runAudit / getPageAudits credit wiring.
 * The billing helper is mocked here; its idempotency is covered in audit-billing.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    charge: vi.fn(),
    refundOnce: vi.fn(),
    refundIfFailed: vi.fn(),
    acquire: vi.fn(),
    release: vi.fn(),
    send: vi.fn(),
    runSiteAudit: vi.fn(),
    prisma: {
        site: { findUnique: vi.fn() },
        audit: {
            findFirst: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
        },
    },
}));

vi.mock("@/lib/credits/audit-billing", () => ({
    chargeAuditCreditsOnce: h.charge,
    refundAuditCreditsOnce: h.refundOnce,
    refundAuditIfFailed: h.refundIfFailed,
}));
vi.mock("@/lib/audit-lock", () => ({ acquireAuditLease: h.acquire, releaseAuditLease: h.release }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: h.send } }));
vi.mock("@/lib/audit", () => ({ runSiteAudit: h.runSiteAudit }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn(async () => ({ ok: true, user: { id: "user_1" } })) }));
vi.mock("@/lib/stripe/guards", () => ({ getEffectiveTier: vi.fn(async () => "PRO"), guardErrorToResult: vi.fn() }));
vi.mock("@/lib/seo/ai", () => ({ clearSessionCaches: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { runAudit, getPageAudits } from "@/app/actions/audit";

const SITE_ID = "csite0000000000000000001";
const AUDIT_ID = "caudit000000000000000001";

beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.site.findUnique.mockResolvedValue({ id: SITE_ID, domain: "example.com", targetKeyword: null });
    h.prisma.audit.findFirst.mockResolvedValue(null);
    h.prisma.audit.create.mockResolvedValue({ id: AUDIT_ID });
    h.prisma.audit.delete.mockResolvedValue({});
    h.prisma.audit.update.mockResolvedValue({});
    h.prisma.audit.updateMany.mockResolvedValue({ count: 1 });
    h.acquire.mockResolvedValue(true);
    h.release.mockResolvedValue(undefined);
    h.send.mockResolvedValue(undefined);
    h.charge.mockResolvedValue({ charged: true, alreadyCharged: false, cost: 10, remaining: 40 });
    h.refundOnce.mockResolvedValue({ refunded: true, amount: 10, balance: 50 });
    h.refundIfFailed.mockResolvedValue({ refunded: true, amount: 10, balance: 50 });
});

describe("runAudit charges at job creation", () => {
    it("charges a full audit once, keyed by the new audit ID, before queueing", async () => {
        const res = await runAudit(SITE_ID, "full");

        expect(res).toEqual({ success: true, audit: { id: AUDIT_ID } });
        expect(h.charge).toHaveBeenCalledTimes(1);
        expect(h.charge).toHaveBeenCalledWith("user_1", AUDIT_ID);
        expect(h.charge.mock.invocationCallOrder[0]).toBeGreaterThan(h.acquire.mock.invocationCallOrder[0]);
        expect(h.charge.mock.invocationCallOrder[0]).toBeLessThan(h.send.mock.invocationCallOrder[0]);
        expect(h.refundOnce).not.toHaveBeenCalled();
    });

    it("does not charge homepage-only scans", async () => {
        await runAudit(SITE_ID, "homepage");
        expect(h.charge).not.toHaveBeenCalled();
        expect(h.send).toHaveBeenCalledTimes(1);
    });

    it("does not charge when another audit holds the lease", async () => {
        h.acquire.mockResolvedValue(false);
        const res = await runAudit(SITE_ID, "full");
        expect(res.success).toBe(false);
        expect(h.charge).not.toHaveBeenCalled();
    });

    it.each(["insufficient_credits", "credits_locked"] as const)(
        "on %s: returns a coded error, removes the audit, releases the lease, queues nothing",
        async (reason) => {
            h.charge.mockResolvedValue({ charged: false, reason, cost: 10, remaining: 3 });

            const res = await runAudit(SITE_ID, "full");

            expect(res).toMatchObject({ success: false, code: reason });
            expect(h.prisma.audit.delete).toHaveBeenCalledWith({ where: { id: AUDIT_ID } });
            expect(h.release).toHaveBeenCalledWith(`audit-lock:user_1:${SITE_ID}`, AUDIT_ID);
            expect(h.send).not.toHaveBeenCalled();
            expect(h.prisma.audit.updateMany).not.toHaveBeenCalled(); // not marked FAILED
        },
    );

    it("refunds when the queue is down and the synchronous fallback fails", async () => {
        h.send.mockRejectedValue(new Error("inngest down"));
        h.runSiteAudit.mockRejectedValue(new Error("crawl failed"));

        await runAudit(SITE_ID, "full");

        expect(h.prisma.audit.update).toHaveBeenCalledWith({ where: { id: AUDIT_ID }, data: { fixStatus: "FAILED" } });
        expect(h.refundOnce).toHaveBeenCalledWith("user_1", AUDIT_ID, expect.stringMatching(/fallback/));
    });

    it("refunds a full audit that degraded to the free homepage-only fallback", async () => {
        h.send.mockRejectedValue(new Error("inngest down"));
        h.runSiteAudit.mockResolvedValue({ categoryScores: {}, issues: [], lcp: null, cls: null, inp: null });

        const res = await runAudit(SITE_ID, "full");

        expect(res.success).toBe(true);
        expect(h.refundOnce).toHaveBeenCalledWith("user_1", AUDIT_ID, expect.stringMatching(/homepage-only fallback/));
    });

    it("refunds (idempotently) when an unexpected error marks the audit FAILED", async () => {
        h.charge.mockRejectedValue(new Error("db blip"));

        const res = await runAudit(SITE_ID, "full");

        expect(res).toEqual({ success: false, error: "Failed to execute audit." });
        expect(h.prisma.audit.updateMany).toHaveBeenCalled();
        expect(h.refundIfFailed).toHaveBeenCalledWith(AUDIT_ID, expect.any(String));
    });
});

describe("getPageAudits no longer charges on every view", () => {
    beforeEach(() => {
        h.prisma.audit.findFirst.mockResolvedValue({ id: AUDIT_ID, pageAudits: [{ id: "p1" }] });
    });

    it("uses the idempotent per-audit charge (no-op for audits charged at creation)", async () => {
        h.charge.mockResolvedValue({ charged: true, alreadyCharged: true, cost: 10, remaining: null });

        await getPageAudits(AUDIT_ID);
        await getPageAudits(AUDIT_ID);

        expect(h.charge).toHaveBeenNthCalledWith(1, "user_1", AUDIT_ID);
        expect(h.charge).toHaveBeenNthCalledWith(2, "user_1", AUDIT_ID);
    });

    it("does not charge for audits without page results (homepage-only / weekly)", async () => {
        h.prisma.audit.findFirst.mockResolvedValue({ id: AUDIT_ID, pageAudits: [] });
        const res = await getPageAudits(AUDIT_ID);
        expect(res).toEqual({ success: true, pages: [] });
        expect(h.charge).not.toHaveBeenCalled();
    });

    it("upsells when an uncharged legacy audit cannot be paid for", async () => {
        h.charge.mockResolvedValue({ charged: false, reason: "insufficient_credits", cost: 10, remaining: 2 });
        const res = await getPageAudits(AUDIT_ID);
        expect(res).toMatchObject({ success: false, upsell: true, pages: [] });
        expect((res as { error: string }).error).toMatch(/2 remaining, need 10/);
    });
});
