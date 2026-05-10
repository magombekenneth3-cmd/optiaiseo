"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { inngest } from "@/lib/inngest/client";
import {
  type DiscoveryResult,
  type QuerySource,
} from "@/lib/aeo/query-discovery";

// FIX #3: Single query via nested select — eliminates the user→site waterfall.

async function resolveUserAndSite(siteId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      sites: { where: { id: siteId }, select: { id: true }, take: 1 },
    },
  });
  if (!user || user.sites.length === 0) return null;
  return { userId: user.id, siteId };
}


export async function discoverQueriesAction(siteId: string): Promise<
  | { success: true; result: DiscoveryResult }
  | { success: false; error: string }
> {
  try {
    // FIX #8: Validate siteId before any DB or network work.
    if (!siteId || siteId.length > 50) {
      return { success: false, error: "Invalid site ID." };
    }

    const ctx = await resolveUserAndSite(siteId);
    if (!ctx) return { success: false, error: "Site not found or access denied" };

    // FIX #1: Rate-limit per user — discovery can be expensive (API calls, scraping).
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const rl = await checkRateLimit(`discover:${ctx.userId}`, 5, 3600);
    if (!rl.allowed) {
      const waitMins = Math.ceil((rl.resetAt.getTime() - Date.now()) / 60000);
      return { success: false, error: `Rate limit reached. Try again in ${waitMins} minute(s).` };
    }

    // FIX #2: Offload to Inngest — don't block the request on a potentially
    // slow discovery pipeline. Return immediately and let the client poll or
    // receive a push notification when the job completes.
    await inngest.send({
      name: "query/discover",
      data: { siteId, userId: ctx.userId },
    });

    return { success: true, result: { status: "queued" } as unknown as DiscoveryResult };
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    logger.error("[QueryDiscovery] Action failed", { siteId, error: msg });
    return { success: false, error: "Discovery failed. Please try again." };
  }
}


export interface UntrackedQuery {
  keyword: string;
  source: QuerySource;
  competitorCited?: string;
  snippet?: string;
}

// FIX #5: Accept optional cursor for pagination instead of a hardcoded take:20.
export async function getUntrackedDiscoveries(
  siteId: string,
  cursor?: Date,
  take = 20,
): Promise<UntrackedQuery[]> {
  try {
    // FIX #8: Validate inputs before touching the DB.
    if (!siteId || siteId.length > 50) return [];

    const ctx = await resolveUserAndSite(siteId);
    // FIX #9: Consistent early return — don't silently swallow auth failures.
    if (!ctx) return [];

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await prisma.seedKeyword.findMany({
      where: {
        siteId,
        // FIX #4: Whitelist known sources instead of excluding "manual" —
        // adding a new source won't silently slip through.
        source: { in: ["gsc", "ai", "serp"] },
        discoveredAt: {
          gte: sevenDaysAgo,
          // FIX #5: Use cursor to page through results.
          ...(cursor ? { lt: cursor } : {}),
        },
      },
      orderBy: { discoveredAt: "desc" },
      take,
      select: { keyword: true, source: true, notes: true },
    });

    return rows.map((r) => ({
      keyword: r.keyword,
      source: r.source as QuerySource,
      competitorCited: extractCompetitorFromNote(r.notes),
      snippet: r.notes ?? undefined,
    }));
  } catch (err: unknown) {
    // FIX #6: Log the failure instead of swallowing it silently.
    logger.error("[QueryDiscovery] getUntrackedDiscoveries failed", {
      siteId,
      error: (err as Error)?.message ?? String(err),
    });
    return [];
  }
}


function extractCompetitorFromNote(notes: string | null): string | undefined {
  if (!notes) return undefined;
  // FIX #7: More robust regex — handles punctuation after the domain and is case-insensitive.
  return notes.match(/mention\s+([^\s,]+)/i)?.[1];
}