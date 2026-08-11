import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateAgencyWhiteLabelPdfReport, AgencyReportData } from "@/lib/pdf/agency-report";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const reportData = body as AgencyReportData;

        if (!reportData.clientSiteName) {
            return NextResponse.json({ error: "Missing required clientSiteName" }, { status: 400 });
        }

        const pdfBuffer = await generateAgencyWhiteLabelPdfReport(reportData);

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${reportData.clientSiteName.toLowerCase().replace(/\s+/g, "-")}-aeo-audit.pdf"`,
            },
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "PDF export failed";
        return NextResponse.json({ error }, { status: 500 });
    }
}
