"use client";

import { useState, useTransition, useEffect, Fragment } from "react";
import { runSeoResearch, enrichSeoResearch, runTrendRefresh } from "@/app/actions/keywordDiscovery";
import { saveKeywordsToPlanner } from "@/app/actions/planner";
import type {
    SeoResearchReport,
    KeywordRow,
    MasterListRow,
    TrendRow,
    TrendStatus,
    CompetitorGapRow,
    ContentCalendarItem,
    TopicalCluster,
    ResearchEvidenceMeta,
} from "@/lib/keywords/seoResearch";


const intentColors: Record<string, string> = {
    informational: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    commercial: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    transactional: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    navigational: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
};

const typeColors: Record<string, string> = {
    "Short-tail": "bg-zinc-700/60 text-zinc-300",
    "Long-tail": "bg-blue-500/10 text-blue-300",
    "Competitive": "bg-red-500/10 text-red-300",
    "Informational": "bg-sky-500/10 text-sky-300",
    "Trending": "bg-orange-500/10 text-orange-300",
    "Question": "bg-violet-500/10 text-violet-300",
    "Local/Regional": "bg-teal-500/10 text-teal-300",
    "Semantic/LSI": "bg-indigo-500/10 text-indigo-300",
};

const priorityColors: Record<string, string> = {
    High: "bg-red-500/10 text-red-400 border-red-500/20",
    Medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Low: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
};

const roadmapColors: Record<string, string> = {
    "Week 1": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    "Month 1": "bg-blue-500/10 text-blue-400 border-blue-500/20",
    "Month 2-3": "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const trendColors: Record<TrendStatus, string> = {
    Rising: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Steady: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    Declining: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    Observed: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    Unknown: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
};

const trendArrows: Record<TrendStatus, string> = {
    Rising: "↗",
    Steady: "→",
    Declining: "↘",
    Observed: "◉",
    Unknown: "·",
};

const gapLabels: Record<string, string> = {
    MISSING: "You don't rank",
    UNDERPERFORMING: "Outranked",
    WEAKLY_DEFENDED: "Contested",
    NEW_OPPORTUNITY: "Open field",
    DOMINATED: "Dominated",
};

// ── Formatting helpers ──────────────────────────────────────────────────────

const NOT_MEASURED = "—";

function fmtNum(n: number | null | undefined): string {
    return typeof n === "number" ? n.toLocaleString() : NOT_MEASURED;
}

function kdClasses(kd: number): { bar: string; text: string } {
    if (kd < 30) return { bar: "bg-emerald-500", text: "text-emerald-400" };
    if (kd < 60) return { bar: "bg-amber-500", text: "text-amber-400" };
    return { bar: "bg-red-500", text: "text-red-400" };
}

function serpTone(score: number): string {
    return score >= 7 ? "text-emerald-400" : score >= 4 ? "text-amber-400" : "text-red-400";
}

/** A report cached before the evidence refactor carries AI-invented metrics — discard it. */
function isEvidenceReport(r: unknown): r is SeoResearchReport {
    return typeof r === "object" && r !== null && "evidence" in r && Array.isArray((r as SeoResearchReport).masterList);
}

function Badge({ text, className }: { text: string; className?: string }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${className}`}>
            {text}
        </span>
    );
}

function TrendBadge({ status, source }: { status: TrendStatus; source?: string | null }) {
    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${trendColors[status]}`}
            title={source ? `Source: ${source}` : "No trend signal measured"}
        >
            <span aria-hidden="true">{trendArrows[status]}</span>
            {status === "Unknown" ? "Not measured" : status}
        </span>
    );
}

function NotMeasured({ label = "Not measured" }: { label?: string }) {
    return (
        <span className="text-xs text-muted-foreground/60" title={label}>
            {NOT_MEASURED}
        </span>
    );
}

function VolumeCell({ value }: { value: number | null }) {
    if (value === null) return <NotMeasured label="Search volume not measured" />;
    return (
        <span className="tabular-nums text-zinc-200" title="Monthly searches · DataForSEO Google Ads">
            {value.toLocaleString()}
        </span>
    );
}

