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
  let data: { proposalId?: string; deploymentUrl?: string };
  try { data = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!data.proposalId || !data.deploymentUrl) return NextResponse.json({ error: "proposalId and deploymentUrl are required." }, { status: 400 });
  try { new URL(data.deploymentUrl); } catch { return NextResponse.json({ error: "Invalid deployment URL." }, { status: 400 }); }
  const proposal = await (prisma as any).seoFixProposal.update({
    where: { id: data.proposalId },
    data: { status: "DEPLOYED", deployedAt: new Date(), deploymentUrl: data.deploymentUrl },
  });
  await inngest.send({ name: "seo-fix/deployed", data: { proposalId: proposal.id } });
  return NextResponse.json({ ok: true });
}
