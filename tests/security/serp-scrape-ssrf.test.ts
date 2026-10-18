/**
 * SSRF regression tests for SERP page scraping.
 *
 * SERP result URLs are third-party controlled: any site that ranks can point
 * (directly or via redirect) at cloud metadata or internal services. Both
 * scrapers — src/lib/blog/serp.ts (scrapePageData) and
 * src/lib/serp-gap/analyser.ts (analyseSerpGap → scrapePage) — must go through
 * safeFetchPublicUrl: no automatic redirects, every hop DNS-validated, bounded body.
 *
 * DNS and fetch are mocked; no network access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("dns/promises", () => ({ default: { lookup: lookupMock }, lookup: lookupMock }));
vi.mock("@/lib/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isPrivateIPv6, isPublicHostname } from "@/lib/security/safe-fetch";
import { scrapePageData } from "@/lib/blog/serp";
import { analyseSerpGap } from "@/lib/serp-gap/analyser";

/** hostname → resolved addresses. Unknown hosts fail resolution. */
const DNS: Record<string, string[]> = {
    "competitor.com": ["93.184.216.34"],
    "www.netflix.com": ["52.0.0.1"],
    "client.com": ["93.184.216.35"],
    "evil-redirect.com": ["93.184.216.36"],
    "rebind.attacker.com": ["127.0.0.1"],
    "dualstack.attacker.com": ["93.184.216.37", "::ffff:a9fe:a9fe"],
    "metadata.attacker.com": ["169.254.169.254"],
};

const ARTICLE_HTML = `<html><head><title>Guide</title></head><body><article>
<h2>First section heading</h2><p>${"Useful readable article text. ".repeat(20)}</p>
<h2>Second section heading</h2></article></body></html>`;

function html(body: string, init: ResponseInit = {}) {
    return new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });
}

