/**
 * Production Environment Validator
 *
 * Validates autonomous pipeline configuration at startup.
 * In NODE_ENV=production, missing required vars cause a hard failure.
 * In development, logs warnings for missing optional vars.
 */

import { logger } from "@/lib/logger";

// ── Types ───────────────────────────────────────────────────────────────────

interface EnvRule {
  key: string;
  required: boolean;
  validate?: (value: string) => string | null; // returns error or null
  default?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: AutonomousConfig;
}

export interface AutonomousConfig {
  globalKillSwitch: boolean;
  d4LlmEnabled: boolean;
  maxProposalsPerHour: number;
  budgetCeilingCents: number;
}

// ── Validation Rules ────────────────────────────────────────────────────────

const AUTONOMOUS_ENV_RULES: EnvRule[] = [
  {
    key: "AUTONOMOUS_GLOBAL_KILL_SWITCH",
    required: false,
    default: "false",
    validate: (v) =>
      v === "true" || v === "false"
        ? null
        : `Must be "true" or "false", got "${v}"`,
  },
  {
    key: "D4_LLM_ENABLED",
    required: false,
    default: "true",
    validate: (v) =>
      v === "true" || v === "false"
        ? null
        : `Must be "true" or "false", got "${v}"`,
  },
  {
    key: "AUTONOMOUS_MAX_PROPOSALS_PER_HOUR",
    required: false,
    default: "20",
    validate: (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) return `Must be a non-negative integer, got "${v}"`;
      if (n > 1000) return `Unreasonably high: ${n} proposals/hour`;
      return null;
    },
  },
  {
    key: "AUTONOMOUS_BUDGET_CEILING_CENTS",
    required: false,
    default: "5000",
    validate: (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) return `Must be a non-negative integer, got "${v}"`;
      return null;
    },
  },
];

// Additional production-required vars (not autonomous-specific)
const PRODUCTION_REQUIRED: string[] = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "GEMINI_API_KEY",
  "INNGEST_SIGNING_KEY",
  "CRON_SECRET",
];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validates environment configuration for the autonomous pipeline.
 *
 * In production:
 *   - Missing required vars → hard error
 *   - Invalid autonomous config → hard error
 *
 * In development:
 *   - Missing required vars → warning
 *   - Invalid autonomous config → warning + default
 */
export function validateAutonomousEnv(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";

  // 1. Check production-required vars
  for (const key of PRODUCTION_REQUIRED) {
    if (!process.env[key]) {
      const msg = `Missing required env var: ${key}`;
      if (isProduction) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  // 2. D4_LLM_ENABLED=true requires GEMINI_API_KEY
  const d4Enabled = (process.env.D4_LLM_ENABLED ?? "true") !== "false";
  if (d4Enabled && !process.env.GEMINI_API_KEY) {
    const msg = "D4_LLM_ENABLED=true but GEMINI_API_KEY is missing — LLM calls will fail";
    if (isProduction) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  }

  // 3. Validate autonomous config vars
  const configValues: Record<string, string> = {};
  for (const rule of AUTONOMOUS_ENV_RULES) {
    const raw = process.env[rule.key] ?? rule.default ?? "";
    configValues[rule.key] = raw;

    if (rule.required && !raw) {
      errors.push(`Missing required env var: ${rule.key}`);
      continue;
    }

    if (raw && rule.validate) {
      const err = rule.validate(raw);
      if (err) {
        const msg = `Invalid ${rule.key}: ${err}`;
        if (isProduction) {
          errors.push(msg);
        } else {
          warnings.push(`${msg} — using default "${rule.default}"`);
          configValues[rule.key] = rule.default ?? "";
        }
      }
    }
  }

  // 4. Build config
  const config: AutonomousConfig = {
    globalKillSwitch:
      configValues["AUTONOMOUS_GLOBAL_KILL_SWITCH"] === "true",
    d4LlmEnabled:
      configValues["D4_LLM_ENABLED"] !== "false",
    maxProposalsPerHour: parseInt(
      configValues["AUTONOMOUS_MAX_PROPOSALS_PER_HOUR"] || "20",
      10
    ),
    budgetCeilingCents: parseInt(
      configValues["AUTONOMOUS_BUDGET_CEILING_CENTS"] || "5000",
      10
    ),
  };

  const valid = errors.length === 0;

  // Log results
  if (errors.length > 0) {
    logger.error("[EnvValidator] Autonomous pipeline configuration errors", {
      errors,
    });
  }
  if (warnings.length > 0) {
    logger.warn("[EnvValidator] Autonomous pipeline configuration warnings", {
      warnings,
    });
  }
  if (valid) {
    logger.info("[EnvValidator] Autonomous pipeline config validated", {
      config: {
        globalKillSwitch: config.globalKillSwitch,
        d4LlmEnabled: config.d4LlmEnabled,
        maxProposalsPerHour: config.maxProposalsPerHour,
        budgetCeilingCents: config.budgetCeilingCents,
      },
    });
  }

  return { valid, errors, warnings, config };
}

/**
 * Returns the current autonomous config (cached).
 * Call validateAutonomousEnv() at startup for hard validation.
 */
let _cachedConfig: AutonomousConfig | null = null;

export function getAutonomousConfig(): AutonomousConfig {
  if (!_cachedConfig) {
    const result = validateAutonomousEnv();
    _cachedConfig = result.config;
  }
  return _cachedConfig;
}
