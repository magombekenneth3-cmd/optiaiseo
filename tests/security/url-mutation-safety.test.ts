/**
 * Phase 4 regression tests — URL and mutation safety.
 *
 * BUG-4A: AutoFix must NOT use hardcoded `site.com` for canonical/OG URLs
 * BUG-4B: Unknown action types must NOT silently succeed
 * BUG-4C: Direct-action mutations must respect kill-switch and REPORT_ONLY
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(`${ROOT}/${rel}`, "utf8");

const execEngineSrc = read("src/lib/growth/execution-engine.ts");

// ─────────────────────────────────────────────────────────────────────────────
// BUG-4A: Hardcoded site.com domain in AutoFix
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-4A: AutoFix canonical/OG URL uses real site domain", () => {
    it("should NOT contain hardcoded 'site.com' as a URL host", () => {
        // The old code: performOneClickAutoFix(blog.content, `https://site.com${targetUrl}`)
        expect(execEngineSrc).not.toContain("https://site.com");
    });

    it("should resolve the site domain from the database", () => {
        // Must query prisma.site.findUnique for the domain
        expect(execEngineSrc).toContain("siteForDomain");
        expect(execEngineSrc).toContain("select: { domain: true }");
    });

    it("should handle missing domain gracefully (no throw)", () => {
        // Must have a try/catch or fallback for domain resolution
        expect(execEngineSrc).toContain("Domain lookup failed");
    });

    it("should normalise domain to include https:// scheme", () => {
        expect(execEngineSrc).toContain('!fullBaseUrl.startsWith("http")');
        expect(execEngineSrc).toContain("`https://${fullBaseUrl}`");
    });

    it("should construct autoFixUrl from resolved domain + targetUrl path", () => {
        expect(execEngineSrc).toContain("const autoFixUrl = fullBaseUrl ?");
        expect(execEngineSrc).toContain("performOneClickAutoFix(blog.content, autoFixUrl)");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-4B: Unknown actions must NOT silently succeed
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-4B: Unknown action types rejected", () => {
    it("should NOT return success: true for unknown actions", () => {
        // Extract the default case block
        const defaultIdx = execEngineSrc.indexOf("default: {", execEngineSrc.indexOf("buildMutationPayload"));
        const defaultBlock = execEngineSrc.substring(defaultIdx, defaultIdx + 600);

        // Should return success: false, not success: true as a return value
        expect(defaultBlock).toContain("success: false");
        // The actual return statement must not have success: true
        // (the comment mentions the old behavior, so we check the return {} block specifically)
        const returnBlock = defaultBlock.substring(defaultBlock.indexOf("return {"));
        expect(returnBlock).not.toMatch(/success:\s*true/);
    });

    it("should NOT have a no-op directAction for unknown actions", () => {
        const defaultIdx = execEngineSrc.indexOf("default: {", execEngineSrc.indexOf("buildMutationPayload"));
        const defaultBlock = execEngineSrc.substring(defaultIdx, defaultIdx + 600);

        expect(defaultBlock).not.toContain("directAction");
        expect(defaultBlock).not.toContain("No-op");
    });

    it("should log a warning for unrecognized action types", () => {
        expect(execEngineSrc).toContain("Unrecognized action type");
    });

    it("should include the action name in the error message", () => {
        expect(execEngineSrc).toContain("`Unrecognized action type: ${action}`");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-4C: Direct-action mutations respect kill-switch + REPORT_ONLY
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-4C: Direct-action safety checks", () => {
    it("should import assertAllKillSwitchesClear", () => {
        expect(execEngineSrc).toContain('import { assertAllKillSwitchesClear } from "@/lib/mutations/kill-switch"');
    });

    it("should check kill switches before executing direct actions", () => {
        // The kill switch check must appear between "if (mutationResult.directAction)" 
        // and the actual "await mutationResult.directAction()" call
        const directActionGuardStart = execEngineSrc.indexOf("if (mutationResult.directAction)");
        const directActionExec = execEngineSrc.indexOf("await mutationResult.directAction()", directActionGuardStart);
        const killSwitchCheck = execEngineSrc.indexOf("assertAllKillSwitchesClear(siteId)", directActionGuardStart);

        expect(killSwitchCheck).toBeGreaterThan(directActionGuardStart);
        expect(killSwitchCheck).toBeLessThan(directActionExec);
    });

    it("should check REPORT_ONLY mode before executing direct actions", () => {
        const directActionGuardStart = execEngineSrc.indexOf("if (mutationResult.directAction)");
        const directActionExec = execEngineSrc.indexOf("await mutationResult.directAction()", directActionGuardStart);
        const reportOnlyCheck = execEngineSrc.indexOf("REPORT_ONLY", directActionGuardStart);

        expect(reportOnlyCheck).toBeGreaterThan(directActionGuardStart);
        expect(reportOnlyCheck).toBeLessThan(directActionExec);
    });

    it("should return BLOCKED status when kill switch is active on direct action", () => {
        const directActionGuardStart = execEngineSrc.indexOf("if (mutationResult.directAction)");
        const directBlock = execEngineSrc.substring(directActionGuardStart, directActionGuardStart + 1500);

        expect(directBlock).toContain('actionExecuted: "BLOCKED"');
    });

    it("should return failure when site is in REPORT_ONLY mode", () => {
        const directActionGuardStart = execEngineSrc.indexOf("if (mutationResult.directAction)");
        const directBlock = execEngineSrc.substring(directActionGuardStart, directActionGuardStart + 1500);

        expect(directBlock).toContain("REPORT_ONLY mode");
        expect(directBlock).toContain("direct actions are blocked");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutation lifecycle integrity checks (verify existing safety remains intact)
// ─────────────────────────────────────────────────────────────────────────────
describe("Mutation lifecycle integrity", () => {
    const concurrencySrc = read("src/lib/mutations/concurrency.ts");
    const operationSrc = read("src/lib/mutations/operation.ts");
    const typesSrc = read("src/lib/mutations/types.ts");

    it("should use a closed MUTABLE_TARGETS allowlist for SQL generation", () => {
        expect(concurrencySrc).toContain("MUTABLE_TARGETS");
        expect(concurrencySrc).toContain("satisfies Record<string, MutableTargetConfig>");
    });

    it("should validate data keys against allowedColumns before SQL", () => {
        expect(concurrencySrc).toContain("is not allowed for model");
        expect(concurrencySrc).toContain("config.allowedColumns");
    });

    it("should use parameterized values ($1, $2...) not string interpolation for data values", () => {
        // The SQL should use $paramIndex for values, not template literals with data
        expect(concurrencySrc).toContain('`"${key}" = $${paramIndex}`');
    });

    it("should throw ConcurrentModificationError when affectedRows === 0", () => {
        expect(concurrencySrc).toContain("throw new ConcurrentModificationError");
    });

    it("should enforce REPORT_ONLY in createOperation for SYSTEM actors", () => {
        expect(operationSrc).toContain("REPORT_ONLY");
        expect(operationSrc).toContain("system-initiated mutations are blocked");
    });

    it("state machine should have exhaustive terminal states with empty transitions", () => {
        expect(typesSrc).toContain("REJECTED: []");
        expect(typesSrc).toContain("FAILED: []");
        expect(typesSrc).toContain("STALE: []");
        expect(typesSrc).toContain("ROLLED_BACK: []");
    });
});
