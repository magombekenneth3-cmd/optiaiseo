/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { Zap, Loader2, Check, AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import { requestIndexing } from "@/app/actions/indexing";
import { toast } from "sonner";

type ErrorState =
    | { code: "API_DISABLED"; consoleUrl: string; message: string }
    | { code: "PERMISSION_DENIED" | "UNKNOWN" | "UNAUTHORIZED"; message: string };

export function RequestIndexingButton({ url, siteId }: { url: string; siteId?: string }) {
    const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
    const [errorState, setErrorState] = useState<ErrorState | null>(null);

    const handleRequest = async () => {
        if (status === "loading") return;
        setErrorState(null);
        setStatus("loading");

        try {
            const res = await requestIndexing(url, siteId);

            if (res.success) {
                setStatus("success");
                toast.success(res.message || "Indexing requested!");
                setTimeout(() => setStatus("idle"), 6000);
                return;
            }

            setStatus("idle");

            if (res.code === "API_DISABLED") {
                setErrorState({
                    code: "API_DISABLED",
                     
                    consoleUrl: (res as any).consoleUrl || "https://console.developers.google.com/apis/api/indexing.googleapis.com",
                    message: res.error || "Google Indexing API is not enabled.",
                });
                return;
            }

             
            // Other errors — inline + toast
            setErrorState({ code: res.code as any, message: res.error || "Failed to request indexing." });
            toast.error(res.error || "Failed to request indexing.", { duration: 5000 });
        } catch {
            setStatus("idle");
            setErrorState({ code: "UNKNOWN", message: "An unexpected error occurred." });
        }
    };

    return (
        <div className="flex flex-col gap-3">
            {/* Main CTA button */}
            <button
                onClick={handleRequest}
                disabled={status === "loading"}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border ${status === "loading"
                    ? "bg-muted border-border text-muted-foreground cursor-not-allowed"
                    : status === "success"
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                        : "bg-blue-600 hover:bg-blue-500 text-white border-blue-400/30 shadow-lg shadow-blue-500/20 hover:scale-[1.02] active:scale-[0.98]"
                    }`}
                title="Ping Google Indexing API for this URL"
            >
                {status === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                    status === "success" ? <Check className="w-3.5 h-3.5" /> :
                        <Zap className="w-3.5 h-3.5 fill-current" />}
                {status === "loading" ? "Requesting…" :
                    status === "success" ? "Indexed!" :
                        "Request Indexing"}
            </button>

            {/* Actionable error banner */}
            {errorState && (
                <div className={`rounded-xl border p-4 text-sm flex flex-col gap-3 ${errorState.code === "API_DISABLED"
                    ? "bg-amber-500/10 border-amber-500/25 text-amber-200"
                    : "bg-rose-500/10 border-rose-500/25 text-rose-300"
                    }`}>
                    <div className="flex items-start gap-2.5">
                        {errorState.code === "API_DISABLED"
                            ? <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                            : <ShieldAlert className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                        }
                        <div className="flex flex-col gap-1.5">
                            {errorState.code === "API_DISABLED" ? (
                                <>
                                    <p className="font-semibold text-amber-300">Google Indexing API Not Enabled</p>
                                    <p className="text-xs text-amber-200/70 leading-relaxed">
                                        This feature requires the <strong>Web Search Indexing API</strong> to be enabled
                                        in your Google Cloud project. It only takes 30 seconds to activate.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="font-semibold">Indexing Request Failed</p>
                                    <p className="text-xs leading-relaxed text-rose-200/70">{errorState.message}</p>
                                </>
                            )}
                        </div>
                    </div>

                    {errorState.code === "API_DISABLED" && (
                         
                        <div className="flex flex-col gap-2">
                            <a
                                href={(errorState as any).consoleUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all"
                            >
                                Enable Google Indexing API
                                <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <p className="text-[11px] text-amber-200/50 text-center">
                                After enabling, wait ~2 minutes then try again.
                            </p>
                        </div>
                    )}

                    {errorState.code === "PERMISSION_DENIED" && (
                        <a
                            href="https://search.google.com/search-console"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-all"
                        >
                            Open Search Console
                            <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                    )}

                    <button
                        onClick={() => setErrorState(null)}
                        className="text-[11px] text-center opacity-40 hover:opacity-70 transition-opacity"
                    >
                        Dismiss
                    </button>
                </div>
            )}
        </div>
    );
}
