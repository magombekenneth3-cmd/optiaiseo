import { getAuthUser } from "@/lib/auth/get-auth-user";
import { CREDIT_COSTS, ACTION_LABELS } from "@/lib/credits/constants";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const user = await getAuthUser(req as any);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") as keyof typeof CREDIT_COSTS | null;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true, creditsLockedAt: true },
  });

  const cost = action ? (CREDIT_COSTS[action] ?? 0) : 0;
  const remaining = dbUser?.credits ?? 0;
  const locked = !!dbUser?.creditsLockedAt;

  return NextResponse.json({
    remaining,
    cost,
    canAfford: !locked && remaining >= cost,
    locked,
    actionLabel: action ? ACTION_LABELS[action] : null,
  });
}
