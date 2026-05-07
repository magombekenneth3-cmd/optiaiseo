import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { monthlyCreditsForTier } from "@/lib/credits";
import { redis } from "@/lib/redis";
import { jwtCacheKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_TIERS = ["FREE", "STARTER", "PRO", "AGENCY"] as const;
type Tier = (typeof VALID_TIERS)[number];

// Tier rank — higher = more powerful. Admin can only upgrade, not downgrade.
const TIER_RANK: Record<Tier, number> = {
  FREE:    0,
  STARTER: 1,
  PRO:     2,
  AGENCY:  3,
};

// Per-tier limits applied when admin assigns a plan
const TIER_LIMITS: Record<Tier, { monthlyAudits: number; credits: number }> = {
  FREE:    { monthlyAudits: 3,   credits: 50   },
  STARTER: { monthlyAudits: 10,  credits: 150  },
  PRO:     { monthlyAudits: 50,  credits: 500  },
  AGENCY:  { monthlyAudits: 500, credits: 2000 },
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  let tier: Tier;
  try {
    const body = await req.json();
    if (!VALID_TIERS.includes(body.tier)) {
      return NextResponse.json(
        { error: `Invalid tier. Must be one of: ${VALID_TIERS.join(", ")}` },
        { status: 400 }
      );
    }
    tier = body.tier as Tier;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, subscriptionTier: true, preferences: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const currentTier = ((existing.subscriptionTier ?? "FREE") as Tier);

  // ── Downgrade prevention ────────────────────────────────────────────────────
  if (TIER_RANK[tier] < TIER_RANK[currentTier]) {
    return NextResponse.json(
      {
        error: `Cannot downgrade from ${currentTier} to ${tier}. Downgrades must go through the billing cancellation flow.`,
        currentTier,
        requestedTier: tier,
      },
      { status: 400 }
    );
  }

  if (tier === currentTier) {
    return NextResponse.json(
      { error: `User is already on ${tier}.` },
      { status: 400 }
    );
  }

  const limits = TIER_LIMITS[tier];
  const credits = monthlyCreditsForTier(tier);

  const existingPrefs =
    existing.preferences !== null &&
    typeof existing.preferences === "object" &&
    !Array.isArray(existing.preferences)
      ? (existing.preferences as Record<string, unknown>)
      : {};

  const user = await prisma.user.update({
    where: { id },
    data: {
      subscriptionTier: tier,
      // Reset credits to new tier allowance immediately
      credits,
      trialEndsAt: null,
      preferences: {
        ...existingPrefs,
        // Bump session version so JWT cache is stale for this user
        sessionVersion: Date.now(),
        lastTierUpgrade: {
          from: currentTier,
          to: tier,
          at: new Date().toISOString(),
          by: "admin_manual",
        },
      },
    },
    select: {
      id: true,
      email: true,
      subscriptionTier: true,
      credits: true,
      trialEndsAt: true,
    },
  });

  // Update subscription record
  await prisma.subscription.upsert({
    where: { userId: id },
    create: {
      userId: id,
      status: tier === "FREE" ? "inactive" : "active",
    },
    update: {
      status: tier === "FREE" ? "inactive" : "active",
    },
  });

  // Invalidate JWT cache so session reflects new tier immediately
  if (existing.email) {
    await redis.del(jwtCacheKey(existing.email)).catch(() => {});
  }

  // Clear audit rate-limit key so new monthly quota takes effect now
  await redis.del(`audit-rate:${id}`).catch(() => {});

  logger.info("[Admin] Tier upgraded", {
    userId: id,
    from: currentTier,
    to: tier,
    creditsGranted: credits,
    monthlyAudits: limits.monthlyAudits,
  });

  return NextResponse.json({
    success: true,
    user,
    message: `Upgraded ${currentTier} → ${tier}. Credits: ${credits}. Monthly audits: ${limits.monthlyAudits}.`,
  });
}