import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { computeDeploymentIdempotencyKey } from "@/lib/seo-audit/lifecycle";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

function verifiedSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.DEPLOYMENT_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const received = signature.slice(7);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifiedSignature(raw, request.headers.get("x-seo-signature"))) {
    return NextResponse.json({ error: "Invalid deployment signature." }, { status: 401 });
  }
  let data: { proposalId?: string; deploymentUrl?: string; deploymentId?: string; commitSha?: string; status?: string; environment?: string };
  try { data = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!data.proposalId || !data.deploymentUrl) return NextResponse.json({ error: "proposalId and deploymentUrl are required." }, { status: 400 });
  try { new URL(data.deploymentUrl); } catch { return NextResponse.json({ error: "Invalid deployment URL." }, { status: 400 }); }
  const proposal = await prisma.seoFixProposal.findUnique({
    where: { id: data.proposalId },
    select: { id: true, siteId: true, mergeCommitSha: true, status: true, diagnosticFindingId: true, findingFingerprint: true, verificationCriteria: true, verificationStatus: true },
  });
  if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  if (proposal.mergeCommitSha && data.commitSha && proposal.mergeCommitSha !== data.commitSha) return NextResponse.json({ error: "Deployment commit does not match the verified merge commit." }, { status: 409 });
  if (data.environment && data.environment !== "production") return NextResponse.json({ error: "Only production deployments can confirm a remediation." }, { status: 409 });
  if (data.status && !["READY", "SUCCESS", "DEPLOYED"].includes(data.status)) return NextResponse.json({ error: "Deployment is not ready." }, { status: 409 });

  if (proposal.status === "DEPLOYED" || proposal.status === "MEASURED") {
    if (proposal.verificationStatus === "DISPATCHED" || !proposal.diagnosticFindingId) {
      return NextResponse.json({ ok: true, idempotent: true });
    }
  }

  const deploymentRevision = data.commitSha ?? data.deploymentId ?? proposal.id;

  if (proposal.status !== "DEPLOYED" && proposal.status !== "MEASURED") {
    await prisma.seoFixProposal.update({
      where: { id: data.proposalId },
      data: {
        status: "DEPLOYED",
        deployedAt: new Date(),
        deploymentUrl: data.deploymentUrl,
        deploymentId: data.deploymentId ?? null,
        deploymentCommitSha: data.commitSha,
        deploymentStatus: "READY",
        verificationStatus: "PENDING",
      },
    });
  }

  const events: Array<{ name: string; data: Record<string, unknown> }> = [
    { name: "seo-fix/deployed", data: { proposalId: proposal.id, commitSha: data.commitSha, deploymentUrl: data.deploymentUrl } },
  ];

  if (proposal.diagnosticFindingId) {
    events.push({
      name: "seo/fix.deployed",
      data: {
        siteId: proposal.siteId,
        findingDbId: proposal.diagnosticFindingId,
        findingFingerprint: proposal.findingFingerprint,
        url: data.deploymentUrl,
        deploymentRevision,
        proposalId: proposal.id,
        verificationCriteria: proposal.verificationCriteria ?? [],
        idempotencyKey: computeDeploymentIdempotencyKey(
          proposal.siteId,
          proposal.diagnosticFindingId,
          deploymentRevision,
        ),
      },
    });
  }

  try {
    await inngest.send(events);
    if (proposal.diagnosticFindingId) {
      await prisma.seoFixProposal.update({
        where: { id: data.proposalId },
        data: { verificationStatus: "DISPATCHED" },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (sendErr) {
    logger.error("[Deployment] Event dispatch failed after DB commit — sweep cron will recover", {
      proposalId: proposal.id,
      error: (sendErr as Error)?.message,
    });
    return NextResponse.json(
      { error: "Deployment recorded but event dispatch failed. Will be recovered by sweep." },
      { status: 502 },
    );
  }
}
