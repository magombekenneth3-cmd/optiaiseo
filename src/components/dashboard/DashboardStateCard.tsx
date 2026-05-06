"use client";

import Link from "next/link";
import { Globe, Zap, ClipboardList, Loader2, CheckCircle, ChevronRight, Sparkles } from "lucide-react";

// ── 4.2: Five dashboard states ────────────────────────────────────────────────
export type DashboardState =
    | "no_site"
    | "no_audit"
    | "audit_complete"
    | "fix_in_progress"
    | "all_done";

export interface DashboardStateCardProps {
    state: DashboardState;
    domain?: string;
    siteId?: string;
    topIssue?: string;
    topIssueId?: string;
    jobId?: string;
    overallScore?: number;
}

export function DashboardStateCard({
    state,
    domain,
    siteId,
    topIssue,
    topIssueId,
    jobId,
    overallScore,
}: DashboardStateCardProps) {
    // State 1: No site added
    if (state === "no_site") {
        return (
            <div className="card-elevated p-8 text-center space-y-4 max-w-md mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto">
                    <Globe className="w-7 h-7 text-brand" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-foreground">Add your first site</h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        Tell OptiAISEO which domain you want to optimise. It only takes 30 seconds.
                    </p>
                </div>
                <Link
                    href="/dashboard/sites/new"
                    id="state-add-site"
                    className="inline-flex items-center gap-2 btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold"
                >
                    Add your site <ChevronRight className="w-4 h-4" />
                </Link>
            </div>
        );
    }

    // State 2: Site added, no audit yet
    if (state === "no_audit") {
        return (
            <div className="card-elevated p-8 text-center space-y-4 max-w-md mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto">
                    <ClipboardList className="w-7 h-7 text-emerald-400" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-foreground">Run your first audit</h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        {domain
                            ? `Scan ${domain} for SEO issues — takes about 2 minutes.`
                            : "Start your first SEO audit now — takes about 2 minutes."}
                    </p>
                </div>
                <Link
                    href={siteId ? `/dashboard/audits?siteId=${siteId}` : "/dashboard/audits"}
                    id="state-run-audit"
                    className="inline-flex items-center gap-2 btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold"
                >
                    <Zap className="w-4 h-4" /> Start audit
                </Link>
                <p className="text-xs text-muted-foreground">Estimated time: ~2 minutes</p>
            </div>
        );
    }

    // State 3: Audit complete — show the one priority fix
    if (state === "audit_complete") {
        return (
            <div className="card-elevated p-6 max-w-lg mx-auto space-y-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                        <Zap className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-foreground">Top fix this week</h2>
                        <p className="text-xs text-muted-foreground">
                            Overall score:{" "}
                            <span className="font-semibold text-foreground">{overallScore ?? "—"}/100</span>
                        </p>
                    </div>
                </div>

                <div className="p-4 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                    <p className="text-sm font-medium text-foreground leading-snug">
                        {topIssue ?? "No issues found — great work!"}
                    </p>
                </div>

                <div className="flex gap-2 flex-wrap">
                    {topIssueId && siteId && (
                        <Link
                            href={`/dashboard/audits?siteId=${siteId}&issueId=${topIssueId}`}
                            id="state-view-fix"
                            className="inline-flex items-center gap-1.5 btn-primary px-4 py-2 rounded-lg text-sm font-semibold"
                        >
                            View fix <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                    )}
                    <Link
                        href="/dashboard/voice"
                        id="state-ask-aria"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                        Ask Aria to fix it
                    </Link>
                </div>
            </div>
        );
    }

    // State 4: Fix in progress — JobPoller-like tracking card
    if (state === "fix_in_progress") {
        return (
            <div className="card-elevated p-6 max-w-lg mx-auto space-y-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                        <Loader2 className="w-5 h-5 text-brand animate-spin" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-foreground">Tracking your fix</h2>
                        <p className="text-xs text-muted-foreground">
                            We&apos;re monitoring the impact of your recent change on {domain ?? "your site"}.
                        </p>
                    </div>
                </div>

                <div className="space-y-2">
                    {["Fix applied", "Checking Google cache", "Monitoring rankings"].map((step, i) => (
                        <div key={step} className="flex items-center gap-2.5 text-xs">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                                i === 0 ? "bg-emerald-500" : i === 1 ? "bg-brand animate-pulse" : "bg-muted"
                            }`}>
                                {i === 0 && <CheckCircle className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <span className={i === 0 ? "text-foreground" : "text-muted-foreground"}>{step}</span>
                        </div>
                    ))}
                </div>

                <p className="text-xs text-muted-foreground">
                    Full impact measured in ~30 days.{" "}
                    <Link href="/dashboard/audits" className="text-brand underline underline-offset-2">
                        View all audits →
                    </Link>
                </p>
            </div>
        );
    }

    // State 5: All done — suggest next level
    if (state === "all_done") {
        return (
            <div className="card-elevated p-8 text-center space-y-4 max-w-md mx-auto">
                <div className="relative mx-auto w-14 h-14">
                    <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-sm" />
                    <div className="relative w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                        <CheckCircle className="w-7 h-7 text-emerald-400" />
                    </div>
                </div>
                <div>
                    <h2 className="text-lg font-bold text-foreground">Ready for the next level</h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        You&apos;ve cleared your top SEO issues. Now boost your AI search visibility.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                    <Link
                        href={siteId ? `/dashboard/aeo?siteId=${siteId}` : "/dashboard/aeo"}
                        id="state-aeo-audit"
                        className="inline-flex items-center gap-2 btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold"
                    >
                        <Sparkles className="w-4 h-4" /> Run AEO Audit
                    </Link>
                    <Link
                        href="/dashboard/blogs"
                        id="state-generate-content"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                        Generate Content
                    </Link>
                </div>
            </div>
        );
    }

    return null;
}
