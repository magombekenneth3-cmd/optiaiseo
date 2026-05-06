"use client";

import type { AeoDiagnosis } from "@/lib/aeo/diagnosis";

interface Props {
    diagnosis: AeoDiagnosis;
}

function gradeColor(grade: AeoDiagnosis["grade"]): string {
    switch (grade) {
        case "Critical": return "text-red-400";
        case "Poor": return "text-red-300";
        case "Fair": return "text-amber-400";
        case "Good": return "text-emerald-400";
        case "Excellent": return "text-emerald-300";
    }
}

function gradeBorder(grade: AeoDiagnosis["grade"]): string {
    switch (grade) {
        case "Critical": return "border-red-500/40";
        case "Poor": return "border-red-400/30";
        case "Fair": return "border-amber-500/30";
        case "Good": return "border-emerald-500/30";
        case "Excellent": return "border-emerald-400/40";
    }
}

function priorityBorder(priority: "Critical" | "High" | "Medium"): string {
    switch (priority) {
        case "Critical": return "border-l-red-500";
        case "High": return "border-l-amber-500";
        case "Medium": return "border-l-blue-500";
    }
}

function priorityBadgeStyle(priority: "Critical" | "High" | "Medium"): string {
    switch (priority) {
        case "Critical": return "bg-red-500/10 text-red-400 border border-red-500/30";
        case "High": return "bg-amber-500/10 text-amber-400 border border-amber-500/30";
        case "Medium": return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
    }
}

function categoryBadgeStyle(): string {
    return "bg-muted text-muted-foreground border border-border/50";
}

