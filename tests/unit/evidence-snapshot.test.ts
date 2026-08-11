import { describe, it, expect } from "vitest";
import { createEvidenceSnapshot, getEvidenceSnapshot, verifyEvidenceSnapshotChecksum, canonicalizeJson } from "@/lib/opportunity-engine/evidence-snapshot";

describe("EvidenceSnapshot Engine Unit Tests", () => {
    it("should produce deterministic canonical JSON regardless of key order", () => {
        const payloadA = { z: 1, a: "test", m: { b: 2, a: 3 } };
        const payloadB = { a: "test", m: { a: 3, b: 2 }, z: 1 };

        const strA = canonicalizeJson(payloadA);
        const strB = canonicalizeJson(payloadB);

        expect(strA).toEqual(strB);
    });

    it("should create immutable EvidenceSnapshot with valid checksum", () => {
        const siteId = "site-123";
        const metrics = { impressions: 1500, clicks: 120, position: 8.5 };

        const snapshot = createEvidenceSnapshot(siteId, metrics);

        expect(snapshot.evidenceSnapshotId).toMatch(/^snap-site-123-[a-f0-9]{12}$/);
        expect(snapshot.inputHash).toHaveLength(64); // SHA-256
        expect(verifyEvidenceSnapshotChecksum(snapshot)).toBe(true);

        const retrieved = getEvidenceSnapshot(snapshot.evidenceSnapshotId);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.checksum).toEqual(snapshot.checksum);
    });

    it("should return the exact same snapshot for identical input", () => {
        const siteId = "site-123";
        const metrics = { impressions: 1500, clicks: 120, position: 8.5 };

        const snap1 = createEvidenceSnapshot(siteId, metrics);
        const snap2 = createEvidenceSnapshot(siteId, metrics);

        expect(snap1.evidenceSnapshotId).toEqual(snap2.evidenceSnapshotId);
    });
});
