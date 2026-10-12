import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syndicateToHashnode } from "@/lib/blog/hashnode";

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

describe("Hashnode syndication", () => {
    it("publishes with the source article canonical URL and valid GraphQL fields", async () => {
        mockFetch.mockResolvedValue(apiResponse({
            data: { publishPost: { post: { id: "post-id", slug: "practical-seo-audits", url: "https://writer.hashnode.dev/practical-seo-audits" } } },
        }));

        const result = await syndicateToHashnode({
            publicationId: "publication-id",
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
            publicationId: "publication-id",
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
        const noToken = await syndicateToHashnode({ publicationId: "publication-id", token: "", draft });
        const noPublication = await syndicateToHashnode({ publicationId: "", token: "token", draft });
        const noContent = await syndicateToHashnode({
            publicationId: "publication-id",
            token: "token",
            draft: { ...draft, content: "   " },
        });

        expect(noToken.success).toBe(false);
        expect(noPublication.success).toBe(false);
        expect(noContent.success).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns GraphQL errors without retrying a non-idempotent publish mutation", async () => {
        mockFetch.mockResolvedValue(apiResponse({
            errors: [{ message: "Publication does not have an active Pro plan." }],
        }));

        const result = await syndicateToHashnode({
            publicationId: "publication-id",
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
            publicationId: "publication-id",
            token: "token",
            draft,
        });

        expect(result).toEqual({
            success: false,
            error: "Hashnode did not return a published post URL",
        });
    });
});
