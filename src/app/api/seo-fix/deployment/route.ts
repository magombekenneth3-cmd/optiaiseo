import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";

function verifiedSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.DEPLOYMENT_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const received = signature.slice(7);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/** Trusted deploy systems call this only after the PR is live at deploymentUrl. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifiedSignature(raw, request.headers.get("x-seo-signature"))) {
    return NextResponse.json({ error: "Invalid deployment signature." }, { status: 401 });
  }
  let data: { proposalId?: string; deploymentUrl?: string; deploymentId?: string; commitSha?: string; status?: string; environment?: string };
  try { data = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!data.proposalId || !data.deploymentUrl || !data.commitSha) return NextResponse.json({ error: "proposalId, deploymentUrl and commitSha are required." }, { status: 400 });
  try { new URL(data.deploymentUrl); } catch { return NextResponse.json({ error: "Invalid deployment URL." }, { status: 400 }); }
  const proposal = await (prisma as any).seoFixProposal.findUnique({
    where: { id: data.proposalId },
    select: { id: true, mergeCommitSha: true, status: true },
  });
  if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  if (!proposal.mergeCommitSha) return NextResponse.json({ error: "Deployment cannot be confirmed before the GitHub merge commit is verified." }, { status: 409 });
  if (proposal.mergeCommitSha !== data.commitSha) return NextResponse.json({ error: "Deployment commit does not match the verified merge commit." }, { status: 409 });
  if (data.environment && data.environment !== "production") return NextResponse.json({ error: "Only production deployments can confirm a remediation." }, { status: 409 });
  if (data.status && !["READY", "SUCCESS", "DEPLOYED"].includes(data.status)) return NextResponse.json({ error: "Deployment is not ready." }, { status: 409 });
  await (prisma as any).seoFixProposal.update({
    where: { id: data.proposalId },
    data: {
      status: "DEPLOYED",
      deployedAt: new Date(),
      deploymentUrl: data.deploymentUrl,
      deploymentId: data.deploymentId ?? null,
      deploymentCommitSha: data.commitSha,
      deploymentStatus: "READY",
    },
  });
  await inngest.send({ name: "seo-fix/deployed", data: { proposalId: proposal.id, commitSha: data.commitSha, deploymentUrl: data.deploymentUrl } });
  return NextResponse.json({ ok: true });
}
