/**
 * Smoke tests — public page rendering.
 *
 * These tests validate that critical public-facing pages load without
 * JavaScript errors or network failures. They do NOT test authenticated flows
 * (those require seeded DB state and belong in a separate integration suite).
 *
 * Expected to run against a live server (local dev or Railway preview).
 * Set PLAYWRIGHT_BASE_URL env var to point at the target environment.
 */

import { test, expect } from "@playwright/test";

// ── Homepage ──────────────────────────────────────────────────────────────────

test("homepage loads with correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/OptiAISEO/i);
    // No console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
    });
    await page.waitForLoadState("networkidle");
    // Allow known non-critical errors (e.g. analytics blocked by extension)
    const criticalErrors = errors.filter(
        e => !e.includes("ERR_BLOCKED") && !e.includes("analytics") && !e.includes("gtag")
    );
    expect(criticalErrors).toHaveLength(0);
});

test("homepage has a call-to-action button", async ({ page }) => {
    await page.goto("/");
    // Any prominent CTA on the hero section
    const cta = page.locator("a[href*='register'], a[href*='signup'], button").first();
    await expect(cta).toBeVisible();
});

// ── Login page ────────────────────────────────────────────────────────────────

test("login page renders email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input[type='email'], input[name='email']")).toBeVisible();
    await expect(page.locator("input[type='password'], input[name='password']")).toBeVisible();
});

// ── robots.txt ────────────────────────────────────────────────────────────────

test("robots.txt is reachable and contains AI crawler rules", async ({ request }) => {
    const resp = await request.get("/robots.txt");
    expect(resp.status()).toBe(200);

    const body = await resp.text();
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("User-agent: PerplexityBot");
    expect(body).toContain("User-agent: ClaudeBot");
    expect(body).toContain("User-agent: Google-Extended");
    // Dashboard should be disallowed to all crawlers
    expect(body).toContain("Disallow: /dashboard/");
});

// ── API docs page ─────────────────────────────────────────────────────────────

test("api-docs page renders Swagger UI container", async ({ page }) => {
    await page.goto("/api-docs");
    // The Swagger UI root div should be in the DOM
    await expect(page.locator("#swagger-ui")).toBeAttached();
});

// ── OpenAPI spec ──────────────────────────────────────────────────────────────

test("openapi.yaml is served as a static asset", async ({ request }) => {
    const resp = await request.get("/openapi.yaml");
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text).toContain("openapi: 3.0.3");
    expect(text).toContain("OptiAISEO API");
});

// ── 404 ───────────────────────────────────────────────────────────────────────

test("unknown route returns a 404 response", async ({ request }) => {
    const resp = await request.get("/this-page-does-not-exist-xyz");
    expect(resp.status()).toBe(404);
});
