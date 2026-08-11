import { describe, it, expect } from "vitest";
import { createEvidenceSnapshot, getEvidenceSnapshot, verifyEvidenceSnapshotChecksum } from "@/lib/opportunity-engine/evidence-snapshot";

describe("Durable EvidenceSnapshot Unit Tests (Phase A)", () => {
    it("should produce deterministic evidenceSnapshotId and checksum for identical rawMetrics", async () => {
        const siteId = "site-durable-1";
        const metricsA = { clicks: 120, impressions: 3000, position: 5.2 };
        const metricsB = { position: 5.2, impressions: 3000, clicks: 120 }; // different property insertion order

        const snapA = await createEvidenceSnapshot(siteId, metricsA);
        const snapB = await createEvidenceSnapshot(siteId, metricsB);

        expect(snapA.evidenceSnapshotId).toEqual(snapB.evidenceSnapshotId);
        expect(snapA.checksum).toEqual(snapB.checksum);
        expect(verifyEvidenceSnapshotChecksum(snapA)).toBe(true);
    });

    it("should retrieve immutable snapshot by ID", async () => {
        const siteId = "site-durable-2";
        const metrics = { clicks: 450, impressions: 9000, position: 2.1 };

        const created = await createEvidenceSnapshot(siteId, metrics);
        const fetched = await getEvidenceSnapshot(created.evidenceSnapshotId);

        expect(fetched).not.toBeNull();
        expect(fetched?.inputHash).toEqual(created.inputHash);
        expect(fetched?.checksum).toEqual(created.checksum);
    });
});
