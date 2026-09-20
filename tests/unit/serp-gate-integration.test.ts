/**
 * tests/unit/serp-gate-integration.test.ts
 *
 * Integration-level tests for the SERP gate credit invariants.
 * Proves that consumeCredits() is gated behind the server-side gate
 * in generateBlog, generateAttackBlog, and generateBlogForKeyword.
 *
 * Key assertion matrix:
 *   BLOCK                  → consumeCredits called 0 times
 *   WARN + no override     → consumeCredits called 0 times
 *   WARN + forceSerpMismatch → consumeCredits called 1 time
 *   ALLOW                  → consumeCredits called 1 time
 *   SKIP                   → consumeCredits called 1 time (fail-open)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks — hoisted before any module imports ────────────────────────────────

vi.mock("@/lib/auth/require-user", () => ({
    requireUser: vi.fn(),
}));

vi.mock("next-auth", () => ({
    getServerSession: vi.fn().mockResolvedValue({ user: { id: "user-1", email: "test@example.com" } }),
}));

vi.mock("@/lib/auth", () => ({
    authOptions: {},
}));

vi.mock("@/lib/credits", () => ({
    consumeCredits: vi.fn(),
}));

vi.mock("@/lib/stripe/plans", () => ({
    getEffectiveTier: vi.fn().mockResolvedValue("PRO"),
    BLOG_CREDITS_COST: 10,
}));

vi.mock("@/lib/blog/serp", () => ({
    fetchGoogleSerp: vi.fn(),
    classifySerpFormat: vi.fn(),
}));

vi.mock("@/lib/blog/serp-gate", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/lib/blog/serp-gate")>();
    return {
        ...real,                         // keep evaluateSerpIntentGate + normalizeKeyword real
        validateSerpPreflight: vi.fn(),  // async I/O — mock only this
        storeSerpPreflight: vi.fn().mockResolvedValue("mock-preflight-id"),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        site: {
            findUnique: vi.fn(),
            findFirst:  vi.fn(),
            update:     vi.fn().mockResolvedValue({}), // maybeSaveAuthorToSite
        },
        user: {
            findUnique: vi.fn(),
        },
        blog: {
            create: vi.fn().mockResolvedValue({ id: "blog-1" }),
        },
    },
}));

vi.mock("@/lib/inngest/client", () => ({
    inngest: { send: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@/lib/rate-limit", () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    limiters: {
        api: { limit: vi.fn().mockResolvedValue({ success: true }) },
        cannibalizationScan: { limit: vi.fn().mockResolvedValue({ success: true }) },
    },
}));

vi.mock("@/lib/blog", () => ({
    generateBlogPost: vi.fn(),
    generateBlogFromKeywordGap: vi.fn().mockResolvedValue({
        title: "Test Blog",
        slug: "test-blog",
        targetKeywords: ["crm"],
        content: "Test content",
        metaDescription: "Test meta",
        validationScore: 85,
        validationErrors: [],
        validationWarnings: [],
        heroImage: null,
    }),
    evaluateDraftForPublication: vi.fn().mockResolvedValue({
        publicationGate: {
            status: "DRAFT",
            score: 85,
            passed: false,
            blockingIssues: [],
            warnings: [],
        },
    }),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { generateBlog, generateAttackBlog } from "@/app/actions/blog";
import { generateBlogForKeyword } from "@/app/actions/keywords";
import { requireUser } from "@/lib/auth/require-user";
import { consumeCredits } from "@/lib/credits";
import { fetchGoogleSerp, classifySerpFormat } from "@/lib/blog/serp";
import { validateSerpPreflight } from "@/lib/blog/serp-gate";
import { prisma } from "@/lib/prisma";
import type { SerpFormatSignal } from "@/lib/blog/serp";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-1", name: "Test User", email: "test@example.com" };
const MOCK_SITE = {
    id: "site-1",
    domain: "example.com",
    userId: "user-1",
    authorName: "Test",
    authorRole:      null,
    authorBio:       null,
    realExperience:  null,
    realNumbers:     null,
    localContext:    null,
    blogTone:        null,
    subscriptionTier: "PRO",
    pipelineType:    "STANDARD",
};

const MOCK_AUTHOR_INPUT = {
    authorName:     "Test User",
    authorRole:     "Founder",
    authorBio:      "Test bio",
    realExperience: "Test experience",
    realNumbers:    "Test numbers",
    localContext:   "Test context",
    keyword:        "best crm software",
};

const MOCK_ORGANIC = [
    { title: "Best CRM tools", link: "https://example.com/crm", snippet: "Top tools" },
];

const TOOL_SIGNAL: SerpFormatSignal = {
    format: "tool", confidence: "high",
    reasoning: "Calculator and generator tools dominate top 3 results",
};
const LISTICLE_SIGNAL: SerpFormatSignal = {
    format: "listicle", confidence: "high",
    reasoning: "Top results are all listicle format",
};
const GUIDE_SIGNAL: SerpFormatSignal = {
    format: "guide", confidence: "high",
    reasoning: "Top results are how-to guides",
};

const ALLOW_RECORD = {
    preflightId: "pre-allow",
    userId:      "user-1",
    siteId:      "site-1",
    keyword:     "best crm software",
    signal:      GUIDE_SIGNAL,
    decision:    { verdict: "ALLOW" as const, format: "guide" as const, confidence: "high" as const, hint: "guide hint" },
    checkedAt:   new Date().toISOString(),
};

const WARN_RECORD = {
    preflightId: "pre-warn",
    userId:      "user-1",
    siteId:      "site-1",
    keyword:     "best crm software",
    signal:      LISTICLE_SIGNAL,
    decision:    {
        verdict: "WARN" as const, format: "listicle" as const, confidence: "high" as const,
        reason: "listicle SERP", hint: "use numbered list",
    },
    checkedAt: new Date().toISOString(),
};

// ─── Default setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireUser).mockResolvedValue({ ok: true, user: MOCK_USER } as never);
    vi.mocked(consumeCredits).mockResolvedValue({ allowed: true, remaining: 90, reason: null } as never);
    vi.mocked(prisma.site.findUnique).mockResolvedValue(MOCK_SITE as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue(MOCK_SITE as never);
    vi.mocked(prisma.site.update).mockResolvedValue(MOCK_SITE as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);
    vi.mocked(prisma.blog.create).mockResolvedValue({ id: "blog-1" } as never);
    vi.mocked(fetchGoogleSerp).mockResolvedValue({ organic: MOCK_ORGANIC, peopleAlsoAsk: [], featuredSnippet: null, relatedSearches: [] } as never);
    vi.mocked(classifySerpFormat).mockReturnValue(GUIDE_SIGNAL);
    vi.mocked(validateSerpPreflight).mockResolvedValue({ valid: false, reason: "PREFLIGHT_NOT_FOUND_OR_EXPIRED" });

    // Ensure SERPER_API_KEY is set for gate to run in tests
    process.env.SERPER_API_KEY = "test-key";
});

// ─── generateBlog ─────────────────────────────────────────────────────────────

describe("generateBlog — SERP gate credit invariants", () => {

    it("BLOCK: consumeCredits is never called", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(TOOL_SIGNAL); // tool+high = BLOCK

        const result = await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT);

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false, code: "SERP_GATE_BLOCK" });
    });

    it("WARN + no override: consumeCredits is never called", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(LISTICLE_SIGNAL); // WARN

        const result = await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT);

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false, code: "SERP_GATE_WARN", requiresConfirmation: true });
    });

    it("WARN + forceSerpMismatch + valid preflight: consumeCredits called once", async () => {
        vi.mocked(validateSerpPreflight).mockResolvedValue({ valid: true, record: WARN_RECORD });

        await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT,
            { preflightId: "pre-warn", forceSerpMismatch: true });

        expect(consumeCredits).toHaveBeenCalledTimes(1);
        expect(consumeCredits).toHaveBeenCalledWith("user-1", "blog_generation");
    });

    it("ALLOW (fresh gate): consumeCredits called once", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(GUIDE_SIGNAL);

        await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT);

        expect(consumeCredits).toHaveBeenCalledTimes(1);
    });

    it("ALLOW (valid preflight): consumeCredits called once", async () => {
        vi.mocked(validateSerpPreflight).mockResolvedValue({ valid: true, record: ALLOW_RECORD });

        await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT,
            { preflightId: "pre-allow" });

        expect(consumeCredits).toHaveBeenCalledTimes(1);
    });

    it("SKIP (no SERPER_API_KEY): consumeCredits called once — fail-open", async () => {
        delete process.env.SERPER_API_KEY;

        await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT);

        expect(consumeCredits).toHaveBeenCalledTimes(1);

        process.env.SERPER_API_KEY = "test-key"; // restore
    });

    it("BLOCK cannot be overridden — forceSerpMismatch on a fresh BLOCK still blocks", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(TOOL_SIGNAL); // tool+high = unconditional BLOCK

        const result = await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT,
            { forceSerpMismatch: true }); // no preflightId, fresh gate

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false, code: "SERP_GATE_BLOCK" });
    });
});

// ─── generateAttackBlog ───────────────────────────────────────────────────────

describe("generateAttackBlog — SERP gate credit invariants", () => {

    it("BLOCK: consumeCredits is never called", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(TOOL_SIGNAL);

        const result = await generateAttackBlog(
            "site-1", "best crm software", "competitor.com", 1000, 40);

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false, code: "SERP_GATE_BLOCK" });
    });

    it("WARN + no override: consumeCredits is never called", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(LISTICLE_SIGNAL);

        const result = await generateAttackBlog(
            "site-1", "best crm software", "competitor.com", 1000, 40);

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false, code: "SERP_GATE_WARN" });
    });

    it("WARN + forceSerpMismatch + valid preflight: consumeCredits called once", async () => {
        vi.mocked(validateSerpPreflight).mockResolvedValue({ valid: true, record: WARN_RECORD });

        await generateAttackBlog(
            "site-1", "best crm software", "competitor.com", 1000, 40,
            undefined, { preflightId: "pre-warn", forceSerpMismatch: true });

        expect(consumeCredits).toHaveBeenCalledTimes(1);
    });

    it("ALLOW: consumeCredits called once", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(GUIDE_SIGNAL);

        await generateAttackBlog(
            "site-1", "best crm software", "competitor.com", 1000, 40);

        expect(consumeCredits).toHaveBeenCalledTimes(1);
    });
});

// ─── generateBlogForKeyword ───────────────────────────────────────────────────

describe("generateBlogForKeyword — SERP gate credit invariants", () => {

    it("BLOCK: consumeCredits is never called", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(TOOL_SIGNAL);

        const result = await generateBlogForKeyword(
            "best crm software", 5, 1000, "site-1");

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.code).toBe("SERP_GATE_BLOCK");
    });

    it("WARN + no override: consumeCredits is never called", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(LISTICLE_SIGNAL);

        const result = await generateBlogForKeyword(
            "best crm software", 5, 1000, "site-1");

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.code).toBe("SERP_GATE_WARN");
        expect(result.requiresConfirmation).toBe(true);
    });

    it("WARN + forceSerpMismatch + valid preflight: consumeCredits called once", async () => {
        vi.mocked(validateSerpPreflight).mockResolvedValue({ valid: true, record: WARN_RECORD });

        await generateBlogForKeyword(
            "best crm software", 5, 1000, "site-1", undefined,
            { preflightId: "pre-warn", forceSerpMismatch: true });

        expect(consumeCredits).toHaveBeenCalledTimes(1);
    });

    it("ALLOW: consumeCredits called once", async () => {
        vi.mocked(classifySerpFormat).mockReturnValue(GUIDE_SIGNAL);

        await generateBlogForKeyword(
            "best crm software", 5, 1000, "site-1");

        expect(consumeCredits).toHaveBeenCalledTimes(1);
    });
});

// ─── Preflight replay semantics ───────────────────────────────────────────────

describe("Preflight replay — same token reusable within TTL", () => {

    it("two generations with the same preflightId each consume one credit", async () => {
        vi.mocked(validateSerpPreflight).mockResolvedValue({ valid: true, record: ALLOW_RECORD });

        await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT, { preflightId: "replay-id" });
        await generateBlog("STANDARD", "site-1", MOCK_AUTHOR_INPUT, { preflightId: "replay-id" });

        // Two separate credit deductions — token not consumed/deleted
        expect(consumeCredits).toHaveBeenCalledTimes(2);
        // Token validated twice — never deleted between calls
        expect(validateSerpPreflight).toHaveBeenCalledTimes(2);
    });
});

// ─── siteId ownership enforcement ────────────────────────────────────────────

describe("siteId ownership — preflight from site-A cannot be used for site-B", () => {

    it("PREFLIGHT_SITE_MISMATCH triggers fresh gate; ALLOW still proceeds", async () => {
        vi.mocked(validateSerpPreflight).mockResolvedValue({
            valid: false,
            reason: "PREFLIGHT_SITE_MISMATCH",
        });
        vi.mocked(classifySerpFormat).mockReturnValue(GUIDE_SIGNAL); // fresh gate → ALLOW
        vi.mocked(prisma.site.findUnique).mockResolvedValue({ ...MOCK_SITE, id: "site-2" } as never);

        await generateBlog(
            "STANDARD", "site-2", MOCK_AUTHOR_INPUT,
            { preflightId: "pre-from-site-1" });

        // Gate ran fresh (ALLOW) → credits consumed
        expect(consumeCredits).toHaveBeenCalledTimes(1);
        // Preflight was validated with the correct siteId
        expect(validateSerpPreflight).toHaveBeenCalledWith(
            "pre-from-site-1", "user-1", "site-2", expect.any(String)
        );
    });

    it("PREFLIGHT_SITE_MISMATCH + fresh gate yields BLOCK = no credits", async () => {
        vi.mocked(validateSerpPreflight).mockResolvedValue({
            valid: false,
            reason: "PREFLIGHT_SITE_MISMATCH",
        });
        vi.mocked(classifySerpFormat).mockReturnValue(TOOL_SIGNAL); // fresh gate → BLOCK
        vi.mocked(prisma.site.findUnique).mockResolvedValue({ ...MOCK_SITE, id: "site-2" } as never);

        const result = await generateBlog(
            "STANDARD", "site-2", MOCK_AUTHOR_INPUT,
            { preflightId: "pre-from-site-1" });

        expect(consumeCredits).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false, code: "SERP_GATE_BLOCK" });
    });
});

// ─── Keyword normalization round-trip ─────────────────────────────────────────

describe("normalizeKeyword — used in integration path", () => {
    it("keyword with extra whitespace still matches stored canonical form", async () => {
        // Preflight stored with normalized " best  crm  software " → "best crm software"
        // Action receives "best crm software" → same after normalize
        vi.mocked(validateSerpPreflight).mockResolvedValue({ valid: true, record: ALLOW_RECORD });

        // Pass keyword with extra spaces — action should normalize before validation
        const modifiedInput = { ...MOCK_AUTHOR_INPUT, keyword: "  best crm software  " };

        await generateBlog("STANDARD", "site-1", modifiedInput, { preflightId: "pre-allow" });

        expect(consumeCredits).toHaveBeenCalledTimes(1);
        expect(validateSerpPreflight).toHaveBeenCalledWith(
            "pre-allow", "user-1", "site-1",
            expect.stringMatching(/^best crm software$/)
        );
    });
});
