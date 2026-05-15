import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAuditReportPdf, type AuditReportData, type AuditFinding } from "@/lib/pdf/audit-report";
import { extractAuditMetrics } from "@/lib/audit/helpers";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auditId = req.nextUrl.searchParams.get("auditId");
    if (!auditId) {
        return NextResponse.json({ error: "Missing auditId" }, { status: 400 });
    }

    const audit = await prisma.audit.findFirst({
        where: {
            id: auditId,
            site: { userId: session.user.id },
        },
        include: {
            site: { select: { domain: true, brandName: true } },
        },
    });

    if (!audit) {
        return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    const { seoScore } = extractAuditMetrics({
        categoryScores: audit.categoryScores as Record<string, unknown> | null,
        issueList: audit.issueList,
    });

    type RawIssue = { status?: string; label?: string; title?: string; description?: string; severity?: string; category?: string; recommendation?: string };
    type RawCategory = { category?: string; items?: RawIssue[] };
    const rawList = audit.issueList as RawCategory[] | null;

    const findings: AuditFinding[] = [];
    if (Array.isArray(rawList)) {
        for (const cat of rawList) {
            const category = cat.category ?? "General";
            for (const item of cat.items ?? []) {
                if (item.status === "Pass") continue;
                findings.push({
                    category,
                    title: item.label ?? item.title ?? "Untitled",
                    severity: item.severity ?? (item.status === "Fail" ? "high" : "medium"),
                    description: item.description ?? "",
                    recommendation: item.recommendation,
                });
            }
        }
    }

    const categoryScores: Record<string, number> = {};
    const rawCatScores = audit.categoryScores as Record<string, unknown> | null;
    if (rawCatScores) {
        for (const [key, val] of Object.entries(rawCatScores)) {
            if (typeof val === "number") categoryScores[key] = val;
            else if (typeof val === "object" && val && "score" in val) {
                categoryScores[key] = (val as { score: number }).score;
            }
        }
    }

    const reportData: AuditReportData = {
        domain: audit.site.domain,
        score: seoScore,
        createdAt: audit.runTimestamp.toISOString(),
        findings,
        categoryScores,
    };

    const pdfBuffer = await generateAuditReportPdf(reportData);

    const filename = `seo-audit-${audit.site.domain.replace(/[^a-z0-9]/gi, "-")}-${audit.runTimestamp.toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(pdfBuffer, {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(pdfBuffer.length),
            "Cache-Control": "private, no-cache",
        },
    });
}
