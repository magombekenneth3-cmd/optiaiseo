/**
 * Regression tests: legacy /api/publish cross-tenant authorization.
 *
 * Primary invariant: the publishing dispatcher is never reached unless the
 * blog belongs to a site owned by the authenticated caller, and destination
 * credentials come from the site's stored connection — never the request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getServerSessionMock, blogFindFirst, dispatchMock } = vi.hoisted(() => ({
    getServerSessionMock: vi.fn(),
    blogFindFirst: vi.fn(),
    dispatchMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({
    prisma: { blog: { findFirst: blogFindFirst } },
}));
vi.mock("@/lib/publishers", () => ({ dispatchMultiCmsPublish: dispatchMock }));
vi.mock("@/lib/mutations", () => {
    class MutationBlockedError extends Error {}
    return { MutationBlockedError };
});

import { POST } from "@/app/api/publish/route";
import { MutationBlockedError } from "@/lib/mutations";

const USER_A = "user-a";
const USER_B = "user-b";

// In-memory tenant data: blog-b belongs to a site owned by USER_B.
const BLOGS = {
    "blog-a": {
        id: "blog-a",
        title: "A",
        content: "<p>A</p>",
        slug: "a",
        metaDescription: null,
        targetKeywords: [],
        site: {
            id: "site-a",
            userId: USER_A,
            wordPressConfig: { wpUrl: "https://a.example.com", wpUser: "u", wpAppPassword: "p" },
            ghostConfig: null,
        },
    },
    "blog-b": {
        id: "blog-b",
        title: "B",
        content: "<p>B</p>",
        slug: "b",
        metaDescription: null,
        targetKeywords: [],
        site: {
            id: "site-b",
            userId: USER_B,
            wordPressConfig: { wpUrl: "https://b.example.com", wpUser: "u", wpAppPassword: "p" },
            ghostConfig: null,
        },
    },
} as const;

/** Emulates Prisma's `where: { id, site: { userId } }` semantics faithfully. */
function installTenantAwareFindFirst() {
    blogFindFirst.mockImplementation(async (args: { where: { id: string; site?: { userId?: string } } }) => {
        const blog = BLOGS[args.where.id as keyof typeof BLOGS];
        if (!blog) return null;
        // If the route ever drops the ownership filter, this test double will
        // return foreign blogs — and the cross-tenant test will fail.
        if (args.where.site?.userId !== undefined && blog.site.userId !== args.where.site.userId) return null;
        return blog;
    });
}

function req(body: unknown) {
    return new Request("http://localhost/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    installTenantAwareFindFirst();
    dispatchMock.mockResolvedValue({ platform: "WORDPRESS", publishedUrl: "https://a.example.com/a" });
});

describe("POST /api/publish — authorization", () => {
    it("returns 401 when unauthenticated and never dispatches", async () => {
        getServerSessionMock.mockResolvedValue(null);
        const res = await POST(req({ blogId: "blog-a", platform: "WORDPRESS" }));
        expect(res.status).toBe(401);
        expect(blogFindFirst).not.toHaveBeenCalled();
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("denies User A publishing User B's blog (404) and never dispatches", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        const res = await POST(req({ blogId: "blog-b", platform: "WORDPRESS" }));
        expect(res.status).toBe(404);
        expect(dispatchMock).not.toHaveBeenCalled();
        // The lookup itself must carry the ownership predicate.
        expect(blogFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "blog-b", site: { userId: USER_A } } }),
        );
    });

    it("returns 404 for a nonexistent blog", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        const res = await POST(req({ blogId: "does-not-exist", platform: "WORDPRESS" }));
        expect(res.status).toBe(404);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("returns 400 for an unsupported platform", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        const res = await POST(req({ blogId: "blog-a", platform: "MYSPACE" }));
        expect(res.status).toBe(400);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        const res = await POST(req("{not json"));
        expect(res.status).toBe(400);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("rejects client-supplied destination config (400)", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        const res = await POST(
            req({ blogId: "blog-a", platform: "WORDPRESS", config: { wpUrl: "http://169.254.169.254" } }),
        );
        expect(res.status).toBe(400);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("returns 422 for a platform with no stored connection", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        const ghost = await POST(req({ blogId: "blog-a", platform: "GHOST" }));
        expect(ghost.status).toBe(422);
        const shopify = await POST(req({ blogId: "blog-a", platform: "SHOPIFY" }));
        expect(shopify.status).toBe(422);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("allows the owner to publish using the site's stored connection and passes siteId", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        const res = await POST(req({ blogId: "blog-a", platform: "WORDPRESS" }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true, platform: "WORDPRESS" });
        expect(dispatchMock).toHaveBeenCalledTimes(1);
        const [, siteConfig] = dispatchMock.mock.calls[0];
        expect(siteConfig).toEqual({
            platform: "WORDPRESS",
            siteId: "site-a",
            wordPressConfig: BLOGS["blog-a"].site.wordPressConfig,
        });
    });

    it("maps the CMS kill switch to 409 without leaking internals", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        dispatchMock.mockRejectedValue(new MutationBlockedError("kill switch: internal detail"));
        const res = await POST(req({ blogId: "blog-a", platform: "WORDPRESS" }));
        expect(res.status).toBe(409);
        expect(JSON.stringify(await res.json())).not.toContain("internal detail");
    });

    it("sanitizes provider failures (502, correlationId, no raw error)", async () => {
        getServerSessionMock.mockResolvedValue({ user: { id: USER_A } });
        dispatchMock.mockRejectedValue(new Error("WP 401: secret-token-xyz"));
        const res = await POST(req({ blogId: "blog-a", platform: "WORDPRESS" }));
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.correlationId).toEqual(expect.any(String));
        expect(JSON.stringify(body)).not.toContain("secret-token-xyz");
    });
});
