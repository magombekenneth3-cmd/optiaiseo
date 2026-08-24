import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/pseo/templates/[id] — fetch template + its pages */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const template = await prisma.pseoTemplate.findFirst({
        where: { id, site: { userId: session.user.id } },
        include: {
            site: { select: { domain: true } },
            pages: { orderBy: { createdAt: "asc" }, select: {
                id: true, slug: true, title: true, metaDescription: true,
                status: true, publishedUrl: true, createdAt: true, variableData: true,
            }},
        },
    });

    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ template });
}

/** DELETE /api/pseo/templates/[id] — delete template + cascade pages */
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const template = await prisma.pseoTemplate.findFirst({
        where: { id, site: { userId: session.user.id } },
    });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.pseoTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
