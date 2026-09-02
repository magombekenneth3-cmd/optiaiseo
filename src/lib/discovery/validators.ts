/**
 * Phase D.1 — Deterministic Signal Validation
 *
 * No LLM, no external calls. Pure deterministic checks on raw signals.
 * Evidence age is SOURCE-SPECIFIC, not a global constant.
 */

import type { RawDiscoverySignal, ValidationResult, DiscoverySource } from "./types";
import { isEvidenceFresh, wouldCreateExpiredCandidate } from "./freshness";

// ── Known Values ────────────────────────────────────────────────────────────

const KNOWN_CATEGORIES = new Set([
  "DECLINING", "QUICK_WIN", "ALMOST_RANKING", "STALE",
  "CANNIBALIZATION", "ORPHANED", "DEAD_WEIGHT",
]);

const KNOWN_ACTIONS = new Set([
  "REFRESH_CONTENT", "BUILD_INTERNAL_LINKS", "CREATE_NEW_CONTENT",
  "CONSOLIDATE_CONTENT", "IMPROVE_SEARCH_INTENT", "OPTIMIZE_TITLE",
  "OPTIMIZE_CONTENT_DEPTH", "DEINDEX_OR_REDIRECT", "MONITOR",
]);

const KNOWN_RESOURCE_TYPES = new Set(["PAGE", "QUERY", "SITE", "KEYWORD"]);

/** Minimum discovery confidence to accept a signal */
export const MIN_DISCOVERY_CONFIDENCE = 0.3;

/** SHA-256 hex string is exactly 64 characters */
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validates a raw discovery signal. All checks are deterministic.
 * Evidence age uses source-specific limits from freshness.ts.
 */
export function validateSignal(
  signal: RawDiscoverySignal,
  now: Date = new Date()
): ValidationResult {
  // 1. Confidence bounds
  if (typeof signal.confidence !== "number" || signal.confidence < 0 || signal.confidence > 1) {
    return { valid: false, reason: `Invalid confidence: ${signal.confidence} (must be 0.0–1.0)` };
  }

  if (signal.confidence < MIN_DISCOVERY_CONFIDENCE) {
    return {
      valid: false,
      reason: `Confidence ${signal.confidence} below minimum ${MIN_DISCOVERY_CONFIDENCE}`,
    };
  }

  // 2. At least 1 evidence item
  if (!signal.evidence || signal.evidence.length === 0) {
    return { valid: false, reason: "No evidence items" };
  }

  // 3. Evidence freshness (source-specific)
  const freshEvidence = signal.evidence.filter((e) =>
    isEvidenceFresh(e, signal.source, now)
  );

  if (freshEvidence.length === 0) {
    return {
      valid: false,
      reason: `All ${signal.evidence.length} evidence items are stale for source ${signal.source}`,
    };
  }

  // 4. Resource ID non-empty
  if (!signal.resourceId || signal.resourceId.trim().length === 0) {
    return { valid: false, reason: "Empty resourceId" };
  }

  // 5. Known category
  if (!KNOWN_CATEGORIES.has(signal.category)) {
    return { valid: false, reason: `Unknown category: ${signal.category}` };
  }

  // 6. Known action
  if (!KNOWN_ACTIONS.has(signal.suggestedAction)) {
    return { valid: false, reason: `Unknown action: ${signal.suggestedAction}` };
  }

  // 7. Known resource type
  if (!KNOWN_RESOURCE_TYPES.has(signal.resourceType)) {
    return { valid: false, reason: `Unknown resourceType: ${signal.resourceType}` };
  }

  // 8. Fingerprint format
  if (!FINGERPRINT_PATTERN.test(signal.fingerprint)) {
    return { valid: false, reason: `Malformed fingerprint: ${signal.fingerprint}` };
  }

  // 9. Source run ID present
  if (!signal.sourceRunId || signal.sourceRunId.trim().length === 0) {
    return { valid: false, reason: "Empty sourceRunId" };
  }

  // 10. Would-create-expired-candidate guard
  // Even if evidence passes age check, reject if ALL evidence would produce
  // a candidate with expiresAt < now (already expired on creation)
  if (wouldCreateExpiredCandidate(signal.evidence, signal.source, now)) {
    return {
      valid: false,
      reason: `All evidence would create an already-expired candidate for source ${signal.source}`,
    };
  }

  return { valid: true };
}

/**
 * Batch-validates signals, returning only valid ones.
 */
export function filterValidSignals(
  signals: RawDiscoverySignal[],
  now: Date = new Date()
): { valid: RawDiscoverySignal[]; rejected: Array<{ signal: RawDiscoverySignal; reason: string }> } {
  const valid: RawDiscoverySignal[] = [];
  const rejected: Array<{ signal: RawDiscoverySignal; reason: string }> = [];

  for (const signal of signals) {
    const result = validateSignal(signal, now);
    if (result.valid) {
      valid.push(signal);
    } else {
      rejected.push({ signal, reason: result.reason! });
    }
  }

  return { valid, rejected };
}
