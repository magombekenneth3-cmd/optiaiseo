import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHashnodePublicationId, syndicateToHashnode } from "@/lib/blog/hashnode";

vi.mock("@/lib/logger", () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const mockFetch = vi.fn();

const draft = {
    title: "Practical SEO Audits",
    content: "# Practical SEO Audits\n\nA useful Markdown article.",
    excerpt: "**A practical** guide to auditing a website.",
    metaDescription: "A practical guide to auditing a website.",
    targetKeywords: ["SEO", "seo", "Technical SEO", "   ", "Content audits", "Crawling", "Indexing", "Analytics"],
};

function apiResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("Hashnode publication resolution", () => {
    it("uses an existing 24-character publication ID without making a network request", async () => {
        const result = await resolveHashnodePublicationId(
            "secret-token",
            "6769f1a59c13c4f98d3b7a2e",
        );

        expect(result).toEqual({
            success: true,
            publicationId: "6769f1a59c13c4f98d3b7a2e",
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("resolves a publication hostname to its Hashnode publication ID", async () => {
        mockFetch.mockResolvedValue(apiResponse({
            data: { publication: { id: "6769f1a59c13c4f98d3b7a2e" } },
        }));

        const result = await resolveHashnodePublicationId(
            "secret-token",
            "https://my-publication.hashnode.dev/",
        );

        expect(result).toEqual({
            success: true,
            publicationId: "6769f1a59c13c4f98d3b7a2e",
        });

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://gql.hashnode.com/");
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-token");
        const payload = JSON.parse(String(init.body));
        expect(payload.query).toContain("publication(host: $host)");
        expect(payload.variables.host).toBe("my-publication.hashnode.dev");
    });

    it("returns an actionable error when a publication hostname cannot be resolved", async () => {
        mockFetch.mockResolvedValue(apiResponse({
            data: { publication: null },
        }));

        const result = await resolveHashnodePublicationId(
            "secret-token",
            "missing-publication.hashnode.dev",
        );

        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain("No Hashnode publication was found");
    });
});

describe("Hashnode syndication", () => {
    it("publishes with the source article canonical URL and valid GraphQL fields", async () => {
        mockFetch.mockResolvedValue(apiResponse({
            data: { publishPost: { post: { id: "post-id", slug: "practical-seo-audits", url: "https://writer.hashnode.dev/practical-seo-audits" } } },
        }));

        const result = await syndicateToHashnode({
            publicationId: "6769f1a59c13c4f98d3b7a2e",
            token: "secret-token",
            canonicalUrl: "https://example.com/blog/practical-seo-audits",
            draft,
        });

        expect(result).toEqual({ success: true, postUrl: "https://writer.hashnode.dev/practical-seo-audits" });
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://gql.hashnode.com/");
        expect(init.method).toBe("POST");
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-token");

        const payload = JSON.parse(String(init.body));
        expect(payload.query).toContain("publishPost(input: $input)");
        expect(payload.variables.input).toMatchObject({
            publicationId: "6769f1a59c13c4f98d3b7a2e",
            title: "Practical SEO Audits",
            contentMarkdown: draft.content,
            originalArticleURL: "https://example.com/blog/practical-seo-audits",
            metaTitle: "Practical SEO Audits",
            metaDescription: draft.metaDescription,
            subtitle: "A practical guide to auditing a website.",
        });
        expect(payload.variables.input.tags).toEqual([
            { slug: "seo", name: "SEO" },
            { slug: "technical-seo", name: "Technical SEO" },
            { slug: "content-audits", name: "Content audits" },
            { slug: "crawling", name: "Crawling" },
            { slug: "indexing", name: "Indexing" },
        ]);
        expect(payload.variables.input).not.toHaveProperty("metaTags");
        expect(payload.variables.input).not.toHaveProperty("coverImageOptions");
    });

    it("fails fast when credentials or required content are missing", async () => {
        const noToken = await syndicateToHashnode({ publicationId: "6769f1a59c13c4f98d3b7a2e", token: "", draft });
        const noPublication = await syndicateToHashnode({ publicationId: "", token: "token", draft });
        const unresolvedHost = await syndicateToHashnode({ publicationId: "my-publication.hashnode.dev", token: "token", draft });
        const noContent = await syndicateToHashnode({
            publicationId: "6769f1a59c13c4f98d3b7a2e",
            token: "token",
            draft: { ...draft, content: "   " },
        });

        expect(noToken.success).toBe(false);
        expect(noPublication.success).toBe(false);
        expect(unresolvedHost.success).toBe(false);
        expect(noContent.success).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns GraphQL errors without retrying a non-idempotent publish mutation", async () => {
        mockFetch.mockResolvedValue(apiResponse({
            errors: [{ message: "Publication does not have an active Pro plan." }],
        }));

        const result = await syndicateToHashnode({
            publicationId: "6769f1a59c13c4f98d3b7a2e",
            token: "token",
            draft,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("active Pro plan");
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not report success when Hashnode returns no post URL", async () => {
        mockFetch.mockResolvedValue(apiResponse({
            data: { publishPost: { post: null } },
        }));

        const result = await syndicateToHashnode({
            publicationId: "6769f1a59c13c4f98d3b7a2e",
            token: "token",
            draft,
        });

        expect(result).toEqual({
            success: false,
            error: "Hashnode did not return a published post URL",
        });
    });
});
