export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = auth.slice(7).trim();

  const user = await prisma.user.findFirst({
    where:  { wpApiKey: token },
    select: {
      email: true,
      sites: { select: { domain: true }, take: 1 },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  return NextResponse.json({
    ok:     true,
    email:  user.email,
    domain: user.sites[0]?.domain ?? null,
  });
}
