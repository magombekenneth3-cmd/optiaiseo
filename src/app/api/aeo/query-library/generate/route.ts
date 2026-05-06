export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma                        from "@/lib/prisma";

async function ownedSite(siteId: string, email: string) {
  return prisma.site.findFirst({
    where:  { id: siteId, user: { email } },
    select: { id: true },
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { siteId } = body as { siteId?: string };
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  const site = await ownedSite(siteId, user.email);
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { inngest } = await import("@/lib/inngest/client");
  await inngest.send({ name: "aeo/query-library.init", data: { siteId } });

  return NextResponse.json({ queued: true });
}
