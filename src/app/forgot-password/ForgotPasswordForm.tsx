"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/passwordReset";

export function ForgotPasswordForm() {
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    // Resend cooldown state
    const [canResend, setCanResend] = useState(false);
    const [resendCountdown, setResendCountdown] = useState(30);

    // Start 30-second cooldown after email is sent
    useEffect(() => {
        if (!sent) return;
        setCanResend(false);
        setResendCountdown(30);

        const interval = setInterval(() => {
            setResendCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    setCanResend(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [sent]);

    async function doSend() {
        setError(null);
        startTransition(async () => {
            const result = await requestPasswordReset(email.trim().toLowerCase());
            if (!result.success) {
                setError(result.error ?? "Something went wrong. Please try again.");
            } else {
                if (sent) {
                    // Resend — restart the countdown
                    setCanResend(false);
                    setResendCountdown(30);
                } else {
                    setSent(true);
                }
            }
        });
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        doSend();
    }

    function handleResend() {
        if (!canResend || isPending) return;
        setCanResend(false);
        setResendCountdown(30);
        doSend();
    }

    return (
        <>
            {sent ? (
                /* ── Success state ── */
                <div className="flex flex-col items-center gap-4 py-4">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                        <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <div className="text-center">
                        <p className="text-base font-semibold text-white mb-1">Check your inbox</p>
                        <p className="text-sm text-muted-foreground">
                            If <strong className="text-zinc-300">{email}</strong> is registered, you&apos;ll receive a reset link within a minute. Check your spam folder too.
                        </p>
                    </div>
                    <p className="text-xs text-zinc-500 text-center">
                        If you didn&apos;t request this, you can safely ignore this email.
                    </p>
                    <p className="text-xs text-zinc-600 text-center">The link expires in 1 hour and can only be used once.</p>

                    {/* Resend button with cooldown */}
                    {canResend ? (
                        <button
                            onClick={handleResend}
                            disabled={isPending}
                            className="text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                        >
                            {isPending ? "Sending…" : "Resend email"}
                        </button>
                    ) : (
                        <p className="text-xs text-zinc-600">
                            Resend in {resendCountdown}s
                        </p>
                    )}

                    <Link
                        href="/login"
                        className="mt-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                        ← Back to sign in
                    </Link>
                </div>
            ) : (
                /* ── Form state ── */
                <form onSubmit={handleSubmit} className="space-y-5">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
                            {error}
                        </div>
                    )}

                    <div>
                        <label htmlFor="fp-email" className="block text-sm font-medium text-zinc-400 mb-1.5">
                            Email address
                        </label>
                        <input
                            id="fp-email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isPending}
                            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-sm
                                       placeholder-zinc-600 focus:outline-none focus:ring-2
                                       focus:ring-emerald-500/50 focus:border-emerald-500/50
                                       transition-all disabled:opacity-50"
                            placeholder="you@example.com"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isPending || !email}
                        className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold
                                   rounded-xl text-sm shadow-[0_0_20px_rgba(16,185,129,0.3)]
                                   hover:shadow-[0_0_25px_rgba(16,185,129,0.45)]
                                   transition-all disabled:opacity-50 disabled:cursor-not-allowed
                                   flex items-center justify-center gap-2"
                    >
                        {isPending ? (
                            <>
                                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Sending…
                            </>
                        ) : (
                            "Send Reset Link"
                        )}
                    </button>

                    <div className="text-center">
                        <Link href="/login" className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors">
                            ← Back to sign in
                        </Link>
                    </div>
                </form>
            )}
        </>
    );
}
