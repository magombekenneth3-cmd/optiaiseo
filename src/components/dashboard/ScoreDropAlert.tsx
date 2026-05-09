import Link from "next/link";
import { AlertTriangle } from "lucide-react";

interface Props {
    delta: number;          // positive number — points lost
    topIssue: string | null;
    auditId: string | null;
}

/**
 * ScoreDropAlert
 * ─────────────────────────────────────────────────────────────────────────────
 * Shown on the dashboard when the SEO score dropped by ≥8 points since the
 * previous audit. Provides a clear cause (top failing issue) and a direct
 * deep-link to the audit detail so the user knows the next action immediately.
 *
 * Server component — no client-side state required.
 */
export function ScoreDropAlert({ delta, topIssue, auditId }: Props) {
    return (
        <div
            role="alert"
            className="fade-in-up w-full rounded-2xl border border-rose-500/30 bg-rose-950/40 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-[0_4px_24px_-8px_rgba(239,68,68,0.2)]"
        >
            {/* Icon */}
            <div className="shrink-0 w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
            </div>

            {/* Copy */}
            <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-400/70 mb-0.5">
                    ⚠️ Score Alert
                </p>
                <p className="text-sm font-bold text-foreground leading-snug">
                    Your SEO score dropped {delta} point{delta !== 1 ? "s" : ""} since the last audit
                </p>
                {topIssue && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Top cause: <span className="text-rose-300 font-medium">{topIssue}</span>
                    </p>
                )}
            </div>

            {/* CTA */}
            {auditId ? (
                <Link
                    href={`/dashboard/audits/${auditId}`}
                    className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-md"
                >
                    Fix now →
                </Link>
            ) : (
                <Link
                    href="/dashboard/audits"
                    className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-md"
                >
                    Run a new audit →
                </Link>
            )}
        </div>
    );
}
