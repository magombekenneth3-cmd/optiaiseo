import { createHmac } from "crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { update, send, findUnique } = vi.hoisted(() => ({
  update: vi.fn(),
  send: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { seoFixProposal: { update, findUnique } } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { POST } from "@/app/api/seo-fix/deployment/route";

function signBody(body: string): string {
  return createHmac("sha256", "test-secret").update(body).digest("hex");
}

function makeRequest(body: string, signature?: string) {
  const headers: Record<string, string> = {};
  if (signature) headers["x-seo-signature"] = `sha256=${signature}`;
  return new Request("http://localhost/api/seo-fix/deployment", {
    method: "POST", body, headers,
  }) as never;
}

describe("SEO deployment webhook", () => {
  beforeEach(() => {
    process.env.DEPLOYMENT_WEBHOOK_SECRET = "test-secret";
    findUnique.mockReset().mockResolvedValue({
      id: "proposal_1",
      siteId: "site_1",
      mergeCommitSha: null,
      status: "MERGED",
      diagnosticFindingId: null,
      findingFingerprint: null,
      verificationCriteria: null,
      verificationStatus: "PENDING",
    });
    update.mockReset().mockResolvedValue({ id: "proposal_1" });
    send.mockReset().mockResolvedValue({});
  });

  it("rejects an unsigned deployment claim", async () => {
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    const response = await POST(makeRequest(body));
    expect(response.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("records a correctly signed deployment and dispatches events", async () => {
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    const response = await POST(makeRequest(body, signBody(body)));
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "proposal_1" } }));
    expect(send).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "seo-fix/deployed",
          data: expect.objectContaining({ proposalId: "proposal_1" }),
        }),
      ]),
    );
  });

  it("does not emit seo/fix.deployed when no diagnosticFindingId", async () => {
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    await POST(makeRequest(body, signBody(body)));
    const sentEvents = send.mock.calls[0][0];
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].name).toBe("seo-fix/deployed");
  });

  it("emits seo/fix.deployed with finding identity when diagnosticFindingId exists", async () => {
    findUnique.mockResolvedValue({
      id: "proposal_1",
      siteId: "site_1",
      mergeCommitSha: null,
      status: "MERGED",
      diagnosticFindingId: "finding_1",
      findingFingerprint: "fp_abc",
      verificationCriteria: [{ type: "HTTP_STATUS", expected: 200 }],
      verificationStatus: "PENDING",
    });
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com", commitSha: "abc123" });
    await POST(makeRequest(body, signBody(body)));
    const sentEvents = send.mock.calls[0][0];
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents[1].name).toBe("seo/fix.deployed");
    expect(sentEvents[1].data.findingDbId).toBe("finding_1");
    expect(sentEvents[1].data.findingFingerprint).toBe("fp_abc");
    expect(sentEvents[1].data.deploymentRevision).toBe("abc123");
    expect(sentEvents[1].data.idempotencyKey).toMatch(/^[a-f0-9]{24}$/);
  });

  it("marks verificationStatus=DISPATCHED after successful send", async () => {
    findUnique.mockResolvedValue({
      id: "proposal_1",
      siteId: "site_1",
      mergeCommitSha: null,
      status: "MERGED",
      diagnosticFindingId: "finding_1",
      findingFingerprint: "fp_abc",
      verificationCriteria: [],
      verificationStatus: "PENDING",
    });
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    await POST(makeRequest(body, signBody(body)));
    const dispatchedCall = update.mock.calls.find(
      (c: any) => c[0]?.data?.verificationStatus === "DISPATCHED",
    );
    expect(dispatchedCall).toBeTruthy();
  });

  it("returns 502 when inngest.send fails after DB commit", async () => {
    send.mockRejectedValue(new Error("Inngest unavailable"));
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    const response = await POST(makeRequest(body, signBody(body)));
    expect(response.status).toBe(502);
    expect(update).toHaveBeenCalled();
  });

  it("idempotent path skips when already DISPATCHED", async () => {
    findUnique.mockResolvedValue({
      id: "proposal_1",
      siteId: "site_1",
      mergeCommitSha: null,
      status: "DEPLOYED",
      diagnosticFindingId: "finding_1",
      findingFingerprint: "fp_abc",
      verificationCriteria: [],
      verificationStatus: "DISPATCHED",
    });
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    const response = await POST(makeRequest(body, signBody(body)));
    const json = await response.json();
    expect(json.idempotent).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("idempotent DEPLOYED + PENDING re-dispatches (recovery path)", async () => {
    findUnique.mockResolvedValue({
      id: "proposal_1",
      siteId: "site_1",
      mergeCommitSha: null,
      status: "DEPLOYED",
      diagnosticFindingId: "finding_1",
      findingFingerprint: "fp_abc",
      verificationCriteria: [],
      verificationStatus: "PENDING",
    });
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    const response = await POST(makeRequest(body, signBody(body)));
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalled();
  });

  it("rejects non-production environment", async () => {
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com", environment: "staging" });
    const response = await POST(makeRequest(body, signBody(body)));
    expect(response.status).toBe(409);
  });

  it("rejects mismatched commit SHA", async () => {
    findUnique.mockResolvedValue({
      id: "proposal_1",
      siteId: "site_1",
      mergeCommitSha: "expected_sha",
      status: "MERGED",
      diagnosticFindingId: null,
      findingFingerprint: null,
      verificationCriteria: null,
      verificationStatus: "PENDING",
    });
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com", commitSha: "wrong_sha" });
    const response = await POST(makeRequest(body, signBody(body)));
    expect(response.status).toBe(409);
  });

  it("no diagnosticFindingId skips verificationStatus update", async () => {
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    await POST(makeRequest(body, signBody(body)));
    const dispatchedCall = update.mock.calls.find(
      (c: any) => c[0]?.data?.verificationStatus === "DISPATCHED",
    );
    expect(dispatchedCall).toBeUndefined();
  });
});
