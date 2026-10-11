/**
 * Phase 6 regression tests — CI/Deployment hardening.
 *
 * BUG-6A: Deploy workflow must gate on tests before deploying
 * BUG-6B: deploy.sh must require --sync-env flag for secret sync
 * BUG-6C: Dockerfile HEALTHCHECK must use /api/health, not /
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(`${ROOT}/${rel}`, "utf8");

const deployYml = read(".github/workflows/deploy.yml");
const ciYml = read(".github/workflows/ci.yml");
const deploySh = read("deploy.sh");
const dockerfile = read("Dockerfile");
const railwayToml = read("railway.toml");
const cronAuthSrc = read("src/lib/cron-auth.ts");
const envSrc = read("src/lib/env.ts");
const startSh = read("scripts/start.sh");
const healthRouteSrc = read("src/app/api/health/route.ts");

// ─────────────────────────────────────────────────────────────────────────────
// BUG-6A: Deploy workflow test gate
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-6A: Deploy workflow requires tests before deploy", () => {
    it("should have a separate test job", () => {
        expect(deployYml).toContain("test:");
        expect(deployYml).toContain("Type Check");
    });

    it("deploy job should depend on test job (needs: test)", () => {
        expect(deployYml).toContain("needs: test");
    });

    it("test job should run vitest security tests", () => {
        expect(deployYml).toContain("vitest run tests/security/");
    });

    it("test job should run TypeScript type check", () => {
        expect(deployYml).toContain("tsc --noEmit");
    });

    it("test job should install dependencies with frozen lockfile", () => {
        expect(deployYml).toContain("--frozen-lockfile");
    });

    it("tsc step in deploy.yml should NOT have continue-on-error", () => {
        // Extract the tsc block — the 3 lines around 'tsc --noEmit' in deploy.yml
        const tscIdx = deployYml.indexOf("tsc --noEmit");
        const tscBlock = deployYml.substring(tscIdx, tscIdx + 200);
        expect(tscBlock).not.toContain("continue-on-error: true");
    });

    it("should have a separate ci.yml PR gate workflow", () => {
        expect(ciYml).toContain("pull_request");
        expect(ciYml).toContain("branches: [main]");
    });

    it("ci.yml should run security tests as blocking", () => {
        expect(ciYml).toContain("vitest run tests/security/");
        // The security test step should NOT have continue-on-error
        const secIdx = ciYml.indexOf("Security regression tests");
        const secBlock = ciYml.substring(secIdx, secIdx + 200);
        expect(secBlock).not.toContain("continue-on-error");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-6B: deploy.sh env sync safeguards
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-6B: deploy.sh requires --sync-env flag", () => {
    it("should NOT auto-sync .env without explicit opt-in", () => {
        expect(deploySh).toContain("--sync-env");
        expect(deploySh).toContain("SYNC_ENV=false");
    });

    it("should warn about test/localhost values in .env", () => {
        expect(deploySh).toContain("sk_test_");
        expect(deploySh).toContain("localhost");
        expect(deploySh).toContain("DANGER");
    });

    it("should skip sync by default with informational message", () => {
        expect(deploySh).toContain("Skipping .env sync");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-6C: Dockerfile HEALTHCHECK points to /api/health
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-6C: Dockerfile HEALTHCHECK uses /api/health", () => {
    it("Dockerfile HEALTHCHECK should use /api/health", () => {
        expect(dockerfile).toContain("/api/health");
        expect(dockerfile).not.toMatch(/curl -f http:\/\/localhost:3000\/\s/);
    });

    it("Railway healthcheck should use /api/health", () => {
        expect(railwayToml).toContain("/api/health");
    });

    it("health endpoint should check database connectivity", () => {
        expect(healthRouteSrc).toContain("SELECT 1");
        expect(healthRouteSrc).toContain("503");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("Infrastructure invariants", () => {
    it("cron auth should use timing-safe comparison", () => {
        expect(cronAuthSrc).toContain("timingSafeEqual");
    });

    it("cron auth should throw when CRON_SECRET is not set", () => {
        expect(cronAuthSrc).toContain("throw new Error");
        expect(cronAuthSrc).toContain("CRON_SECRET is not set");
    });

    it("env validation should use Zod schema", () => {
        expect(envSrc).toContain("z.object(");
        expect(envSrc).toContain("envSchema.parse(process.env)");
    });

    it("env validation should exit(1) in production when validation fails", () => {
        expect(envSrc).toContain("process.exit(1)");
    });

    it("env should require STRIPE_SECRET_KEY to start with sk_ in production", () => {
        expect(envSrc).toContain('startsWith("sk_")');
    });

    it("env should require CRON_SECRET min 32 chars in production", () => {
        expect(envSrc).toContain("min(32");
    });

    it("start.sh should run prisma migrate deploy before starting", () => {
        expect(startSh).toContain("prisma migrate deploy");
    });

    it("start.sh should abort on migration failure", () => {
        expect(startSh).toContain("set -e");
        expect(startSh).toContain("exit 1");
    });

    it("Dockerfile should run as non-root user", () => {
        expect(dockerfile).toContain("USER nextjs");
    });

    it("Dockerfile should use multi-stage build", () => {
        const fromCount = (dockerfile.match(/^FROM /gm) || []).length;
        expect(fromCount).toBeGreaterThanOrEqual(3);
    });
});
