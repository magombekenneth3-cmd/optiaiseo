import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { disconnectGsc } from "@/lib/gsc/token";

export async function POST(req: Request) {
    const user = await getAuthUser(req as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await disconnectGsc(user.id);

    return NextResponse.json({ ok: true });
}

