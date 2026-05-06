"use client";

import { useState, useTransition, useRef } from "react";
import { deleteAccount } from "@/app/actions/user";
import { signOut } from "next-auth/react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export function DeleteAccountButton() {
    const [open, setOpen] = useState(false);
    const [typed, setTyped] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef   = useRef<HTMLDivElement>(null);
    useFocusTrap(panelRef, open, triggerRef);

    const confirmed = typed.trim() === CONFIRM_PHRASE;

    function handleOpen() {
        setOpen(true);
        setTyped("");
        setError(null);
    }

    function handleCancel() {
        setOpen(false);
        setTyped("");
        setError(null);
    }

    function handleDelete() {
        if (!confirmed) return;
        startTransition(async () => {
            const result = await deleteAccount();
            if (!result.success) {
                setError(result.error ?? "Failed to delete account. Please try again.");
                return;
            }
            // Sign out client-side and redirect to home
            await signOut({ callbackUrl: "/" });
        });
    }

    return (
        <>
            {/* Trigger button */}
            <button
                ref={triggerRef}
                onClick={handleOpen}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg
                           bg-rose-500/10 text-rose-400 border border-rose-500/25
                           hover:bg-rose-500/20 hover:border-rose-500/40
                           text-sm font-semibold transition-colors"
                aria-haspopup="dialog"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Account
            </button>

            {/* Modal overlay */}
            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
                    onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}
                >
                    <div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-account-title"
                        aria-describedby="delete-account-desc"
                        tabIndex={-1}
                        className="relative w-full max-w-md rounded-2xl border border-rose-500/30 bg-[#0f0f11] shadow-2xl shadow-rose-900/20 p-6 flex flex-col gap-5 focus:outline-none"
                    >
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center shrink-0" aria-hidden="true">
                                <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <div>
                                <h2 id="delete-account-title" className="text-base font-bold text-white">Delete Account</h2>
                                <p id="delete-account-desc" className="text-sm text-muted-foreground mt-0.5">
                                    This action is <strong className="text-rose-400">permanent and irreversible</strong>.
                                </p>
                            </div>
                        </div>

                        {/* What gets deleted */}
                        <div className="rounded-xl bg-rose-500/5 border border-rose-500/15 p-4">
                            <p className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-2">The following will be permanently deleted</p>
                            <ul className="text-xs text-muted-foreground space-y-1">
                                {[
                                    "Your account and profile",
                                    "All registered sites and their settings",
                                    "All SEO audit reports",
                                    "All blog posts (drafts & published)",
                                    "All keyword, AEO, and competitor data",
                                    "All rank snapshots and on-page reports",
                                    "Billing subscription (cancels immediately)",
                                    "All active sessions (signed out everywhere)",
                                ].map((item) => (
                                    <li key={item} className="flex items-center gap-2">
                                        <span className="w-1 h-1 rounded-full bg-rose-500/70 shrink-0" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Confirmation input */}
                        <div className="flex flex-col gap-2">
                            <label htmlFor="delete-confirm-input" className="text-xs text-muted-foreground">
                                Type <span className="font-mono font-bold text-rose-400">{CONFIRM_PHRASE}</span> to confirm
                            </label>
                            <input
                                id="delete-confirm-input"
                                type="text"
                                value={typed}
                                onChange={(e) => { setTyped(e.target.value); setError(null); }}
                                placeholder={CONFIRM_PHRASE}
                                disabled={isPending}
                                aria-invalid={!!error}
                                aria-describedby={error ? "delete-confirm-error" : undefined}
                                className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm
                                           text-white placeholder:text-muted-foreground outline-none
                                           focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/30
                                           disabled:opacity-50 transition-colors font-mono"
                            />
                            {error && (
                                <p id="delete-confirm-error" role="alert" className="text-xs text-rose-400">{error}</p>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={handleCancel}
                                disabled={isPending}
                                className="px-4 py-2 rounded-lg bg-muted border border-border
                                           text-sm font-medium text-muted-foreground
                                           hover:bg-white/10 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={!confirmed || isPending}
                                aria-busy={isPending}
                                aria-disabled={!confirmed || isPending}
                                className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors
                                           bg-rose-600 text-white hover:bg-rose-500
                                           disabled:opacity-40 disabled:cursor-not-allowed
                                           flex items-center gap-2"
                            >
                                {isPending ? (
                                    <>
                                        <svg role="status" aria-label="Deleting account…" className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        Deleting…
                                    </>
                                ) : (
                                    "Permanently Delete"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
