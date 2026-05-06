"use client";

import { useState } from "react";

export function ExportAuditButton({ auditId }: { auditId: string }) {
    const [isExporting, setIsExporting] = useState<"excel" | "pdf" | null>(null);

    const handleExport = async (format: "excel" | "pdf") => {
        if (isExporting) return;
        setIsExporting(format);

        try {
            const url =
                format === "pdf"
                    ? `/api/audit/export/${auditId}?format=pdf`
                    : `/api/audit/export/${auditId}`;

            const link = document.createElement("a");
            link.href = url;
            link.download = "";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(() => setIsExporting(null), 3000);
        } catch {
            setIsExporting(null);
        }
    };

    return (
        <div className="flex items-center gap-2">
            {/* Excel Export */}
            <button
                onClick={() => handleExport("excel")}
                disabled={!!isExporting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export full audit report to Excel (.xlsx)"
            >
                {isExporting === "excel" ? (
                    <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Exporting…
                    </>
                ) : (
                    <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Excel
                    </>
                )}
            </button>

            {/* PDF Export */}
            <button
                onClick={() => handleExport("pdf")}
                disabled={!!isExporting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export audit report as printable PDF-ready HTML"
            >
                {isExporting === "pdf" ? (
                    <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Preparing…
                    </>
                ) : (
                    <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        PDF
                    </>
                )}
            </button>
        </div>
    );
}
