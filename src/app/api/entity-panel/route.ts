// CRUD API for Knowledge Graph brand facts
// GET    /api/entity-panel?siteId=... — list all facts
// POST   /api/entity-panel            — create a new fact
// PATCH  /api/entity-panel            — update a fact by id
// DELETE /api/entity-panel            — delete a fact by id
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveOwnership(siteId: string, userId: string) {
    return prisma.site.findFirst({
        where: { id: siteId, userId },
        select: { id: true, domain: true },
    });
}

function bustKgCache(domain: string) {
    return redis.del(`kg:feed:${domain}`).catch(() => {
        // Non-fatal — cache will expire naturally
    });
}

// ─── GET — list facts ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId)
        return NextResponse.json({ error: "siteId required" }, { status: 400 });

    const site = await resolveOwnership(siteId, user.id);
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const brandFacts = await prisma.brandFact.findMany({
        where: { siteId },
        select: {
            id: true,
            factType: true,
            value: true,
            sourceUrl: true,
            verified: true,
            updatedAt: true,
        },
        orderBy: [{ verified: "desc" }, { factType: "asc" }, { updatedAt: "desc" }],
    });

    return NextResponse.json({ brandFacts, domain: site.domain });
}

// ─── POST — create fact ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body)
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { siteId, factType, value, sourceUrl } = body as {
        siteId?: string;
        factType?: string;
        value?: string;
        sourceUrl?: string;
    };

    if (!siteId || !factType || !value)
        return NextResponse.json({ error: "siteId, factType, and value are required" }, { status: 400 });

    const site = await resolveOwnership(siteId, user.id);
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    // Duplicate detection — return 409 instead of letting the DB throw
    const existing = await prisma.brandFact.findUnique({
        where: { siteId_factType_value: { siteId, factType, value } },
        select: { id: true },
    });
    if (existing)
        return NextResponse.json({ error: "A fact with this type and value already exists" }, { status: 409 });

    const fact = await prisma.brandFact.create({
        data: { siteId, factType, value, sourceUrl: sourceUrl || null, verified: false },
        select: { id: true, factType: true, value: true, sourceUrl: true, verified: true, updatedAt: true },
    });

    await bustKgCache(site.domain);

    return NextResponse.json({ fact }, { status: 201 });
}

// ─── PATCH — update fact ──────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body)
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { id, value, verified, factType, sourceUrl } = body as {
        id?: string;
        value?: string;
        verified?: boolean;
        factType?: string;
        sourceUrl?: string;
    };

    if (!id)
        return NextResponse.json({ error: "id is required" }, { status: 400 });

    // Verify the fact belongs to a site owned by this user
    const fact = await prisma.brandFact.findFirst({
        where: { id },
        include: { site: { select: { userId: true, domain: true } } },
    });
    if (!fact || fact.site.userId !== user.id)
        return NextResponse.json({ error: "Fact not found" }, { status: 404 });

    const updated = await prisma.brandFact.update({
        where: { id },
        data: {
            ...(value !== undefined && { value }),
            ...(verified !== undefined && { verified }),
            ...(factType !== undefined && { factType }),
            ...(sourceUrl !== undefined && { sourceUrl: sourceUrl || null }),
        },
        select: { id: true, factType: true, value: true, sourceUrl: true, verified: true, updatedAt: true },
    });

    await bustKgCache(fact.site.domain);

    return NextResponse.json({ fact: updated });
}

// ─── DELETE — remove fact ─────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body)
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { id } = body as { id?: string };
    if (!id)
        return NextResponse.json({ error: "id is required" }, { status: 400 });

    const fact = await prisma.brandFact.findFirst({
        where: { id },
        include: { site: { select: { userId: true, domain: true } } },
    });
    if (!fact || fact.site.userId !== user.id)
        return NextResponse.json({ error: "Fact not found" }, { status: 404 });

    await prisma.brandFact.delete({ where: { id } });
    await bustKgCache(fact.site.domain);

    return NextResponse.json({ success: true });
}
