/**
 * Mutation Snapshot — first-class immutable version lineage.
 *
 * Snapshots are captured INSIDE the same Prisma transaction as the mutation,
 * tied to the operation ID. Enables querying version history:
 *
 *   SELECT * FROM MutationSnapshot
 *   WHERE targetModel = 'Blog' AND targetId = 'xyz'
 *   ORDER BY targetVersion DESC;
 *   -- Blog v15 → v14 → v13 → v12 ...
 */

import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

type JsonValue = Prisma.JsonValue;

/**
 * Captures the before-state of a target entity inside the mutation transaction.
 * Creates an immutable MutationSnapshot record.
 *
 * @param tx - Prisma transaction client (same tx as the mutation)
 * @param operationId - Parent MutationOperation ID
 * @param targetModel - e.g. "Blog"
 * @param targetId - e.g. blog.id
 * @param beforeState - The full entity state before mutation
 * @param targetVersion - The version of the entity at snapshot time
 */
export async function captureBeforeSnapshot(
  tx: Prisma.TransactionClient,
  operationId: string,
  targetModel: string,
  targetId: string,
  beforeState: JsonValue,
  targetVersion: number
): Promise<string> {
  const snapshot = await (tx as any).mutationSnapshot.create({
    data: {
      operationId,
      targetModel,
      targetId,
      targetVersion,
      beforeState: beforeState as Prisma.InputJsonValue,
      afterState: Prisma.JsonNull, // Populated after mutation commits
    },
  });

  logger.info("[MutationSnapshot] Before-state captured", {
    snapshotId: snapshot.id,
    operationId,
    targetModel,
    targetId,
    targetVersion,
  });

  return snapshot.id;
}

/**
 * Records the after-state on an existing snapshot.
 * Called after the atomic versioned update succeeds within the same transaction.
 */
export async function recordAfterState(
  tx: Prisma.TransactionClient,
  snapshotId: string,
  afterState: JsonValue
): Promise<void> {
  await (tx as any).mutationSnapshot.update({
    where: { id: snapshotId },
    data: { afterState: afterState as Prisma.InputJsonValue },
  });

  logger.info("[MutationSnapshot] After-state recorded", { snapshotId });
}

/**
 * Retrieves the full version lineage for a target entity.
 * Returns snapshots in reverse chronological order (newest first).
 */
export async function getVersionLineage(
  targetModel: string,
  targetId: string,
  limit: number = 20
) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.mutationSnapshot.findMany({
    where: { targetModel, targetId },
    orderBy: { targetVersion: "desc" },
    take: limit,
    include: {
      operation: {
        select: {
          id: true,
          actorId: true,
          actorType: true,
          mutationType: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
}
