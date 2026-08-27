"use client";

import { useState, useCallback, useEffect } from "react";
import {
    Search, Zap, AlertTriangle, CheckCircle2, Clock, Loader2,
    TrendingUp, Target, ChevronRight, BarChart3, FileText,
    ArrowUpRight, RefreshCw, XCircle, Info,
} from "lucide-react";
import { SerpGapDetail } from "./SerpGapDetail";


interface AnalysisRow {
    id: string;
    keyword: string;
    clientUrl: string;
    clientPosition: number;
    status: string;
    serpFormat: string | null;
    gapCount: number | null;
    criticalGapCount: number | null;
    estimatedPositionGain: string | null;
    topPriority: string | null;
    taskCount: number | null;
    automatedTaskCount: number | null;
    createdAt: Date;
    completedAt: Date | null;
}

interface QuotaInfo {
    used: number;
    limit: number;
    remaining: number;
    tier: string;
    resetAt: string;
}

interface Props {
    sites: { id: string; domain: string }[];
    activeSiteId: string;
    activeSiteDomain: string;
    userTier: string;
    userCredits: number;
    initialAnalyses: AnalysisRow[];
}


function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
        PENDING:   { label: "Queued",    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",   icon: <Clock className="w-3 h-3" /> },
        SCRAPING:  { label: "Scraping",  cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",   icon: <Loader2 className="w-3 h-3 animate-spin" /> },
        PLANNING:  { label: "Planning",  cls: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
        COMPLETED: { label: "Complete",  cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: <CheckCircle2 className="w-3 h-3" /> },
        FAILED:    { label: "Failed",    cls: "bg-red-500/10 text-red-400 border-red-500/20",       icon: <XCircle className="w-3 h-3" /> },
    };
    const s = map[status] ?? map.PENDING;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${s.cls}`}>
            {s.icon}{s.label}
        </span>
    );
}


function GapPill({ count, critical }: { count: number | null; critical: number | null }) {
    if (count === null) return <span className="text-muted-foreground text-xs">—</span>;
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold">{count}</span>
            {critical != null && critical > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                    {critical} critical
                </span>
            )}
        </div>
    );
}


export function SerpGapDashboard({
    sites,
    activeSiteId,
    activeSiteDomain,
    userTier,
    userCredits,
    initialAnalyses,
}: Props) {
    const [analyses, setAnalyses] = useState<AnalysisRow[]>(initialAnalyses);
    const [keyword, setKeyword] = useState("");
    const [clientUrl, setClientUrl] = useState(activeSiteDomain ? `https://${activeSiteDomain}/` : "");
    const [clientPosition, setClientPosition] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
    const [quota, setQuota] = useState<QuotaInfo | null>(null);

    const isFree = userTier.toUpperCase() === "FREE";

    // Fetch quota on mount
    useEffect(() => {
        fetch("/api/serp-gap/quota")
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setQuota(data); })
            .catch(() => {});
    }, []);

    // Poll in-progress analyses
    const pollAnalysis = useCallback(async (id: string) => {
        try {
            const res = await fetch(`/api/sites/${activeSiteId}/serp-gap/${id}`);
            if (!res.ok) return;
            const data = await res.json();
            setAnalyses(prev => prev.map(a => a.id === id ? { ...a, ...data } : a));
            if (data.status === "COMPLETED" || data.status === "FAILED") {
                setPollingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
            }
        } catch { /* silent */ }
    }, [activeSiteId]);

    useEffect(() => {
        const running = analyses.filter(a => ["PENDING", "SCRAPING", "PLANNING"].includes(a.status));
        if (running.length === 0) return;
        running.forEach(a => setPollingIds(prev => new Set([...prev, a.id])));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (pollingIds.size === 0) return;
        const interval = setInterval(() => {
            pollingIds.forEach(id => pollAnalysis(id));
        }, 4000);
        return () => clearInterval(interval);
    }, [pollingIds, pollAnalysis]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!activeSiteId) { setError("No site selected."); return; }
        const pos = parseInt(clientPosition);
        if (!keyword.trim() || !clientUrl || isNaN(pos)) {
            setError("Please fill in all fields.");
            return;
        }
        setSubmitting(true);
        try {
            const res = await fetch(`/api/sites/${activeSiteId}/serp-gap`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keyword: keyword.trim(), clientUrl, clientPosition: pos }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error ?? "Failed to start analysis."); return; }
            const newRow: AnalysisRow = {
                id: data.analysisId,
                keyword: keyword.trim(),
                clientUrl,
                clientPosition: pos,
                status: "PENDING",
                serpFormat: null,
                gapCount: null,
                criticalGapCount: null,
                estimatedPositionGain: null,
                topPriority: null,
                taskCount: null,
                automatedTaskCount: null,
                createdAt: new Date(),
                completedAt: null,
            };
            setAnalyses(prev => [newRow, ...prev]);
            setPollingIds(prev => new Set([...prev, data.analysisId]));
            setKeyword(""); setClientPosition("");
            // Refresh quota after successful submission
            fetch("/api/serp-gap/quota")
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setQuota(d); })
                .catch(() => {});
        } catch { setError("Network error. Please try again."); }
        finally { setSubmitting(false); }
    };

    const selectedAnalysis = analyses.find(a => a.id === selectedId) ?? null;

    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">

            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-1 flex items-center gap-2">
                        <BarChart3 className="w-6 h-6 text-purple-400" />
                        SERP Gap Analysis
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Discover why your page isn&apos;t ranking — and get a 4-week fix plan.
                        {activeSiteDomain && <> · <span className="text-foreground font-medium">{activeSiteDomain}</span></>}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {quota && !isFree && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border text-sm">
                            <BarChart3 className="w-4 h-4 text-purple-400" />
                            <span className="text-muted-foreground">Quota:</span>
                            <span className="font-bold">{quota.used}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="font-bold">{quota.limit}</span>
                            <span className="text-muted-foreground text-xs">this month</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border text-sm">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-muted-foreground">Credits:</span>
                        <span className="font-bold">{userCredits}</span>
                        <span className="text-muted-foreground text-xs">(5 per analysis)</span>
                    </div>
                </div>
            </div>

            {/* How it works banner */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-purple-500/20 bg-purple-500/5 text-sm">
                <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-muted-foreground leading-relaxed">
                    Enter a keyword where you&apos;re ranking on <strong className="text-foreground">page 2+</strong>. We&apos;ll scrape the top 5 results,
                    compare your page against them across 12 content dimensions, and generate a precise week-by-week upgrade plan.
                    <strong className="text-purple-400"> Costs 5 credits.</strong>
                </p>
            </div>

            {/* Tier gate for FREE users */}
            {isFree ? (
                <div className="card-surface p-8 flex flex-col items-center gap-4 text-center border-amber-500/20 bg-amber-500/5">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <BarChart3 className="w-7 h-7 text-amber-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-foreground mb-1">Upgrade to unlock SERP Gap Analysis</h3>
                        <p className="text-sm text-muted-foreground max-w-md">
                            SERP Gap Analysis is available on Starter (5/mo), Pro (30/mo), and Agency (200/mo) plans.
                            Discover exactly why your pages aren&apos;t ranking and get a week-by-week fix plan.
                        </p>
                    </div>
                    <a
                        href="/dashboard/billing"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition-colors shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                    >
                        <ArrowUpRight className="w-4 h-4" />
                        View Plans
                    </a>
                </div>
            ) : (
                /* Trigger form */
                <form onSubmit={handleSubmit} className="card-surface p-6 flex flex-col gap-4">
                    <h2 className="font-semibold text-base flex items-center gap-2">
                        <Search className="w-4 h-4 text-muted-foreground" />
                        New Gap Analysis
                    </h2>

                    {/* Near-limit warning */}
                    {quota && quota.remaining <= 2 && quota.remaining > 0 && (
                        <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            Only {quota.remaining} analysis{quota.remaining === 1 ? "" : "es"} remaining this month.
                        </div>
                    )}
                    {quota && quota.remaining <= 0 && (
                        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            Monthly quota reached ({quota.limit} analyses).{" "}
                            <a href="/dashboard/billing" className="underline font-semibold hover:text-red-300">Upgrade</a>{" "}
                            for more.
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Keyword</label>
                            <input
                                id="serp-gap-keyword"
                                type="text"
                                value={keyword}
                                onChange={e => setKeyword(e.target.value)}
                                placeholder="e.g. best seo tools 2025"
                                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/60 transition-colors"
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Page URL</label>
                            <input
                                id="serp-gap-url"
                                type="url"
                                value={clientUrl}
                                onChange={e => setClientUrl(e.target.value)}
                                placeholder="https://yourdomain.com/page"
                                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/60 transition-colors"
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Position</label>
                            <input
                                id="serp-gap-position"
                                type="number"
                                min={1}
                                max={200}
                                value={clientPosition}
                                onChange={e => setClientPosition(e.target.value)}
                                placeholder="e.g. 18"
                                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/60 transition-colors"
                                required
                            />
                        </div>
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-4">
                        <p className="text-xs text-muted-foreground">
                            Analysis takes ~90 seconds. You&apos;ll see results appear below.
                        </p>
                        <button
                            id="serp-gap-submit"
                            type="submit"
                            disabled={submitting || userCredits < 5 || (quota != null && quota.remaining <= 0)}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            {submitting ? "Starting…" : "Analyse Gap (5 credits)"}
                        </button>
                    </div>
                </form>
            )}

            {/* Results table */}
            {analyses.length > 0 && (
                <div className="card-surface overflow-hidden">
                    <div className="p-5 border-b border-border flex items-center justify-between">
                        <h2 className="font-semibold flex items-center gap-2">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            Recent Analyses
                        </h2>
                        {pollingIds.size > 0 && (
                            <span className="flex items-center gap-1.5 text-xs text-blue-400">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                {pollingIds.size} running…
                            </span>
                        )}
                    </div>

                    {/* Mobile */}
                    <div className="md:hidden divide-y divide-border">
                        {analyses.map(a => (
                            <button
                                key={a.id}
                                onClick={() => a.status === "COMPLETED" && setSelectedId(a.id)}
                                disabled={a.status !== "COMPLETED"}
                                className="w-full text-left flex flex-col gap-2 px-4 py-4 hover:bg-accent/50 transition-colors disabled:cursor-default"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm font-medium truncate max-w-[200px]">{a.keyword}</p>
                                    <StatusBadge status={a.status} />
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    <span>Pos #{a.clientPosition}</span>
                                    {a.gapCount !== null && <><span>·</span><GapPill count={a.gapCount} critical={a.criticalGapCount} /></>}
                                    {a.estimatedPositionGain && <><span>·</span><span className="text-emerald-400">{a.estimatedPositionGain}</span></>}
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Desktop */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
                                <tr>
                                    <th className="px-5 py-3">Keyword</th>
                                    <th className="px-5 py-3">Position</th>
                                    <th className="px-5 py-3">Status</th>
                                    <th className="px-5 py-3">Gaps</th>
                                    <th className="px-5 py-3">Format</th>
                                    <th className="px-5 py-3">Est. Gain</th>
                                    <th className="px-5 py-3">Tasks</th>
                                    <th className="px-5 py-3"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {analyses.map(a => (
                                    <tr key={a.id} className="hover:bg-accent/30 transition-colors">
                                        <td className="px-5 py-3.5 font-medium max-w-[200px] truncate" title={a.keyword}>{a.keyword}</td>
                                        <td className="px-5 py-3.5">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold">
                                                #{a.clientPosition}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5"><StatusBadge status={a.status} /></td>
                                        <td className="px-5 py-3.5"><GapPill count={a.gapCount} critical={a.criticalGapCount} /></td>
                                        <td className="px-5 py-3.5 capitalize text-muted-foreground text-xs">{a.serpFormat ?? "—"}</td>
                                        <td className="px-5 py-3.5 text-xs text-emerald-400 max-w-[160px] truncate" title={a.estimatedPositionGain ?? ""}>
                                            {a.estimatedPositionGain ?? "—"}
                                        </td>
                                        <td className="px-5 py-3.5 text-xs text-muted-foreground">
                                            {a.taskCount != null ? (
                                                <span>
                                                    {a.taskCount} tasks
                                                    {a.automatedTaskCount ? <span className="text-purple-400 ml-1">({a.automatedTaskCount} auto)</span> : null}
                                                </span>
                                            ) : "—"}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            {a.status === "COMPLETED" && (
                                                <button
                                                    id={`serp-gap-view-${a.id}`}
                                                    onClick={() => setSelectedId(a.id)}
                                                    className="inline-flex items-center gap-1 text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors"
                                                >
                                                    View Plan <ChevronRight className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {analyses.length === 0 && (
                <div className="card-surface p-12 text-center flex flex-col items-center gap-3">
                    <Target className="w-10 h-10 text-muted-foreground/40" />
                    <p className="font-medium text-muted-foreground">No analyses yet</p>
                    <p className="text-sm text-muted-foreground/60 max-w-sm">
                        Enter a keyword above where you&apos;re ranking on page 2+. We&apos;ll identify exactly what&apos;s holding you back.
                    </p>
                </div>
            )}

            {/* Detail modal */}
            {selectedId && (
                <SerpGapDetail
                    analysisId={selectedId}
                    siteId={activeSiteId}
                    onClose={() => setSelectedId(null)}
                />
            )}
        </div>
    );
}
