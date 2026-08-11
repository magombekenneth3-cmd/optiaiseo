import { describe, it, expect } from "vitest";
import {
    canonicalizeJson,
    createEvidenceSnapshot,
    getEvidenceSnapshot,
    verifyEvidenceSnapshotChecksum,
} from "@/lib/opportunity-engine/evidence-snapshot";

describe("EvidenceSnapshot Engine Unit Tests", () => {
    it("canonicalizeJson should recursively sort object keys deterministically", () => {
        const objA = { z: 1, a: 2, m: { y: "test", b: "hello" } };
        const objB = { a: 2, m: { b: "hello", y: "test" }, z: 1 };

        const strA = canonicalizeJson(objA);
        const strB = canonicalizeJson(objB);

        expect(strA).toEqual(strB);
        expect(strA).toEqual('{"a":2,"m":{"b":"hello","y":"test"},"z":1}');
    });

    it("createEvidenceSnapshot should generate immutable snapshot with valid checksum", async () => {
        const siteId = "site-test-123";
        const rawMetrics = { clicks: 100, impressions: 2000, position: 7.4 };

        const snap1 = await createEvidenceSnapshot(siteId, rawMetrics);
        expect(snap1.evidenceSnapshotId).toMatch(/^ev_[a-f0-9]{16}$/);
        expect(snap1.inputHash).toHaveLength(64);
        expect(verifyEvidenceSnapshotChecksum(snap1)).toBe(true);

        const fetched = await getEvidenceSnapshot(snap1.evidenceSnapshotId);
        expect(fetched?.checksum).toEqual(snap1.checksum);
    });

    it("same raw metrics input should return exact same evidenceSnapshotId (idempotent inputHash)", async () => {
        const siteId = "site-test-123";
        const rawMetrics1 = { clicks: 50, position: 3.2 };
        const rawMetrics2 = { position: 3.2, clicks: 50 }; // different key order

        const snap1 = await createEvidenceSnapshot(siteId, rawMetrics1);
        const snap2 = await createEvidenceSnapshot(siteId, rawMetrics2);

        expect(snap1.evidenceSnapshotId).toEqual(snap2.evidenceSnapshotId);
    });
});
