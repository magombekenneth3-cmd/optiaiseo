"use client";

import { useState, useRef, useEffect } from "react";
import { GitBranch, Loader2, Check, Copy, AlertCircle } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

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

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

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
        <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
            <DialogContent className="w-full max-w-3xl max-h-[90vh] flex flex-col p-0 border-border bg-card shadow-2xl overflow-hidden">
                <DialogHeader className="flex items-center justify-between flex-row px-6 py-4 border-b border-border shrink-0 text-left">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center" aria-hidden="true">
                            <GitBranch className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                            <DialogTitle className="font-semibold text-sm text-foreground">Review Before Committing</DialogTitle>
                            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{payload.filePath}</p>
                        </div>
                    </div>
                </DialogHeader>

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
            </DialogContent>
        </Dialog>
    );
}
