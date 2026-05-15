"use client";

import { useState } from "react";
import { Download, Loader2, Check } from "lucide-react";

interface PdfDownloadButtonProps {
    endpoint: string;
    params: Record<string, string>;
    label?: string;
    filename?: string;
}

export function PdfDownloadButton({
    endpoint,
    params,
    label = "Download PDF",
    filename,
}: PdfDownloadButtonProps) {
    const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

    async function handleDownload() {
        setState("loading");
        try {
            const qs = new URLSearchParams(params).toString();
            const res = await fetch(`${endpoint}?${qs}`);
            if (!res.ok) throw new Error("Download failed");

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename ?? "report.pdf";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            setState("done");
            setTimeout(() => setState("idle"), 3000);
        } catch {
            setState("error");
            setTimeout(() => setState("idle"), 3000);
        }
    }

    return (
        <button
            onClick={handleDownload}
            disabled={state === "loading"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all disabled:opacity-50"
            style={{
                background: state === "done" ? "rgba(46,160,67,0.1)" : state === "error" ? "rgba(248,81,73,0.1)" : "rgba(56,139,253,0.1)",
                color: state === "done" ? "#2ea043" : state === "error" ? "#f85149" : "#388bfd",
                border: `1px solid ${state === "done" ? "rgba(46,160,67,0.2)" : state === "error" ? "rgba(248,81,73,0.2)" : "rgba(56,139,253,0.2)"}`,
            }}
        >
            {state === "loading" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
            ) : state === "done" ? (
                <Check className="w-3 h-3" />
            ) : (
                <Download className="w-3 h-3" />
            )}
            {state === "loading" ? "Generating..." : state === "done" ? "Downloaded!" : state === "error" ? "Failed" : label}
        </button>
    );
}
