"use client";

import { useState, useRef, useEffect } from "react";
import { X, GitBranch, Loader2, Check, Copy, AlertCircle } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

export interface PrReviewPayload {
    filePath: string;
    content: string;
    language?: string;
    issueLabel: string;
}

interface Props {
    payload: PrReviewPayload;
    onConfirm: (content: string) => Promise<void>;
    onCancel: () => void;
}

export function PrReviewModal({ payload, onConfirm, onCancel }: Props) {
    const [code, setCode] = useState(payload.content);
    const [submitting, setSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const panelRef    = useRef<HTMLDivElement>(null);
    useFocusTrap(panelRef, true);   // always active while mounted

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    // Close on Escape key
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onCancel]);

    const handleConfirm = async () => {
        setSubmitting(true);
        await onConfirm(code);
        setSubmitting(false);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="pr-review-title"
                tabIndex={-1}
                className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl focus:outline-none"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center" aria-hidden="true">
                            <GitBranch className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                            <p id="pr-review-title" className="font-semibold text-sm text-foreground">Review Before Committing</p>
                            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{payload.filePath}</p>
                        </div>
                    </div>
                    <button
                        onClick={onCancel}
                        aria-label="Close review dialog"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>

                <div className="px-6 py-3 border-b border-border shrink-0">
                    <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                            AI-generated fix for <strong className="font-semibold">{payload.issueLabel}</strong>. Review carefully — you can edit the code directly before pushing.
                        </span>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden px-6 py-4 min-h-0">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {payload.language ?? "code"}
                        </span>
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 border border-border transition-colors"
                        >
                            {copied ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                        </button>
                    </div>
                    <textarea
                        ref={textareaRef}
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        spellCheck={false}
                        className="w-full h-full min-h-[320px] bg-muted/40 border border-input rounded-xl p-4 text-xs font-mono text-foreground leading-relaxed resize-none outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                    />
                </div>

                <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border shrink-0">
                    <button
                        onClick={onCancel}
                        disabled={submitting}
                        className="px-4 py-2 text-sm text-foreground hover:text-foreground/80 border border-input bg-card hover:bg-muted rounded-xl transition-colors disabled:opacity-40"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={submitting || !code.trim()}
                        className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {submitting
                        ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /><span className="sr-only">Opening PR…</span>Opening PR…</>
                        : <><GitBranch className="w-4 h-4" aria-hidden="true" /> Commit &amp; Open PR</>
                    }
                    </button>
                </div>
            </div>
        </div>
    );
}
