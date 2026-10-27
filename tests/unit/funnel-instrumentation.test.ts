import { describe, it, expect, vi, beforeEach } from "vitest";

const { auditLogCreate, auditLogGroupBy, loggerWarn } = vi.hoisted(() => ({
    auditLogCreate: vi.fn(),
    auditLogGroupBy: vi.fn(),
    loggerWarn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: { auditLog: { create: auditLogCreate, groupBy: auditLogGroupBy } },
}));

vi.mock("@/lib/logger", () => ({
    logger: { warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { trackFunnelEvent, getFunnelSummary, funnelAction } from "@/lib/funnel";

describe("funnel instrumentation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("records a namespaced AuditLog row", async () => {
        auditLogCreate.mockResolvedValue({});
        await trackFunnelEvent("user-1", "site_connected", "site-1", { siteCount: 1 });
        expect(auditLogCreate).toHaveBeenCalledWith({
            data: {
                actorId: "user-1",
                action: "funnel.site_connected",
                target: "site-1",
                payload: { siteCount: 1 },
            },
        });
    });

    it("never throws when persistence fails", async () => {
        auditLogCreate.mockRejectedValue(new Error("db down"));
        await expect(trackFunnelEvent("user-1", "audit_completed", "site-1")).resolves.toBeUndefined();
        expect(loggerWarn).toHaveBeenCalled();
    });

    it("counts unique users per funnel step", async () => {
        auditLogGroupBy.mockResolvedValue([
            { action: funnelAction("site_connected"), actorId: "a" },
            { action: funnelAction("site_connected"), actorId: "b" },
            { action: funnelAction("audit_completed"), actorId: "a" },
            { action: funnelAction("checkout_completed"), actorId: "a" },
        ]);
        const summary = await getFunnelSummary(new Date("2026-01-01"));
        expect(summary).toEqual({
            site_connected: 2,
            audit_completed: 1,
            fix_approved: 0,
            checkout_completed: 1,
        });
    });
});
