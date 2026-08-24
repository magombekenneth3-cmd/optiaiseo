import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generatePseoBatch, replacePlaceholders } from "@/lib/pseo/generator";
import { logger } from "@/lib/logger";

/**
 * POST /api/pseo/templates/[id]/generate
 *
 * Generates pages for every row in the template's dataset using Gemini,
 * persists them to PseoPage, and updates the template's pageCount.
 * Previously generated pages for this template are deleted first (re-generate).
 */
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const template = await prisma.pseoTemplate.findFirst({
        where: { id, site: { userId: session.user.id } },
        include: { site: { select: { domain: true, authorName: true } } },
    });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const dataset = template.dataset as Record<string, string>[];
    if (!dataset || dataset.length === 0) {
        return NextResponse.json({ error: "Template dataset is empty" }, { status: 400 });
    }

    // Delete previously generated pages for this template
    await prisma.pseoPage.deleteMany({ where: { templateId: id } });

    // Generate via Gemini
    const batchResult = await generatePseoBatch({
        pattern: template.pattern,
        dataset,
        siteId: template.siteId,
        siteDomain: template.site.domain,
        authorName: template.site.authorName ?? "OptiAISEO",
    });

    // Persist pages
    const rows = batchResult.pages.map((p) => ({
        templateId: id,
        siteId: template.siteId,
        slug: p.slug,
        title: p.title,
        metaDescription: p.metaDescription,
        contentHtml: p.contentHtml,
        schemaJsonLd: p.schemaJsonLd as object,
        heroVisualSvg: p.heroVisualSvg,
        variableData: p.variableData as object,
    }));

    // Upsert to handle slug collisions gracefully
    let saved = 0;
    for (const row of rows) {
        try {
            await prisma.pseoPage.create({ data: row });
            saved++;
        } catch (e: unknown) {
            logger.warn("[pSEO] Skipped duplicate slug", {
                slug: row.slug,
                error: (e as Error)?.message,
            });
        }
    }

    // Update template pageCount + status
    await prisma.pseoTemplate.update({
        where: { id },
        data: { pageCount: saved, status: "ACTIVE" },
    });

    return NextResponse.json({
        success: true,
        generated: saved,
        total: dataset.length,
    });
}

// Re-export replacePlaceholders so it's importable alongside the route for tests
export { replacePlaceholders };
