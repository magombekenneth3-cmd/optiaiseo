import { describe, it, expect } from "vitest";
import { createEvidenceSnapshot } from "@/lib/opportunity-engine/evidence-snapshot";
import { rankGrowthDecisions } from "@/lib/opportunity-engine/decision-ranker";
import { ConsolidatedOpportunity } from "@/lib/opportunity-engine/types";

describe("Decision Reconstruction Reproducibility Unit Tests", () => {
    it("should generate identical decision score.final for identical raw evidence snapshots", async () => {
        const siteId = "site-repro-1";
        const rawMetrics = { clicks: 150, impressions: 4500, position: 6.8 };

        const opp: ConsolidatedOpportunity = {
            url: "https://acme.com/pricing",
            keyword: "saas pricing calculator",
            primaryCategory: "QUICK_WIN",
            categories: ["QUICK_WIN"],
            impressions: 4500,
            clicks: 150,
            position: 6.8,
            inboundInternalLinksCount: 2,
            signals: [],
        };

        const snapshotA = await createEvidenceSnapshot(siteId, rawMetrics);
        const decisionsA = rankGrowthDecisions(siteId, [opp], new Map(), {
            rankerVersion: "ranker-v1.0.0",
            weightsVersion: "weights-v1.0.0",
            featureSetVersion: "gsc-lh-aeo-v1",
            evidenceSnapshotId: snapshotA.evidenceSnapshotId,
        });

        const snapshotB = await createEvidenceSnapshot(siteId, rawMetrics);
        const decisionsB = rankGrowthDecisions(siteId, [opp], new Map(), {
            rankerVersion: "ranker-v1.0.0",
            weightsVersion: "weights-v1.0.0",
            featureSetVersion: "gsc-lh-aeo-v1",
            evidenceSnapshotId: snapshotB.evidenceSnapshotId,
        });

        expect(decisionsA[0].score.final).toEqual(decisionsB[0].score.final);
        expect(decisionsA[0].traceability.evidenceSnapshotId).toEqual(decisionsB[0].traceability.evidenceSnapshotId);
    });
});
