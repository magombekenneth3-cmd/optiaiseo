/**
 * src/lib/ui/action-errors.tsx
 *
 * Centralised error-to-toast mapper for server action responses.
 *
 * Usage:
 *   import { showActionError } from "@/lib/ui/action-errors";
 *
 *   const res = await generateBlog(...);
 *   if (!res.success) { showActionError(res); return; }
 *
 * Rules:
 *  - Every structured error code gets a purpose-built message + CTA.
 *  - Generic errors fall through to a sensible default.
 *  - Never expose raw server stack traces to the user.
 */
"use client";

import { toast } from "sonner";
import { Zap, CreditCard, AlertTriangle, Clock, ShieldAlert } from "lucide-react";

// ── Canonical error codes returned by server actions ────────────────────────

export type ActionErrorCode =
    | "insufficient_credits"
    | "TIER_INSUFFICIENT"
    | "rate_limit"
    | "unauthorized"
    | string;           // future-proof for unknown codes

interface ActionFailResult {
    success: false;
    error?: string;
    code?: ActionErrorCode;
}

// ── Toast duration constants ─────────────────────────────────────────────────
const DURATION_NORMAL   = 8_000;
const DURATION_CRITICAL = 12_000;   // credits / tier — user needs time to read + act

// ── Main handler ─────────────────────────────────────────────────────────────

/**
 * showActionError(result)
 *
 * Call this whenever a server action returns { success: false }.
 * It shows a richly formatted, code-aware toast with upgrade CTAs where relevant.
 */
export function showActionError(result: ActionFailResult): void {
    const code    = result.code ?? "";
    const message = result.error ?? "Something went wrong. Please try again.";

    switch (code) {
        // ── Out of credits ────────────────────────────────────────────────────
        case "insufficient_credits":
            toast.error(
                <InsufficientCreditsToast message={message} />,
                { duration: DURATION_CRITICAL, id: "insufficient-credits" }
            );
            return;

        // ── Plan gate (requireTiers / requireFeature threw TierError) ─────────
        case "TIER_INSUFFICIENT":
            toast.error(
                <TierGateToast message={message} />,
                { duration: DURATION_CRITICAL, id: "tier-gate" }
            );
            return;

        // ── Rate limit ────────────────────────────────────────────────────────
        case "rate_limit":
            toast.error(
                <RateLimitToast message={message} />,
                { duration: DURATION_NORMAL, id: "rate-limit" }
            );
            return;

        // ── Unauthenticated ───────────────────────────────────────────────────
        case "unauthorized":
            toast.error(
                <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-sm">Session expired</span>
                        <span className="text-xs opacity-80">Please sign in again to continue.</span>
                        <a href="/auth/signin" className="text-xs text-blue-400 underline underline-offset-2 hover:text-blue-300 mt-1">
                            Sign in →
                        </a>
                    </div>
                </div>,
                { duration: DURATION_NORMAL }
            );
            return;

        // ── Generic fallback ─────────────────────────────────────────────────
        default:
            toast.error(
                <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-sm">Action failed</span>
                        <span className="text-xs opacity-80">{message}</span>
                    </div>
                </div>,
                { duration: DURATION_NORMAL }
            );
    }
}

// ── Sub-components (rendered inside sonner toasts) ───────────────────────────

function InsufficientCreditsToast({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2.5 min-w-[260px]">
            <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
                <span className="font-semibold text-sm">Not enough credits</span>
                <span className="text-xs opacity-80 leading-relaxed">{message}</span>
                <div className="flex items-center gap-2 mt-1.5">
                    <a
                        href="/dashboard/billing"
                        className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg transition-colors"
                    >
                        <CreditCard className="w-3 h-3" />
                        Buy Credits
                    </a>
                    <a
                        href="/dashboard/billing"
                        className="text-xs text-amber-400 underline underline-offset-2 hover:text-amber-300"
                    >
                        Upgrade plan →
                    </a>
                </div>
            </div>
        </div>
    );
}

function TierGateToast({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2.5 min-w-[260px]">
            <ShieldAlert className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
                <span className="font-semibold text-sm">Plan upgrade required</span>
                <span className="text-xs opacity-80 leading-relaxed">{message}</span>
                <a
                    href="/dashboard/billing"
                    className="inline-flex items-center gap-1 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg transition-colors mt-1.5 w-fit"
                >
                    <Zap className="w-3 h-3" />
                    Upgrade Now →
                </a>
            </div>
        </div>
    );
}

function RateLimitToast({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-sm">Slow down!</span>
                <span className="text-xs opacity-80 leading-relaxed">{message}</span>
            </div>
        </div>
    );
}
