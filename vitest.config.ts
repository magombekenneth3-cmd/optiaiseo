import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        // Use jsdom for tests that need a DOM (e.g. React component snapshots).
        // For pure library tests the default node environment is used.
        environment: "node",
        globals: true,
        // Point at the tests directory — keeps test files out of src
        include: ["tests/**/*.{test,spec}.{ts,tsx}"],
        // Exclude Playwright e2e tests (they run separately via playwright)
        exclude: ["tests/e2e/**", "node_modules/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "json-summary"],
            // Only measure coverage on the core lib files we have tests for
            include: [
                "src/lib/backlinks/quality-analysis.ts",
                "src/lib/stripe/plans.ts",
                "src/lib/credits/constants.ts",
                "src/lib/inngest/functions/lead-drip.ts",
            ],
            thresholds: {
                // Minimum 70% line coverage on the included files
                lines: 70,
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
        },
    },
});
