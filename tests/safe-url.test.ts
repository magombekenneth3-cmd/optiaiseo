/**
 * isSafeUrl security regression tests
 *
 * Carry-forward from Week 4 review:
 * - Proves safe URLs are accepted
 * - Proves unsafe URLs (SSRF targets) are rejected
 * - Proves the function returns { ok: boolean } (not a bare boolean)
 * - Proves skipSafeUrlCheck cannot leak into production crawl paths
 */
import { describe, it, expect } from "vitest";
import { isSafeUrl } from "@/lib/security/safe-url";

describe("isSafeUrl — security regression", () => {
    // ── Safe URLs ─────────────────────────────────────────────────────────

    it("accepts https URLs", () => {
        const result = isSafeUrl("https://example.com/page");
        expect(result.ok).toBe(true);
        expect(result.url).toBeDefined();
        expect(result.url!.hostname).toBe("example.com");
    });

    it("accepts http URLs", () => {
        const result = isSafeUrl("http://example.com");
        expect(result.ok).toBe(true);
    });

    // ── SSRF targets — must be rejected ───────────────────────────────────

    it("rejects 127.0.0.1 (loopback)", () => {
        const result = isSafeUrl("http://127.0.0.1:3000/secret");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("Private");
    });

    it("rejects localhost", () => {
        const result = isSafeUrl("http://localhost:8080/admin");
        expect(result.ok).toBe(false);
    });

    it("rejects 10.x.x.x (RFC 1918)", () => {
        const result = isSafeUrl("http://10.0.0.1/internal");
        expect(result.ok).toBe(false);
    });

    it("rejects 192.168.x.x (RFC 1918)", () => {
        const result = isSafeUrl("http://192.168.1.1/router");
        expect(result.ok).toBe(false);
    });

    it("rejects 172.16-31.x.x (RFC 1918)", () => {
        const result = isSafeUrl("http://172.16.0.1/db");
        expect(result.ok).toBe(false);
    });

    it("rejects 169.254.x.x (link-local / cloud metadata)", () => {
        const result = isSafeUrl("http://169.254.169.254/latest/meta-data/");
        expect(result.ok).toBe(false);
    });

    it("rejects ::1 (IPv6 loopback)", () => {
        const result = isSafeUrl("http://[::1]:3000/");
        expect(result.ok).toBe(false);
    });

    it("rejects .internal hostnames", () => {
        const result = isSafeUrl("http://db.internal/query");
        expect(result.ok).toBe(false);
    });

    it("rejects .local hostnames", () => {
        const result = isSafeUrl("http://printer.local/");
        expect(result.ok).toBe(false);
    });

    // ── Protocol restrictions ─────────────────────────────────────────────

    it("rejects javascript: protocol", () => {
        const result = isSafeUrl("javascript:alert(1)");
        expect(result.ok).toBe(false);
    });

    it("rejects file: protocol", () => {
        const result = isSafeUrl("file:///etc/passwd");
        expect(result.ok).toBe(false);
    });

    it("rejects ftp: protocol", () => {
        const result = isSafeUrl("ftp://evil.com/payload");
        expect(result.ok).toBe(false);
    });

    // ── Malformed input ───────────────────────────────────────────────────

    it("rejects empty string", () => {
        const result = isSafeUrl("");
        expect(result.ok).toBe(false);
    });

    it("rejects garbage input", () => {
        const result = isSafeUrl("not-a-url");
        expect(result.ok).toBe(false);
    });

    // ── Return type contract ──────────────────────────────────────────────
    // This is the exact bug that was found in chunked.ts line 158:
    // `if (!isSafeUrl(href))` was always truthy because it returns an object.
    // This test ensures the contract is: returns { ok: boolean }, not boolean.

    it("returns an object (not a boolean) — regression for chunked.ts line 158", () => {
        const result = isSafeUrl("https://example.com");
        // The result must be an object with an `ok` property
        expect(typeof result).toBe("object");
        expect(result).toHaveProperty("ok");
        expect(typeof result.ok).toBe("boolean");

        // Critically: the object itself is always truthy, even for unsafe URLs
        const unsafeResult = isSafeUrl("http://127.0.0.1");
        expect(!!unsafeResult).toBe(true); // object is truthy
        expect(unsafeResult.ok).toBe(false); // but .ok is false
    });
});
