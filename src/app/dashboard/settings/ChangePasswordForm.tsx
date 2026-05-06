"use client";

import { useState, useTransition } from "react";
import { changePassword } from "@/app/actions/user";
import { PasswordStrength } from "@/components/auth/PasswordStrength";

export function ChangePasswordForm() {
    const [current, setCurrent] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirm, setConfirm] = useState("");
    // Independent show/hide per field
    const [showCurrentPw, setShowCurrentPw] = useState(false);
    const [showNewPw, setShowNewPw] = useState(false);
    const [showConfirmPw, setShowConfirmPw] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [isPending, startTransition] = useTransition();

    const mismatch = confirm.length > 0 && newPw !== confirm;
    const canSubmit = current.length > 0 && newPw.length >= 8 && newPw === confirm && !isPending;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSuccess(false);
        startTransition(async () => {
            const result = await changePassword(current, newPw);
            if (!result.success) {
                setError(result.error ?? "Failed to change password.");
            } else {
                setSuccess(true);
                setCurrent(""); setNewPw(""); setConfirm("");
            }
        });
    }

    const inputClass = "w-full px-4 py-2.5 bg-card border border-border rounded-xl text-sm placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all disabled:opacity-50";

    const EyeIcon = ({ show }: { show: boolean }) => (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {show ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            ) : (
                <>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </>
            )}
        </svg>
    );

    return (
        <div className="card-surface p-6">
            <div className="flex items-start gap-4 mb-5">
                <div className="w-10 h-10 rounded-xl bg-accent border border-border flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-base font-bold mb-0.5">Change Password</h2>
                    <p className="text-sm text-muted-foreground">Update your account password. You&apos;ll stay logged in on this device.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>
                )}
                {success && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Password updated successfully.
                    </div>
                )}

                {/* Current password */}
                <div>
                    <label htmlFor="cp-current" className="block text-sm font-medium text-muted-foreground mb-1.5">Current password</label>
                    <div className="relative">
                        <input id="cp-current" type={showCurrentPw ? "text" : "password"} value={current}
                            onChange={e => setCurrent(e.target.value)} disabled={isPending}
                            className={`${inputClass} pr-10`} placeholder="••••••••" autoComplete="current-password" />
                        <button type="button" tabIndex={-1} onClick={() => setShowCurrentPw(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-zinc-300">
                            <EyeIcon show={showCurrentPw} />
                        </button>
                    </div>
                </div>

                {/* New password */}
                <div>
                    <label htmlFor="cp-new" className="block text-sm font-medium text-muted-foreground mb-1.5">New password</label>
                    <div className="relative">
                        <input id="cp-new" type={showNewPw ? "text" : "password"} value={newPw} minLength={8}
                            onChange={e => setNewPw(e.target.value)} disabled={isPending}
                            className={`${inputClass} pr-10`} placeholder="Min. 8 characters" autoComplete="new-password" />
                        <button type="button" tabIndex={-1} onClick={() => setShowNewPw(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-zinc-300">
                            <EyeIcon show={showNewPw} />
                        </button>
                    </div>
                    <PasswordStrength password={newPw} />
                </div>

                {/* Confirm password */}
                <div>
                    <label htmlFor="cp-confirm" className="block text-sm font-medium text-muted-foreground mb-1.5">Confirm new password</label>
                    <div className="relative">
                        <input id="cp-confirm" type={showConfirmPw ? "text" : "password"} value={confirm}
                            onChange={e => setConfirm(e.target.value)} disabled={isPending}
                            className={`${inputClass} pr-10 ${mismatch ? "border-rose-500/50 focus:ring-rose-500/30" : ""}`}
                            placeholder="Repeat new password" autoComplete="new-password" />
                        <button type="button" tabIndex={-1} onClick={() => setShowConfirmPw(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-zinc-300">
                            <EyeIcon show={showConfirmPw} />
                        </button>
                    </div>
                    {mismatch && <p className="text-xs text-rose-400 mt-1">Passwords do not match</p>}
                </div>

                <button type="submit" disabled={!canSubmit}
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                    {isPending ? (
                        <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>Updating…</>
                    ) : "Update Password"}
                </button>
            </form>
        </div>
    );
}
