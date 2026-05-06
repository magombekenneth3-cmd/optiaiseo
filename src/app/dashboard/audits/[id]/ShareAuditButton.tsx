"use client";

import { useState, useCallback, useTransition } from "react";
import { Share2, Check, Copy, Loader2, Trash2, ExternalLink, X } from "lucide-react";

interface ShareState {
    token: string | null;
    expiresAt: string | null;
}

export function ShareAuditButton({ auditId }: { auditId: string }) {
    const [state, setState] = useState<ShareState>({ token: null, expiresAt: null });
    const [copied, setCopied] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const shareUrl = state.token
        ? `${window.location.origin}/share/${state.token}`
        : null;

    const generate = useCallback(() => {
        startTransition(async () => {
            setError(null);
            const res = await fetch(`/api/audit/${auditId}/share`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError((body as { error?: string }).error ?? "Failed to generate link");
                return;
            }
            const data = await res.json() as { token: string; expiresAt: string };
            setState({ token: data.token, expiresAt: data.expiresAt });
            setOpen(true);
        });
    }, [auditId]);

    const revoke = useCallback(() => {
        startTransition(async () => {
            setError(null);
            const res = await fetch(`/api/audit/${auditId}/share`, { method: "DELETE" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError((body as { error?: string }).error ?? "Failed to revoke link");
                return;
            }
            setState({ token: null, expiresAt: null });
            setOpen(false);
        });
    }, [auditId]);

    const copy = useCallback(async () => {
        if (!shareUrl) return;
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError("Clipboard access denied");
        }
    }, [shareUrl]);

    const daysLeft = state.expiresAt
        ? Math.ceil((new Date(state.expiresAt).getTime() - Date.now()) / 86_400_000)
        : 0;

    return (
        <>
            <button
                id="share-audit-btn"
                onClick={open ? () => setOpen(false) : state.token ? () => setOpen(true) : generate}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                aria-label="Share audit report"
            >
                {isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Share2 className="w-3.5 h-3.5" />
                )}
                Share
            </button>

            {open && shareUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
                    onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="share-dialog-title"
                        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h2 id="share-dialog-title" className="font-semibold text-base">Share audit report</h2>
                            <button
                                onClick={() => setOpen(false)}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <p className="text-xs text-muted-foreground mb-4">
                            Anyone with this link can view the audit scores and issues. No account details or personal information is shared. Link expires in <strong>{daysLeft} day{daysLeft !== 1 ? "s" : ""}</strong>.
                        </p>

                        <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-2 mb-4">
                            <span className="text-xs text-muted-foreground truncate flex-1 font-mono">{shareUrl}</span>
                            <button
                                onClick={copy}
                                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="Copy share link"
                            >
                                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>

                        {error && (
                            <p className="text-xs text-red-400 mb-4">{error}</p>
                        )}

                        <div className="flex items-center gap-2">
                            <button
                                onClick={copy}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-foreground text-background text-sm font-semibold py-2 rounded-lg hover:opacity-90 transition-all"
                            >
                                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                {copied ? "Copied!" : "Copy link"}
                            </button>
                            <a
                                href={shareUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 border border-border text-sm font-medium px-3 py-2 rounded-lg hover:bg-accent transition-colors"
                                aria-label="Open shared report in new tab"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <button
                                onClick={revoke}
                                disabled={isPending}
                                className="inline-flex items-center justify-center gap-1.5 border border-red-500/30 text-red-400 text-sm font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                aria-label="Revoke share link"
                            >
                                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