function redirect(location: string, status = 302) {
    return new Response(null, { status, headers: { location } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockImplementation(async (hostname: string) => {
        const addrs = DNS[hostname];
        if (!addrs) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
        return addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── IP classification: forms the URL parser actually produces ─────────────────

describe("isPrivateIPv6 — embedded/encoded private addresses", () => {
    it.each([
        ["::ffff:7f00:1", true],          // new URL("http://[::ffff:127.0.0.1]").hostname form
        ["[::ffff:a9fe:a9fe]", true],     // metadata 169.254.169.254, hex-mapped, bracketed
        ["::ffff:0:7f00:1", true],        // IPv4-translated
        ["::127.0.0.1", true],            // deprecated IPv4-compatible
        ["64:ff9b::a9fe:a9fe", true],     // NAT64 → 169.254.169.254
        ["64:ff9b::10.0.0.1", true],      // NAT64 → RFC1918, dotted tail
        ["64:ff9b:1::1", true],           // NAT64 local-use
        ["2002:7f00:1::", true],          // 6to4 → 127.0.0.1
        ["2002:a9fe:a9fe::1", true],      // 6to4 → metadata
        ["2001:0:4136:e378::1", true],    // Teredo
        ["fec0::1", true],                // site-local
        ["fe90::1", true],                // still inside fe80::/10
        ["ff02::1", true],                // multicast
        ["fe80::1%eth0", true],           // zone id
        ["64:ff9b::808:808", false],      // NAT64 → 8.8.8.8 (public)
        ["2002:808:808::1", false],       // 6to4 → 8.8.8.8 (public)
        ["::ffff:808:808", false],        // mapped 8.8.8.8 (public)
        ["2607:f8b0:4004:800::200e", false],
        ["not-an-ip", false],
    ])("classifies %s as private=%s", (ip, expected) => {
        expect(isPrivateIPv6(ip)).toBe(expected);
    });

    it("blocks IPv6-mapped loopback/metadata exactly as URL.hostname reports them", () => {
        for (const raw of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/latest/meta-data/"]) {
            expect(isPublicHostname(new URL(raw).hostname)).toBe(false);
        }
    });

    it("treats a trailing-dot localhost as localhost", () => {
        expect(isPublicHostname("localhost.")).toBe(false);
        expect(isPublicHostname("example.com.")).toBe(true);
    });
});

// ── src/lib/blog/serp.ts — scrapePageData ─────────────────────────────────────

describe("scrapePageData (blog SERP scraper)", () => {
    it("scrapes a public page with manual redirect handling", async () => {
        fetchMock.mockResolvedValueOnce(html(ARTICLE_HTML));

        const page = await scrapePageData("https://competitor.com/guide");

        expect(page.status).toBe("ANALYZED");
        expect(page.headings).toContain("First section heading");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    });

    it("never fetches a SERP link whose host resolves to a private address", async () => {
        const page = await scrapePageData("https://rebind.attacker.com/");

        expect(fetchMock).not.toHaveBeenCalled();
        expect(page.status).toBe("UNSCRAPPABLE");
        expect(page.failureReason).toMatch(/Blocked: .*private IP 127\.0\.0\.1/);
    });

    it("blocks dual-stack hosts where any address is private (hex-mapped metadata AAAA)", async () => {
        const page = await scrapePageData("https://dualstack.attacker.com/");

        expect(fetchMock).not.toHaveBeenCalled();
        expect(page.status).toBe("UNSCRAPPABLE");
    });

    it.each([
        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        "http://metadata.attacker.com/latest/meta-data/",
        "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
        "http://localhost:3000/admin",
        "http://db.internal/",
    ])("does not follow a public page's redirect to %s", async (target) => {
        fetchMock.mockResolvedValueOnce(redirect(target));

        const page = await scrapePageData("https://evil-redirect.com/ranking-article");

        expect(fetchMock).toHaveBeenCalledTimes(1); // only the public hop
        expect(page.status).toBe("UNSCRAPPABLE");
        expect(page.text).toBe("");
        expect(page.failureReason).toMatch(/^Blocked redirect/);
    });

    it("blocks direct IP-literal and non-http SERP links without fetching", async () => {
        for (const url of ["http://10.0.0.5/", "http://[::1]:8080/", "file:///etc/passwd"]) {
            const page = await scrapePageData(url);
            expect(page.status).toBe("UNSCRAPPABLE");
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("abandons oversized bodies instead of buffering them", async () => {
        fetchMock.mockResolvedValueOnce(html("x".repeat(6 * 1024 * 1024)));

        const page = await scrapePageData("https://competitor.com/huge");

        expect(page.status).toBe("UNSCRAPPABLE");
        expect(page.failureReason).toMatch(/byte limit/);
    });

    it("retries transient network failures, not policy blocks", async () => {
        fetchMock
            .mockRejectedValueOnce(new TypeError("fetch failed"))
            .mockResolvedValueOnce(html(ARTICLE_HTML));

        const page = await scrapePageData("https://competitor.com/flaky");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(page.status).toBe("ANALYZED");
    });

    it("excludes social domains by hostname, not substring", async () => {
        const yt = await scrapePageData("https://www.youtube.com/watch?v=abc");
        expect(yt.status).toBe("UNSCRAPPABLE");
        expect(fetchMock).not.toHaveBeenCalled();

        // netflix.com contains "x.com" but is not x.com
        fetchMock.mockResolvedValueOnce(html(ARTICLE_HTML));
        const nf = await scrapePageData("https://www.netflix.com/tudum/articles/guide");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(nf.status).toBe("ANALYZED");
    });
});

// ── src/lib/serp-gap/analyser.ts — analyseSerpGap → scrapePage ────────────────

describe("analyseSerpGap (SERP gap analyser scraper)", () => {
    const originalKey = process.env.SERPER_API_KEY;
    beforeEach(() => {
        process.env.SERPER_API_KEY = "test-key";
    });
    afterEach(() => {
        process.env.SERPER_API_KEY = originalKey;
    });

    it("does not follow competitor redirects to metadata and still scrapes safe pages", async () => {
        fetchMock.mockImplementation(async (input: string | URL) => {
            const url = String(input);
            if (url === "https://google.serper.dev/search") {
                return new Response(
                    JSON.stringify({
                        organic: [
                            { link: "https://evil-redirect.com/post", title: "Evil" },
                            { link: "https://competitor.com/guide", title: "Good" },
                        ],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }
            if (url === "https://evil-redirect.com/post") {
                return redirect("http://169.254.169.254/latest/meta-data/");
            }
            if (url === "https://competitor.com/guide" || url === "https://client.com/page") {
                return html(ARTICLE_HTML);
            }
            throw new Error(`unexpected fetch ${url}`);
        });

        const report = await analyseSerpGap("seo guide", "https://client.com/page", 14);

        expect(report).not.toBeNull();
        const evil = report!.topResults.find((r) => r.url === "https://evil-redirect.com/post")!;
        expect(evil.fetchedOk).toBe(false);
        expect(evil.fetchError).toMatch(/^Blocked redirect/);

        const good = report!.topResults.find((r) => r.url === "https://competitor.com/guide")!;
        expect(good.fetchedOk).toBe(true);
        expect(report!.clientSignals.fetchedOk).toBe(true);

        const fetchedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(fetchedUrls.some((u) => u.includes("169.254.169.254"))).toBe(false);
    });

    it("does not fetch a competitor link that resolves to a private address", async () => {
        fetchMock.mockImplementation(async (input: string | URL) => {
            const url = String(input);
            if (url === "https://google.serper.dev/search") {
                return new Response(JSON.stringify({ organic: [{ link: "https://rebind.attacker.com/x" }] }), {
                    status: 200,
                });
            }
            if (url === "https://client.com/page") return html(ARTICLE_HTML);
            throw new Error(`unexpected fetch ${url}`);
        });

        const report = await analyseSerpGap("seo guide", "https://client.com/page", 14);

        expect(report!.topResults[0].fetchedOk).toBe(false);
        expect(report!.topResults[0].fetchError).toMatch(/private IP 127\.0\.0\.1/);
        expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain("https://rebind.attacker.com/x");
    });
});
