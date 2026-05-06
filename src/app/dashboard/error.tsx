"use client";
import { logger } from "@/lib/logger";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        logger.error("[Dashboard Error]", { error: error?.message || error });
    }, [error]);

    
    const isDev = process.env.NODE_ENV === "development";
    const message = isDev
        ? error.message || "An unexpected error occurred on this page."
        : "An unexpected error occurred. Our team has been notified.";

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-rose-400" />
            </div>
            <div>
                <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
                <p className="text-muted-foreground text-sm max-w-md">{message}</p>
                {error.digest && (
                    <p className="text-xs text-muted-foreground mt-2 font-mono">Error ID: {error.digest}</p>
                )}
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={reset}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-white/10 border border-border text-sm font-medium transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                    Try again
                </button>
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </Link>
            </div>
        </div>
    );
}
