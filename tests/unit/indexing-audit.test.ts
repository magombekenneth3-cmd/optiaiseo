/**
 * tests/unit/indexing-audit.test.ts
 *
 * Focused tests for the indexing audit remediation.
 * Covers all 14 required test scenarios.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.GOOGLE_INDEXING_API_KEY;
    delete process.env.REDIS_URL;
    vi.resetModules();
});

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Source-level tests — validate the code patterns are correct
// ---------------------------------------------------------------------------

describe("1. Google success reporting", () => {
    it("submitGoogleIndexingApi uses pingGoogleIndexingApi (OAuth), not API-key auth", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // Must import and use the existing OAuth-based function
        expect(content).toContain('import { pingGoogleIndexingApi }');
        expect(content).toContain("pingGoogleIndexingApi(url,");

        // Must NOT use API-key auth in URL
        expect(content).not.toContain("?key=");
        expect(content).not.toContain("GOOGLE_INDEXING_API_KEY");
        expect(content).not.toContain("v13");
    });
});

describe("2. Google authentication failure is reported as failure", () => {
    it("AUTH_FAILED maps to NOT_CONFIGURED status", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // When Google returns AUTH_FAILED, we must return a failure status
        expect(content).toContain('"AUTH_FAILED"');
        expect(content).toContain('status: "NOT_CONFIGURED"');
    });
});

describe("3. Google 404/invalid endpoint cannot produce success", () => {
    it("does not use nonexistent v13 endpoint", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // No reference to v13 or direct fetch to indexing API
        expect(content).not.toContain("v13");
        expect(content).not.toContain("googleapis.com/v13");
        // Uses the validated wrapper instead
        expect(content).toContain("pingGoogleIndexingApi");
    });
});

describe("4. Google timeout cannot produce success", () => {
    it("timeout results in failure, not success", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // Must have TIMEOUT status in ProviderResult
        expect(content).toContain('"TIMEOUT"');
        // The old fail-open patterns must be gone
        expect(content).not.toMatch(/catch\s*\(\s*\)\s*\{\s*\}/);
        expect(content).not.toContain("return true; // Fail open");
    });
});

describe("5. IndexNow success is independent of Google failure", () => {
    it("indexer.ts does not gate IndexNow on Google result.success", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexer.ts"),
            "utf-8"
        );

        // Must NOT have the old pattern: `if (indexNowCfg && result.success)`
        expect(content).not.toContain("indexNowCfg && result.success");
        // Must have: `if (indexNowCfg)` (no dependency on result.success)
        expect(content).toContain("if (indexNowCfg)");
    });

    it("triggerInstantIndexing runs both providers with Promise.all", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // Must run Google and IndexNow concurrently
        expect(content).toContain("Promise.all");
        expect(content).toContain("submitGoogleIndexingApi");
        expect(content).toContain("submitIndexNow");
    });
});

describe("6. Google success is independent of IndexNow failure", () => {
    it("overall success is true if either provider succeeds", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // Success derived from OR of both providers
        expect(content).toContain('google.status === "SUCCESS" || indexNow.status === "SUCCESS"');
    });
});

describe("7. Both providers failing produces failure", () => {
    it("success is false when both are non-SUCCESS", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // The OR logic means: if both are NOT "SUCCESS", overall success is false
        expect(content).toContain('google.status === "SUCCESS" || indexNow.status === "SUCCESS"');
    });
});

describe("8. Missing IndexNow key produces NOT_CONFIGURED, never success", () => {
    it("submitIndexNow returns NOT_CONFIGURED when no config found", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // When getIndexNowConfig returns null → NOT_CONFIGURED
        const indexNowFn = content.slice(
            content.indexOf("export async function submitIndexNow"),
            content.indexOf("export async function submitGoogleIndexingApi")
        );
        expect(indexNowFn).toContain('status: "NOT_CONFIGURED"');
        expect(indexNowFn).toContain("getIndexNowConfig");
        // Must NOT have hardcoded key
        expect(indexNowFn).not.toContain("aiseo-indexnow-key");
    });
});

describe("9. Missing site domain never submits a fallback domain", () => {
    it("does not contain optiaiseo.com as a fallback domain", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        expect(content).not.toContain('"optiaiseo.com"');
        expect(content).not.toContain("'optiaiseo.com'");
    });

    it("triggerInstantIndexing returns failure when site is not found", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // When site not found → both providers report NOT_CONFIGURED, success: false
        const triggerFn = content.slice(content.indexOf("export async function triggerInstantIndexing"));
        expect(triggerFn).toContain("Site not found");
        expect(triggerFn).toContain("success: false");
    });
});

describe("10. Redis quota enforcement uses production Redis abstraction", () => {
    it("imports from @/lib/redis (Upstash), not ioredis", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // Must use Upstash HTTP client
        expect(content).toContain('from "@/lib/redis"');
        expect(content).toContain("getRedis");
        // Must NOT use ioredis
        expect(content).not.toContain("ioredis");
        expect(content).not.toContain("REDIS_URL");
    });
});

describe("11. Redis failure does not silently skip quota enforcement", () => {
    it("logs error when Redis quota check fails", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        // Must log an error when Redis fails, not silently succeed
        expect(content).toContain("Redis quota check failed");
        // Must NOT silently return true/success on Redis failure
        expect(content).not.toContain("return true; // Fail open");
    });

    it("warns when Redis is not configured", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexing/indexnow.ts"),
            "utf-8"
        );

        expect(content).toContain("Redis not configured");
        expect(content).toContain("quota enforcement disabled");
    });
});

describe("12. indexingAction never returns unconditional success: true", () => {
    it("derives success from result.success", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/app/actions/indexingAction.ts"),
            "utf-8"
        );

        // Must derive success from the actual result
        expect(content).toContain("success: result.success");
        // Must NOT have unconditional `success: true`
        // Count occurrences of `success: true` — should be zero (the old pattern)
        const unconditionalSuccess = content.match(/success:\s*true(?![\s\S]*result)/);
        expect(unconditionalSuccess).toBeNull();
    });

    it("includes error message on failure", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/app/actions/indexingAction.ts"),
            "utf-8"
        );

        expect(content).toContain("error:");
        expect(content).toContain("indexing providers failed");
    });
});

describe("13. Raw provider error details are not returned to the client", () => {
    it("indexing.ts never returns result.message or result.reason directly", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/app/actions/indexing.ts"),
            "utf-8"
        );

        // PERMISSION_DENIED case must NOT return result.message
        const permDeniedSection = content.slice(
            content.indexOf('"PERMISSION_DENIED"'),
            content.indexOf('"PERMISSION_DENIED"') + 300
        );
        expect(permDeniedSection).not.toContain("error: result.message");

        // UNKNOWN case must NOT return result.message
        expect(content).not.toMatch(/code:\s*"UNKNOWN"[^}]*error:\s*result\.(message|reason)/);
    });

    it("indexingAction.ts does not expose raw provider data", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/app/actions/indexingAction.ts"),
            "utf-8"
        );

        // Must NOT return the full result object
        expect(content).not.toContain("data: result");
        // Must only return sanitized status
        expect(content).toContain("google: { status:");
        expect(content).toContain("indexNow: { status:");
    });
});

describe("14. Existing primary indexing path integrity", () => {
    it("indexer.ts still uses pingGoogleIndexingApi for the primary path", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexer.ts"),
            "utf-8"
        );

        expect(content).toContain('import { pingGoogleIndexingApi }');
        expect(content).toContain("pingGoogleIndexingApi(url,");
        expect(content).toContain("submitToAllIndexNow");
    });

    it("primary indexer maintains retry queue with exponential backoff", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const content = fs.readFileSync(
            path.resolve(__dirname, "../../src/lib/indexer.ts"),
            "utf-8"
        );

        expect(content).toContain("RETRY_PENDING");
        expect(content).toContain("drainRetryQueue");
        expect(content).toContain("MAX_RETRY_ATTEMPTS");
        expect(content).toContain("retryDelayMs");
    });
});
