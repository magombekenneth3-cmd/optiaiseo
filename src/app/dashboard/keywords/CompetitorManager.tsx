/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef } from "react";
import { addCompetitor, refreshCompetitorKeywords, generateBlogForCompetitor, deleteCompetitor, detectCompetitorsFromSerp } from "@/app/actions/competitors";
import { CompetitorTopPages } from "./CompetitorTopPages";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { showActionError } from "@/lib/ui/action-errors";
import { Zap, Plus, RefreshCw, Trash2, Crosshair, Microscope, X, CheckCircle, AlertTriangle, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";

// ─── Page Analysis Panel ──────────────────────────────────────────────────────
interface PageAnalysis {
    url: string;
    keyword: string;
    wordCount: number;
    titleTag: string;
    h1: string;
    headings: string[];
    hasSchema: boolean;
    hasFAQ: boolean;
    internalLinkCount: number;
    imageCount: number;
    metaDescription: string;
    contentGaps: string[];
    onPageScore: number;
    beatThemWith: string[];
}

function OnPageScoreBadge({ score }: { score: number }) {
    const color = score >= 70 ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
        : score >= 45 ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
        : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    const label = score >= 70 ? "Strong — hard to beat" : score >= 45 ? "Moderate — beatable" : "Weak — easy win";
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${color}`}>
            {score}/100 · {label}
        </span>
    );
}

function PageAnalysisPanel({ analysis, onClose }: { analysis: PageAnalysis; onClose: () => void }) {
    return (
        <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 space-y-5 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-semibold truncate text-sm mb-1" title={analysis.url}>{analysis.url}</p>
                    <OnPageScoreBadge score={analysis.onPageScore} />
                </div>
                <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Structural signals */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: "Word Count", value: analysis.wordCount.toLocaleString() },
                    { label: "H2 Headings", value: analysis.headings.length },
                    { label: "Images", value: analysis.imageCount },
                    { label: "Intl. Links", value: analysis.internalLinkCount },
                ].map(s => (
                    <div key={s.label} className="bg-card border border-border rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-0.5">{s.label}</p>
                        <p className="text-lg font-bold">{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Schema badges */}
            <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium ${analysis.hasSchema ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                    {analysis.hasSchema ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {analysis.hasSchema ? "Has JSON-LD schema" : "No JSON-LD schema"}
                </span>
                <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium ${analysis.hasFAQ ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                    {analysis.hasFAQ ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {analysis.hasFAQ ? "Has FAQ section" : "No FAQ section"}
                </span>
            </div>

            {/* Title & H1 */}
            {(analysis.titleTag || analysis.h1) && (
                <div className="space-y-1.5">
                    {analysis.titleTag && <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">Title:</span> {analysis.titleTag}</p>}
                    {analysis.h1 && <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">H1:</span> {analysis.h1}</p>}
                </div>
            )}

            {/* H2 headings */}
            {analysis.headings.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Their H2 Structure</p>
                    <div className="flex flex-wrap gap-1.5">
                        {analysis.headings.map((h, i) => (
                            <span key={i} className="text-xs bg-card border border-border rounded px-2 py-0.5 text-foreground/80">{h}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Content Gaps */}
            {analysis.contentGaps.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Topics They Cover (You Don&apos;t)</p>
                    <ul className="space-y-1">
                        {analysis.contentGaps.map((gap, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                                <span className="text-amber-400 mt-0.5 shrink-0">▸</span>
                                <span>{gap}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Beat them with */}
            {analysis.beatThemWith.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">How to Outrank This Page</p>
                    <ul className="space-y-1.5">
                        {analysis.beatThemWith.map((tactic, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                                <span className="text-emerald-400 font-bold shrink-0 mt-0.5">{i + 1}.</span>
                                <span>{tactic}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────
function DeleteCompetitorModal({
    domain,
    isDeleting,
    onConfirm,
    onCancel,
}: {
    domain: string;
    isDeleting: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    // ESC to cancel
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !isDeleting) onCancel(); };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onCancel, isDeleting]);

    return createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }} aria-modal="true" role="dialog" aria-labelledby="delete-modal-title">
            {/* Backdrop */}
            <div
                style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
                onClick={() => { if (!isDeleting) onCancel(); }}
            />
            {/* Card */}
            <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", pointerEvents: "none" }}>
                <div
                    className="pointer-events-auto w-full max-w-sm rounded-2xl border border-rose-500/20 bg-card shadow-[0_25px_60px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
                    role="alertdialog"
                >
                    {/* Header stripe */}
                    <div className="h-1 w-full bg-gradient-to-r from-rose-600 via-rose-500 to-orange-500" />

                    <div className="p-6">
                        {/* Icon + title */}
                        <div className="flex items-start gap-4 mb-5">
                            <div className="w-11 h-11 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                                <AlertCircle className="w-5 h-5 text-rose-400" />
                            </div>
                            <div>
                                <h2 id="delete-modal-title" className="text-base font-bold text-white mb-1">
                                    Remove competitor?
                                </h2>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    This will permanently delete{" "}
                                    <span className="font-semibold text-white">{domain}</span>{" "}
                                    and all its keyword gap data. This action cannot be undone.
                                </p>
                            </div>
                        </div>

                        {/* Domain pill */}
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-rose-500/5 border border-rose-500/15 mb-6">
                            <Crosshair className="w-3.5 h-3.5 text-rose-400/60 shrink-0" />
                            <span className="text-sm font-mono text-rose-300 truncate">{domain}</span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={onCancel}
                                disabled={isDeleting}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-muted hover:bg-accent text-sm font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={onConfirm}
                                disabled={isDeleting}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-all shadow-[0_0_20px_rgba(239,68,68,0.25)] hover:shadow-[0_0_25px_rgba(239,68,68,0.4)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                aria-busy={isDeleting}
                            >
                                {isDeleting ? (
                                    <>
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        Removing…
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Yes, remove it
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CompetitorManager({
    siteId,
    initialCompetitors
}: {
    siteId: string;
    initialCompetitors: any[]
}) {
    const [domain, setDomain] = useState("");
    const [isAdding, setIsAdding] = useState(false);
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [generatingId, setGeneratingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; domain: string } | null>(null);
    const [competitors, setCompetitors] = useState(initialCompetitors);
    const [analysingKey, setAnalysingKey] = useState<string | null>(null);
    // Map of "kwId" → PageAnalysis
    const [analyses, setAnalyses] = useState<Record<string, PageAnalysis>>({});
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isDetecting, setIsDetecting] = useState(false);
    const [addingSuggestion, setAddingSuggestion] = useState<string | null>(null);
    // Ref to hold active polling interval so we can clean it up on unmount
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    useEffect(() => {
        setCompetitors(initialCompetitors);
    }, [initialCompetitors]);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!domain) return;
        setIsAdding(true);
        const res = await addCompetitor(siteId, domain);
        if (res.success) {
            toast.success(`Added ${domain} as a competitor!`);
            setDomain("");
            if (res.competitor) {
                setCompetitors(prev => [res.competitor, ...prev]);
                handleRefresh(res.competitor.id);
            }
        } else {
            toast.error(res.error || "Failed to add competitor");
        }
        setIsAdding(false);
    };

    const handleAutoDetect = async () => {
        setIsDetecting(true);
        setSuggestions([]);
        const res = await detectCompetitorsFromSerp(siteId);
        if (res.success && (res.suggestions?.length ?? 0) > 0) {
            const existing = new Set(competitors.map((c: any) => c.domain.replace(/^www\./, "")));
            setSuggestions((res.suggestions ?? []).filter((s: string) => !existing.has(s)));
            if (res.warnings?.length) {
                res.warnings.forEach((w) => toast.info(w, { duration: 6000 }));
            }
        } else {
            toast.error(res.error ?? "No competitors found. Set a target keyword in Site Settings.");
        }
        setIsDetecting(false);
    };

    const handleAddSuggestion = async (domain: string) => {
        setAddingSuggestion(domain);
        const res = await addCompetitor(siteId, domain);
        if (res.success) {
            toast.success(`${domain} added as competitor.`);
            setSuggestions(prev => prev.filter(s => s !== domain));
            if (res.competitor) {
                setCompetitors(prev => [res.competitor, ...prev]);
                handleRefresh(res.competitor.id);
            }
        } else {
            toast.error(res.error ?? "Failed to add competitor.");
        }
        setAddingSuggestion(null);
    };

    const handleRefresh = async (compId: string) => {
        setRefreshingId(compId);
        const res = await refreshCompetitorKeywords(siteId, compId);
        if (res.success) {
            toast.success(`Found ${res.count} keyword gaps!`);
            // Patch _count AND reset the keywords array length display
            setCompetitors(prev => prev.map(c =>
                c.id === compId
                    ? { ...c, _count: { keywords: res.count ?? 0 }, keywords: c.keywords }
                    : c
            ));
        } else {
            toast.error(res.error || "Failed to find gaps");
        }
        setRefreshingId(null);
    };

    const handleDelete = async (compId: string) => {
        setDeletingId(compId);
        const res = await deleteCompetitor(siteId, compId);
        if (res.success) {
            toast.success("Competitor removed.");
            setCompetitors(prev => prev.filter(c => c.id !== compId));
        } else {
            toast.error(res.error || "Failed to remove competitor");
        }
        setDeletingId(null);
        setDeleteTarget(null);
    };

    const handleGenerate = async (compId: string, compDomain: string, keyword: string, vol: number, diff: number, intent?: string) => {
        const genKey = `${compId}::${keyword}`;
        setGeneratingId(genKey);
        toast.info("Generating SEO-optimized post...");
        const res = await generateBlogForCompetitor(siteId, compDomain, keyword, vol, diff, intent);
        if (res.success) {
            toast.success("Blog draft generated successfully!");
        } else {
            showActionError(res as { success: false; error?: string; code?: string });
        }
        setGeneratingId(null);
    };

    const handleAnalysePage = async (kwId: string, url: string, keyword: string) => {
        // Toggle off if already showing
        if (analyses[kwId]) {
            setAnalyses(prev => { const next = { ...prev }; delete next[kwId]; return next; });
            return;
        }
        setAnalysingKey(kwId);
        toast.info("Queuing competitor page analysis\u2026");
        try {
            const res = await fetch("/api/competitors/analyse-page", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, keyword, siteId }),
            });
            const data = await res.json();

            if (!res.ok) {
                toast.error(data.error || "Could not queue analysis");
                setAnalysingKey(null);
                return;
            }

            const { analysisId } = data as { analysisId: string };

            // Step 2: Poll every 3 seconds until done or failed (max 90 seconds)
            let attempts = 0;
            const MAX_ATTEMPTS = 30;
            // Store in ref so cleanup effect can clear it on unmount
            pollRef.current = setInterval(async () => {
                attempts++;
                try {
                    const check = await fetch(`/api/competitors/analyse-page/${analysisId}`);
                    const result = await check.json();

                    if (result.status === "done") {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setAnalyses(prev => ({ ...prev, [kwId]: result.result as PageAnalysis }));
                        setAnalysingKey(null);
                        toast.success("Page analysis complete!");
                    } else if (result.status === "failed") {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setAnalysingKey(null);
                        toast.error(result.error || "Analysis failed \u2014 please try again.");
                    } else if (attempts >= MAX_ATTEMPTS) {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setAnalysingKey(null);
                        toast.error("Analysis timed out after 90 seconds \u2014 please retry.");
                    }
                } catch {
                    if (pollRef.current) clearInterval(pollRef.current);
                    setAnalysingKey(null);
                    toast.error("Network error while checking analysis status");
                }
            }, 3000);
        } catch {
            toast.error("Network error during page analysis");
            setAnalysingKey(null);
        }
    };

    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Crosshair className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-lg font-semibold">Competitor Intelligence</h2>
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 ml-2">New</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Track competitors to find keyword gaps — then analyse their exact pages to discover what it takes to outrank them.
                    </p>
                </div>

                {competitors.length < 5 && (
                    <div className="flex flex-col gap-3">
                        <form onSubmit={handleAdd} className="flex items-center gap-2">
                            <input
                                type="text"
                                placeholder="competitor.com"
                                value={domain}
                                onChange={(e) => setDomain(e.target.value)}
                                disabled={isAdding}
                                className="flex-1 bg-card border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all md:w-64"
                            />
                            <button
                                type="submit"
                                disabled={isAdding || !domain}
                                className="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
                            >
                                {isAdding ? "Adding…" : "Add"}
                            </button>
                            <button
                                type="button"
                                onClick={handleAutoDetect}
                                disabled={isDetecting}
                                title="Auto-detect competitors from Google search results"
                                className="px-4 py-2 bg-muted border border-border text-muted-foreground rounded-lg text-sm font-semibold hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 flex items-center gap-1.5"
                            >
                                {isDetecting ? (
                                    <><RefreshCw className="animate-spin w-3.5 h-3.5" /> Detecting…</>
                                ) : "🔍 Auto-detect"}
                            </button>
                        </form>

                        {/* Detecting status banner */}
                        {isDetecting && (
                            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-violet-500/20 bg-violet-500/5 text-xs text-violet-300">
                                <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                                <span className="flex-1">Scanning Google SERP for competitors — this takes 20–40 seconds…</span>
                            </div>
                        )}

                        {suggestions.length > 0 && (
                            <div className="p-3 bg-muted border border-border rounded-xl">
                                <p className="text-xs font-semibold text-muted-foreground mb-2">
                                    Found {suggestions.length} competitor{suggestions.length !== 1 ? "s" : ""} from Google results — click to add:
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {suggestions.map(s => (
                                        <button
                                            key={s}
                                            onClick={() => handleAddSuggestion(s)}
                                            disabled={addingSuggestion === s}
                                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-card border border-border rounded-lg text-xs font-medium hover:border-emerald-500/40 hover:text-emerald-400 transition-colors disabled:opacity-50"
                                        >
                                            {addingSuggestion === s ? (
                                                <RefreshCw className="animate-spin w-3 h-3" />
                                            ) : <Plus className="w-3 h-3" />} {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {competitors.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center">
                    <Crosshair className="w-12 h-12 text-white/10 mb-3" />
                    <p>Add a competitor domain to start discovering keyword gaps.</p>
                </div>
            ) : (
                <div className="divide-y divide-border">
                    {competitors.map((comp: any) => (
                        <div key={comp.id} className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-lg flex items-center gap-2">
                                    {comp.domain}
                                    <span className="text-xs font-normal text-muted-foreground px-2 py-0.5 bg-muted rounded-full border border-border">
                                        {comp.keywords?.length || 0} gaps found
                                    </span>
                                </h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleRefresh(comp.id)}
                                        disabled={refreshingId === comp.id}
                                        className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                                    >
                                        <RefreshCw className={`w-3.5 h-3.5 ${refreshingId === comp.id ? 'animate-spin' : ''}`} />
                                        {refreshingId === comp.id ? "Scanning..." : "Sync Gaps"}
                                    </button>
                                    <button
                                        onClick={() => setDeleteTarget({ id: comp.id, domain: comp.domain })}
                                        disabled={deletingId === comp.id}
                                        className="text-muted-foreground hover:text-rose-400 p-1.5 rounded-lg bg-muted hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                                        title="Remove Competitor"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {comp.keywords && comp.keywords.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {comp.keywords.map((kw: any) => {
                                        const kwId = kw.id ?? `${comp.id}-${kw.keyword}`;
                                        const hasUrl = !!kw.url;
                                        const isAnalysing = analysingKey === kwId;
                                        const analysis = analyses[kwId];

                                        return (
                                            <div key={kwId} className="bg-card border border-border rounded-xl p-4 hover:border-indigo-500/30 transition-colors flex flex-col gap-3">
                                                <div>
                                                    <div className="flex items-start justify-between gap-2 mb-2">
                                                        <p className="font-bold text-sm truncate" title={kw.keyword}>{kw.keyword}</p>
                                                        {kw.dataSource === "gsc" ? (
                                                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 border border-emerald-500/20">
                                                                Live GSC
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
                                                                Vol: {kw.searchVolume || '>1K'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {kw.dataSource === "gsc" && kw.impressions != null ? (
                                                        // Real GSC data
                                                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                                            <span className="text-emerald-400 font-medium">
                                                                {Math.round(kw.impressions / 3).toLocaleString()} imp/mo
                                                            </span>
                                                            <span>{kw.clicks ?? 0} clicks</span>
                                                            <span>CTR: {kw.ctr ?? 0}%</span>
                                                            <span>Pos: #{kw.position ?? '—'}</span>
                                                            {kw.intent && (
                                                                <span className="capitalize px-1.5 py-0.5 rounded bg-muted border border-border">{kw.intent}</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        // Estimated data
                                                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                                            <span>Pos: {kw.position > 0 ? `#${kw.position}` : 'Not ranking'}</span>
                                                            {kw.clicks != null && (
                                                                <span className="text-indigo-400 font-medium flex items-center gap-0.5">
                                                                    <Zap className="w-3 h-3" />
                                                                    ~{kw.clicks.toLocaleString()} clicks/mo
                                                                </span>
                                                            )}
                                                            {kw.ctr != null && (
                                                                <span>CTR: {(kw.ctr * 100).toFixed(1)}%</span>
                                                            )}
                                                            <span>Diff: {kw.difficulty || 45}/100</span>
                                                            {kw.intent && (
                                                                <span className="capitalize px-1.5 py-0.5 rounded bg-muted border border-border">{kw.intent}</span>
                                                            )}
                                                        </div>
                                                    )}

                                                </div>

                                                {/* Analyse Page button — only if we have a URL */}
                                                {hasUrl && (
                                                    <button
                                                        onClick={() => handleAnalysePage(kwId, kw.url, kw.keyword)}
                                                        disabled={isAnalysing}
                                                        className="w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50"
                                                    >
                                                        {isAnalysing ? (
                                                            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analysing page…</>
                                                        ) : analysis ? (
                                                            <>{analysis ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} Hide Analysis</>
                                                        ) : (
                                                            <><Microscope className="w-3.5 h-3.5" /> Analyse Page</>
                                                        )}
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => handleGenerate(comp.id, comp.domain, kw.keyword, kw.searchVolume || 1000, kw.difficulty || 45, kw.intent)}
                                                    disabled={generatingId === `${comp.id}::${kw.keyword}`}
                                                    className="w-full py-1.5 bg-muted hover:bg-indigo-500/20 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors text-white hover:text-indigo-300 disabled:opacity-50"
                                                >
                                                    {generatingId === `${comp.id}::${kw.keyword}` ? (
                                                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating...</>
                                                    ) : (
                                                        <>Generate Post to Outrank</>
                                                    )}
                                                </button>

                                                {/* Page analysis panel — collapses per keyword card */}
                                                {analysis && (
                                                    <PageAnalysisPanel
                                                        analysis={analysis}
                                                        onClose={() => setAnalyses(prev => { const next = { ...prev }; delete next[kwId]; return next; })}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground bg-card p-4 rounded-xl border border-border text-center">
                                    No keyword gaps found yet. Click &apos;Sync Gaps&apos; to scan this competitor.
                                </div>
                            )}
                        <CompetitorTopPages
                                siteId={siteId}
                                competitorId={comp.id}
                                domain={comp.domain}
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* Delete confirmation modal — portal to document.body, outside any CSS stacking context */}
            {deleteTarget && (
                <DeleteCompetitorModal
                    domain={deleteTarget.domain}
                    isDeleting={deletingId === deleteTarget.id}
                    onConfirm={() => handleDelete(deleteTarget.id)}
                    onCancel={() => { if (!deletingId) setDeleteTarget(null); }}
                />
            )}
        </div>
    );
}