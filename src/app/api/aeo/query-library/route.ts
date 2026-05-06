export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { logger }                    from "@/lib/logger";
import prisma                        from "@/lib/prisma";
import { getQueryLibrarySummary }    from "@/lib/aeo/query-library";

const VALID_INTENTS = new Set([
  "informational", "commercial", "comparison", "problem", "navigational",
]);

async function ownedSite(siteId: string, email: string) {
  return prisma.site.findFirst({
    where:  { id: siteId, user: { email } },
    select: { id: true },
  });
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  const site = await ownedSite(siteId, user.email);
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const summary = await getQueryLibrarySummary(siteId);
    return NextResponse.json(summary);
  } catch (err: unknown) {
    logger.error("[QueryLibraryAPI] GET failed", { error: (err as Error)?.message });
    return NextResponse.json({ error: "Failed to load query library" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { siteId, query, intent = "informational", source = "manual" } = body as {
    siteId?: string;
    query?:  string;
    intent?: string;
    source?: string;
  };

  if (!siteId || !query?.trim()) {
    return NextResponse.json(
      { error: "siteId and query are required" },
      { status: 400 }
    );
  }

  if (!VALID_INTENTS.has(intent)) {
    return NextResponse.json(
      { error: `Invalid intent. Use: ${[...VALID_INTENTS].join(", ")}` },
      { status: 400 }
    );
  }

  const site = await ownedSite(siteId, user.email);
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing = await prisma.trackedQuery.findFirst({
    where:  { siteId, queryText: query.trim() },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "This query is already in your library" },
      { status: 409 }
    );
  }

  try {
    const created = await prisma.trackedQuery.create({
      data: {
        siteId,
        queryText: query.trim(),
        intent,
        source,
        isActive: true,
      },
      select: { id: true, queryText: true, intent: true, createdAt: true },
    });

    return NextResponse.json({ query: created }, { status: 201 });
  } catch (err: unknown) {
    logger.error("[QueryLibraryAPI] POST failed", { error: (err as Error)?.message });
    return NextResponse.json({ error: "Failed to add query" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { queryId, pause = false } = body as { queryId?: string; pause?: boolean };

  if (!queryId) {
    return NextResponse.json({ error: "queryId required" }, { status: 400 });
  }

  const tq = await prisma.trackedQuery.findUnique({
    where:  { id: queryId },
    select: { site: { select: { user: { select: { email: true } } } } },
  });

  if (!tq || tq.site.user.email !== user.email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (pause) {
    await prisma.trackedQuery.update({
      where: { id: queryId },
      data:  { isActive: false },
    });
  } else {
    await prisma.trackedQuery.delete({ where: { id: queryId } });
  }

  return NextResponse.json({ success: true });
}
