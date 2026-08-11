import { createHash } from "crypto";

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

export function calculateRankerChecksum(snapshot: Omit<RankerSnapshot, "checksum">): string {
    const rawString = `${snapshot.rankerVersion}:${snapshot.weightsVersion}:${snapshot.featureSetVersion}:${snapshot.status}:${JSON.stringify(snapshot.configuration)}`;
    return createHash("sha256").update(rawString).digest("hex");
}

// Initial immutable ranker registry state
const registry = new Map<string, RankerSnapshot>();

const initialV1: Omit<RankerSnapshot, "checksum"> = {
    rankerVersion: "ranker-v1.0.0",
    weightsVersion: "weights-v1.0.0",
    featureSetVersion: "gsc-lh-aeo-v1",
    configuration: { impactWeight: 0.25, confidenceWeight: 0.20, trafficOppWeight: 0.20, businessValWeight: 0.20 },
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "system-bootstrap",
    status: "INACTIVE",
};
const v1Checksum = calculateRankerChecksum(initialV1);
registry.set("ranker-v1.0.0", Object.freeze({ ...initialV1, checksum: v1Checksum }));

const initialV2: Omit<RankerSnapshot, "checksum"> = {
    rankerVersion: "ranker-v2.0.0",
    weightsVersion: "weights-v2.0.0",
    featureSetVersion: "gsc-lh-aeo-v2",
    configuration: { impactWeight: 0.30, confidenceWeight: 0.25, trafficOppWeight: 0.25, businessValWeight: 0.20 },
    createdAt: "2026-08-11T00:00:00.000Z",
    createdBy: "system-deploy",
    status: "ACTIVE",
    parentVersion: "ranker-v1.0.0",
};
const v2Checksum = calculateRankerChecksum(initialV2);
registry.set("ranker-v2.0.0", Object.freeze({ ...initialV2, checksum: v2Checksum }));

/**
 * Returns the single ACTIVE ranker configuration.
 */
export function getActiveRanker(): RankerSnapshot {
    for (const snap of registry.values()) {
        if (snap.status === "ACTIVE") return snap;
    }
    return registry.get("ranker-v2.0.0")!;
}

/**
 * Returns a specific ranker snapshot by version string.
 */
export function getRankerByVersion(version: string): RankerSnapshot | null {
    return registry.get(version) ?? null;
}

/**
 * Atomically & idempotently rolls back the active ranker version to a target version.
 * Enforces single ACTIVE status & checksum validation.
 */
export function rollbackRanker(targetVersion?: string): { success: boolean; activeVersion: string; previousVersion: string; auditId: string } {
    const currentActive = getActiveRanker();
    const rollbackTarget = targetVersion ?? currentActive.parentVersion ?? "ranker-v1.0.0";

    const targetSnap = registry.get(rollbackTarget);
    if (!targetSnap) {
        throw new Error(`Rollback target version '${rollbackTarget}' not found in registry.`);
    }

    if (targetSnap.status === "DEPRECATED") {
        throw new Error(`Cannot rollback to deprecated ranker version '${rollbackTarget}'.`);
    }

    // Verify target checksum
    const expectedChecksum = calculateRankerChecksum(targetSnap);
    if (targetSnap.checksum !== expectedChecksum) {
        throw new Error(`Checksum mismatch on target ranker '${rollbackTarget}'. Integrity check failed.`);
    }

    // Idempotent check — already active
    if (currentActive.rankerVersion === rollbackTarget) {
        return {
            success: true,
            activeVersion: rollbackTarget,
            previousVersion: currentActive.rankerVersion,
            auditId: `audit-noop-${Date.now()}`
        };
    }

    // Atomic mutation (Single ACTIVE invariant)
    const updatedCurrent: RankerSnapshot = Object.freeze({ ...currentActive, status: "INACTIVE", checksum: calculateRankerChecksum({ ...currentActive, status: "INACTIVE" }) });
    const updatedTarget: RankerSnapshot = Object.freeze({ ...targetSnap, status: "ACTIVE", checksum: calculateRankerChecksum({ ...targetSnap, status: "ACTIVE" }) });

    registry.set(currentActive.rankerVersion, updatedCurrent);
    registry.set(rollbackTarget, updatedTarget);

    const auditId = `audit-${Date.now()}-${createHash("sha256").update(`${currentActive.rankerVersion}:${rollbackTarget}`).digest("hex").slice(0, 8)}`;

    return {
        success: true,
        activeVersion: rollbackTarget,
        previousVersion: currentActive.rankerVersion,
        auditId,
    };
}
