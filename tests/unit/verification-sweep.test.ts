import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, update, updateMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
const { send, createFunction } = vi.hoisted(() => {
  const send = vi.fn();
  const createFunction = vi.fn((_config: any, handler: any) => {
    return { _handler: handler };
  });
  return { send, createFunction };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { seoFixProposal: { findMany, update, updateMany } },
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send, createFunction } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { computeDeploymentIdempotencyKey } from "@/lib/seo-audit/lifecycle";

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal_1",
    siteId: "site_1",
    diagnosticFindingId: "finding_1",
    findingFingerprint: "fp_abc",
    deploymentUrl: "https://example.com",
    deploymentCommitSha: "sha_abc",
    deploymentId: null,
    verificationCriteria: [],
    ...overrides,
  };
}

async function simulateSweep() {
  vi.resetModules();
  const mod = await import("@/lib/inngest/functions/verification-dispatch-sweep");
  const handler = createFunction.mock.calls[createFunction.mock.calls.length - 1]?.[1];
  if (!handler) throw new Error("Handler not captured from createFunction");
  const stepResults = new Map<string, unknown>();
  const step = {
    run: async (name: string, fn: () => Promise<unknown>) => {
      if (stepResults.has(name)) return stepResults.get(name);
      const result = await fn();
      stepResults.set(name, result);
      return result;
    },
  };
  return handler({ step });
}

describe("Verification Dispatch Sweep", () => {
  beforeEach(() => {
    findMany.mockReset();
    update.mockReset();
    updateMany.mockReset();
    send.mockReset();
    updateMany.mockResolvedValue({ count: 0 });
  });

  it("returns early when no undispatched proposals exist", async () => {
    findMany.mockResolvedValue([]);
    const result = await simulateSweep();
    expect(result).toEqual({ recovered: 0, failed: 0, skipped: 0, total: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("reclaims stale DISPATCHING records before scanning PENDING", async () => {
    findMany.mockResolvedValue([]);

    await simulateSweep();

    const reclaimCall = updateMany.mock.calls.find(
      (c: any) => c[0]?.where?.verificationStatus === "DISPATCHING",
    );
    expect(reclaimCall).toBeTruthy();
    expect(reclaimCall![0].data.verificationStatus).toBe("PENDING");
  });

  it("recovers an undispatched proposal and marks DISPATCHED", async () => {
    findMany.mockResolvedValue([makeProposal()]);
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    send.mockResolvedValue({});
    update.mockResolvedValue({});

    const result = await simulateSweep();
    expect(result.recovered).toBe(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "seo/fix.deployed",
        data: expect.objectContaining({
          findingDbId: "finding_1",
          deploymentRevision: "sha_abc",
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "proposal_1" },
      data: { verificationStatus: "DISPATCHED" },
    });
  });

  it("skips proposal when another process already claimed it", async () => {
    findMany.mockResolvedValue([makeProposal()]);
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await simulateSweep();
    expect(result.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves record as DISPATCHING on send failure (reclaim will reset it)", async () => {
    findMany.mockResolvedValue([makeProposal()]);
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    send.mockRejectedValue(new Error("Inngest unavailable"));

    const result = await simulateSweep();
    expect(result.failed).toBe(1);
    const dispatchedUpdate = update.mock.calls.find(
      (c: any) => c[0]?.data?.verificationStatus === "DISPATCHED",
    );
    expect(dispatchedUpdate).toBeUndefined();
  });

  it("produces deterministic idempotency key matching the webhook", async () => {
    findMany.mockResolvedValue([makeProposal()]);
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    send.mockResolvedValue({});
    update.mockResolvedValue({});

    await simulateSweep();
    const sentData = send.mock.calls[0][0].data;
    const expectedKey = computeDeploymentIdempotencyKey("site_1", "finding_1", "sha_abc");
    expect(sentData.idempotencyKey).toBe(expectedKey);
  });

  it("handles multiple proposals with mixed outcomes", async () => {
    findMany.mockResolvedValue([
      makeProposal({ id: "p1" }),
      makeProposal({ id: "p2" }),
      makeProposal({ id: "p3" }),
    ]);
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("fail"));
    update.mockResolvedValue({});

    const result = await simulateSweep();
    expect(result.total).toBe(3);
    expect(result.recovered).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("skips proposals with null diagnosticFindingId", async () => {
    findMany.mockResolvedValue([makeProposal({ diagnosticFindingId: null })]);
    updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await simulateSweep();
    expect(result.total).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses deploymentId as fallback when commitSha is null", async () => {
    findMany.mockResolvedValue([makeProposal({ deploymentCommitSha: null, deploymentId: "deploy_xyz" })]);
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    send.mockResolvedValue({});
    update.mockResolvedValue({});

    await simulateSweep();
    const sentData = send.mock.calls[0][0].data;
    expect(sentData.deploymentRevision).toBe("deploy_xyz");
  });

  it("crash after claim (DISPATCHING) but before send is recoverable on next sweep", async () => {
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    findMany.mockResolvedValueOnce([]);

    const result = await simulateSweep();

    const reclaimCall = updateMany.mock.calls.find(
      (c: any) =>
        c[0]?.where?.verificationStatus === "DISPATCHING" &&
        c[0]?.data?.verificationStatus === "PENDING",
    );
    expect(reclaimCall).toBeTruthy();
    expect(result.total).toBe(0);
  });

  it("crash after send but before DISPATCHED update — duplicate send is idempotent", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findMany.mockResolvedValue([makeProposal()]);
    updateMany
      .mockResolvedValueOnce({ count: 1 });
    send.mockResolvedValue({});
    update.mockResolvedValue({});

    const result = await simulateSweep();
    expect(result.recovered).toBe(1);

    const sentData = send.mock.calls[0][0].data;
    const expectedKey = computeDeploymentIdempotencyKey("site_1", "finding_1", "sha_abc");
    expect(sentData.idempotencyKey).toBe(expectedKey);
  });
});
