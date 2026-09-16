import { createHmac } from "crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { update, send } = vi.hoisted(() => ({ update: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { seoFixProposal: { update } } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send } }));

import { POST } from "@/app/api/seo-fix/deployment/route";

describe("SEO deployment webhook", () => {
  beforeEach(() => {
    process.env.DEPLOYMENT_WEBHOOK_SECRET = "test-secret";
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
    expect(send).toHaveBeenCalledWith({ name: "seo-fix/deployed", data: { proposalId: "proposal_1" } });
  });
});
