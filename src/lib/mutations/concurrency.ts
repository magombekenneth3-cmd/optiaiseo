/**
 * Atomic Optimistic Concurrency — versioned conditional updates.
 *
 * Uses $executeRawUnsafe with a CLOSED model allowlist to prevent SQL injection.
 * Model/column names are NEVER derived from external input — only from
 * the MUTABLE_TARGETS constant below.
 *
 * See: implementation_plan.md v2.1 — Correction D
 */

import { Prisma } from "@prisma/client";
import { ConcurrentModificationError } from "./types";
import { logger } from "@/lib/logger";

// ── Closed Allowlist ────────────────────────────────────────────────────────
// Only these models can be targets of versioned mutations.
// Table/column names are compile-time constants, never from user input.

interface MutableTargetConfig {
  table: string;
  versionColumn: string;
  idColumn: string;
  updatedAtColumn: string;
  allowedColumns: readonly string[];
}

const MUTABLE_TARGETS = {
  Blog: {
    table: '"Blog"',
    versionColumn: '"version"',
    idColumn: '"id"',
    updatedAtColumn: '"updatedAt"',
    allowedColumns: [
      "content",
      "schemaMarkup",
      "title",
      "metaDescription",
      "status",
      "needsRefresh",
      "interactiveWidget",
      "ogImage",
    ] as const,
  },
} as const satisfies Record<string, MutableTargetConfig>;

export type MutableModel = keyof typeof MUTABLE_TARGETS;

/**
 * Performs an atomic conditional UPDATE that:
 * 1. Verifies expectedVersion matches current version
 * 2. Increments version atomically
 * 3. Returns the new version
 *
 * If affectedRows === 0, the target was modified by another worker
 * and the operation should transition to STALE.
 *
 * SQL:
 *   UPDATE "Blog"
 *   SET "content" = $1, "version" = "version" + 1, "updatedAt" = $N
 *   WHERE "id" = $X AND "version" = $Y
 *
 * @throws {Error} if model is not in MUTABLE_TARGETS
 * @throws {Error} if any data key is not in allowedColumns
 * @throws {ConcurrentModificationError} if affectedRows === 0
 */
export async function atomicVersionedUpdate(
  tx: Prisma.TransactionClient,
  model: MutableModel,
  id: string,
  expectedVersion: number,
  data: Record<string, unknown>
): Promise<{ newVersion: number }> {
  const config = MUTABLE_TARGETS[model];
  if (!config) {
    throw new Error(
      `[atomicVersionedUpdate] Model "${model}" is not in MUTABLE_TARGETS allowlist`
    );
  }

  // Validate all data keys against allowed columns
  const dataKeys = Object.keys(data);
  for (const key of dataKeys) {
    if (!(config.allowedColumns as readonly string[]).includes(key)) {
      throw new Error(
        `[atomicVersionedUpdate] Column "${key}" is not allowed for model "${model}". ` +
          `Allowed: ${config.allowedColumns.join(", ")}`
      );
    }
  }

  if (dataKeys.length === 0) {
    throw new Error("[atomicVersionedUpdate] No data columns provided");
  }

  // Build SET clause from allowed columns — column names are from the constant,
  // values are parameterized via $1, $2, ... to prevent SQL injection.
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const key of dataKeys) {
    setClauses.push(`"${key}" = $${paramIndex}`);
    values.push(data[key]);
    paramIndex++;
  }

  // Add version increment (not parameterized — it's a column reference)
  setClauses.push(`${config.versionColumn} = ${config.versionColumn} + 1`);

  // Add updatedAt
  setClauses.push(`${config.updatedAtColumn} = $${paramIndex}`);
  values.push(new Date());
  paramIndex++;

  // WHERE id = $X AND version = $Y
  values.push(id);
  const idParamIndex = paramIndex;
  paramIndex++;

  values.push(expectedVersion);
  const versionParamIndex = paramIndex;

  const sql = `UPDATE ${config.table} SET ${setClauses.join(", ")} WHERE ${config.idColumn} = $${idParamIndex} AND ${config.versionColumn} = $${versionParamIndex}`;

  logger.info("[atomicVersionedUpdate] Executing conditional update", {
    model,
    id,
    expectedVersion,
    columns: dataKeys,
  });

  const affectedRows: number = await (tx as any).$executeRawUnsafe(
    sql,
    ...values
  );

  if (affectedRows === 0) {
    throw new ConcurrentModificationError(model, id, expectedVersion);
  }

  const newVersion = expectedVersion + 1;

  logger.info("[atomicVersionedUpdate] Version incremented", {
    model,
    id,
    oldVersion: expectedVersion,
    newVersion,
  });

  return { newVersion };
}

/**
 * Claims exclusive execution of a MutationOperation.
 *
 * Uses an atomic conditional UPDATE:
 *   UPDATE "MutationOperation"
 *   SET status = 'EXECUTING',
 *       "executionClaimedBy" = $1,
 *       "executionClaimedAt" = $2,
 *       "executionLeaseExpiresAt" = $3
 *   WHERE id = $4 AND status = 'APPROVED'
 *
 * @returns true if claim succeeded (affectedRows === 1)
 * @returns false if another worker already claimed it
 */
export async function claimExecution(
  tx: Prisma.TransactionClient,
  operationId: string,
  workerId: string,
  leaseDurationMs: number = 60_000
): Promise<boolean> {
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + leaseDurationMs);

  const affectedRows: number = await (tx as any).$executeRawUnsafe(
    `UPDATE "MutationOperation"
     SET "status" = 'EXECUTING',
         "executionClaimedBy" = $1,
         "executionClaimedAt" = $2,
         "executionLeaseExpiresAt" = $3,
         "updatedAt" = $4
     WHERE "id" = $5 AND "status" = 'APPROVED'`,
    workerId,
    now,
    leaseExpires,
    now,
    operationId
  );

  if (affectedRows === 1) {
    logger.info("[claimExecution] Execution claimed", {
      operationId,
      workerId,
    });
    return true;
  }

  logger.warn("[claimExecution] Claim failed — already claimed or not APPROVED", {
    operationId,
    workerId,
  });
  return false;
}
