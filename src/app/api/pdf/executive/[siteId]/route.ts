import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateExecutiveDigestPdf } from "@/lib/pdf/executive-digest";
import { aggregateExecutiveDigestData } from "@/lib/pdf/queries";

/**
 * GET /api/pdf/executive/:siteId?startDate=2026-08-01&endDate=2026-08-31
 *
 * Generates a unified Executive Digest PDF combining SEO, AEO, GSC, and
 * competitor data for the specified reporting period.
 *
 * Auth: session required + site ownership check.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> },
) {
    // ── Auth ──────────────────────────────────────────────────────────

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Params ────────────────────────────────────────────────────────

    const { siteId } = await params;
    if (!siteId) {
        return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
    }

    const startDate = req.nextUrl.searchParams.get("startDate");
    const endDate = req.nextUrl.searchParams.get("endDate");

    if (!startDate || !endDate) {
        return NextResponse.json(
            { error: "Missing required query params: startDate, endDate (ISO format)" },
            { status: 400 },
        );
    }

    // Validate date format
    const parsedStart = new Date(startDate);
    const parsedEnd = new Date(endDate);

    if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
        return NextResponse.json(
            { error: "Invalid date format. Use ISO format: YYYY-MM-DD" },
            { status: 400 },
        );
    }

    if (parsedStart >= parsedEnd) {
        return NextResponse.json(
            { error: "startDate must be before endDate" },
            { status: 400 },
        );
    }

    // ── Aggregate & Generate ─────────────────────────────────────────

    try {
        const { data } = await aggregateExecutiveDigestData(
            siteId,
            session.user.id,
            startDate,
            endDate,
        );

        const pdfBuffer = await generateExecutiveDigestPdf(data);

        const safeDate = startDate.replace(/[^0-9-]/g, "");
        const safeDomain = data.domain.replace(/[^a-z0-9]/gi, "-");
        const filename = `executive-digest-${safeDomain}-${safeDate}.pdf`;

        return new NextResponse(new Uint8Array(pdfBuffer), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Content-Length": String(pdfBuffer.length),
                "Cache-Control": "private, no-cache",
            },
        });
    } catch (err: unknown) {
        const message = (err as Error)?.message ?? "Unknown error";

        if (message.includes("not found") || message.includes("not authorized")) {
            return NextResponse.json({ error: message }, { status: 404 });
        }

        return NextResponse.json(
            { error: "Failed to generate executive digest", details: message },
            { status: 500 },
        );
    }
}
