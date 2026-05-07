import { getAuthUser } from "@/lib/auth/get-auth-user";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET(req: import("next/server").NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const user = await getAuthUser(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user?.id;

    const whereClause = userId
        ? { id, site: { userId } }
        : { id, site: { user: { email: user?.email ?? "" } } };

    const blog = await prisma.blog.findFirst({
        where: whereClause,
        select: { status: true },
    });

    if (!blog) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const step = await redis
        .get<string>(`blog:step:${id}`)
        .catch(() => null);

    return NextResponse.json({
        status: blog.status,
        generationStep: step ?? "researching",
    });
}
