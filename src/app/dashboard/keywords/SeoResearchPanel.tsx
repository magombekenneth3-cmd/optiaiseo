"use client";

import { useState, useTransition, useEffect } from "react";
import { runSeoResearch, runTrendRefresh } from "@/app/actions/keywordDiscovery";
import { saveKeywordsToPlanner } from "@/app/actions/planner";
import type {
    SeoResearchReport,
    KeywordRow,
    TrendRow,
    CompetitorGapRow,
    ContentCalendarItem,
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

function Badge({ text, className }: { text: string; className?: string }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${className}`}>
            {text}
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
    { label: "Competitor Gap", emoji: "🔍" },
    { label: "Keyword Generation", emoji: "📝" },
    { label: "Trend Simulation", emoji: "🔥" },
    { label: "Content Calendar", emoji: "📅" },
    { label: "Master Keyword List", emoji: "🏆" },
];

function LoadingSkeleton({ currentPhase }: { currentPhase: number }) {
    return (
        <div className="card-surface p-8">
            <div className="flex flex-col items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
                    <span className="text-3xl">{PHASES[currentPhase]?.emoji}</span>
                </div>
                <div className="text-center">
                    <p className="text-lg font-semibold mb-1">Running Phase {currentPhase + 1} of {PHASES.length}</p>
                    <p className="text-muted-foreground text-sm">{PHASES[currentPhase]?.label}…</p>
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


function exportMasterListCsv(masterList: (KeywordRow & { roadmap: string })[]) {
    const headers = ["Rank", "Keyword", "Type", "Volume", "Difficulty", "Intent", "Relevance", "Quick Win", "Content Type", "Roadmap"];
    const rows = masterList.map(k => [
        k.rank,
        `"${k.keyword}"`,
        k.type,
        k.volume,
        k.difficulty,
        k.intent,
        k.relevance,
        k.quickWin ? "Yes" : "No",
        k.contentType,
        k.roadmap,
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
            <SectionHeader emoji="🏢" title="Phase 1 — Business Analysis" subtitle="Content pillars and full-funnel keyword mapping" />
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
            <SectionHeader emoji="🔍" title="Phase 2 — Competitor Gap Analysis" subtitle="Keywords competitors are weak on — your quickest wins" />
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                        <tr>
                            <th scope="col" className="px-5 py-3">Keyword</th>
                            <th scope="col" className="px-5 py-3">Difficulty</th>
                            <th scope="col" className="px-5 py-3">Competitor Ranking</th>
                            <th scope="col" className="px-5 py-3">Gap Opportunity</th>
                            <th scope="col" className="px-5 py-3">Priority</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {data.map((row, i) => (
                            <tr key={i} className="hover:bg-card transition-colors">
                                <td className="px-5 py-3 font-medium max-w-[220px]">
                                    <span className="truncate block" title={row.keyword}>{row.keyword}</span>
                                </td>
                                <td className="px-5 py-3 text-muted-foreground">{row.difficulty}</td>
                                <td className="px-5 py-3 text-muted-foreground text-xs max-w-[160px] truncate" title={row.competitorRanking}>{row.competitorRanking}</td>
                                <td className="px-5 py-3 text-zinc-300 text-xs max-w-[260px] truncate" title={row.gapOpportunity}>{row.gapOpportunity}</td>
                                <td className="px-5 py-3">
                                    <Badge text={row.priority} className={priorityColors[row.priority] || ""} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Phase3Panel({ data }: { data: KeywordRow[] }) {
    const [filter, setFilter] = useState<string>("All");
    const types = ["All", "Short-tail", "Long-tail", "Competitive", "Informational", "Trending", "Question", "Local/Regional", "Semantic/LSI"];
    const filtered = filter === "All" ? data : data.filter(k => k.type === filter);

    return (
        <div className="card-surface overflow-hidden">
            <SectionHeader emoji="📝" title="Phase 3 — Full Keyword Generation" subtitle={`${data.length} keywords across 8 categories — scored and prioritised`} />
            <div className="px-5 py-3 border-b border-border flex flex-wrap gap-2">
                {types.map(t => (
                    <button
                        key={t}
                        onClick={() => setFilter(t)}
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
                            <th scope="col" className="px-5 py-3">#</th>
                            <th scope="col" className="px-5 py-3">Keyword</th>
                            <th scope="col" className="px-5 py-3">Type</th>
                            <th scope="col" className="px-5 py-3">Volume</th>
                            <th scope="col" className="px-5 py-3">KD</th>
                            <th scope="col" className="px-5 py-3">Intent</th>
                            <th scope="col" className="px-5 py-3">Relevance</th>
                            <th scope="col" className="px-5 py-3">Quick Win</th>
                            <th scope="col" className="px-5 py-3">Content Type</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground text-sm">
                                    {data.length === 0
                                        ? "No keywords were returned — Gemini may have hit its output limit. Click ↺ Re-run Research to try again."
                                        : "No keywords match the selected filter."}
                                </td>
                            </tr>
                        )}
                        {filtered.map((kw, i) => (
                            <tr key={i} className="hover:bg-card transition-colors">
                                <td className="px-5 py-3 text-muted-foreground text-xs">{kw.rank}</td>
                                <td className="px-5 py-3 font-medium max-w-[260px]">
                                    <span className="truncate block" title={kw.keyword}>{kw.keyword}</span>
                                    {kw.trendStatus && <span className="text-xs text-orange-400">{kw.trendStatus}</span>}
                                </td>
                                <td className="px-5 py-3">
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${typeColors[kw.type] || "bg-zinc-700 text-zinc-300"}`}>
                                        {kw.type}
                                    </span>
                                </td>
                                <td className="px-5 py-3 text-muted-foreground">{kw.volume}</td>
                                <td className="px-5 py-3">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${kw.difficulty < 30 ? "bg-emerald-500" : kw.difficulty < 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${kw.difficulty}%` }} />
                                        </div>
                                        <span className="text-xs text-muted-foreground">{kw.difficulty}</span>
                                    </div>
                                </td>
                                <td className="px-5 py-3">
                                    <Badge text={kw.intent} className={intentColors[kw.intent] || ""} />
                                </td>
                                <td className="px-5 py-3">
                                    <div className="flex">
                                        {Array.from({ length: 10 }).map((_, d) => (
                                            <div key={d} className={`w-1.5 h-1.5 rounded-full mr-0.5 ${d < kw.relevance ? "bg-primary" : "bg-white/10"}`} />
                                        ))}
                                    </div>
                                </td>
                                <td className="px-5 py-3">
                                    {kw.quickWin
                                        ? <span className="text-emerald-400 font-bold text-xs">✓ Yes</span>
                                        : <span className="text-muted-foreground text-xs">Long-term</span>}
                                </td>
                                <td className="px-5 py-3 text-xs text-muted-foreground">{kw.contentType}</td>
                            </tr>
                        ))}
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
                        <span className="text-xl">🔥</span>
                        <h2 className="text-lg font-semibold">Phase 5 — Daily Trend Simulation</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">Trending topics right now — publish within 48 hours to capture momentum</p>
                </div>
                <button
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    className="shrink-0 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isRefreshing ? "Refreshing…" : "↻ Refresh Trends"}
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                        <tr>
                            <th scope="col" className="px-5 py-3">Trend Topic</th>
                            <th scope="col" className="px-5 py-3">Status</th>
                            <th scope="col" className="px-5 py-3">Keyword Variations</th>
                            <th scope="col" className="px-5 py-3">Recommended Content</th>
                            <th scope="col" className="px-5 py-3">Urgency</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {data.map((trend, i) => (
                            <tr key={i} className="hover:bg-card transition-colors">
                                <td className="px-5 py-3 font-medium text-foreground">{trend.topic}</td>
                                <td className="px-5 py-3 text-base">{trend.status}</td>
                                <td className="px-5 py-3">
                                    <div className="flex flex-col gap-1">
                                        {trend.keywordVariations.slice(0, 3).map((kv, j) => (
                                            <span key={j} className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{kv}</span>
                                        ))}
                                    </div>
                                </td>
                                <td className="px-5 py-3 text-xs text-zinc-300 max-w-[250px]">{trend.recommendedContent}</td>
                                <td className="px-5 py-3 text-xs text-amber-400 font-semibold">{trend.urgency}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Phase6Panel({ data }: { data: ContentCalendarItem[] }) {
    const buckets = ["Week 1", "Month 1", "Month 2-3"] as const;

    return (
        <div className="card-surface overflow-hidden">
            <SectionHeader emoji="📅" title="Phase 6 — Content Calendar" subtitle="Top 10 pieces to create, grouped by publishing roadmap" />
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
                                {item.priorityScore && (
                                    <span className={`absolute top-4 right-4 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${item.priorityScore >= 80 ? "bg-red-500/10 text-red-400" : item.priorityScore >= 50 ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"}`}>
                                        Score: {item.priorityScore}
                                    </span>
                                )}
                                <p className="text-sm font-semibold text-foreground mb-2 pr-12">{item.title}</p>
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

function Phase7Panel({ data }: { data: (KeywordRow & { roadmap: string })[] }) {
    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">🏆</span>
                        <h2 className="text-lg font-semibold">Phase 7 — Master Keyword List</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">Top 50 keywords sorted by priority score — your publishing roadmap</p>
                </div>
                <button
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
                            <th scope="col" className="px-5 py-3">Intent</th>
                            <th scope="col" className="px-5 py-3">Rel.</th>
                            <th scope="col" className="px-5 py-3">Quick Win</th>
                            <th scope="col" className="px-5 py-3">Content Type</th>
                            <th scope="col" className="px-5 py-3">Roadmap</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {data.map((kw, i) => (
                            <tr key={i} className={`hover:bg-card transition-colors ${kw.quickWin ? "border-l-2 border-l-emerald-500/30" : ""}`}>
                                <td className="px-5 py-3 text-muted-foreground text-xs font-bold">{kw.rank}</td>
                                <td className="px-5 py-3 font-medium max-w-[220px]">
                                    <span className="truncate block" title={kw.keyword}>{kw.keyword}</span>
                                </td>
                                <td className="px-5 py-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${typeColors[kw.type] || ""}`}>{kw.type}</span>
                                </td>
                                <td className="px-5 py-3 text-muted-foreground text-xs">{kw.volume}</td>
                                <td className="px-5 py-3">
                                    <span className={`text-xs font-bold ${kw.difficulty < 30 ? "text-emerald-400" : kw.difficulty < 60 ? "text-amber-400" : "text-red-400"}`}>
                                        {kw.difficulty}
                                    </span>
                                </td>
                                <td className="px-5 py-3">
                                    <Badge text={kw.intent} className={intentColors[kw.intent] || ""} />
                                </td>
                                <td className="px-5 py-3 text-xs text-muted-foreground">{kw.relevance}/10</td>
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
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSavingPlanner, setIsSavingPlanner] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [loadingPhase, setLoadingPhase] = useState(0);
    const STORAGE_KEY = `seo_research_report_${siteId}`;

    // Restore report from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) setReport(JSON.parse(saved));
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
        const PHASE_MS = [4000, 5000, 8000, 5000, 4000, 4000];
        const next = () => {
            if (phase < PHASES.length - 1) {
                setTimeout(() => { phase++; setLoadingPhase(phase); next(); }, PHASE_MS[phase]);
            }
        };
        setTimeout(next, PHASE_MS[0]);
    };

    const handleRunResearch = () => {
        setError(null);
        startPhaseTimer();
        startTransition(async () => {
            const res = await runSeoResearch(siteId);
            if (res.success) {
                setReport(res.report);
            } else {
                setError(res.error);
            }
        });
    };

    const handleRefreshTrends = async () => {
        setError(null);
        setIsRefreshing(true);
        try {
            const res = await runTrendRefresh(siteId);
            if (res.success && report) {
                setReport({ ...report, trends: res.trends });
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

    return (
        <div className="flex flex-col gap-4">
            {/* Header CTA */}
            <div className="card-surface p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                        <span>🎯</span> OptiAISEO Research — 7-Phase Analysis
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Senior SEO strategist-level keyword research: business analysis, competitor gaps,
                        all keyword types, trend tracking, content calendar, and a full master keyword list.
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
                                onClick={handleSaveToPlanner}
                                disabled={isSavingPlanner || isPending}
                                className="px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                            >
                                {isSavingPlanner ? "Saving…" : saveSuccess ? (
                                    <span>✅ Saved! <a href={`/dashboard/planner?siteId=${siteId}`} className="underline font-bold">View Planner →</a></span>
                                ) : "📅 Save to Planner"}
                            </button>
                            <button
                                onClick={handleRefreshTrends}
                                disabled={isRefreshing || isPending}
                                className="px-4 py-2 text-sm font-semibold rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-all disabled:opacity-50"
                            >
                                {isRefreshing ? "Refreshing…" : "↻ Refresh Trends"}
                            </button>
                        </>
                    )}
                    <button
                        onClick={handleRunResearch}
                        disabled={isPending || isRefreshing}
                        className="px-6 py-2 text-sm font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                    >
                        {isPending ? "Analysing…" : report ? "↺ Re-run Research" : "▶ Run Full Research"}
                    </button>
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="card-surface p-5 border border-red-500/20 flex items-start gap-3">
                    <span className="text-red-400 text-xl shrink-0">⚠</span>
                    <div>
                        <p className="font-semibold text-red-400">Research Failed</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
                    </div>
                </div>
            )}

            {/* Loading State */}
            {isPending && <LoadingSkeleton currentPhase={loadingPhase} />}

            {/* Results */}
            {!isPending && report && (
                <>
                    <Phase1Panel data={report.businessAnalysis} />
                    {report.competitorGap.length > 0 && <Phase2Panel data={report.competitorGap} />}
                    <Phase3Panel data={report.keywords} />
                    {report.trends.length > 0 && (
                        <Phase5Panel data={report.trends} onRefresh={handleRefreshTrends} isRefreshing={isRefreshing} />
                    )}
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
                            Click <strong>Run Full Research</strong> to generate a complete 7-phase SEO strategy with
                            50+ keywords, competitor gap analysis, trending topics, content calendar, and a publishable roadmap.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left max-w-lg w-full mt-2">
                        {PHASES.map((p, i) => (
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
