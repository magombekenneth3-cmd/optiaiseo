export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/stripe/plans";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { subscriptionTier: true },
  });

  if (!hasFeature(dbUser?.subscriptionTier ?? "FREE", "backlinks")) {
    return NextResponse.json(
      { error: "Backlink monitoring requires a Pro plan." },
      { status: 403 },
    );
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId, userId: user.id },
    select: { domain: true },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const toxicLinks = await prisma.backlinkDetail.findMany({
    where: { siteId, isToxic: true },
    select: { srcDomain: true },
    orderBy: { srcDomain: "asc" },
  });

  const uniqueDomains = [...new Set(toxicLinks.map((l) => l.srcDomain.toLowerCase()))];

  const lines = [
    `# Disavow file for ${site.domain}`,
    `# Generated ${new Date().toISOString()}`,
    `# ${uniqueDomains.length} toxic domain(s) detected by OptiAISEO`,
    `# Upload this file at https://search.google.com/search-console/disavow-links`,
    "",
    ...uniqueDomains.map((d) => `domain:${d}`),
  ];

  const filename = `disavow-${site.domain}-${new Date().toISOString().slice(0, 10)}.txt`;

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
