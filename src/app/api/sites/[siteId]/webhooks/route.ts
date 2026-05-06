import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { isSafeUrl } from "@/lib/security/safe-url";

// POST /api/sites/[siteId]/webhooks — save Slack & Zapier URLs
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params;
  const user = await getAuthUser(req);
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dbUser = await prisma.user.findUnique({ where: { email: user!.email } });
  if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = await req.json() as { slackWebhookUrl?: string; zapierWebhookUrl?: string };

  for (const key of ["slackWebhookUrl", "zapierWebhookUrl"] as const) {
    const val = body[key];
    if (val && val.trim()) {
      const guard = isSafeUrl(val.trim());
      if (!guard.ok) {
        return NextResponse.json({ error: `${key}: ${guard.error}` }, { status: 422 });
      }
    }
  }

  const site = await prisma.site.findFirst({ where: { id: siteId, userId: user!.id } });
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  await prisma.site.update({
    where: { id: siteId },
    data: {
      slackWebhookUrl:  body.slackWebhookUrl?.trim() || null,
      zapierWebhookUrl: body.zapierWebhookUrl?.trim() || null,
    },
  });

  return NextResponse.json({ saved: true });
}

// GET /api/sites/[siteId]/webhooks — return current webhook URLs (masked)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params;
  const user = await getAuthUser(req);
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dbUser = await prisma.user.findUnique({ where: { email: user!.email } });
  if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const site = await prisma.site.findFirst({
    where:  { id: siteId, userId: user!.id },
    select: { slackWebhookUrl: true, zapierWebhookUrl: true },
  });
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  // Mask URLs — just expose whether they're set and last 8 chars
  function mask(url: string | null) {
    if (!url) return null;
    try { const u = new URL(url); return `${u.hostname}/…${url.slice(-8)}`; }
    catch { return "***"; }
  }

  return NextResponse.json({
    slackWebhookUrl:  mask(site.slackWebhookUrl),
    zapierWebhookUrl: mask(site.zapierWebhookUrl),
    slackConfigured:  !!site.slackWebhookUrl,
    zapierConfigured: !!site.zapierWebhookUrl,
  });
}
