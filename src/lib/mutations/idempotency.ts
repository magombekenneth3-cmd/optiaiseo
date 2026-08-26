/**
 * Two-Level Idempotency Keys
 *
 * - Operation-level: represents the logical mutation intent
 * - Effect-level: represents a specific external side effect
 *
 * Each key is UNIQUE in the database (enforced by schema).
 * Collision on INSERT = idempotent no-op.
 *
 * See: implementation_plan.md v2.1 — Phase 2
 */

import { createHash } from "crypto";

/**
 * Generates an operation-level idempotency key.
 *
 * Represents the logical mutation intent. If the same intent is submitted
 * again (e.g., due to Inngest retry), the UNIQUE constraint prevents
 * a second operation from being created.
 *
 * Format: op:{type}:{deterministic-hash-of-params}
 *
 * Examples:
 *   "op:growth:clx12345"
 *   "op:blog-update:blogId123:abc123def"
 */
export function generateOperationKey(
  type: string,
  params: Record<string, string>
): string {
  const paramsHash = hashParams(params);
  return `op:${type}:${paramsHash}`;
}

/**
 * Generates an effect-level idempotency key.
 *
 * Represents a specific external side effect. Independent retry semantics
 * from the parent operation — a failed effect can be retried without
 * recreating the operation.
 *
 * Format: fx:{type}:{deterministic-hash-of-params}
 *
 * Examples:
 *   "fx:cms:blogId123:WORDPRESS:abc123def"
 *   "fx:ghpr:owner:repo:treeHash123"
 *   "fx:indexnow:opId123:urlHash456"
 */
export function generateEffectKey(
  type: string,
  params: Record<string, string>
): string {
  const paramsHash = hashParams(params);
  return `fx:${type}:${paramsHash}`;
}

/**
 * Creates a deterministic hash of parameters for key generation.
 * Keys are sorted to ensure stability regardless of insertion order.
 */
function hashParams(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}
