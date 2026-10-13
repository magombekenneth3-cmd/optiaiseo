import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGscEvidenceResult } from "@/lib/opportunity-engine/evidence";
import { detectRawOpportunities } from "@/lib/opportunity-engine/detector";
import { consolidateOpportunities } from "@/lib/opportunity-engine/deduplicator";
import { buildOpportunityIntelligence } from "@/lib/opportunity-engine/serp-intelligence";
import { rankGrowthDecisions } from "@/lib/opportunity-engine/decision-ranker";
import { savePersistedDecisions } from "@/lib/growth/decision-persistence";
import { acquireSyncLock, releaseSyncLock } from "@/lib/growth/decision-lock";
import { runGrowthDecisionPipeline } from "@/lib/opportunity-engine";

vi.mock("@/lib/opportunity-engine/evidence", () => ({
  fetchGscEvidenceResult: vi.fn(),
}));

vi.mock("@/lib/opportunity-engine/detector", () => ({
  detectRawOpportunities: vi.fn(),
}));

vi.mock("@/lib/opportunity-engine/deduplicator", () => ({
  consolidateOpportunities: vi.fn(),
}));

vi.mock("@/lib/opportunity-engine/serp-intelligence", () => ({
  buildOpportunityIntelligence: vi.fn(),
}));

vi.mock("@/lib/opportunity-engine/decision-ranker", () => ({
  rankGrowthDecisions: vi.fn(),
}));

vi.mock("@/lib/growth/decision-persistence", () => ({
  savePersistedDecisions: vi.fn(),
}));

vi.mock("@/lib/growth/decision-lock", () => ({
  acquireSyncLock: vi.fn(),
  releaseSyncLock: vi.fn(),
}));

vi.mock("@/lib/opportunity-engine/findings-to-opportunities", () => ({
  generateOpportunitiesFromFindings: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("growth pipeline GSC evidence safety gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(acquireSyncLock).mockResolvedValue(true);
    vi.mocked(releaseSyncLock).mockResolvedValue(undefined);
    vi.mocked(detectRawOpportunities).mockResolvedValue([]);
    vi.mocked(consolidateOpportunities).mockReturnValue([]);
    vi.mocked(buildOpportunityIntelligence).mockResolvedValue(new Map());
    vi.mocked(rankGrowthDecisions).mockReturnValue([]);
    vi.mocked(savePersistedDecisions).mockResolvedValue(undefined);
  });

  it("preserves existing decisions and reports failure when GSC is disconnected", async () => {
    vi.mocked(fetchGscEvidenceResult).mockResolvedValue({
      status: "NOT_CONNECTED",
      data: null,
      source: "NONE",
      observedAt: null,
      dateRange: null,
    });

    const result = await runGrowthDecisionPipeline("site-1");

    expect(result).toEqual({ success: false, count: 0, status: "GSC_NOT_CONNECTED" });
    expect(detectRawOpportunities).not.toHaveBeenCalled();
    expect(savePersistedDecisions).not.toHaveBeenCalled();
    expect(releaseSyncLock).toHaveBeenCalledWith("site-1");
  });


  it("reports FAILED when durable decision persistence throws", async () => {
    vi.mocked(fetchGscEvidenceResult).mockResolvedValue({
      status: "NO_DATA",
      data: [],
      source: "LIVE_GSC",
      observedAt: "2026-10-13T18:00:00.000Z",
      dateRange: { from: "2026-07-12", to: "2026-10-10" },
    });
    vi.mocked(savePersistedDecisions).mockRejectedValue(new Error("database write failed"));

    const result = await runGrowthDecisionPipeline("site-1");

    expect(result).toEqual({ success: false, count: 0, status: "FAILED" });
    expect(savePersistedDecisions).toHaveBeenCalledWith("site-1", []);
  });

  it("continues when GSC authoritatively returns no rows", async () => {
    vi.mocked(fetchGscEvidenceResult).mockResolvedValue({
      status: "NO_DATA",
      data: [],
      source: "LIVE_GSC",
      observedAt: "2026-10-13T18:00:00.000Z",
      dateRange: { from: "2026-07-12", to: "2026-10-10" },
    });

    const result = await runGrowthDecisionPipeline("site-1");

    expect(result).toEqual({ success: true, count: 0, status: "COMPLETED" });
    expect(detectRawOpportunities).toHaveBeenCalledWith("site-1", []);
    expect(savePersistedDecisions).toHaveBeenCalledWith("site-1", []);
  });
});
