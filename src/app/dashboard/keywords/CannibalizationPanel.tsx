"use client";
import { useState } from "react";
import { getCannibalizationIssues } from "@/app/actions/keywords";
import type { CannibalizationIssue } from "@/lib/gsc";

export function CannibalizationPanel({ siteId }: { siteId: string }) {
    const [issues,  setIssues]  = useState<CannibalizationIssue[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded,  setLoaded]  = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await getCannibalizationIssues(siteId);
            if (!res.success) { setError(res.error ?? "Failed"); return; }
            setIssues(res.issues ?? []);
            setLoaded(true);
        } finally {
            setLoading(false);
        }
    }

    const fixLabel: Record<CannibalizationIssue["suggestedFix"], string> = {
        merge:          "Merge competing pages into one canonical resource.",
        canonicalize:   "Add a canonical tag pointing weaker pages to the primary.",
        "internal-link": "Strengthen the primary page with internal links from competing pages.",
    };

    return (
        <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="font-semibold text-foreground">Keyword Cannibalization</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Pages competing for the same keyword split ranking signals and reduce overall visibility.
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium
                               hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                    {loading ? "Scanning…" : loaded ? "Rescan" : "Scan Now"}
                </button>
            </div>

            {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">{error}</p>
            )}

            {loaded && issues.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                    🎉 No cannibalization detected across your top 90-day keywords.
                </p>
            )}

            {issues.length > 0 && (
                <div className="mt-2 space-y-3">
                    {issues.map((issue) => (
                        <div
                            key={issue.keyword}
                            className="rounded-lg border border-border/60 bg-background px-4 py-3"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm text-foreground truncate">
                                        &ldquo;{issue.keyword}&rdquo;
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {issue.totalImpressions.toLocaleString()} impressions/month across{" "}
                                        {issue.urls.length} pages
                                    </p>
                                    <ul className="mt-2 space-y-1">
                                        {issue.urls.map((u) => (
                                            <li key={u.url} className="text-xs text-blue-500 hover:underline truncate">
                                                <a href={u.url} target="_blank" rel="noopener noreferrer">{u.url}</a>
                                                <span className="text-muted-foreground ml-2">#{u.position} · {u.clicks} clicks</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">
                                        Fix: {fixLabel[issue.suggestedFix]}
                                    </p>
                                </div>
                                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                                    issue.severity === "high"
                                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                        : issue.severity === "medium"
                                        ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                                        : "bg-muted text-muted-foreground"
                                }`}>
                                    {issue.severity}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
