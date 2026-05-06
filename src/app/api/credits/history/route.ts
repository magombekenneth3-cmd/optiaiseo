export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";

/**
 * GET /api/credits/history?page=0&take=20
 * Returns paginated credit ledger for the authenticated user.
 */
export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const take = Math.min(50, parseInt(url.searchParams.get("take") ?? "20", 10));
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const rows = await prisma.creditHistory.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: take + 1,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
            id: true,
            action: true,
            label: true,
            cost: true,
            balanceAfter: true,
            metadata: true,
            createdAt: true,
        },
    });

    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return NextResponse.json({ rows: data, nextCursor, hasMore });
}
