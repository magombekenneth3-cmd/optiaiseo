import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    redisGet: vi.fn(),
    redisSet: vi.fn(),
    notificationFindMany: vi.fn(),
    auditFindMany: vi.fn(),
    blogFindMany: vi.fn(),
}));

vi.mock("next-auth", () => ({
    getServerSession: vi.fn().mockResolvedValue({ user: { email: "reader@example.com" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/get-auth-user", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
    redis: { get: mocks.redisGet, set: mocks.redisSet, del: vi.fn() },
    isRedisConfigured: true,
    redisErrorCode: vi.fn(() => "ETIMEDOUT"),
}));
vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", sites: [] }) },
        notification: { findMany: mocks.notificationFindMany },
        audit: { findMany: mocks.auditFindMany },
        blog: { findMany: mocks.blogFindMany },
    },
}));

import { GET } from "@/app/api/notifications/route";

describe("notification reads when Redis is unavailable", () => {
    it("falls through to persisted notifications and returns the database response", async () => {
        mocks.redisGet.mockRejectedValueOnce(new Error("ETIMEDOUT"));
        mocks.redisSet.mockResolvedValue(undefined);
        mocks.notificationFindMany.mockResolvedValueOnce([{
            id: "notification-1",
            type: "info",
            title: "Saved alert",
            body: "This notification was read from Postgres.",
            href: null,
            read: false,
            createdAt: new Date("2026-10-21T10:00:00Z"),
        }]);
        mocks.auditFindMany.mockResolvedValueOnce([]);
        mocks.blogFindMany.mockResolvedValueOnce([]);

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get("X-Cache")).toBe("MISS");
        expect(body.notifications).toEqual([expect.objectContaining({
            id: "notification-1",
            title: "Saved alert",
            read: false,
        })]);
        expect(mocks.notificationFindMany).toHaveBeenCalledTimes(1);
        expect(mocks.redisSet).toHaveBeenCalledTimes(1);
    });
});
