export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeAuditDiff } from "@/lib/audit/diff";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const auditId = searchParams.get("auditId");
    const siteId  = searchParams.get("siteId");

    if (!auditId || !siteId) {
        return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    // Ownership check
    const owned = await prisma.audit.findFirst({
        where: { id: auditId, site: { userId: session.user.id } },
        select: { id: true },
    });

    if (!owned) {
        return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    const diff = await computeAuditDiff(auditId, siteId);
    return NextResponse.json(diff);
}
