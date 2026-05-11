export const dynamic = "force-dynamic";
export const maxDuration = 300;
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAuditResult } from "@/lib/seo-audit/parse-audit-result";
import ExcelJS from "exceljs";

function extractBrokenLinks(categories: any[]): {
    checked: number;
    brokenUrls: string[];
    unreachableUrls: string[];
} {
    for (const cat of categories) {
        if (!Array.isArray(cat.items)) continue;
        for (const item of cat.items) {
            if (item.id === "page-broken-links") {
                const d = item.details ?? {};
                const broken = d.brokenUrls ? d.brokenUrls.split(", ").filter(Boolean) : [];
                const unreachable = d.unreachableUrls ? d.unreachableUrls.split(", ").filter(Boolean) : [];
                return {
                    checked: d.linksChecked ?? 0,
                    brokenUrls: broken,
                    unreachableUrls: unreachable,
                };
            }
        }
    }
    return { checked: 0, brokenUrls: [], unreachableUrls: [] };
}

function _statusEmoji(status: string): string {
    switch (status) {
        case "Pass": return "✅ Pass";
        case "Fail": return "❌ Fail";
        case "Warning": return "⚠️ Warning";
        case "Info": return "ℹ️ Info";
        default: return status;
    }
}

function _priorityEmoji(priority: string): string {
    switch (priority) {
        case "High": return "🔴 High";
        case "Medium": return "🟠 Medium";
        case "Low": return "🟡 Low";
        default: return priority ?? "";
    }
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await (await import("next-auth")).getServerSession((await import("@/lib/auth")).authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const format = req.nextUrl.searchParams.get("format") ?? "xlsx";

        const dbUser = await prisma.user.findUnique({
            where: { email: session.user?.email ?? "" },
            select: { id: true, whiteLabel: true },
        });
        if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 403 });

        const audit = await prisma.audit.findUnique({
            where: { id },
            include: { site: { select: { domain: true, userId: true } } },
        });

        if (!audit || audit.site.userId !== session.user!.id) {
            return NextResponse.json({ error: "Audit not found" }, { status: 404 });
        }

        const domain = audit.site.domain;
        const auditDate = new Date(audit.runTimestamp ?? (audit as any).createdAt);
        const runDate = auditDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        const runDateFilename = auditDate.toISOString().slice(0, 10);
        const safeDomain = domain.replace(/[^a-z0-9_.-]/gi, "_");

        const parsed = parseAuditResult(audit.issueList);
        const categories = parsed.categories;
        const issues = categories.flatMap(cat =>
            (cat.items ?? []).map(item => ({
                category: cat.label ?? cat.id ?? "General",
                severity: item.status === "Fail" ? "error" : item.status === "Warning" ? "warning" : "info",
                title: item.label ?? item.id ?? "Issue",
                description: item.finding ?? "",
                fixSuggestion: item.recommendation?.text ?? "",
                impact: item.recommendation?.priority ?? "",
                roiImpact: item.roiImpact,
                aiVisibilityImpact: item.aiVisibilityImpact,
                status: item.status,
            }))
        );
        const categoryScores = audit.categoryScores as Record<string, number> ?? {};

        let overallScore: number = parsed.overallScore ?? 0;
        if (!overallScore && Object.keys(categoryScores).length > 0) {
            const vals = Object.values(categoryScores).filter(v => typeof v === "number") as number[];
            if (vals.length > 0) overallScore = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        }

        const brokenLinksData = extractBrokenLinks(categories);

        if (format === "pdf") {
            const { generateAuditReportPdf } = await import("@/lib/pdf/audit-report");

            const findings = categories.flatMap((c: any) =>
                (c.items ?? []).map((r: any) => ({
                    category: c.label ?? c.id ?? "General",
                    title: r.label ?? r.id ?? "Issue",
                    severity: r.status === "Fail" ? "critical" : r.status === "Warning" ? "medium" : "low",
                    description: r.finding ?? r.description ?? "",
                    recommendation: r.recommendation?.text ?? "",
                }))
            );

            const wl = (dbUser?.whiteLabel as Record<string, string | undefined>) ?? {};

            const pdfBuffer = await generateAuditReportPdf({
                domain: audit.site.domain,
                score: overallScore ?? 0,
                createdAt: auditDate.toISOString().split("T")[0],
                findings,
                categoryScores,
                vitals: {
                    lcp: audit.lcp != null ? Number(audit.lcp) : undefined,
                    cls: audit.cls != null ? Number(audit.cls) : undefined,
                    inp: audit.inp != null ? Number(audit.inp) : undefined,
                },
                whiteLabel: {
                    logoUrl: wl.logoUrl,
                    primaryColor: wl.primaryColor,
                    companyName: wl.companyName,
                    clientName: wl.clientName,
                },
            });

            return new NextResponse(new Uint8Array(pdfBuffer), {
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="audit-${audit.site.domain}-${runDateFilename}.pdf"`,
                    "Cache-Control": "private, no-store",
                },
            });
        }

        const wb = new ExcelJS.Workbook();
        wb.creator = "OptiAISEO";
        wb.created = auditDate;

        const criticalCount = issues.filter((i: any) => i.severity === "error").length;
        const warningCount = issues.filter((i: any) => i.severity === "warning").length;
        const summarySheet = wb.addWorksheet("Summary");
        summarySheet.columns = [{ width: 38 }, { width: 30 }];

        const summaryRows: (string | number)[][] = [
            ["OptiAISEO Audit Report"],
            [""],
            ["Website / Domain", domain],
            ["Audit Date", runDate],
            ["Overall SEO Score", `${overallScore}/100`],
            [""],
            ["── Score by Category ──"],
            ...Object.entries(categoryScores).map(([cat, score]) => [
                cat.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
                `${score}/100`,
            ]),
            [""],
            ["── Issue Breakdown ──"],
            ["Total Issues", issues.length],
            ["Critical (Errors)", criticalCount],
            ["Warnings", warningCount],
            ["── Broken Links ──"],
            ["Total Links Checked", brokenLinksData.checked],
            ["Confirmed Broken (HTTP 4xx/5xx)", brokenLinksData.brokenUrls.length],
            ["Unreachable / Timeout", brokenLinksData.unreachableUrls.length],
        ];
        if ((audit.lcp as any) != null) {
            summaryRows.push(["── Core Web Vitals ──"]);
            summaryRows.push(["LCP (Largest Contentful Paint)", `${Number(audit.lcp).toFixed(2)}s`]);
        }
        if ((audit.cls as any) != null) summaryRows.push(["CLS (Cumulative Layout Shift)", Number(audit.cls).toFixed(3)]);
        if ((audit.inp as any) != null) summaryRows.push(["INP / FID", `${Number(audit.inp).toFixed(0)}ms`]);

        summaryRows.forEach(r => summarySheet.addRow(r));
        const titleRow = summarySheet.getRow(1);
        titleRow.font = { bold: true, size: 14 };
        titleRow.commit();

        const issueSheet = wb.addWorksheet("All Issues");
        issueSheet.columns = [
            { header: "#", width: 5 },
            { header: "Category", width: 22 },
            { header: "Severity", width: 14 },
            { header: "Issue", width: 40 },
            { header: "Description / Finding", width: 60 },
            { header: "How to Fix", width: 70 },
            { header: "Priority", width: 12 },
            { header: "ROI Impact", width: 14 },
            { header: "AI Visibility Impact", width: 18 },
        ];
        issueSheet.getRow(1).font = { bold: true };
        if (issues.length > 0) {
            issues.forEach((issue: any, i: number) => {
                issueSheet.addRow([
                    i + 1,
                    issue.category ?? "",
                    issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Warning" : "Info",
                    issue.title ?? issue.type ?? "",
                    issue.description ?? issue.detail ?? "",
                    issue.fixSuggestion ?? issue.recommendation ?? "",
                    issue.impact ?? "",
                    issue.roiImpact !== undefined ? `${issue.roiImpact}/100` : "",
                    issue.aiVisibilityImpact !== undefined ? `${issue.aiVisibilityImpact}/100` : "",
                ]);
            });
        } else {
            issueSheet.addRow(["", "", "", "No issues found — site is well-optimized! ✅", "", "", "", "", ""]);
        }

        const recSheet = wb.addWorksheet("Priority Actions");
        recSheet.columns = [
            { header: "#", width: 5 },
            { header: "Priority", width: 14 },
            { header: "Category", width: 22 },
            { header: "Issue", width: 40 },
            { header: "How to Fix", width: 70 },
            { header: "SEO / Business Impact", width: 16 },
            { header: "ROI Impact", width: 14 },
            { header: "AI Visibility Impact", width: 18 },
        ];
        recSheet.getRow(1).font = { bold: true };
        const recIssues = issues.filter((i: any) => i.severity === "error" || i.impact === "High" || i.impact === "high");
        if (recIssues.length > 0) {
            recIssues.forEach((issue: any, i: number) => {
                recSheet.addRow([
                    i + 1,
                    issue.severity === "error" ? "Critical" : "High",
                    issue.category ?? "",
                    issue.title ?? issue.type ?? "",
                    issue.fixSuggestion ?? issue.recommendation ?? "",
                    issue.impact ?? "",
                    issue.roiImpact !== undefined ? `${issue.roiImpact}/100` : "",
                    issue.aiVisibilityImpact !== undefined ? `${issue.aiVisibilityImpact}/100` : "",
                ]);
            });
        } else {
            recSheet.addRow(["", "", "", "No critical issues — great job! ✅", "", "", "", ""]);
        }

        const brokenSheet = wb.addWorksheet("Broken Links");
        brokenSheet.columns = [
            { header: "#", width: 5 },
            { header: "Status", width: 30 },
            { header: "URL", width: 80 },
            { header: "Action Required", width: 70 },
        ];
        brokenSheet.getRow(1).font = { bold: true };
        const allBroken = [
            ...brokenLinksData.brokenUrls.map((url, i) => [
                i + 1, "Broken (HTTP Error)", url,
                "Fix immediately — update or remove the link. This shows a 4xx/5xx error to Google.",
            ]),
            ...brokenLinksData.unreachableUrls.map((url, i) => [
                brokenLinksData.brokenUrls.length + i + 1, "Unreachable (Timeout)", url,
                "Verify manually in browser. May be bot-protected. If site is down, update or remove link.",
            ]),
        ];
        if (allBroken.length > 0) {
            allBroken.forEach(r => brokenSheet.addRow(r));
        } else {
            brokenSheet.addRow(["", "No broken links detected ✅", `Checked ${brokenLinksData.checked} links`, ""]);
        }

        if (categories.length > 0) {
            const detailSheet = wb.addWorksheet("Full Audit Detail");
            detailSheet.columns = [
                { header: "Category", width: 24 },
                { header: "Check", width: 40 },
                { header: "Status", width: 16 },
                { header: "Finding", width: 70 },
                { header: "How to Fix", width: 80 },
                { header: "Priority", width: 14 },
                { header: "ROI Impact", width: 12 },
                { header: "AI Impact", width: 12 },
            ];
            detailSheet.getRow(1).font = { bold: true };
            for (const cat of categories) {
                if (!Array.isArray(cat.items)) continue;
                for (const item of cat.items) {
                    detailSheet.addRow([
                        cat.label ?? cat.id ?? "",
                        item.label ?? item.id ?? "",
                        item.status ?? "",
                        item.finding ?? "",
                        item.recommendation?.text ?? "",
                        item.recommendation?.priority ?? "",
                        item.roiImpact !== undefined ? `${item.roiImpact}/100` : "",
                        item.aiVisibilityImpact !== undefined ? `${item.aiVisibilityImpact}/100` : "",
                    ]);
                }
            }
        }

        const buffer = await wb.xlsx.writeBuffer();
        const filename = `aiseo-audit-${safeDomain}-${runDateFilename}.xlsx`;

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store",
            },
        });

    } catch (error: unknown) {
        logger.error("[Audit Export] Failed:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }
}