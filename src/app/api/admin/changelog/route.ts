import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { logger } from "@/lib/logger";
import { z } from "zod";

const VALID_CATEGORIES = ["feature", "improvement", "fix", "security"] as const;

const createSchema = z.object({
    title:       z.string().min(3).max(200),
    category:    z.enum(VALID_CATEGORIES),
    description: z.string().min(10).max(5000),
    version:     z.string().max(20).optional(),
    publishedAt: z.string().datetime().optional(),
    isPublic:    z.boolean().optional(),
});

// GET /api/admin/changelog — list all entries (admin only)
export async function GET(req: NextRequest) {
    const guard = await requireAdminApi();
    if (guard instanceof NextResponse) return guard;

    try {
        const entries = await prisma.changelog.findMany({
            orderBy: { publishedAt: "desc" },
            take: 100,
        });
        return NextResponse.json(entries);
    } catch (err: unknown) {
        logger.error("[Admin/Changelog] GET failed", { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ error: "Failed to fetch changelog" }, { status: 500 });
    }
}

// POST /api/admin/changelog — create a new entry
export async function POST(req: NextRequest) {
    const guard = await requireAdminApi();
    if (guard instanceof NextResponse) return guard;

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Validation failed", details: parsed.error.flatten() },
            { status: 422 }
        );
    }

    const { title, category, description, version, publishedAt, isPublic } = parsed.data;

    try {
        const entry = await prisma.changelog.create({
            data: {
                title,
                category,
                description,
                version:     version ?? null,
                publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
                isPublic:    isPublic ?? true,
            },
        });

        await logAdminAction({
            actorId:   guard.userId,
            action:    "changelog.create",
            target:    entry.id,
            payload:   { title, category, version: version ?? null },
            ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
        });

        return NextResponse.json(entry, { status: 201 });
    } catch (err: unknown) {
        logger.error("[Admin/Changelog] POST failed", { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ error: "Failed to create entry" }, { status: 500 });
    }
}

// DELETE /api/admin/changelog?id=xxx
export async function DELETE(req: NextRequest) {
    const guard = await requireAdminApi();
    if (guard instanceof NextResponse) return guard;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    try {
        await prisma.changelog.delete({ where: { id } });

        await logAdminAction({
            actorId:   guard.userId,
            action:    "changelog.delete",
            target:    id,
            ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
        });

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        logger.error("[Admin/Changelog] DELETE failed", { error: err instanceof Error ? err.message : String(err), id });
        return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
    }
}
