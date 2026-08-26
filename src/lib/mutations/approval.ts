/**
 * Canonical Mutation Hashing & Approval Validation
 *
 * The approval hash represents EXACTLY what is being approved:
 * the target, version, mutation type, and patch — NOT the AI plan.
 *
 * See: implementation_plan.md v2.1 — Phase 2
 */

import { createHash } from "crypto";
import type { MutationOperation } from "@prisma/client";
import { ApprovalExpiredError, ApprovalHashMismatchError } from "./types";
import { logger } from "@/lib/logger";

/**
 * Canonicalizes and hashes the executable mutation.
 *
 * The canonical payload:
 * {
 *   "target": { "model": "Blog", "id": "clx123" },
 *   "expectedVersion": 17,
 *   "mutationType": "BLOG_CONTENT_UPDATE",
 *   "patch": { "content": "...", "schemaMarkup": "..." }
 * }
 *
 * Object keys are sorted recursively to ensure deterministic hashing.
 */
export function hashCanonicalMutation(
  targetModel: string,
  targetId: string,
  expectedVersion: number,
  mutationType: string,
  patch: Record<string, unknown>
): string {
  const canonical = {
    target: { model: targetModel, id: targetId },
    expectedVersion,
    mutationType,
    patch: sortObjectKeys(patch),
  };

  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}

export interface ApprovalValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Validates that an operation's approval is still valid.
 *
 * Checks:
 * 1. approvalExpiresAt > now()
 * 2. approvalHash === current mutationHash
 * 3. approvedBy is present
 *
 * @throws {ApprovalExpiredError} if approval TTL has passed
 * @throws {ApprovalHashMismatchError} if mutation changed after approval
 */
export function validateApproval(operation: MutationOperation): ApprovalValidation {
  // Must be in APPROVED status
  if (operation.status !== "APPROVED") {
    return { valid: false, reason: `Operation is not APPROVED (status: ${operation.status})` };
  }

  // Must have approvedBy
  if (!operation.approvedBy) {
    return { valid: false, reason: "No approver recorded" };
  }

  // Check TTL
  if (operation.approvalExpiresAt && operation.approvalExpiresAt < new Date()) {
    logger.warn("[Approval] TTL expired", {
      operationId: operation.id,
      approvalExpiresAt: operation.approvalExpiresAt,
    });
    throw new ApprovalExpiredError(operation.id);
  }

  // Check hash integrity — the mutation payload must not have changed
  if (operation.approvalHash && operation.approvalHash !== operation.mutationHash) {
    logger.error("[Approval] Hash mismatch — mutation changed after approval", {
      operationId: operation.id,
      approvalHash: operation.approvalHash,
      currentHash: operation.mutationHash,
    });
    throw new ApprovalHashMismatchError(operation.id);
  }

  return { valid: true };
}

/**
 * Generates the approval metadata for an operation.
 * Called when an approver approves a pending operation.
 */
export function generateApprovalData(
  operation: MutationOperation,
  approvedBy: string,
  ttlMinutes: number = 60
) {
  const now = new Date();
  return {
    approvedBy,
    approvedAt: now,
    approvalExpiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000),
    approvalHash: operation.mutationHash,
    status: "APPROVED" as const,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────

/**
 * Recursively sorts object keys for deterministic JSON serialization.
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);

  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
      return sorted;
    }, {} as Record<string, unknown>);
}
