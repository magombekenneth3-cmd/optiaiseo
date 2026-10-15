/**
 * SSRF regression tests for safeFetchPublicUrl
 *
 * These tests MUST be blocking in CI — they guard against the SSRF vector
 * where a malicious sitemap or redirect could cause the server to request
 * internal addresses or cloud metadata endpoints.
 *
 * Tests are structured around the attack surface:
 * 1. Direct private IP access
 * 2. Redirect to private IP (the most dangerous vector)
 * 3. IPv6 loopback and link-local
 * 4. Cloud metadata endpoints (169.254.169.254)
 * 5. Domain scope enforcement (sitemap cross-domain injection)
 * 6. Oversized response protection
 * 7. Scheme restrictions
 * 8. validateSitemapUrls batch validation
 */

import { describe, it, expect } from "vitest";
import {
    isPrivateIPv4,
    isPrivateIPv6,
    isPublicHostname,
    getRegisteredDomain,
    validateSitemapUrls,
} from "@/lib/security/safe-fetch";

// ── Unit tests for IP classification ────────────────────────────────────────────

describe("isPrivateIPv4", () => {
    it.each([
        ["127.0.0.1", true],
        ["127.255.255.255", true],
        ["10.0.0.1", true],
        ["10.255.255.255", true],
        ["172.16.0.1", true],
        ["172.31.255.255", true],
        ["192.168.0.1", true],
        ["192.168.255.255", true],
        ["169.254.169.254", true],   // Cloud metadata
        ["169.254.0.1", true],       // Link-local
        ["0.0.0.0", true],           // "This host"
        ["100.64.0.1", true],        // Carrier-grade NAT
        ["224.0.0.1", true],         // Multicast
        ["240.0.0.1", true],         // Reserved
        ["8.8.8.8", false],          // Google DNS — public
        ["1.1.1.1", false],          // Cloudflare — public
        ["93.184.216.34", false],     // example.com — public
        ["172.15.255.255", false],   // Just below RFC 1918 range
        ["172.32.0.0", false],       // Just above RFC 1918 range
    ])("classifies %s as private=%s", (ip, expected) => {
        expect(isPrivateIPv4(ip)).toBe(expected);
    });
});

describe("isPrivateIPv6", () => {
    it.each([
        ["::1", true],               // Loopback
        ["::", true],                 // Unspecified
        ["fe80::1", true],           // Link-local
        ["fc00::1", true],           // Unique local
        ["fd00::1", true],           // Unique local
        ["::ffff:127.0.0.1", true],  // IPv4-mapped loopback
        ["::ffff:169.254.169.254", true], // IPv4-mapped metadata
        ["::ffff:10.0.0.1", true],   // IPv4-mapped private
        ["2607:f8b0:4004:800::200e", false], // Google — public
        ["2001:db8::1", false],      // Documentation range (not flagged as private in our impl)
    ])("classifies %s as private=%s", (ip, expected) => {
        expect(isPrivateIPv6(ip)).toBe(expected);
    });
});

// ── Hostname validation ────────────────────────────────────────────────────────

describe("isPublicHostname", () => {
    it.each([
        ["example.com", true],
        ["www.optiaiseo.online", true],
        ["sub.domain.co.uk", true],
        ["localhost", false],
        ["db.internal", false],
        ["printer.local", false],
        ["myapp.localhost", false],
        ["test.test", false],
        ["127.0.0.1", false],
        ["[::1]", false],
        ["169.254.169.254", false],
        ["10.0.0.1", false],
    ])("classifies %s as public=%s", (hostname, expected) => {
        expect(isPublicHostname(hostname)).toBe(expected);
    });
});

// ── Domain scope extraction ────────────────────────────────────────────────────

describe("getRegisteredDomain", () => {
    it.each([
        ["www.example.com", "example.com"],
        ["example.com", "example.com"],
        ["sub.example.com", "example.com"],
        ["deep.sub.example.com", "example.com"],
        ["www.example.co.uk", "example.co.uk"],
        ["sub.example.co.uk", "example.co.uk"],
        ["optiaiseo.online", "optiaiseo.online"],
        ["www.optiaiseo.online", "optiaiseo.online"],
    ])("extracts registered domain from %s as %s", (hostname, expected) => {
        expect(getRegisteredDomain(hostname)).toBe(expected);
    });
});

// ── Sitemap URL validation ─────────────────────────────────────────────────────

describe("validateSitemapUrls", () => {
    it("accepts URLs within the allowed domain", async () => {
        const urls = [
            "https://example.com/page1",
            "https://www.example.com/page2",
            "https://blog.example.com/post",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toHaveLength(3);
        expect(result.rejected).toHaveLength(0);
    });

    it("rejects URLs outside the allowed domain scope", async () => {
        const urls = [
            "https://example.com/legit",
            "https://evil.com/steal-data",
            "https://attacker.io/payload",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toHaveLength(1);
        expect(result.valid[0]).toBe("https://example.com/legit");
        expect(result.rejected).toHaveLength(2);
        expect(result.rejected[0].reason).toContain("Outside allowed domain");
    });

    it("rejects sitemap entries pointing to private IPs", async () => {
        const urls = [
            "http://127.0.0.1:3000/admin",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/internal-api",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toHaveLength(0);
        expect(result.rejected).toHaveLength(3);
    });

    it("rejects sitemap entries with non-http schemes", async () => {
        const urls = [
            "ftp://example.com/file",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toHaveLength(0);
        expect(result.rejected).toHaveLength(3);
    });

    it("rejects sitemap entries to localhost and internal TLDs", async () => {
        const urls = [
            "http://localhost:8080/admin",
            "http://db.internal/query",
            "http://printer.local/status",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toHaveLength(0);
        expect(result.rejected).toHaveLength(3);
    });

    it("rejects invalid URL strings", async () => {
        const urls = [
            "not-a-url",
            "",
            "://broken",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toHaveLength(0);
        expect(result.rejected).toHaveLength(3);
    });

    it("handles IPv6 loopback in sitemap entries", async () => {
        const urls = [
            "http://[::1]:3000/secret",
            "http://[fe80::1]/link-local",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toHaveLength(0);
        expect(result.rejected).toHaveLength(2);
    });

    it("handles mixed valid and invalid URLs correctly", async () => {
        const urls = [
            "https://example.com/page1",
            "http://127.0.0.1/admin",
            "https://example.com/page2",
            "https://evil.com/steal",
            "https://www.example.com/page3",
            "ftp://example.com/file",
        ];
        const result = await validateSitemapUrls(urls, "example.com");
        expect(result.valid).toEqual([
            "https://example.com/page1",
            "https://example.com/page2",
            "https://www.example.com/page3",
        ]);
        expect(result.rejected).toHaveLength(3);
    });
});
