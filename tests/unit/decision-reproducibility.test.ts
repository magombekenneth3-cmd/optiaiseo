import { describe, it, expect } from "vitest";
import { rankGrowthDecisions } from "@/lib/opportunity-engine/decision-ranker";
import { ConsolidatedOpportunity } from "@/lib/opportunity-engine/types";
import { createEvidenceSnapshot } from "@/lib/opportunity-engine/evidence-snapshot";

describe("Decision Traceability & Reconstruction Unit Tests (Gate 4)", () => {
    it("should generate reproducible decision outputs with full traceability metadata", () => {
        const siteId = "site-reproducibility-123";
        const metrics = { impressions: 3200, clicks: 140, position: 6.2 };
        const snapshot = createEvidenceSnapshot(siteId, metrics);

        const opp: ConsolidatedOpportunity & { evidenceSnapshotId?: string } = {
            url: "https://acme.com/seo-guide",
            keyword: "best seo software",
            primaryCategory: "QUICK_WIN",
            categories: ["QUICK_WIN", "STALE"],
            impressions: 3200,
            clicks: 140,
            position: 6.2,
            inboundInternalLinksCount: 1,
            signals: [],
            evidenceSnapshotId: snapshot.evidenceSnapshotId,
        };

        const decisions = rankGrowthDecisions(siteId, [opp]);

        expect(decisions).toHaveLength(1);
        const dec = decisions[0];

        // Traceability payload invariants
        expect(dec.traceability).toBeDefined();
        expect(dec.traceability.decisionId).toEqual(`dec:${siteId}:${encodeURIComponent(opp.url)}`);
        expect(dec.traceability.siteId).toEqual(siteId);
        expect(dec.traceability.rankerVersion).toEqual("ranker-v1.0.0");
        expect(dec.traceability.weightsVersion).toEqual("weights-v1.0.0");
        expect(dec.traceability.evidenceSnapshotId).toEqual(snapshot.evidenceSnapshotId);
        expect(dec.traceability.generatedAt).toBeDefined();

        // Reconstruction Invariant Test
        const reconstructedDecisions = rankGrowthDecisions(siteId, [opp]);
        expect(reconstructedDecisions[0].score.final).toEqual(dec.score.final);
        expect(reconstructedDecisions[0].action).toEqual(dec.action);
    });
});
