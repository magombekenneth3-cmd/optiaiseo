/**
 * Append-Only Mutation Audit Event Logger
 *
 * This module ONLY exposes create operations for audit events.
 * No update or delete methods exist — this is by design.
 *
 * Every state transition, approval, rejection, execution, and failure
 * produces an immutable audit record linked to the parent operation.
 *
 * See: implementation_plan.md v2.1 — Phase 2
 */

import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

export type AuditEventType =
  | "CREATED"
  | "RISK_ASSESSED"
  | "APPROVAL_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "EXECUTING"
  | "COMMITTED"
  | "EFFECT_DISPATCHED"
  | "EFFECT_CONFIRMED"
  | "EFFECT_FAILED"
  | "EFFECT_COMPENSATED"
  | "STALE"
  | "FAILED"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "ROLLED_BACK"
  | "KILL_SWITCH_BLOCKED"
  | "COMPENSATION_STARTED"
  | "COMPENSATION_COMPLETED"
  | "EXECUTION_RECOVERED";

/**
 * Appends an immutable audit event to the operation.
 *
 * This function ONLY calls prisma.mutationAuditEvent.create().
 * No update or delete methods are exposed — by design.
 *
 * @param operationId - Parent MutationOperation ID
 * @param eventType - The type of event being recorded
 * @param actorId - Who triggered this event (user ID, "system:inngest", etc.)
 * @param details - Optional event-specific metadata
 * @param tx - Optional Prisma transaction client (for transactional consistency)
 */
export async function appendAuditEvent(
  operationId: string,
  eventType: AuditEventType,
  actorId: string,
  details?: Record<string, unknown>,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? (await import("@/lib/prisma")).prisma;

  await (client as any).mutationAuditEvent.create({
    data: {
      operationId,
      eventType,
      actorId,
      details: (details as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    },
  });

  logger.info("[MutationAudit]", {
    operationId,
    eventType,
    actorId,
    hasDetails: !!details,
  });
}

/**
 * Retrieves the full audit trail for an operation.
 * Returns events in chronological order (oldest first).
 */
export async function getAuditTrail(operationId: string) {
  const { prisma } = await import("@/lib/prisma");

  return (prisma as any).mutationAuditEvent.findMany({
    where: { operationId },
    orderBy: { createdAt: "asc" },
  });
}
