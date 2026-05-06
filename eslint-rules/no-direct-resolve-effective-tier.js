/**
 * eslint-rules/no-direct-resolve-effective-tier.js
 *
 * Bans importing resolveEffectiveTier directly in server actions and API routes.
 * All tier enforcement must go through guards.ts helpers so the export API
 * revenue leak (issue #1) and missing-tier bugs (issues #2, #3) can't silently
 * recur in new features.
 *
 * ALLOWED callers (allowlist below):
 *   - src/lib/stripe/guards.ts  (the one true caller)
 *   - src/app/actions/get-tier.ts  (UI-facing tier resolver — no guard needed)
 *
 * Usage in eslint.config.mjs:
 *   import noDirectResolve from "./eslint-rules/no-direct-resolve-effective-tier.js";
 *
 *   export default defineConfig([
 *     ...compat.extends("next/core-web-vitals", "next/typescript"),
 *     {
 *       plugins: { local: { rules: { "no-direct-resolve-effective-tier": noDirectResolve } } },
 *       rules: { "local/no-direct-resolve-effective-tier": "error" },
 *     },
 *   ]);
 */

"use strict";

const path = require("path");

// Normalise a file path to forward-slash relative form for matching.
function toRelative(filename) {
    return filename.replace(/\\/g, "/");
}

// Files that are explicitly allowed to import resolveEffectiveTier directly.
const ALLOWLIST = [
    "src/lib/stripe/guards.ts",
    "src/app/actions/get-tier.ts",
];

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
    meta: {
        type: "problem",
        docs: {
            description:
                "Disallow direct imports of resolveEffectiveTier outside guards.ts. " +
                "Use requireFeature, requireWithinLimit, requireTiers, or getEffectiveTier from @/lib/stripe/guards instead.",
            recommended: true,
            url: "https://github.com/your-org/aiseo/blob/main/eslint-rules/no-direct-resolve-effective-tier.js",
        },
        messages: {
            noDirectImport:
                "Direct import of '{{source}}' is not allowed here. " +
                "Use requireFeature(), requireWithinLimit(), requireTiers(), or getEffectiveTier() " +
                "from '@/lib/stripe/guards' instead. " +
                "If you genuinely need the raw tier string (e.g. to pass to Inngest), use getEffectiveTier().",
        },
        schema: [],
    },

    create(context) {
        const filename = toRelative(context.getFilename());

        // Skip allowlisted files.
        if (ALLOWLIST.some((allowed) => filename.endsWith(allowed))) {
            return {};
        }

        return {
            ImportDeclaration(node) {
                const source = node.source.value;
                if (
                    typeof source === "string" &&
                    (source.includes("resolveEffectiveTier") ||
                        source.endsWith("stripe/resolveEffectiveTier"))
                ) {
                    context.report({
                        node,
                        messageId: "noDirectImport",
                        data: { source },
                    });
                }
            },

            // Also catches dynamic imports: await import("@/lib/stripe/resolveEffectiveTier")
            ImportExpression(node) {
                const src = node.source;
                if (
                    src.type === "Literal" &&
                    typeof src.value === "string" &&
                    (src.value.includes("resolveEffectiveTier") ||
                        src.value.endsWith("stripe/resolveEffectiveTier"))
                ) {
                    context.report({
                        node,
                        messageId: "noDirectImport",
                        data: { source: src.value },
                    });
                }
            },
        };
    },
};