"use client";
import { logger } from "@/lib/logger";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function AuditError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        logger.error("[Audit Error]", { error: error?.message || error });
    }, [error]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center p-10">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <div className="max-w-sm">
                <h2 className="text-xl font-bold text-foreground mb-2">Audit failed to load</h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                    There was a problem loading this audit report. The site might be unreachable, or an API quota was hit.
                </p>
                {error?.message && (
                    <p className="text-[11px] font-mono text-red-400/70 bg-card rounded-lg px-3 py-2 text-left">
                        {error.message}
                    </p>
                )}
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={reset}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-muted hover:bg-white/10 border border-border text-zinc-300 text-sm font-medium transition-all"
                >
                    <RefreshCcw className="w-4 h-4" />
                    Retry
                </button>
                <Link
                    href="/dashboard/audits"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 text-sm font-medium transition-all"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Audits
                </Link>
            </div>
        </div>
    );
}
