"use client";

/**
 * QuickWinCard
 * ────────────
 * Shows the single highest-impact unfixed audit issue on the dashboard.
 * Pulls the top "Fail" item from the most recent audit and presents it
 * as an actionable card with a direct link to the audit detail.
 *
 * Server-rendered — receives props from dashboard/page.tsx.
 * No client fetch — zero additional DB calls.
 */

import Link from "next/link";
import { Zap, ArrowRight, CheckCircle2 } from "lucide-react";

interface Props {
    /** Top-priority unfixed issue label from the latest audit */
    issueLabel:  string;
    /** ID of the latest audit for the deep-link */
    auditId:     string;
    /** Overall SEO score for context */
    score:       number;
    /** Category the issue belongs to (e.g. "Performance", "SEO") */
    category?:   string;
}

export function QuickWinCard({ issueLabel, auditId, score, category }: Props) {
    const scorePct = Math.min(100, Math.max(0, score));
    const urgencyColor =
        scorePct < 50  ? "border-rose-500/30 bg-rose-500/5"
        : scorePct < 70 ? "border-amber-500/30 bg-amber-500/5"
        :                  "border-emerald-500/30 bg-emerald-500/5";
    const dotColor =
        scorePct < 50  ? "bg-rose-400"
        : scorePct < 70 ? "bg-amber-400"
        :                  "bg-emerald-400";
    const labelColor =
        scorePct < 50  ? "text-rose-400"
        : scorePct < 70 ? "text-amber-400"
        :                  "text-emerald-400";

    return (
        <div className={`rounded-2xl border p-5 flex items-start gap-4 ${urgencyColor}`}>
            {/* Icon */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                scorePct < 50  ? "bg-rose-500/10 border-rose-500/20"
                : scorePct < 70 ? "bg-amber-500/10 border-amber-500/20"
                :                  "bg-emerald-500/10 border-emerald-500/20"
            }`}>
                <Zap className={`w-4 h-4 ${labelColor}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Your #1 Quick Win
                    </span>
                    {category && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${
                            scorePct < 50
                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
                                : "bg-muted text-muted-foreground border-border"
                        }`}>
                            {category}
                        </span>
                    )}
                </div>
                <p className="text-sm font-semibold text-foreground leading-snug">
                    {issueLabel}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                    Fixing this alone could meaningfully improve your site score.
                </p>
            </div>

            {/* CTA */}
            <Link
                href={`/dashboard/audits/${auditId}`}
                className={`shrink-0 self-center flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-xl border transition-all hover:scale-[1.02] active:scale-95 ${
                    scorePct < 50
                        ? "bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/30"
                        : scorePct < 70
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/30"
                        : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30"
                }`}
            >
                Fix it <ArrowRight className="w-3.5 h-3.5" />
            </Link>
        </div>
    );
}

/** Empty state: shown when all audit issues are resolved */
export function QuickWinAllClear() {
    return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-[18px] h-[18px] text-emerald-400" />
            </div>
            <div>
                <p className="text-sm font-semibold text-foreground">All clear — no critical issues</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                    Your latest audit shows no failing checks. Run a new audit to stay ahead.
                </p>
            </div>
            <Link
                href="/dashboard/audits"
                className="ml-auto shrink-0 text-[12px] font-bold px-3.5 py-2 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all flex items-center gap-1.5"
            >
                Run audit <ArrowRight className="w-3.5 h-3.5" />
            </Link>
        </div>
    );
}
