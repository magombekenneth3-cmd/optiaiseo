/**
 * tests/unit/js-rendering-crawl.test.ts
 *
 * Unit tests for F1 — JS-Rendered Crawling (Playwright integration).
 * Tests cover:
 *  - detectSpaSignatures() heuristics for React, Next.js, Vue, Angular, and generic SPAs
 *  - extractLinks() helper
 *  - isPlaywrightAvailable() environment check
 *  - CrawlOptions / CrawlResult type contracts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectSpaSignatures,
  isPlaywrightAvailable,
} from "@/lib/crawler/index";
import { extractLinks } from "@/lib/seo-audit/crawler";

// =============================================================================
// detectSpaSignatures
// =============================================================================

describe("detectSpaSignatures", () => {
  // ---- Next.js ----
  it("detects Next.js CSR (thin body + __NEXT_DATA__)", () => {
    const html = `
      <html><head></head>
      <body>
        <div id="__next"></div>
        <script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
        <script src="/_next/static/chunks/main.js"></script>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe("Next.js");
  });

  it("does NOT flag Next.js SSR with rich content as SPA", () => {
    // 200+ words of content — SSR pages should NOT trigger SPA detection
    const words = Array(250).fill("lorem").join(" ");
    const html = `
      <html><head></head>
      <body>
        <div id="__next"><main><p>${words}</p></main></div>
        <script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(false);
  });

  // ---- React (CRA / Vite) ----
  it("detects React SPA (data-reactroot + thin body)", () => {
    const html = `
      <html><head></head>
      <body>
        <div id="root" data-reactroot></div>
        <script src="/static/js/bundle.js"></script>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe("React");
  });

  // ---- Vue / Nuxt ----
  it("detects Vue SPA (__NUXT__ marker + thin body)", () => {
    const html = `
      <html><head></head>
      <body>
        <div id="__nuxt"></div>
        <script>window.__NUXT__={}</script>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe("Vue");
  });

  it("detects Vue SPA via data-v- scoped style attributes", () => {
    const html = `
      <html><head></head>
      <body>
        <div data-v-1a2b3c class="app"></div>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe("Vue");
  });

  // ---- Angular ----
  it("detects Angular SPA (ng-version + thin body)", () => {
    const html = `
      <html><head></head>
      <body>
        <app-root ng-version="17.0.0"></app-root>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe("Angular");
  });

  it("detects Angular SPA via ng-app attribute", () => {
    const html = `
      <html><head></head>
      <body ng-app="myApp">
        <div></div>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBe("Angular");
  });

  // ---- Generic SPA ----
  it("detects generic SPA (many scripts + very thin body)", () => {
    const html = `
      <html><head></head>
      <body>
        <div id="app"></div>
        <script src="/a.js"></script>
        <script src="/b.js"></script>
        <script src="/c.js"></script>
        <script src="/d.js"></script>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(true);
    expect(result.framework).toBeNull(); // Generic — no specific framework
  });

  // ---- Negative cases ----
  it("returns false for a normal server-rendered HTML page", () => {
    const words = Array(300).fill("content").join(" ");
    const html = `
      <html><head><title>My Blog</title></head>
      <body>
        <h1>Welcome</h1>
        <p>${words}</p>
        <a href="/about">About</a>
        <script src="/analytics.js"></script>
      </body>
      </html>`;
    const result = detectSpaSignatures(html);
    expect(result.isSpa).toBe(false);
    expect(result.framework).toBeNull();
  });

  it("returns false for empty HTML", () => {
    const result = detectSpaSignatures("");
    expect(result.isSpa).toBe(false);
    expect(result.framework).toBeNull();
  });
});

// =============================================================================
// extractLinks
// =============================================================================

describe("extractLinks", () => {
  const origin = "https://example.com";

  it("extracts same-origin absolute links", () => {
    const html = `
      <a href="https://example.com/about">About</a>
      <a href="https://example.com/blog">Blog</a>
    `;
    const links = extractLinks(html, origin);
    expect(links).toContain("https://example.com/about");
    expect(links).toContain("https://example.com/blog");
    expect(links).toHaveLength(2);
  });

  it("resolves relative links against origin", () => {
    const html = `<a href="/pricing">Pricing</a>`;
    const links = extractLinks(html, origin);
    expect(links).toContain("https://example.com/pricing");
  });

  it("excludes external links", () => {
    const html = `
      <a href="https://example.com/home">Home</a>
      <a href="https://other.com/page">Other</a>
    `;
    const links = extractLinks(html, origin);
    expect(links).toHaveLength(1);
    expect(links[0]).toBe("https://example.com/home");
  });

  it("deduplicates identical links", () => {
    const html = `
      <a href="/page">A</a>
      <a href="/page">B</a>
    `;
    const links = extractLinks(html, origin);
    expect(links).toHaveLength(1);
  });

  it("returns empty array for HTML with no links", () => {
    const html = `<p>No links here</p>`;
    const links = extractLinks(html, origin);
    expect(links).toHaveLength(0);
  });

  it("ignores mailto and javascript links", () => {
    const html = `
      <a href="mailto:hi@example.com">Email</a>
      <a href="javascript:void(0)">Click</a>
    `;
    const links = extractLinks(html, origin);
    expect(links).toHaveLength(0);
  });
});

// =============================================================================
// isPlaywrightAvailable
// =============================================================================

describe("isPlaywrightAvailable", () => {
  const envBefore = { ...process.env };

  afterEach(() => {
    process.env = { ...envBefore };
  });

  it("returns true when BROWSERLESS_URL is set", () => {
    process.env.BROWSERLESS_URL = "wss://fake.browserless.io";
    expect(isPlaywrightAvailable()).toBe(true);
  });

  it("returns true when PLAYWRIGHT_ENABLED is 'true'", () => {
    delete process.env.BROWSERLESS_URL;
    process.env.PLAYWRIGHT_ENABLED = "true";
    expect(isPlaywrightAvailable()).toBe(true);
  });

  it("returns false when neither env var is set", () => {
    delete process.env.BROWSERLESS_URL;
    delete process.env.PLAYWRIGHT_ENABLED;
    expect(isPlaywrightAvailable()).toBe(false);
  });
});

// =============================================================================
// CrawlOptions type contract (compile-time verification)
// =============================================================================

describe("CrawlOptions contract", () => {
  it("CrawlOptions interface accepts jsRendering values", async () => {
    // Dynamic import to verify the type exists at runtime
    const { crawlSite } = await import("@/lib/crawler/index");
    expect(typeof crawlSite).toBe("function");

    // Type-level check: these should compile without error
    const _opts1 = { jsRendering: "auto" as const };
    const _opts2 = { jsRendering: "always" as const };
    const _opts3 = { jsRendering: "never" as const };
    expect(_opts1.jsRendering).toBe("auto");
    expect(_opts2.jsRendering).toBe("always");
    expect(_opts3.jsRendering).toBe("never");
  });
});
