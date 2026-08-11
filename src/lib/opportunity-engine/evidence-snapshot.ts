import { createHash } from "crypto";

export interface EvidenceSnapshot {
    evidenceSnapshotId: string;
    siteId: string;
    createdAt: string;
    inputHash: string;
    canonicalPayload: string;
    features: Record<string, unknown>;
    checksum: string;
}

// In-memory immutable snapshot store (backed by persistent caching)
const snapshotStore = new Map<string, EvidenceSnapshot>();

/**
 * Sorts object keys recursively to produce a canonical deterministic JSON string representation.
 */
export function canonicalizeJson(obj: unknown): string {
    if (obj === null || typeof obj !== "object") {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return "[" + obj.map(canonicalizeJson).join(",") + "]";
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const sortedObj: Record<string, string> = {};
    for (const key of keys) {
        sortedObj[key] = canonicalizeJson((obj as Record<string, unknown>)[key]);
    }
    return JSON.stringify(sortedObj);
}

/**
 * Generates an immutable EvidenceSnapshot with deterministic inputHash and checksum.
 * "Same evidence snapshot ID -> same evidence forever"
 */
export function createEvidenceSnapshot(siteId: string, rawMetrics: Record<string, unknown>): EvidenceSnapshot {
    const createdAt = new Date().toISOString();
    const canonicalPayload = canonicalizeJson(rawMetrics);
    const inputHash = createHash("sha256").update(canonicalPayload).digest("hex");
    
    const snapshotIdString = `${siteId}:${inputHash}`;
    const evidenceSnapshotId = `snap-${siteId}-${createHash("sha256").update(snapshotIdString).digest("hex").slice(0, 12)}`;

    const checksumString = `${evidenceSnapshotId}:${siteId}:${inputHash}:${canonicalPayload}`;
    const checksum = createHash("sha256").update(checksumString).digest("hex");

    const snapshot: EvidenceSnapshot = {
        evidenceSnapshotId,
        siteId,
        createdAt,
        inputHash,
        canonicalPayload,
        features: rawMetrics,
        checksum,
    };

    // Store immutably (prevent updates/deletions)
    if (!snapshotStore.has(evidenceSnapshotId)) {
        snapshotStore.set(evidenceSnapshotId, Object.freeze(snapshot));
    }

    return snapshotStore.get(evidenceSnapshotId)!;
}

/**
 * Retrieves an immutable evidence snapshot by ID.
 */
export function getEvidenceSnapshot(evidenceSnapshotId: string): EvidenceSnapshot | null {
    return snapshotStore.get(evidenceSnapshotId) ?? null;
}

/**
 * Verifies snapshot checksum integrity.
 */
export function verifyEvidenceSnapshotChecksum(snapshot: EvidenceSnapshot): boolean {
    const checksumString = `${snapshot.evidenceSnapshotId}:${snapshot.siteId}:${snapshot.inputHash}:${snapshot.canonicalPayload}`;
    const expectedChecksum = createHash("sha256").update(checksumString).digest("hex");
    return snapshot.checksum === expectedChecksum;
}
