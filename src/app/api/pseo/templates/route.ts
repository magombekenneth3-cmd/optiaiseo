import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/pseo/templates — list all templates for user's sites */
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");

    const where = siteId
        ? { siteId, site: { userId: session.user.id } }
        : { site: { userId: session.user.id } };

    const templates = await prisma.pseoTemplate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            siteId: true,
            name: true,
            pattern: true,
            status: true,
            pageCount: true,
            createdAt: true,
            site: { select: { domain: true } },
            _count: { select: { pages: true } },
        },
    });

    return NextResponse.json({ templates });
}

/** POST /api/pseo/templates — create a new template */
export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { siteId, name, pattern, dataset } = body as {
        siteId: string;
        name: string;
        pattern: string;
        dataset: Record<string, string>[];
    };

    if (!siteId || !name || !pattern || !Array.isArray(dataset) || dataset.length === 0) {
        return NextResponse.json({ error: "siteId, name, pattern, and dataset are required" }, { status: 400 });
    }

    // Verify site ownership
    const site = await prisma.site.findFirst({ where: { id: siteId, userId: session.user.id } });
    if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const template = await prisma.pseoTemplate.create({
        data: { siteId, name, pattern, dataset },
    });

    return NextResponse.json({ template }, { status: 201 });
}