function KdCell({ value }: { value: number | null }) {
    if (value === null) return <NotMeasured label="Organic difficulty not measured" />;
    const tone = kdClasses(value);
    return (
        <div className="flex items-center gap-1.5" title="Organic keyword difficulty · DataForSEO Labs">
            <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone.bar}`}
                    style={{ width: `${value}%` }}
                />
            </div>
            <span className={`text-xs tabular-nums ${tone.text}`}>{value}</span>
        </div>
    );
}

function SerpCell({ value, explanation }: { value: number | null; explanation: string | null }) {
    if (value === null) return <NotMeasured label="Live SERP not checked" />;
    return (
        <span className={`text-xs font-bold tabular-nums ${serpTone(value)}`} title={explanation ?? "Live SERP feasibility"}>
            {value}/10
        </span>
    );
}

function SectionHeader({ emoji, title, subtitle }: { emoji: string; title: string; subtitle?: string }) {
    return (
        <div className="p-6 border-b border-border">
            <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{emoji}</span>
                <h2 className="text-lg font-semibold">{title}</h2>
            </div>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
    );
}


const PHASES = [
    { label: "Business Analysis", emoji: "🏢" },
    { label: "Keyword Candidates", emoji: "📝" },
    { label: "Topical Clusters", emoji: "🧭" },
    { label: "Content Calendar", emoji: "📅" },
];

const MEASURE_STEPS = [
    "DataForSEO volume & CPC",
    "Labs organic difficulty",
    "Search Console performance",
    "Competitor rankings",
    "Reddit threads & news",
    "Live SERP feasibility",
];

function LoadingSkeleton({ currentPhase }: { currentPhase: number }) {
    return (
        <div className="card-surface p-8">
            <div className="flex flex-col items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
                    <span className="text-3xl">{PHASES[currentPhase]?.emoji}</span>
                </div>
                <div className="text-center">
                    <p className="text-lg font-semibold mb-1">Stage 1 · Strategy ({currentPhase + 1} of {PHASES.length})</p>
                    <p className="text-muted-foreground text-sm">{PHASES[currentPhase]?.label}…</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">AI proposes candidates only — every metric is measured in stage 2.</p>
                </div>
                <div className="w-full max-w-md flex gap-2">
                    {PHASES.map((phase, i) => (
                        <div
                            key={i}
                            className={`flex-1 h-1.5 rounded-full transition-all duration-500 ${i <= currentPhase ? "bg-primary" : "bg-white/10"}`}
                        />
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-3 w-full max-w-md">
                    {PHASES.map((phase, i) => (
                        <div key={i} className={`flex items-center gap-2 text-sm ${i <= currentPhase ? "text-foreground" : "text-muted-foreground/40"}`}>
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs transition-all ${i < currentPhase ? "bg-emerald-500/20 text-emerald-400" : i === currentPhase ? "bg-primary/20 text-primary animate-pulse" : "bg-muted"}`}>
                                {i < currentPhase ? "✓" : i === currentPhase ? "…" : ""}
                            </span>
                            <span>{phase.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Evidence status banner ──────────────────────────────────────────────────

function EvidenceBanner({
    evidence,
    isMeasuring,
    onMeasure,
}: {
    evidence: ResearchEvidenceMeta;
    isMeasuring: boolean;
    onMeasure: () => void;
}) {
    if (isMeasuring) {
        return (
            <div className="card-surface p-5 border border-primary/20 relative overflow-hidden" role="status" aria-live="polite">
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
                <div className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    </div>
                    <div className="flex-1">
                        <p className="font-semibold">Stage 2 · Measuring every keyword with real data…</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Usually 20–45 seconds. Metrics stay blank until measured — nothing is estimated.</p>
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {MEASURE_STEPS.map((s, i) => (
                                <span
                                    key={s}
                                    className="px-2 py-0.5 rounded-md text-[11px] bg-muted text-muted-foreground animate-pulse"
                                    style={{ animationDelay: `${i * 180}ms` }}
                                >
                                    {s}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (evidence.status === "pending") {
        return (
            <div className="card-surface p-5 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                <div>
                    <p className="font-semibold text-amber-300">Keywords not measured yet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        These are AI-suggested candidates. Volume, difficulty, SERP and trend data appear after measurement.
                    </p>
                </div>
                <button
                    id="seo-research-measure-btn"
                    onClick={onMeasure}
                    className="shrink-0 px-4 py-2 text-sm font-semibold rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                >
                    ⚡ Measure keywords
                </button>
            </div>
        );
    }

    const tone =
        evidence.status === "COMPLETED" ? "border-emerald-500/20" :
        evidence.status === "PARTIAL" ? "border-amber-500/20" :
        "border-red-500/20";
    const label =
        evidence.status === "COMPLETED" ? "All evidence sources returned data" :
        evidence.status === "PARTIAL" ? "Some sources were unavailable — affected metrics show “—”" :
        "No data source returned results — metrics are blank, not estimated";

    return (
        <div className={`card-surface p-5 border ${tone}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold">{label}</p>
                    {evidence.compiledAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Measured {new Date(evidence.compiledAt).toLocaleString()}
                            {evidence.runId && <> · Run <code className="text-[10px]">{evidence.runId.slice(-8)}</code></>}
                        </p>
                    )}
                </div>
                <button
                    id="seo-research-remeasure-btn"
                    onClick={onMeasure}
                    className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-muted text-muted-foreground hover:bg-white/10 transition-all"
                >
                    ↻ Re-measure
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
                {evidence.dataSources.map((s) => (
                    <span key={s} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        ✓ {s}
                    </span>
                ))}
                {evidence.failedSources.map((s) => (
                    <span key={s} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                        ✕ {s}
                    </span>
                ))}
            </div>
        </div>
    );
}

// ── Evidence drawer (expanded row) ──────────────────────────────────────────

function EvidenceDrawer({ kw }: { kw: KeywordRow }) {
    const hasAny =
        kw.serpSignals.length > 0 || kw.trendEvidence.length > 0 || kw.communityEvidence.length > 0 ||
        kw.competitorPositions.length > 0 || kw.gscPosition !== null || kw.cpc !== null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 bg-card/40 text-xs whitespace-normal">
            <div className="flex flex-col gap-3">
                <div>
                    <p className="font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Recommendation</p>
                    <p className="text-zinc-300">{kw.recommendation ?? "Measure this keyword to get a recommendation."}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <dt className="text-muted-foreground">Opportunity</dt>
                    <dd className="tabular-nums">{kw.opportunityScore ?? NOT_MEASURED}</dd>
                    <dt className="text-muted-foreground">CPC</dt>
                    <dd className="tabular-nums">{kw.cpc !== null ? `$${kw.cpc.toFixed(2)}` : NOT_MEASURED}</dd>
                    <dt className="text-muted-foreground" title="Google Ads paid competition — not organic difficulty">Paid competition</dt>
                    <dd className="tabular-nums">{fmtNum(kw.competitionIndex)}</dd>
                    <dt className="text-muted-foreground">GSC position</dt>
                    <dd className="tabular-nums">{kw.gscPosition !== null ? `#${kw.gscPosition}` : NOT_MEASURED}</dd>
                    <dt className="text-muted-foreground">GSC clicks / impr.</dt>
                    <dd className="tabular-nums">{fmtNum(kw.gscClicks)} / {fmtNum(kw.gscImpressions)}</dd>
                </dl>
                {kw.missingInputs.length > 0 && (
                    <p className="text-[11px] text-amber-300/80">
                        Not measured: {kw.missingInputs.join(", ")}. The score uses neutral weights for these and never shows them as data.
                    </p>
                )}
                {kw.dataSources.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {kw.dataSources.map((s) => (
                            <span key={s} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">{s}</span>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-3">
                <div>
                    <p className="font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Live SERP</p>
                    {kw.serpFeasibilityExplanation ? (
                        <>
                            <p className="text-zinc-300 mb-2">{kw.serpFeasibilityExplanation}</p>
                            <ul className="flex flex-col gap-1">
                                {kw.serpSignals.map((s, i) => (
                                    <li key={i} className="flex gap-2">
                                        <span className={`tabular-nums font-bold ${s.impact > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                            {s.impact > 0 ? `+${s.impact}` : s.impact}
                                        </span>
                                        <span className="text-muted-foreground">{s.detail}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : <p className="text-muted-foreground">SERP not checked for this keyword.</p>}
                </div>
                {kw.competitorPositions.length > 0 && (
                    <div>
                        <p className="font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Competitors ranking</p>
                        <ul className="flex flex-col gap-1">
                            {kw.competitorPositions.slice(0, 4).map((c, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="tabular-nums font-bold text-zinc-300">#{c.position}</span>
                                    {c.url
                                        ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{c.domain}</a>
                                        : <span className="text-muted-foreground">{c.domain}</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-3">
                <div>
                    <p className="font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Trend</p>
                    <div className="flex items-center gap-2 mb-1">
                        <TrendBadge status={kw.trendStatus} source={kw.trendSource} />
                        {kw.trendSource && <span className="text-[10px] text-muted-foreground">{kw.trendSource}</span>}
                    </div>
                    {kw.trendEvidence.map((t, i) => <p key={i} className="text-muted-foreground">{t}</p>)}
                </div>
                <div>
                    <p className="font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Community threads</p>
                    {kw.communityEvidence.length > 0 ? (
                        <ul className="flex flex-col gap-1.5">
                            {kw.communityEvidence.slice(0, 3).map((c, i) => (
                                <li key={i}>
                                    {c.url
                                        ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{c.title}</a>
                                        : <span className="text-zinc-300">{c.title}</span>}
                                    <span className="block text-[10px] text-muted-foreground">
                                        {[c.community, c.upvotes !== null ? `${c.upvotes} upvotes` : null, c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : null].filter(Boolean).join(" · ")}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted-foreground">
                            {kw.painPointHypothesis ? "AI pain-point hypothesis — no matching Reddit threads found." : "No matching threads found."}
                        </p>
                    )}
                </div>
                {!hasAny && kw.evidenceObservedAt === null && (
                    <p className="text-muted-foreground">No evidence yet — run measurement.</p>
                )}
            </div>
        </div>
    );
}

function ExpandButton({ id, expanded, onToggle, label }: { id: string; expanded: boolean; onToggle: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={id}
            aria-label={`${expanded ? "Hide" : "Show"} evidence for ${label}`}
            className={`w-6 h-6 rounded-md flex items-center justify-center text-xs transition-all ${expanded ? "bg-primary/20 text-primary rotate-90" : "bg-muted text-muted-foreground hover:bg-white/10"}`}
        >
            ▸
        </button>
    );
}


function exportMasterListCsv(masterList: MasterListRow[]) {
    const headers = [
        "Rank", "Keyword", "Type", "Search Volume", "Keyword Difficulty", "SERP Feasibility", "CPC",
        "Trend", "Trend Source", "GSC Position", "Opportunity", "Intent", "AI Relevance", "Quick Win",
        "Content Type", "Roadmap", "Data Sources", "Measured At",
    ];
    const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`);
    const rows = masterList.map(k => [
        k.rank,
        cell(k.keyword),
        k.type,
        cell(k.searchVolume),
        cell(k.keywordDifficulty),
        cell(k.serpFeasibility),
        cell(k.cpc),
        k.trendStatus,
        cell(k.trendSource),
        cell(k.gscPosition),
        cell(k.opportunityScore),
        k.intent,
        k.relevance,
        k.quickWin ? "Yes" : "No",
        k.contentType,
        k.roadmap,
        cell(k.dataSources.join(" | ")),
        cell(k.evidenceObservedAt),
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seo-master-keywords-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}


function Phase1Panel({ data }: { data: SeoResearchReport["businessAnalysis"] }) {
    return (
        <div className="card-surface overflow-hidden">
            <SectionHeader emoji="🏢" title="Business Analysis" subtitle="Content pillars and full-funnel keyword mapping (AI strategy)" />
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Content Pillars</h3>
                    <div className="flex flex-wrap gap-2">
                        {data.pillars.map((p, i) => (
                            <span key={i} className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium border border-primary/20">
                                {p}
                            </span>
                        ))}
                    </div>
                    {data.valueProposition && (
                        <div className="mt-4 p-4 rounded-xl bg-card/60 border border-border">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Value Proposition</p>
                            <p className="text-sm text-zinc-300">{data.valueProposition}</p>
                        </div>
                    )}
                    {data.communityPainPoints && data.communityPainPoints.length > 0 && (
                        <div className="mt-4 p-4 rounded-xl bg-card/60 border border-border">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
                                Pain-point hypotheses <span className="normal-case font-normal">(verified against Reddit during measurement)</span>
                            </p>
                            <ul className="text-sm text-zinc-300 list-disc pl-4">
                                {data.communityPainPoints.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Funnel Map</h3>
                    <div className="flex flex-col gap-3">
                        {(["awareness", "consideration", "decision"] as const).map(stage => (
                            <div key={stage} className="p-3 rounded-xl bg-card/60 border border-border">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 capitalize">{stage}</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {(data.funnelMap[stage] || []).slice(0, 5).map((kw, i) => (
                                        <span key={i} className="px-2 py-0.5 rounded bg-muted text-xs text-zinc-300">{kw}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Phase2Panel({ data }: { data: CompetitorGapRow[] }) {
    return (
        <div className="card-surface overflow-hidden">
            <SectionHeader emoji="🔍" title="Competitor Gap Analysis" subtitle="Keywords where tracked competitors rank and you don't — from real ranking data" />
            {data.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                    No measured competitor gaps yet. Add competitors and sync their rankings to populate this table.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                            <tr>
                                <th scope="col" className="px-5 py-3">Keyword</th>
                                <th scope="col" className="px-5 py-3">Volume</th>
                                <th scope="col" className="px-5 py-3">KD</th>
                                <th scope="col" className="px-5 py-3">Competitor</th>
                                <th scope="col" className="px-5 py-3">You</th>
                                <th scope="col" className="px-5 py-3">Gap</th>
                                <th scope="col" className="px-5 py-3">Recommendation</th>
                                <th scope="col" className="px-5 py-3">Priority</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {data.map((row, i) => (
                                <tr key={i} className="hover:bg-card transition-colors">
                                    <td className="px-5 py-3 font-medium max-w-[220px]">
                                        <span className="truncate block" title={row.keyword}>{row.keyword}</span>
                                        <span className="text-[10px] text-muted-foreground">{row.source}</span>
                                    </td>
                                    <td className="px-5 py-3"><VolumeCell value={row.searchVolume} /></td>
                                    <td className="px-5 py-3"><KdCell value={row.keywordDifficulty} /></td>
                                    <td className="px-5 py-3 text-xs max-w-[180px] truncate">
                                        {row.competitorUrl
                                            ? <a href={row.competitorUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" title={row.competitorUrl}>{row.competitorRanking}</a>
                                            : <span className="text-muted-foreground">{row.competitorRanking ?? NOT_MEASURED}</span>}
                                    </td>
                                    <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">
                                        {row.yourPosition !== null ? `#${row.yourPosition}` : "Not ranking"}
                                    </td>
                                    <td className="px-5 py-3 text-xs text-zinc-300">{row.gapType ? gapLabels[row.gapType] : NOT_MEASURED}</td>
                                    <td className="px-5 py-3 text-zinc-300 text-xs max-w-[280px] truncate" title={row.gapOpportunity}>{row.gapOpportunity}</td>
                                    <td className="px-5 py-3">
                                        {row.priority
                                            ? <Badge text={row.priority} className={priorityColors[row.priority] || ""} />
                                            : <NotMeasured label="Demand not measured" />}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Phase3Panel({ data }: { data: KeywordRow[] }) {
    const [filter, setFilter] = useState<string>("All");
    const [expanded, setExpanded] = useState<string | null>(null);
    const types = ["All", "Short-tail", "Long-tail", "Competitive", "Informational", "Trending", "Question", "Local/Regional", "Semantic/LSI"];
    const filtered = filter === "All" ? data : data.filter(k => k.type === filter);

    return (
        <div className="card-surface overflow-hidden">
            <SectionHeader emoji="📝" title="Keyword Opportunities" subtitle={`${data.length} keywords — ranked by measured opportunity. Expand a row to see the evidence.`} />
            <div className="px-5 py-3 border-b border-border flex flex-wrap gap-2">
                {types.map(t => (
                    <button
                        key={t}
                        onClick={() => setFilter(t)}
                        aria-pressed={filter === t}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${filter === t ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-white/10"}`}
                    >
                        {t} {t !== "All" && <span className="opacity-60">({data.filter(k => k.type === t).length})</span>}
                    </button>
                ))}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                        <tr>
                            <th scope="col" className="pl-5 py-3"><span className="sr-only">Evidence</span></th>
                            <th scope="col" className="px-3 py-3">#</th>
                            <th scope="col" className="px-5 py-3">Keyword</th>
                            <th scope="col" className="px-5 py-3">Type</th>
                            <th scope="col" className="px-5 py-3" title="Monthly searches · DataForSEO">Volume</th>
                            <th scope="col" className="px-5 py-3" title="Organic difficulty · DataForSEO Labs">KD</th>
                            <th scope="col" className="px-5 py-3" title="Live SERP feasibility (1-10)">SERP</th>
                            <th scope="col" className="px-5 py-3">Trend</th>
                            <th scope="col" className="px-5 py-3">Intent</th>
                            <th scope="col" className="px-5 py-3" title="AI judgement of business fit — not a market metric">AI Fit</th>
                            <th scope="col" className="px-5 py-3">Quick Win</th>
                            <th scope="col" className="px-5 py-3">Content Type</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={12} className="px-5 py-10 text-center text-muted-foreground text-sm">
                                    {data.length === 0
                                        ? "No keywords were returned — Gemini may have hit its output limit. Click ↺ Re-run Research to try again."
                                        : "No keywords match the selected filter."}
                                </td>
                            </tr>
                        )}
                        {filtered.map((kw) => {
                            const isOpen = expanded === kw.keyword;
                            const drawerId = `evidence-${kw.rank}`;
                            return (
                                <Fragment key={kw.keyword}>
                                    <tr className={`hover:bg-card transition-colors ${isOpen ? "bg-card/60" : ""}`}>
                                        <td className="pl-5 py-3">
                                            <ExpandButton id={drawerId} expanded={isOpen} label={kw.keyword} onToggle={() => setExpanded(isOpen ? null : kw.keyword)} />
                                        </td>
                                        <td className="px-3 py-3 text-muted-foreground text-xs">{kw.rank}</td>
                                        <td className="px-5 py-3 font-medium max-w-[260px]">
                                            <span className="truncate block" title={kw.keyword}>{kw.keyword}</span>
                                            {kw.communitySource && (
                                                <span className="text-[10px] text-orange-300">● {kw.communityEvidence.length} Reddit thread{kw.communityEvidence.length === 1 ? "" : "s"}</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3">
                                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${typeColors[kw.type] || "bg-zinc-700 text-zinc-300"}`}>
                                                {kw.type}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3"><VolumeCell value={kw.searchVolume} /></td>
                                        <td className="px-5 py-3"><KdCell value={kw.keywordDifficulty} /></td>
                                        <td className="px-5 py-3"><SerpCell value={kw.serpFeasibility} explanation={kw.serpFeasibilityExplanation} /></td>
                                        <td className="px-5 py-3"><TrendBadge status={kw.trendStatus} source={kw.trendSource} /></td>
                                        <td className="px-5 py-3">
                                            <Badge text={kw.intent} className={intentColors[kw.intent] || ""} />
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex" aria-label={`AI fit ${kw.relevance} of 10`}>
                                                {Array.from({ length: 10 }).map((_, d) => (
                                                    <div key={d} className={`w-1.5 h-1.5 rounded-full mr-0.5 ${d < kw.relevance ? "bg-primary" : "bg-white/10"}`} />
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3">
                                            {kw.quickWin
                                                ? <span className="text-emerald-400 font-bold text-xs" title="Low measured KD with real demand, or ranking #11-20">✓ Yes</span>
                                                : <span className="text-muted-foreground text-xs">{kw.evidenceObservedAt ? "Long-term" : NOT_MEASURED}</span>}
                                        </td>
                                        <td className="px-5 py-3 text-xs text-muted-foreground">{kw.contentType}</td>
                                    </tr>
                                    {isOpen && (
                                        <tr id={drawerId}>
                                            <td colSpan={12} className="p-0 border-l-2 border-l-primary/40">
                                                <EvidenceDrawer kw={kw} />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Phase5Panel({ data, onRefresh, isRefreshing }: { data: TrendRow[]; onRefresh: () => void; isRefreshing: boolean }) {
    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">📈</span>
                        <h2 className="text-lg font-semibold">Trend Signals</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Measured 12-month search-volume direction, plus cited niche news. News shows topical activity, not search direction.
                    </p>
                </div>
                <button
                    id="seo-research-refresh-trends-panel"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    className="shrink-0 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isRefreshing ? "Refreshing…" : "↻ Refresh News"}
                </button>
            </div>
            {data.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                    No trend signals measured. This needs DataForSEO volume history or a Serper News key.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                            <tr>
                                <th scope="col" className="px-5 py-3">Topic</th>
                                <th scope="col" className="px-5 py-3">Status</th>
                                <th scope="col" className="px-5 py-3">Evidence</th>
                                <th scope="col" className="px-5 py-3">Recommendation</th>
                                <th scope="col" className="px-5 py-3">Source</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {data.map((trend, i) => (
                                <tr key={i} className="hover:bg-card transition-colors align-top">
                                    <td className="px-5 py-3 font-medium text-foreground max-w-[280px]">
                                        {trend.evidenceUrl
                                            ? <a href={trend.evidenceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">{trend.topic}</a>
                                            : trend.topic}
                                    </td>
                                    <td className="px-5 py-3"><TrendBadge status={trend.status} source={trend.source} /></td>
                                    <td className="px-5 py-3 text-xs text-muted-foreground max-w-[300px]">
                                        {(trend.evidence ?? []).slice(0, 2).map((e, j) => <p key={j} className="line-clamp-2">{e}</p>)}
                                    </td>
                                    <td className="px-5 py-3 text-xs text-zinc-300 max-w-[250px]">{trend.recommendedContent}</td>
                                    <td className="px-5 py-3 text-[11px] text-muted-foreground whitespace-nowrap">
                                        <span className="block">{trend.source ?? NOT_MEASURED}</span>
                                        <span className="block opacity-70">{trend.urgency}</span>
                                        {trend.observedAt && <span className="block opacity-70">Observed {new Date(trend.observedAt).toLocaleDateString()}</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Phase6Panel({ data }: { data: ContentCalendarItem[] }) {
    const buckets = ["Week 1", "Month 1", "Month 2-3"] as const;

    return (
        <div className="card-surface overflow-hidden">
            <SectionHeader emoji="📅" title="Content Calendar" subtitle="Pieces to create, grouped by publishing roadmap. Score = best measured opportunity among target keywords." />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
                {buckets.map(bucket => (
                    <div key={bucket} className="flex flex-col gap-3">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border self-start ${roadmapColors[bucket]}`}>
                            {bucket}
                        </div>
                        {data.filter(d => d.week === bucket).map((item, i) => (
                            <div key={i} className={`p-4 rounded-xl border relative ${item.pillar ? "border-primary/30 bg-primary/5" : "border-border bg-card/40"}`}>
                                {item.pillar && (
                                    <span className="text-[10px] uppercase font-bold tracking-wider text-primary mb-1 block">Pillar Page</span>
                                )}
                                {item.priorityScore !== null && item.priorityScore !== undefined ? (
                                    <span className={`absolute top-4 right-4 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${item.priorityScore >= 50 ? "bg-red-500/10 text-red-400" : item.priorityScore >= 25 ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"}`}>
                                        Score: {item.priorityScore}
                                    </span>
                                ) : (
                                    <span className="absolute top-4 right-4 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground" title="Target keywords not measured yet">
                                        Unscored
                                    </span>
                                )}
                                <p className="text-sm font-semibold text-foreground mb-2 pr-16">{item.title}</p>
                                <div className="flex flex-wrap gap-1">
                                    {item.targetKeywords.slice(0, 3).map((kw, j) => (
                                        <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{kw}</span>
                                    ))}
                                </div>
                                {item.internalLinks && item.internalLinks.length > 0 && (
                                    <p className="text-[10px] text-muted-foreground mt-2">
                                        🔗 Links to: {item.internalLinks.slice(0, 2).join(", ")}
                                    </p>
                                )}
                            </div>
                        ))}
                        {data.filter(d => d.week === bucket).length === 0 && (
                            <p className="text-xs text-muted-foreground">No items assigned</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function ClustersPanel({ data }: { data: TopicalCluster[] }) {
    return (
        <div className="card-surface overflow-hidden">
            <SectionHeader emoji="🧭" title="Topical Clusters" subtitle="AI grouping; volume and difficulty are measured totals across each cluster" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
                {data.map((c, i) => (
                    <div key={i} className="p-4 rounded-xl border border-border bg-card/40 flex flex-col gap-3">
                        <p className="text-sm font-semibold">{c.parentTopic}</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2 rounded-lg bg-muted/60">
                                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Total volume</p>
                                <p className="font-bold tabular-nums">{fmtNum(c.totalSearchVolume)}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/60">
                                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Avg KD</p>
                                <p className="font-bold tabular-nums">{fmtNum(c.avgKeywordDifficulty)}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {c.keywords.slice(0, 6).map((kw, j) => (
                                <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{kw}</span>
                            ))}
                        </div>
                        {c.contentPlan && <p className="text-xs text-zinc-300">{c.contentPlan}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
}

function Phase7Panel({ data }: { data: MasterListRow[] }) {
    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">🏆</span>
                        <h2 className="text-lg font-semibold">Master Keyword List</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">Sorted by measured opportunity — roadmap derived from evidence where available</p>
                </div>
                <button
                    id="seo-research-export-csv"
                    onClick={() => exportMasterListCsv(data)}
                    className="shrink-0 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                >
                    ↓ Export CSV
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                        <tr>
                            <th scope="col" className="px-5 py-3">#</th>
                            <th scope="col" className="px-5 py-3">Keyword</th>
                            <th scope="col" className="px-5 py-3">Type</th>
                            <th scope="col" className="px-5 py-3">Volume</th>
                            <th scope="col" className="px-5 py-3">KD</th>
                            <th scope="col" className="px-5 py-3">SERP</th>
                            <th scope="col" className="px-5 py-3">Opportunity</th>
                            <th scope="col" className="px-5 py-3">Intent</th>
                            <th scope="col" className="px-5 py-3">Quick Win</th>
                            <th scope="col" className="px-5 py-3">Content Type</th>
                            <th scope="col" className="px-5 py-3">Roadmap</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {data.map((kw) => (
                            <tr key={kw.keyword} className={`hover:bg-card transition-colors ${kw.quickWin ? "border-l-2 border-l-emerald-500/30" : ""}`}>
                                <td className="px-5 py-3 text-muted-foreground text-xs font-bold">{kw.rank}</td>
                                <td className="px-5 py-3 font-medium max-w-[220px]">
                                    <span className="truncate block" title={kw.keyword}>{kw.keyword}</span>
                                </td>
                                <td className="px-5 py-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${typeColors[kw.type] || ""}`}>{kw.type}</span>
                                </td>
                                <td className="px-5 py-3 text-xs"><VolumeCell value={kw.searchVolume} /></td>
                                <td className="px-5 py-3"><KdCell value={kw.keywordDifficulty} /></td>
                                <td className="px-5 py-3"><SerpCell value={kw.serpFeasibility} explanation={kw.serpFeasibilityExplanation} /></td>
                                <td className="px-5 py-3 text-xs">
                                    {kw.opportunityScore !== null
                                        ? <span className="font-bold tabular-nums text-zinc-200" title={kw.recommendation ?? undefined}>{kw.opportunityScore}</span>
                                        : <NotMeasured label="Demand not measured" />}
                                </td>
                                <td className="px-5 py-3">
                                    <Badge text={kw.intent} className={intentColors[kw.intent] || ""} />
                                </td>
                                <td className="px-5 py-3">
                                    {kw.quickWin
                                        ? <span className="text-emerald-400 font-bold text-xs">✓</span>
                                        : <span className="text-muted-foreground text-xs">—</span>}
                                </td>
                                <td className="px-5 py-3 text-xs text-muted-foreground">{kw.contentType}</td>
                                <td className="px-5 py-3">
                                    <Badge text={kw.roadmap} className={roadmapColors[kw.roadmap as keyof typeof roadmapColors] || "bg-zinc-700 text-zinc-300 border-zinc-600"} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


export function SeoResearchPanel({ siteId }: { siteId: string }) {
    const [report, setReport] = useState<SeoResearchReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const [isMeasuring, setIsMeasuring] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSavingPlanner, setIsSavingPlanner] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [loadingPhase, setLoadingPhase] = useState(0);
    const STORAGE_KEY = `seo_research_report_${siteId}`;

    // Restore report from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return;
            const parsed: unknown = JSON.parse(saved);
            if (isEvidenceReport(parsed)) {
                setReport(parsed);
            } else {
                // Legacy report with AI-generated metrics — never show it again.
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch {
            // ignore corrupt cache
        }
    }, [STORAGE_KEY]);

    // Persist report to localStorage whenever it changes
    useEffect(() => {
        if (!report) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
        } catch {
            // storage quota exceeded — silently skip
        }
    }, [report, STORAGE_KEY]);

    // Simulate phase progress during loading
    const startPhaseTimer = () => {
        setLoadingPhase(0);
        let phase = 0;
        const PHASE_MS = [5000, 10000, 8000, 6000];
        const next = () => {
            if (phase < PHASES.length - 1) {
                setTimeout(() => { phase++; setLoadingPhase(phase); next(); }, PHASE_MS[phase]);
            }
        };
        setTimeout(next, PHASE_MS[0]);
    };

    const measure = async (base: SeoResearchReport) => {
        setIsMeasuring(true);
        try {
            const res = await enrichSeoResearch(siteId, base);
            if (res.success) {
                setReport(res.report);
            } else {
                setError(`Measurement failed: ${res.error}. Keywords are shown unmeasured.`);
            }
        } finally {
            setIsMeasuring(false);
        }
    };

    const handleRunResearch = () => {
        setError(null);
        startPhaseTimer();
        startTransition(async () => {
            const res = await runSeoResearch(siteId);
            if (res.success) {
                setReport(res.report);
                // Stage 2 runs as its own server action to stay within time limits.
                void measure(res.report);
            } else {
                setError(res.error);
            }
        });
    };

    const handleMeasure = () => {
        if (!report) return;
        setError(null);
        void measure(report);
    };

    const handleRefreshTrends = async () => {
        setError(null);
        setIsRefreshing(true);
        try {
            const res = await runTrendRefresh(siteId);
            if (res.success && report) {
                // Keep measured volume trends; replace only the news rows.
                const measured = report.trends.filter(t => t.status !== "Observed");
                setReport({ ...report, trends: [...measured, ...res.trends] });
            } else if (!res.success) {
                setError(res.error);
            }
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleSaveToPlanner = async () => {
        if (!report?.contentCalendar) return;
        setIsSavingPlanner(true);
        setSaveSuccess(false);
        try {
            const kwInputs = report.contentCalendar.map(item => ({
                keyword: item.targetKeywords?.[0] ?? item.title,
                parentTopic: item.targetKeywords?.[0] ?? item.title,
            }));
            const result = await saveKeywordsToPlanner(siteId, kwInputs);
            if (result.success) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 4000);
            } else {
                setError(result.error || "Failed to save planner");
            }
        } finally {
            setIsSavingPlanner(false);
        }
    };

    const busy = isPending || isMeasuring;

    return (
        <div className="flex flex-col gap-4">
            {/* Header CTA */}
            <div className="card-surface p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                        <span>🎯</span> OptiAISEO Research — Evidence-Based
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        AI proposes the strategy; DataForSEO, Search Console, the live SERP, Reddit and news measure it.
                        Every number shows its source — missing data shows “—”, never a guess.
                    </p>
                    {report && (
                        <p className="text-xs text-muted-foreground mt-1">
                            Last generated: {new Date(report.generatedAt).toLocaleString()} · {report.domain}
                        </p>
                    )}
                </div>
                <div className="flex gap-3 shrink-0">
                    {report && (
                        <>
                            <button
                                id="seo-research-save-planner"
                                onClick={handleSaveToPlanner}
                                disabled={isSavingPlanner || busy}
                                className="px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                            >
                                {isSavingPlanner ? "Saving…" : saveSuccess ? (
                                    <span>✅ Saved! <a href={`/dashboard/planner?siteId=${siteId}`} className="underline font-bold">View Planner →</a></span>
                                ) : "📅 Save to Planner"}
                            </button>
                            <button
                                id="seo-research-refresh-trends"
                                onClick={handleRefreshTrends}
                                disabled={isRefreshing || busy}
                                className="px-4 py-2 text-sm font-semibold rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-all disabled:opacity-50"
                            >
                                {isRefreshing ? "Refreshing…" : "↻ Refresh News"}
                            </button>
                        </>
                    )}
                    <button
                        id="seo-research-run"
                        onClick={handleRunResearch}
                        disabled={busy || isRefreshing}
                        className="px-6 py-2 text-sm font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                    >
                        {isPending ? "Analysing…" : isMeasuring ? "Measuring…" : report ? "↺ Re-run Research" : "▶ Run Full Research"}
                    </button>
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="card-surface p-5 border border-red-500/20 flex items-start gap-3" role="alert">
                    <span className="text-red-400 text-xl shrink-0">⚠</span>
                    <div>
                        <p className="font-semibold text-red-400">Research Issue</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
                    </div>
                </div>
            )}

            {/* Loading State */}
            {isPending && <LoadingSkeleton currentPhase={loadingPhase} />}

            {/* Results */}
            {!isPending && report && (
                <>
                    <EvidenceBanner evidence={report.evidence} isMeasuring={isMeasuring} onMeasure={handleMeasure} />
                    <Phase3Panel data={report.keywords} />
                    {report.evidence.status !== "pending" && <Phase2Panel data={report.competitorGap} />}
                    {report.evidence.status !== "pending" && (
                        <Phase5Panel data={report.trends} onRefresh={handleRefreshTrends} isRefreshing={isRefreshing} />
                    )}
                    <Phase1Panel data={report.businessAnalysis} />
                    {report.topicalClusters && report.topicalClusters.length > 0 && <ClustersPanel data={report.topicalClusters} />}
                    {report.contentCalendar.length > 0 && <Phase6Panel data={report.contentCalendar} />}
                    {report.masterList.length > 0 && <Phase7Panel data={report.masterList} />}
                </>
            )}

            {/* Empty State */}
            {!isPending && !report && !error && (
                <div className="card-surface p-12 flex flex-col items-center text-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-3xl">🎯</div>
                    <div>
                        <h3 className="text-lg font-semibold mb-1">Ready to Run</h3>
                        <p className="text-muted-foreground text-sm max-w-md">
                            Click <strong>Run Full Research</strong>. AI drafts the strategy and candidate keywords, then every
                            keyword is measured against real search data with sources and timestamps.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left max-w-lg w-full mt-2">
                        {[...PHASES.map(p => ({ emoji: p.emoji, label: p.label })), { emoji: "📊", label: "Evidence measurement" }, { emoji: "🔍", label: "Competitor gaps" }].map((p, i) => (
                            <div key={i} className="flex items-center gap-2 p-3 rounded-xl bg-card/50 border border-border">
                                <span className="text-lg">{p.emoji}</span>
                                <span className="text-xs text-muted-foreground">{p.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
