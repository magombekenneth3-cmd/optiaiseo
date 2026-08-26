/**
 * Diff-Based Risk Scoring Engine
 *
 * Computes a numeric risk score (0-100) and categorical risk level
 * based on the actual mutation diff, not just the action type.
 *
 * See: implementation_plan.md v2.1 — Phase 2
 */

import type { RiskLevel } from "./types";
import { logger } from "@/lib/logger";

// ── Protected Surfaces ──────────────────────────────────────────────────────
// Fields whose mutation should raise risk level to at least HIGH.
const PROTECTED_FIELDS = new Set([
  "canonical",
  "canonicalUrl",
  "robotsMeta",
  "noindex",
  "nofollow",
  "redirect",
  "redirectUrl",
  "slug",
]);

// Fields that affect external SEO surfaces (moderate risk increase)
const SEO_SENSITIVE_FIELDS = new Set([
  "schemaMarkup",
  "metaDescription",
  "ogImage",
  "ogTitle",
  "title",
]);

export interface RiskCalculationParams {
  mutationType: string;
  affectedFields: string[];
  diffSizeBytes: number;
  targetModel: string;
  /** Total pages on the site — used for blast radius calculation */
  sitePageCount: number;
  /** How many URLs are affected by this mutation */
  affectedUrlCount: number;
  /** Whether any protected surface is being modified */
  isProtectedSurface?: boolean;
}

export interface RiskAssessment {
  riskLevel: RiskLevel;
  riskScore: number;
  reasons: string[];
}

/**
 * Calculates the risk level and numeric score for a mutation operation.
 *
 * Scoring:
 * - Base: 10
 * - Diff size: <500B → -10, >5KB → +20, >20KB → +40
 * - SEO-sensitive fields: +15 per field
 * - Protected fields: +30 per field (minimum HIGH)
 * - Blast radius: affected/total > 10% → +25
 * - Content-only: -5
 *
 * Risk levels:
 * - LOW: 0-24
 * - MEDIUM: 25-49
 * - HIGH: 50-74
 * - CRITICAL: 75-100
 */
export function calculateOperationRisk(
  params: RiskCalculationParams
): RiskAssessment {
  let score = 10; // Base score
  const reasons: string[] = [];
  let forceMinimumHigh = false;

  // ── Diff size ───────────────────────────────────────────────────────────
  if (params.diffSizeBytes < 500) {
    score -= 10;
    reasons.push("Small diff (<500B)");
  } else if (params.diffSizeBytes > 20_000) {
    score += 40;
    reasons.push(`Very large diff (${params.diffSizeBytes}B)`);
  } else if (params.diffSizeBytes > 5_000) {
    score += 20;
    reasons.push(`Large diff (${params.diffSizeBytes}B)`);
  }

  // ── Field sensitivity ─────────────────────────────────────────────────
  for (const field of params.affectedFields) {
    if (PROTECTED_FIELDS.has(field)) {
      score += 30;
      forceMinimumHigh = true;
      reasons.push(`Protected field: ${field}`);
    } else if (SEO_SENSITIVE_FIELDS.has(field)) {
      score += 15;
      reasons.push(`SEO-sensitive field: ${field}`);
    }
  }

  if (params.isProtectedSurface) {
    forceMinimumHigh = true;
    score += 30;
    reasons.push("Protected surface mutation");
  }

  // ── Content-only bonus ────────────────────────────────────────────────
  const onlyContent = params.affectedFields.every(
    (f) => f === "content" || f === "interactiveWidget"
  );
  if (onlyContent && params.affectedFields.length > 0) {
    score -= 5;
    reasons.push("Content-only mutation");
  }

  // ── Blast radius ──────────────────────────────────────────────────────
  if (params.sitePageCount > 0 && params.affectedUrlCount > 0) {
    const ratio = params.affectedUrlCount / params.sitePageCount;
    if (ratio > 0.1) {
      score += 25;
      reasons.push(
        `Blast radius: ${(ratio * 100).toFixed(1)}% of site (${params.affectedUrlCount}/${params.sitePageCount})`
      );
    }
  }

  // ── Clamp score ───────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));

  // ── Determine level ───────────────────────────────────────────────────
  let riskLevel: RiskLevel;
  if (score >= 75) {
    riskLevel = "CRITICAL";
  } else if (score >= 50 || forceMinimumHigh) {
    riskLevel = "HIGH";
    score = Math.max(score, 50); // Enforce minimum score for HIGH
  } else if (score >= 25) {
    riskLevel = "MEDIUM";
  } else {
    riskLevel = "LOW";
  }

  logger.info("[RiskEngine] Assessment", {
    mutationType: params.mutationType,
    riskLevel,
    riskScore: score,
    reasons,
  });

  return { riskLevel, riskScore: score, reasons };
}

/**
 * Determines whether a risk level requires human approval.
 */
export function requiresApproval(riskLevel: RiskLevel): boolean {
  return riskLevel === "MEDIUM" || riskLevel === "HIGH" || riskLevel === "CRITICAL";
}