export function AeoDiagnosisPanel({ diagnosis }: Props) {
    const { score, grade, primaryProblem, explanation, competitorCounts, patterns, actionPlan } = diagnosis;

    const maxCompCount = Math.max(1, ...Object.values(competitorCounts));
    const competitors = Object.entries(competitorCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8);

    const quickWins = actionPlan.filter(a => a.effort === "30 minutes" || a.effort === "2 hours");

    return (
        <div className="flex flex-col gap-6">
            {/* ── Section 1: Score Card ─────────────────────────────────────────── */}
            <div className={`card-surface p-6 border ${gradeBorder(grade)}`}>
                <div className="flex flex-col md:flex-row md:items-start gap-6">
                    {/* Big score */}
                    <div className="shrink-0 flex flex-col items-center gap-1 min-w-[120px]">
                        <div className={`text-6xl font-black ${gradeColor(grade)}`}>{score}%</div>
                        <div className={`text-sm font-bold px-3 py-0.5 rounded-full border ${gradeBorder(grade)} ${gradeColor(grade)}`}>
                            {grade}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">Brand Visibility</div>
                    </div>
                    {/* Problem headline + explanation */}
                    <div className="flex-1 min-w-0">
                        <p className="text-base font-bold text-foreground mb-2 leading-snug">{primaryProblem}</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{explanation}</p>
                    </div>
                </div>
            </div>

            {/* ── Section 2: Pattern Flags ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    {
                        label: "Branded queries not citing you",
                        active: patterns.brandedQueriesFailing,
                        severe: false,
                    },
                    {
                        label: "Generic queries not citing you",
                        active: patterns.genericQueriesFailing,
                        severe: false,
                    },
                    {
                        label: "AI has no entity association",
                        active: patterns.irrelevantResultsOnBranded,
                        severe: true,
                    },
                    {
                        label: patterns.topCompetitors.length > 0
                            ? `Outranked by ${patterns.topCompetitors.slice(0, 2).join(", ")}`
                            : "No consistent competitor outranking",
                        active: patterns.topCompetitors.length > 0,
                        severe: false,
                    },
                ].map((flag, i) => (
                    <div
                        key={i}
                        className={`card-surface p-3 text-center text-xs font-semibold rounded-xl border transition-colors ${flag.active
                            ? flag.severe
                                ? "bg-red-500/10 border-red-500/40 text-red-300"
                                : "bg-red-500/5 border-red-500/20 text-red-400"
                            : "bg-muted/50 border-border/50 text-muted-foreground/80"
                            }`}
                    >
                        {flag.severe && flag.active && (
                            <span className="block text-base mb-1">⚠️</span>
                        )}
                        {flag.label}
                    </div>
                ))}
            </div>

            {/* ── Section 3: Competitor Visibility ─────────────────────────────── */}
            {competitors.length > 0 && (
                <div className="card-surface p-6">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                        Competitors recommended instead of you
                    </h3>
                    <div className="space-y-3">
                        {/* Your brand — always 0 */}
                        <div className="flex items-center gap-3">
                            <div className="w-32 text-xs text-red-400 font-semibold truncate shrink-0">Your Brand</div>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-red-500 rounded-full" style={{ width: `${(0 / maxCompCount) * 100}%` }} />
                            </div>
                            <div className="text-xs text-muted-foreground w-8 text-right">0</div>
                        </div>
                        {competitors.map(([name, count], i) => (
                            <div key={i} className="flex items-center gap-3">
                                <div className="w-32 text-xs text-muted-foreground truncate shrink-0" title={name}>{name}</div>
                                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 rounded-full transition-all"
                                        style={{ width: `${(count / maxCompCount) * 100}%` }}
                                    />
                                </div>
                                <div className="text-xs text-muted-foreground/80 w-8 text-right">{count}</div>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-4">Citations across all tracked queries</p>
                </div>
            )}

            {/* ── Section 4: Action Plan ────────────────────────────────────────── */}
            {actionPlan.length > 0 && (
                <div className="flex flex-col gap-4">
                    <h3 className="text-base font-bold text-foreground">
                        Action Plan <span className="text-muted-foreground font-normal text-sm">({actionPlan.length} items)</span>
                    </h3>
                    {actionPlan.map((item, i) => (
                        <div key={i} className={`card-surface border-l-4 ${priorityBorder(item.priority)} p-5`}>
                            <div className="flex items-start justify-between gap-4 mb-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${priorityBadgeStyle(item.priority)}`}>
                                            {item.priority}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${categoryBadgeStyle()}`}>
                                            {item.category}
                                        </span>
                                    </div>
                                    <h4 className="text-sm font-bold text-foreground leading-snug">{item.title}</h4>
                                </div>
                                <span className="text-xs text-muted-foreground shrink-0 mt-1 whitespace-nowrap">⏱ {item.effort}</span>
                            </div>
                            <p className="text-sm text-foreground/80 mb-1"><span className="font-semibold text-foreground/90">What:</span> {item.what}</p>
                            <p className="text-sm text-muted-foreground/80 mb-3"><span className="font-semibold text-muted-foreground">Why:</span> {item.why}</p>
                            <ol className="space-y-1 mb-3">
                                {item.howSteps.map((step, si) => (
                                    <li key={si} className="flex gap-2 text-xs text-muted-foreground/80">
                                        <span className="text-muted-foreground/60 font-bold shrink-0">{si + 1}.</span>
                                        <span>{step}</span>
                                    </li>
                                ))}
                            </ol>
                            <p className="text-xs text-muted-foreground italic">{item.estimatedImpact}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Section 5: Quick Wins ─────────────────────────────────────────── */}
            {quickWins.length > 0 && (
                <div className="card-surface p-5 border border-amber-500/20 bg-amber-500/5">
                    <h3 className="text-sm font-bold text-amber-400 mb-3">⚡ Start here — these can be done today</h3>
                    <ol className="space-y-2">
                        {quickWins.map((item, i) => (
                            <li key={i} className="flex gap-3 items-start text-sm">
                                <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                    {i + 1}
                                </span>
                                <div>
                                    <span className="font-semibold text-foreground/90">{item.title}</span>
                                    <span className="text-muted-foreground ml-2 text-xs">({item.effort})</span>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
}
