import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke test configuration.
 *
 * These tests only run the critical happy-paths — they're NOT exhaustive e2e tests.
 * They verify that:
 *  1. The public homepage renders without a crash
 *  2. The login page loads and has the right form elements
 *  3. The robots.txt is valid and includes AI crawler rules
 *  4. The API docs page loads
 *
 * Run via: npx playwright test
 *
 * In CI, set PLAYWRIGHT_BASE_URL to the preview URL (e.g. Railway preview).
 * Locally, set it to http://localhost:3000 (after `npm run dev`).
 */

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30_000,
    retries: 1,
    workers: 1,                // Sequential to avoid port contention in CI
    reporter: "list",

    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],

    // In CI: start the Next.js server automatically before running tests
    // Locally: you're expected to run `npm run dev` in another terminal
    ...(process.env.CI
        ? {
            webServer: {
                command: "npm run start",
                url: "http://localhost:3000",
                reuseExistingServer: false,
                timeout: 120_000,
            },
        }
        : {}),
});
