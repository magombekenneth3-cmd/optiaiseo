import { createHmac } from "crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { update, send, findUnique } = vi.hoisted(() => ({
  update: vi.fn(),
  send: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { seoFixProposal: { update, findUnique } } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send } }));

import { POST } from "@/app/api/seo-fix/deployment/route";

describe("SEO deployment webhook", () => {
  beforeEach(() => {
    process.env.DEPLOYMENT_WEBHOOK_SECRET = "test-secret";
    findUnique.mockReset().mockResolvedValue({ id: "proposal_1", mergeCommitSha: null, status: "MERGED" });
    update.mockReset().mockResolvedValue({ id: "proposal_1" });
    send.mockReset().mockResolvedValue({});
  });

  it("rejects an unsigned deployment claim", async () => {
    const response = await POST(new Request("http://localhost/api/seo-fix/deployment", {
      method: "POST", body: JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" }),
    }) as never);
    expect(response.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("records only a correctly signed deployment", async () => {
    const body = JSON.stringify({ proposalId: "proposal_1", deploymentUrl: "https://example.com" });
    const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
    const response = await POST(new Request("http://localhost/api/seo-fix/deployment", {
      method: "POST", body, headers: { "x-seo-signature": `sha256=${signature}` },
    }) as never);
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "proposal_1" } }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      name: "seo-fix/deployed",
      data: expect.objectContaining({ proposalId: "proposal_1" }),
    }));
  });
});
