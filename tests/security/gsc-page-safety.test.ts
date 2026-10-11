/**
 * Phase 3 regression tests — GSC and page-existence safety.
 *
 * BUG-3A: Decay reoptimizer uses stored-connection resolution (not raw config)
 * BUG-3B: fetchWithRetry throws GSC_TOKEN_EXPIRED on 401
 * BUG-3C: fetchWithRetry sanitizes error messages (no raw API text leak)
 * BUG-3D: Property resolver fuzzy match requires domain boundary
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — read source files once
// ─────────────────────────────────────────────────────────────────────────────
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(`${ROOT}/${rel}`, "utf8");

const decayReoptSrc = read("src/lib/gsc/decay-reoptimizer.ts");
const gscIndexSrc = read("src/lib/gsc/index.ts");
const propertyResolverSrc = read("src/lib/gsc/property-resolver.ts");
const gscAvailabilitySrc = read("src/lib/gsc/gsc-availability.ts");

// ─────────────────────────────────────────────────────────────────────────────
// BUG-3A: Decay reoptimizer lifecycle fix
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-3A: Decay reoptimizer CMS safety", () => {
    it("should NOT hardcode platform to WORDPRESS", () => {
        // The old code had: platform: "WORDPRESS"
        // The new code iterates supported platforms via resolveStoredConnection
        expect(decayReoptSrc).not.toMatch(/platform:\s*["']WORDPRESS["']/);
    });

    it("should NOT read raw wordPressConfig from site record for CMS publish", () => {
        // The old code cast site to Record<string, unknown> and read wordPressConfig
        // as a CMS publish destination. The new code passes it through resolveStoredConnection
        // which Zod-validates it. Check that raw config is only passed TO the resolver, not
        // directly to dispatchMultiCmsPublish.
        const publishCalls = decayReoptSrc.match(/dispatchMultiCmsPublish\s*\([^)]*\)/gs) || [];
        for (const call of publishCalls) {
            expect(call).not.toContain("wordPressConfig:");
        }
    });

    it("should import resolveStoredConnection for CMS resolution", () => {
        expect(decayReoptSrc).toContain("resolveStoredConnection");
        expect(decayReoptSrc).toContain("@/lib/publishers/stored-connection");
    });

    it("should handle kill-switch blocks distinctly from generic errors", () => {
        expect(decayReoptSrc).toContain("kill_switch");
        expect(decayReoptSrc).toContain("KILL_SWITCH");
    });

    it("should skip publish gracefully when no CMS is connected", () => {
        expect(decayReoptSrc).toContain("No CMS connection configured");
    });

    it("should still require valid DecayEvidence before any mutation", () => {
        // Ensure the evidence validation is called before any content update
        const validateIdx = decayReoptSrc.indexOf("validateDecayEvidence(evidence)");
        const updateIdx = decayReoptSrc.indexOf("prisma.blog.update");
        expect(validateIdx).toBeGreaterThan(-1);
        expect(updateIdx).toBeGreaterThan(validateIdx);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-3B: fetchWithRetry 401 handling
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-3B: GSC 401 token expiry handling", () => {
    it("fetchWithRetry should throw GSC_TOKEN_EXPIRED on 401", () => {
        // The function must detect 401 and throw a typed error
        expect(gscIndexSrc).toContain("GSC_TOKEN_EXPIRED");
        expect(gscIndexSrc).toContain("res.status === 401");
    });

    it("classifyGscError should recognize GSC_TOKEN_EXPIRED as AUTH_REVOKED", () => {
        expect(gscAvailabilitySrc).toContain("gsc_token_expired");
        // Verify it's in the AUTH_REVOKED classification block
        const authRevokedBlock = gscAvailabilitySrc.substring(
            gscAvailabilitySrc.indexOf("Auth revoked"),
            gscAvailabilitySrc.indexOf("return \"AUTH_REVOKED\"")
        );
        expect(authRevokedBlock).toContain("gsc_token_expired");
    });

    it("should NOT retry 401 (it is not retryable by exponential backoff)", () => {
        // 401 is handled separately from the 429/5xx retry path
        const retryBlock = gscIndexSrc.match(
            /if\s*\(\s*\(\s*res\.status === 429.*?attempt < RETRY_ATTEMPTS\s*\)/s
        );
        expect(retryBlock).toBeTruthy();
        // 401 should not appear in the retry condition
        expect(retryBlock![0]).not.toContain("401");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-3C: Sanitized GSC API error messages
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-3C: GSC error message sanitization", () => {
    it("should NOT include raw API response text in thrown errors", () => {
        // Old pattern: throw new Error(`GSC API ${res.status}: ${err}`)
        // New pattern: throw new Error(`GSC API error (${res.status})`)
        expect(gscIndexSrc).not.toMatch(/throw new Error\(`GSC API \$\{res\.status\}:\s*\$\{/);
    });

    it("should log raw errors server-side for debugging", () => {
        expect(gscIndexSrc).toContain("rawErr");
        expect(gscIndexSrc).toContain("[GSC API] Request failed");
    });

    it("thrown error should contain only the status code, not response body", () => {
        expect(gscIndexSrc).toContain('throw new Error(`GSC API error (${res.status})`)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-3D: Property resolver fuzzy match boundary
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-3D: Property resolver fuzzy match safety", () => {
    it("should NOT use simple string includes for fuzzy matching", () => {
        // Old pattern: sites.find((s) => s.includes(bare))
        // This matches example.com against notexample.com
        expect(propertyResolverSrc).not.toMatch(/sites\.find\(\(s\)\s*=>\s*s\.includes\(bare\)\)/);
    });

    it("should use a regex with boundary for fuzzy matching", () => {
        expect(propertyResolverSrc).toContain("barePattern");
        expect(propertyResolverSrc).toContain("barePattern.test(s)");
    });

    it("fuzzy match regex should require a boundary before the domain", () => {
        // The regex should include (?:^|[:/]) or similar to prevent partial matches
        expect(propertyResolverSrc).toMatch(/\(\?:\^\|\[:[/]\]\)/);
    });

    it("should escape special regex characters in the bare domain", () => {
        // Dots in domain names are special regex chars that must be escaped
        expect(propertyResolverSrc).toContain(".replace(/[.*+?^${}()|[\\]\\\\]/g");
    });

    // ── Inline unit tests for the fuzzy match logic ──────────────────────
    // Extract and test the regex pattern directly
    it("boundary regex should match 'https://example.com/' but NOT 'https://notexample.com/'", () => {
        const bare = "example.com";
        const barePattern = new RegExp(
            `(?:^|[:/])${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/]|$)`,
            "i"
        );

        // Should match — these are the patterns that reach fuzzy fallback
        expect(barePattern.test("https://example.com/")).toBe(true);
        expect(barePattern.test("sc-domain:example.com")).toBe(true);
        expect(barePattern.test("http://example.com/")).toBe(true);

        // Should NOT match — prevents cross-domain false positives
        expect(barePattern.test("https://notexample.com/")).toBe(false);
        expect(barePattern.test("https://example.com.au/")).toBe(false);
    });
});
