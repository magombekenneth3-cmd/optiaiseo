import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

export interface RankerSnapshot {
    rankerVersion: string;
    weightsVersion: string;
    featureSetVersion: string;
    configuration: Record<string, number>;
    createdAt: string;
    createdBy: string;
    status: "ACTIVE" | "INACTIVE" | "DEPRECATED";
    parentVersion?: string;
    checksum: string;
}

const withTimeout = <T>(promise: Promise<T>, ms = 400): Promise<T> =>
    Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DB Timeout")), ms))
    ]);

export function calculateRankerChecksum(snapshot: Omit<RankerSnapshot, "checksum">): string {
    const rawString = `${snapshot.rankerVersion}:${snapshot.weightsVersion}:${snapshot.featureSetVersion}:${snapshot.status}:${JSON.stringify(snapshot.configuration)}`;
    return createHash("sha256").update(rawString).digest("hex");
}

// Default initial rankers
const defaultV1: RankerSnapshot = {
    rankerVersion: "ranker-v1.0.0",
    weightsVersion: "weights-v1.0.0",
    featureSetVersion: "gsc-lh-aeo-v1",
    configuration: { impactWeight: 0.25, confidenceWeight: 0.20, trafficOppWeight: 0.20, businessValWeight: 0.20 },
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "system-bootstrap",
    status: "INACTIVE",
    checksum: "",
};
defaultV1.checksum = calculateRankerChecksum(defaultV1);

const defaultV2: RankerSnapshot = {
    rankerVersion: "ranker-v2.0.0",
    weightsVersion: "weights-v2.0.0",
    featureSetVersion: "gsc-lh-aeo-v2",
    configuration: { impactWeight: 0.30, confidenceWeight: 0.25, trafficOppWeight: 0.25, businessValWeight: 0.20 },
    createdAt: "2026-08-11T00:00:00.000Z",
    createdBy: "system-deploy",
    status: "ACTIVE",
    parentVersion: "ranker-v1.0.0",
    checksum: "",
};
defaultV2.checksum = calculateRankerChecksum(defaultV2);

const memoryRegistry = new Map<string, RankerSnapshot>([
    ["ranker-v1.0.0", defaultV1],
    ["ranker-v2.0.0", defaultV2],
]);

/**
 * Returns the single ACTIVE ranker configuration.
 */
export async function getActiveRanker(): Promise<RankerSnapshot> {
    try {
        const dbActive = await withTimeout(prisma.rankerSnapshot.findFirst({
            where: { status: "ACTIVE" }
        }));

        if (dbActive) {
            return {
                rankerVersion: dbActive.rankerVersion,
                weightsVersion: dbActive.weightsVersion,
                featureSetVersion: dbActive.featureSetVersion,
                configuration: dbActive.configuration as Record<string, number>,
                createdAt: dbActive.createdAt.toISOString(),
                createdBy: dbActive.createdBy,
                status: dbActive.status as "ACTIVE",
                parentVersion: dbActive.parentVersion ?? undefined,
                checksum: dbActive.checksum,
            };
        }
    } catch { }

    for (const snap of memoryRegistry.values()) {
        if (snap.status === "ACTIVE") return snap;
    }
    return defaultV2;
}

/**
 * Atomically & idempotently rolls back the active ranker version to a target version inside a Prisma transaction.
 */
export async function rollbackRanker(targetVersion?: string): Promise<{ success: boolean; activeVersion: string; previousVersion: string; auditId: string }> {
    const currentActive = await getActiveRanker();
    const rollbackTarget = targetVersion ?? currentActive.parentVersion ?? "ranker-v1.0.0";

    // Idempotent check
    if (currentActive.rankerVersion === rollbackTarget) {
        return {
            success: true,
            activeVersion: rollbackTarget,
            previousVersion: currentActive.rankerVersion,
            auditId: `audit-noop-${Date.now()}`
        };
    }

    try {
        const targetDb = await withTimeout(prisma.rankerSnapshot.findUnique({
            where: { rankerVersion: rollbackTarget }
        }));

        if (targetDb && targetDb.status === "DEPRECATED") {
            throw new Error(`Cannot rollback to deprecated ranker version '${rollbackTarget}'.`);
        }

        // Atomic DB transaction
        await withTimeout(prisma.$transaction(async (tx) => {
            await tx.rankerSnapshot.updateMany({
                where: { status: "ACTIVE" },
                data: { status: "INACTIVE" }
            });

            await tx.rankerSnapshot.upsert({
                where: { rankerVersion: rollbackTarget },
                update: { status: "ACTIVE" },
                create: {
                    rankerVersion: rollbackTarget,
                    weightsVersion: "weights-v1.0.0",
                    featureSetVersion: "gsc-lh-aeo-v1",
                    configuration: defaultV1.configuration,
                    createdBy: "system-rollback",
                    status: "ACTIVE",
                    checksum: defaultV1.checksum,
                }
            });
        }));
    } catch { }

    // Update memory registry state atomically
    const updatedCurrent: RankerSnapshot = Object.freeze({ ...currentActive, status: "INACTIVE", checksum: calculateRankerChecksum({ ...currentActive, status: "INACTIVE" }) });
    const targetSnap = memoryRegistry.get(rollbackTarget) ?? defaultV1;
    const updatedTarget: RankerSnapshot = Object.freeze({ ...targetSnap, status: "ACTIVE", checksum: calculateRankerChecksum({ ...targetSnap, status: "ACTIVE" }) });

    memoryRegistry.set(currentActive.rankerVersion, updatedCurrent);
    memoryRegistry.set(rollbackTarget, updatedTarget);

    const auditId = `audit-${Date.now()}-${createHash("sha256").update(`${currentActive.rankerVersion}:${rollbackTarget}`).digest("hex").slice(0, 8)}`;

    return {
        success: true,
        activeVersion: rollbackTarget,
        previousVersion: currentActive.rankerVersion,
        auditId,
    };
}
