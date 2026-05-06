import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "url";
import path from "path";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const compat = new FlatCompat({ baseDirectory: __dirname });

// Local rule: bans direct resolveEffectiveTier imports outside guards.ts
const noDirectResolveEffectiveTier = require("./eslint-rules/no-direct-resolve-effective-tier.js");

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ── Project-wide rules ────────────────────────────────────────────────────
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "off",
      "@next/next/no-img-element": "off",
      "prefer-const": "off",
    },
  },

  // ── Tier-enforcement guard rule ───────────────────────────────────────────
  // Applies only to server action and API route files where tier gates live.
  {
    files: [
      "src/app/actions/**/*.ts",
      "src/app/api/**/*.ts",
      "src/app/dashboard/**/*.tsx",
      "src/app/dashboard/**/*.ts",
    ],
    plugins: {
      local: {
        rules: {
          "no-direct-resolve-effective-tier": noDirectResolveEffectiveTier,
        },
      },
    },
    rules: {
      // "error" makes CI fail on violations; change to "warn" during migration
      // and flip to "error" once all files are migrated.
      "local/no-direct-resolve-effective-tier": "error",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;