import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifyUnsubToken } from "@/lib/unsub-token";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse("Missing token", { status: 400 });
  }

  const userId = verifyUnsubToken(token);
  if (!userId) {
    logger.warn("[Unsubscribe] Invalid or tampered token", { token: token.slice(0, 20) });
    return new NextResponse("Invalid unsubscribe link", { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { preferences: true },
    });
    if (!user) return new NextResponse("Invalid unsubscribe link", { status: 400 });

    await prisma.user.update({
      where: { id: userId },
      data: {
        preferences: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(user.preferences as Record<string, any> ?? {}),
          unsubscribed:   true,
          unsubscribedAt: new Date().toISOString(),
        },
      },
    });

    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="background:#0d1117;color:#9ca3af;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">
  <div>
    <h1 style="color:#e5e7eb;font-size:24px;margin-bottom:12px;">You&#39;ve been unsubscribed</h1>
    <p>You won&#39;t receive any more email sequences from AISEO.</p>
    <p style="margin-top:24px;font-size:14px;">
      <a href="/dashboard/settings" style="color:#10b981;text-decoration:underline;">
        Manage notification settings
      </a>
    </p>
  </div>
</body>
</html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (err: unknown) {
    logger.error("[Unsubscribe] DB error", { error: (err as Error)?.message });
    return new NextResponse("Invalid unsubscribe link", { status: 400 });
  }
}
