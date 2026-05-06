"use client";

import { useState, useTransition } from "react";
import { deleteAudit } from "@/app/actions/audit";

export function DeleteAuditButton({ auditId }: { auditId: string }) {
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    function handleDeleteClick(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        setConfirming(true);
        setError(null);
    }

    function handleCancel(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        setConfirming(false);
        setError(null);
    }

    function handleConfirm(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
            const result = await deleteAudit(auditId);
            if (!result.success) {
                setError(result.error ?? "Failed to delete audit");
                setConfirming(false);
            }
            // On success, revalidatePath in the server action refreshes the list automatically
        });
    }

    if (confirming) {
        return (
            <span
                className="inline-flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
            >
                {error && (
                    <span className="text-xs text-rose-400">{error}</span>
                )}
                <span className="text-xs text-muted-foreground mr-1">Delete?</span>
                <button
                    onClick={handleConfirm}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
                               bg-rose-500/15 text-rose-400 border border-rose-500/25
                               hover:bg-rose-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isPending ? (
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                    Yes, delete
                </button>
                <button
                    onClick={handleCancel}
                    disabled={isPending}
                    className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md
                               bg-muted text-muted-foreground border border-border
                               hover:bg-zinc-700 transition-colors disabled:opacity-50"
                >
                    Cancel
                </button>
            </span>
        );
    }

    return (
        <button
            onClick={handleDeleteClick}
            title="Delete this audit"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md
                       text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10
                       border border-transparent hover:border-rose-500/20
                       transition-colors opacity-0 group-hover:opacity-100"
        >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
        </button>
    );
}
