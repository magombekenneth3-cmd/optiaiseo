"use client";

import React, { useState } from "react";
import { executeGrowthDecisionAction } from "@/app/actions/executeDecision";
import { ExecutionProgressStepper } from "@/components/dashboard/ExecutionProgressStepper";

export interface ExecuteDecisionButtonProps {
    decisionId: string;
    siteId: string;
    actionType: "OPTIMIZE_INTERNAL_LINKS" | "REFRESH_CONTENT" | "APPLY_ONE_CLICK_FIX" | "CONSOLIDATE_PAGES" | "IMPROVE_SEARCH_INTENT";
    targetUrl: string;
    onSuccess?: () => void;
}

export function ExecuteDecisionButton({
    decisionId,
    siteId,
    actionType,
    targetUrl,
    onSuccess,
}: ExecuteDecisionButtonProps) {
    const [status, setStatus] = useState<"idle" | "executing" | "completed" | "error">("idle");
    const [currentPhase, setCurrentPhase] = useState<1 | 2 | 3 | 4>(1);
    const [phaseDetails, setPhaseDetails] = useState<string>("Initializing execution pipeline...");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleExecute = async () => {
        setStatus("executing");
        setErrorMessage(null);
        setCurrentPhase(1);
        setPhaseDetails("Vector Linker: Analyzing pillar page internal links...");

        try {
            // Simulated SSE phase progression for responsive UI feedback
            setTimeout(() => {
                setCurrentPhase(2);
                setPhaseDetails("FAQ Schema: Injecting JSON-LD FAQPage & canonical tags...");
            }, 300);

            setTimeout(() => {
                setCurrentPhase(3);
                setPhaseDetails("Instant IndexNow: Pinging Bing & Google Indexing API...");
            }, 600);

            setTimeout(() => {
                setCurrentPhase(4);
                setPhaseDetails("28-Day ROI: Locking in T0 baseline position & CTR metrics...");
            }, 900);

            const res = await executeGrowthDecisionAction(decisionId, siteId);

            if (res.success) {
                setStatus("completed");
                if (onSuccess) onSuccess();
            } else {
                setStatus("error");
                setErrorMessage(res.error || "Execution failed");
            }
        } catch (err: unknown) {
            setStatus("error");
            setErrorMessage((err as Error)?.message || "Execution error");
        }
    };

    if (status === "completed") {
        return (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-md text-xs font-semibold">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Executed & IndexNow Pinned</span>
            </div>
        );
    }

    return (
        <div className="inline-flex flex-col gap-2 min-w-[280px]">
            {status === "executing" && (
                <ExecutionProgressStepper
                    currentPhase={currentPhase}
                    phaseTitle={`Executing ${actionType}`}
                    details={phaseDetails}
                />
            )}

            <button
                onClick={handleExecute}
                disabled={status === "executing"}
                className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white rounded-md transition-all shadow-sm ${
                    status === "executing"
                        ? "bg-cyan-600/50 cursor-not-allowed"
                        : status === "error"
                        ? "bg-rose-600 hover:bg-rose-500"
                        : "bg-cyan-600 hover:bg-cyan-500 active:scale-95"
                }`}
            >
                {status === "executing" ? (
                    <>
                        <svg className="w-3.5 h-3.5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Executing Pipeline...</span>
                    </>
                ) : (
                    <>
                        <span>⚡ Execute Decision</span>
                    </>
                )}
            </button>
            {errorMessage && (
                <span className="text-[10px] text-rose-400 font-medium">{errorMessage}</span>
            )}
        </div>
    );
}

