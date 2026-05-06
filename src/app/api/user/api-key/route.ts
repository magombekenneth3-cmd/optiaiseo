export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { randomBytes }               from "crypto";
import prisma                        from "@/lib/prisma";

export async function GET(req: import('next/server').NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where:  { email: user!.email },
    select: { wpApiKey: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key = dbUser?.wpApiKey;
  return NextResponse.json({
    hasKey: !!key,
    maskedKey: key ? `${key.slice(0, 14)}${"•".repeat(key.length - 18)}${key.slice(-4)}` : null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where:  { email: user!.email },
    select: { id: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prefix  = user!.id.slice(-6);
  const random  = randomBytes(12).toString("hex");
  const wpApiKey = `oaiseo_${prefix}_${random}`;

  await prisma.user.update({
    where: { id: user!.id },
    data:  { wpApiKey },
  });

  return NextResponse.json(
    { wpApiKey, createdAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: import('next/server').NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.update({
    where: { email: user!.email },
    data:  { wpApiKey: null },
  });

  return NextResponse.json({ revoked: true });
}
