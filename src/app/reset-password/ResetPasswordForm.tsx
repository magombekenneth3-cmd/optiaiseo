"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { resetPassword, validateResetToken } from "@/app/actions/passwordReset";
import { PasswordStrength } from "@/components/auth/PasswordStrength";

type PageState = "loading" | "invalid" | "form" | "success";

// FIX #6 (DX): Extract shared eye icon components to eliminate 4× duplication
function EyeOffIcon() {
    return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
        </svg>
    );
}

function EyeIcon() {
    return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
    );
}

function ToggleVisibilityButton({
    visible,
    onToggle,
    label,
}: {
    visible: boolean;
    onToggle: () => void;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            tabIndex={-1}
            aria-label={label}
        >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
    );
}

// Minimum password strength score to allow submission (0–4 scale)
const MIN_STRENGTH_SCORE = 2;

// Mirror the strength heuristic locally so we can gate form submission
// without needing to modify the PasswordStrength component's props.
function scorePassword(pw: string): number {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
}

export function ResetPasswordForm({ token }: { token: string }) {
    const [pageState, setPageState] = useState<PageState>("loading");
    // FIX #3 (server): emailDomain only — never expose the full address
    const [emailDomain, setEmailDomain] = useState<string | undefined>(undefined);
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    // FIX #7 (UX): track strength score derived locally — no prop needed on PasswordStrength
    const [strengthScore, setStrengthScore] = useState(0);
    const [showNewPw, setShowNewPw] = useState(false);
    const [showConfirmPw, setShowConfirmPw] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    // Keep score in sync with password value
    useEffect(() => {
        setStrengthScore(scorePassword(password));
    }, [password]);

    useEffect(() => {
        // FIX #5: Guard against empty/junk tokens before even hitting the server
        if (!token || token.trim().length < 10) {
            setPageState("invalid");
            return;
        }
        validateResetToken(token).then(({ valid, emailDomain }) => {
            if (valid) {
                setEmailDomain(emailDomain);
                setPageState("form");
            } else {
                setPageState("invalid");
            }
        });
    }, [token]);

    // FIX #7 (UX): Gate submission on both length/match AND minimum strength
    const passwordValid =
        password.length >= 8 &&
        password === confirm &&
        strengthScore >= MIN_STRENGTH_SCORE;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
        if (password !== confirm) { setError("Passwords do not match."); return; }
        if (strengthScore < MIN_STRENGTH_SCORE) { setError("Please choose a stronger password."); return; }

        startTransition(async () => {
            const result = await resetPassword(token, password);
            if (!result.success) {
                // FIX #4: Detect expired/invalid tokens from the error message and
                // transition to the invalid state so the user sees the actionable
                // "Request new link" CTA rather than a generic inline error.
                const isTokenError =
                    result.error?.toLowerCase().includes("invalid") ||
                    result.error?.toLowerCase().includes("expired") ||
                    result.error?.toLowerCase().includes("already been used");
                if (isTokenError) {
                    setPageState("invalid");
                } else {
                    setError(result.error ?? "Something went wrong.");
                }
            } else {
                setPageState("success");
            }
        });
    }

    /* ── Loading ── */
    if (pageState === "loading") {
        return (
            <div className="flex items-center justify-center py-10 gap-3 text-muted-foreground text-sm">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Verifying reset link…
            </div>
        );
    }

    /* ── Invalid / Expired ── */
    if (pageState === "invalid") {
        return (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center">
                    <svg className="w-7 h-7 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
                    </svg>
                </div>
                <p className="text-base font-semibold text-white">Link invalid or expired</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                    This password reset link is invalid or has expired (links are valid for 1 hour). Please request a new one.
                </p>
                <Link
                    href="/forgot-password"
                    className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-foreground text-background font-bold rounded-xl text-sm transition-colors hover:opacity-90"
                >
                    Request new link
                </Link>
            </div>
        );
    }

    /* ── Success ── */
    if (pageState === "success") {
        return (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                    <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <p className="text-base font-semibold text-white">Password updated!</p>
                <p className="text-sm text-muted-foreground">
                    Your password has been changed successfully.
                </p>
                <Link href="/login" className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium">
                    Sign in now →
                </Link>
            </div>
        );
    }

    /* ── Form ── */
    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {/* FIX #3: Show only domain, not full email, to avoid confirming account existence */}
            {emailDomain && (
                <p className="text-sm text-center text-muted-foreground">
                    Resetting password for an account at <strong className="text-zinc-300">@{emailDomain}</strong>
                </p>
            )}

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
                    {error}
                </div>
            )}

            {/* New Password */}
            <div>
                <label htmlFor="rp-password" className="block text-sm font-medium text-zinc-400 mb-1.5">
                    New password
                </label>
                <div className="relative">
                    <input
                        id="rp-password"
                        type={showNewPw ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        // FIX #2: Add minLength for native browser validation as defence-in-depth
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isPending}
                        className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-sm
                       placeholder-zinc-600 focus:outline-none focus:ring-2
                       focus:ring-emerald-500/50 focus:border-emerald-500/50
                       transition-all disabled:opacity-50 pr-11"
                        placeholder="••••••••"
                    />
                    <ToggleVisibilityButton
                        visible={showNewPw}
                        onToggle={() => setShowNewPw((v) => !v)}
                        label={showNewPw ? "Hide password" : "Show password"}
                    />
                </div>
                {/* FIX #7: Wrap PasswordStrength in a div with a data attribute trick —
            since the existing component doesn't expose onScoreChange, we measure
            strength independently using the same heuristic the component uses. */}
                <PasswordStrength password={password} />
                {password.length > 0 && strengthScore < MIN_STRENGTH_SCORE && (
                    <p className="text-xs text-amber-400 mt-1">Please choose a stronger password</p>
                )}
            </div>

            {/* Confirm Password */}
            <div>
                <label htmlFor="rp-confirm" className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Confirm new password
                </label>
                <div className="relative">
                    <input
                        id="rp-confirm"
                        type={showConfirmPw ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        disabled={isPending}
                        className={`w-full px-4 py-3 bg-black/50 border rounded-xl text-sm placeholder-zinc-600
                        focus:outline-none focus:ring-2 transition-all disabled:opacity-50 pr-11
                        ${confirm && password !== confirm
                                ? "border-rose-500/50 focus:ring-rose-500/30"
                                : "border-white/10 focus:ring-emerald-500/50 focus:border-emerald-500/50"}`}
                        placeholder="••••••••"
                    />
                    <ToggleVisibilityButton
                        visible={showConfirmPw}
                        onToggle={() => setShowConfirmPw((v) => !v)}
                        label={showConfirmPw ? "Hide confirm password" : "Show confirm password"}
                    />
                </div>
                {confirm && password !== confirm && (
                    <p className="text-xs text-rose-400 mt-1">Passwords do not match</p>
                )}
            </div>

            <button
                type="submit"
                // FIX #7: Disabled until password is strong enough, matches, and meets length
                disabled={isPending || !passwordValid}
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
                        Updating…
                    </>
                ) : (
                    "Set New Password"
                )}
            </button>
        </form>
    );
}