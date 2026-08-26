import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/operations/[id]
 *
 * Returns full operation detail including snapshot, effects, and audit trail.
 * This is the lifecycle view: operation → target → actor → status → risk →
 * effects → snapshot → audit trail → rollback eligibility.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const operation = await (prisma as any).mutationOperation.findUnique({
        where: { id },
        include: {
            snapshot: true,
            effects: {
                orderBy: { createdAt: "asc" },
            },
            auditEvents: {
                orderBy: { createdAt: "asc" },
            },
            site: {
                select: { id: true, domain: true, userId: true, viewerId: true },
            },
        },
    });

    if (!operation) {
        return NextResponse.json({ error: "Operation not found" }, { status: 404 });
    }

    // Authorization: must own or view the site
    if (
        operation.site.userId !== session.user.id &&
        operation.site.viewerId !== session.user.id
    ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Determine rollback eligibility
    const canRollback =
        operation.snapshot !== null &&
        operation.snapshot.beforeState !== null &&
        ["COMMITTED", "EFFECTS_PENDING", "COMPLETED", "COMPLETED_WITH_ERRORS"].includes(operation.status);

    return NextResponse.json({
        operation: {
            ...operation,
            site: { id: operation.site.id, domain: operation.site.domain },
        },
        canRollback,
    });
}
