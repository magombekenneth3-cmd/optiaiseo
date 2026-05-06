import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { randomBytes } from "crypto";

// GET /api/sites/[siteId]/share-token — returns or generates the share token
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
    where: { id: siteId, userId: dbUser!.id },
    select: { id: true, domain: true, shareToken: true },
  });
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  // Generate token if not present
  let token = site.shareToken;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    await prisma.site.update({
      where: { id: siteId },
      data:  { shareToken: token },
    });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online";
  return NextResponse.json({ token, url: `${baseUrl}/client/${token}` });
}

// DELETE /api/sites/[siteId]/share-token — revokes the token
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params;
  const user = await getAuthUser(req);
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbUser2 = await prisma.user.findUnique({ where: { email: user!.email } });
  if (!dbUser2) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const site = await prisma.site.findFirst({ where: { id: siteId, userId: dbUser2!.id } });
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  await prisma.site.update({ where: { id: siteId }, data: { shareToken: null } });
  return NextResponse.json({ revoked: true });
}
