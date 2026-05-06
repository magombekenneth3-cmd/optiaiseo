"use client";

import { memo } from "react";
import {
    Badge,
    DifficultyLabel,
    SerpFeasibility,
    ErrorBanner,
    PlannerMessage,
    AddButton,
    Spinner,
} from "../atoms";
import { CATEGORY_COLORS } from "../../types";
import { useResearchHub, type ResearchHubKeyword, type ResearchHubCluster, type CalendarEntry } from "../hooks";

type ResearchView = "generate" | "filter" | "cluster";

const STEPS = [
    { id: "generate" as ResearchView, num: "1", label: "Generate Pool", desc: "Describe your product" },
    { id: "filter" as ResearchView, num: "2", label: "Filter & Validate", desc: "Find quick wins" },
    { id: "cluster" as ResearchView, num: "3", label: "Cluster by Topic", desc: "Build authority" },
];

// ─── Step Progress Bar ────────────────────────────────────────────────────────
const StepProgress = memo(function StepProgress({
    step,
    setStep,
    hasResult,
}: {
    step: ResearchView;
    setStep: (s: ResearchView) => void;
    hasResult: boolean;
}) {
    return (
        <div className="flex gap-2">
            {STEPS.map((s) => (
                <button
                    key={s.id}
                    onClick={() => hasResult && setStep(s.id)}
                    disabled={!hasResult && s.id !== "generate"}
                    className={`flex-1 flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                        step === s.id
                            ? "bg-violet-500/10 border-violet-500/40 text-violet-300"
                            : hasResult
                                ? "bg-muted border-border text-muted-foreground hover:border-white/20"
                                : "bg-card border-border text-muted-foreground cursor-not-allowed"
                    }`}
                >
                    <span
                        className={`w-6 h-6 rounded-full text-xs font-black flex items-center justify-center shrink-0 ${
                            step === s.id ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground"
                        }`}
                    >
                        {s.num}
                    </span>
                    <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{s.label}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{s.desc}</p>
                    </div>
                </button>
            ))}
        </div>
    );
});

// ─── Keyword Row ──────────────────────────────────────────────────────────────
const KeywordRow = memo(function KeywordRow({
    kw,
    added,
    adding,
    onAdd,
}: {
    kw: ResearchHubKeyword;
    added: boolean;
    adding: boolean;
    onAdd: () => void;
}) {
    return (
        <div className="flex items-start gap-3 p-3 card-surface rounded-xl hover:border-white/15 transition-all">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-medium text-sm text-foreground">{kw.keyword}</p>
                    <Badge text={kw.category} className={CATEGORY_COLORS[kw.category] ?? ""} />
                    {kw.communitySource && kw.communitySource !== "null" && (
                        <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded px-1.5 py-0.5 font-bold">
                            {kw.communitySource}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <DifficultyLabel difficulty={kw.difficulty} />
                    <SerpFeasibility score={kw.serpFeasibility} />
                    <span
                        className="text-[10px] text-muted-foreground truncate max-w-[120px]"
                        title={kw.parentTopic}
                    >
                        📁 {kw.parentTopic}
                    </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{kw.reason}</p>
            </div>
            <AddButton added={added} loading={adding} onClick={onAdd} />
        </div>
    );
});

// ─── Cluster Card ─────────────────────────────────────────────────────────────
const ClusterCard = memo(function ClusterCard({
    cluster,
    ci,
    siteId,
    expanded,
    saving,
    saved,
    addedSet,
    onAddCluster,
    onToggle,
    onAddKeyword,
}: {
    cluster: ResearchHubCluster;
    ci: number;
    siteId: string;
    expanded: boolean;
    saving: boolean;
    saved: boolean;
    addedSet: Set<string>;
    onAddCluster: () => void;
    onToggle: () => void;
    onAddKeyword: (kw: ResearchHubKeyword) => void;
}) {
    const displayKws = expanded ? cluster.keywords : cluster.keywords.slice(0, 8);
    const authorityColor =
        cluster.topicalAuthorityScore >= 7
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : cluster.topicalAuthorityScore >= 5
                ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                : "bg-zinc-500/10 text-muted-foreground border-zinc-500/20";

    return (
        <div className="card-surface p-5 rounded-xl space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-bold text-foreground text-sm">📁 {cluster.parentTopic}</p>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${authorityColor}`}>
                            Authority ★{cluster.topicalAuthorityScore}/10
                        </span>
                        <span className="text-[10px] text-muted-foreground">{cluster.keywords.length} keywords</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{cluster.contentPlan}</p>
                </div>
                <button
                    onClick={onAddCluster}
                    disabled={saving}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        saved
                            ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                            : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
                    }`}
                >
                    {saving ? "…" : saved ? (
                        <>
                            <span>✅ Saved!</span>{" "}
                            <a href={`/dashboard/planner?siteId=${siteId}`} className="underline">
                                View →
                            </a>
                        </>
                    ) : "+ Add All to Planner"}
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {displayKws.map((kw, ki) => (
                    <button
                        key={ki}
                        onClick={() => !addedSet.has(kw.keyword) && onAddKeyword(kw)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-all ${
                            addedSet.has(kw.keyword)
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : "bg-muted border-border text-zinc-300 hover:border-white/30"
                        }`}
                    >
                        {addedSet.has(kw.keyword) ? "✓ " : ""}
                        {kw.keyword}
                    </button>
                ))}
                {!expanded && cluster.keywords.length > 8 && (
                    <button
                        onClick={onToggle}
                        className="text-[11px] px-2 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 font-bold hover:bg-violet-500/20 transition-all"
                    >
                        +{cluster.keywords.length - 8} more
                    </button>
                )}
                {expanded && cluster.keywords.length > 8 && (
                    <button
                        onClick={onToggle}
                        className="text-[11px] px-2 py-1 rounded-full bg-zinc-500/10 border border-zinc-500/20 text-zinc-400 font-bold hover:bg-zinc-500/20 transition-all"
                    >
                        Show less ↑
                    </button>
                )}
            </div>
        </div>
    );
});

// ─── ResearchHubTab ───────────────────────────────────────────────────────────
export const ResearchHubTab = memo(function ResearchHubTab({ siteId }: { siteId: string }) {
    const hub = useResearchHub(siteId);

    return (
        <div className="space-y-6">
            <StepProgress step={hub.step} setStep={hub.setStep} hasResult={!!hub.result} />

            {/* ── STEP 1 ── */}
            {hub.step === "generate" && (
                <div className="space-y-4">
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-xs text-blue-300 space-y-1.5">
                        <p className="font-bold text-sm">📋 Step 1: Describe Your Product or Service</p>
                        <p className="text-muted-foreground">
                            Paste a description of what you sell — features, target customers, pain points. The more detail,
                            the better the research.
                        </p>
                    </div>
                    <textarea
                        value={hub.productDesc}
                        onChange={(e) => hub.setProductDesc(e.target.value)}
                        rows={6}
                        placeholder={`Example:\n\nRentalStack is a property management platform for small landlords.\nFeatures:\n- Rent collection & payment tracking\n- Maintenance request management\n- Tenant screening & application portal`}
                        className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/50 resize-none font-mono"
                    />
                    <ErrorBanner message={hub.error} />
                    <button
                        onClick={hub.handleGenerate}
                        disabled={hub.loading || !hub.productDesc.trim()}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-violet-500 to-blue-500 text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-[0_0_30px_rgba(139,92,246,0.25)] disabled:opacity-40"
                    >
                        {hub.loading ? (
                            <><Spinner /> Generating keyword pool… (15–30s)</>
                        ) : (
                            "🔬 Generate Keyword Pool (60+ keywords)"
                        )}
                    </button>
                </div>
            )}

            {/* ── STEP 2 ── */}
            {hub.step === "filter" && hub.result && ((
                (result) => (
                <div className="space-y-4">
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-xs space-y-2">
                        <p className="font-bold text-amber-400 text-sm">🔍 Step 2: Validate Using the SERP</p>
                        <p className="text-muted-foreground">
                            For each keyword, Google it and study the top 5. Ask: can I create better content, and can I
                            mention my product naturally?
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                            💡 SERP score ≥ 7 + Low difficulty = Quick Win.
                        </p>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                        {[
                            { label: "Total", val: result.keywords.length, color: "text-foreground" },
                            { label: "Quick Wins", val: result.quickWins.length, color: "text-emerald-400" },
                            { label: "Community", val: result.communityKeywords.length, color: "text-blue-400" },
                            { label: "Clusters", val: result.clusters.length, color: "text-violet-400" },
                        ].map((s) => (
                            <div key={s.label} className="card-surface p-3 text-center">
                                <p className={`text-2xl font-black ${s.color}`}>{s.val}</p>
                                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                                    {s.label}
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={() => hub.setQuickWinsOnly(!hub.quickWinsOnly)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                                hub.quickWinsOnly
                                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                    : "bg-muted border-border text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            ⚡ Quick Wins Only
                        </button>
                        {(["all", "informational", "commercial", "transactional"] as const).map((cat) => (
                            <button
                                key={cat}
                                onClick={() => { hub.setFilterCategory(cat); hub.setQuickWinsOnly(false); }}
                                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all capitalize ${
                                    !hub.quickWinsOnly && hub.filterCategory === cat
                                        ? cat === "all" ? "bg-zinc-700 border-zinc-500 text-foreground"
                                            : cat === "informational" ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                                                : cat === "commercial" ? "bg-violet-500/20 border-violet-500/40 text-violet-400"
                                                    : "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                        : "bg-muted border-border text-muted-foreground hover:text-zinc-300"
                                }`}
                            >
                                {cat === "all"
                                    ? `All (${result.keywords.length})`
                                    : `${cat} (${result.keywords.filter((k) => k.category === cat).length})`}
                            </button>
                        ))}
                        <div className="ml-auto">
                            <button
                                onClick={hub.handleSaveFilteredToPlanner}
                                disabled={hub.plannerSaving || !hub.displayKeywords.length}
                                className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold rounded-xl text-xs hover:opacity-90 transition-all shadow-lg disabled:opacity-50"
                            >
                                {hub.plannerSaving ? "Saving…" : `📅 Save ${hub.displayKeywords.length} to Planner`}
                            </button>
                        </div>
                    </div>

                    <PlannerMessage msg={hub.plannerMsg} siteId={siteId} />

                    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-2">
                        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                            {hub.displayKeywords.length} keywords
                        </p>
                        {hub.displayKeywords.map((kw, i) => (
                            <KeywordRow
                                key={i}
                                kw={kw}
                                added={hub.isAdded(kw.keyword)}
                                adding={hub.adding === kw.keyword}
                                onAdd={() => hub.handleAddKeyword(kw)}
                            />
                        ))}
                    </div>

                    <button
                        onClick={() => hub.setStep("cluster")}
                        className="w-full py-2.5 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-400 font-bold text-sm hover:bg-violet-500/30 transition-all"
                    >
                        → Step 3: Cluster by Topical Authority
                    </button>
                </div>
                ))(hub.result)
            )}

            {/* ── STEP 3 ── */}
            {hub.step === "cluster" && hub.result && ((
                (result) => (
                <div className="space-y-4">
                    <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 text-xs space-y-1.5">
                        <p className="font-bold text-violet-400 text-sm">🗂 Step 3: Build Topical Authority</p>
                        <p className="text-muted-foreground">
                            Each cluster has a <strong className="text-zinc-300">Parent Topic</strong> — the hub Google
                            uses to judge topical authority across all related queries.
                        </p>
                    </div>

                    <div className="space-y-4">
                        {result.clusters.map((cluster, ci) => (
                            <ClusterCard
                                key={ci}
                                cluster={cluster}
                                ci={ci}
                                siteId={siteId}
                                expanded={hub.expandedClusters.has(ci)}
                                saving={hub.clusterSaving === ci}
                                saved={hub.clusterSaved.has(ci)}
                                addedSet={hub.addedSet}
                                onAddCluster={() => hub.handleAddCluster(cluster, ci)}
                                onToggle={() => hub.toggleClusterExpand(ci)}
                                onAddKeyword={(kw) => hub.handleAddKeyword(kw)}
                            />
                        ))}
                    </div>

                    <div className="mt-8 pt-8 border-t border-border">
                        <div className="flex items-center justify-between gap-4 mb-4">
                            <div>
                                <p className="font-bold text-sm text-foreground mb-1">📅 Minimum Viable Content Calendar</p>
                                <p className="text-xs text-muted-foreground">
                                    Generate a 150-word page strategy for your top clusters.
                                </p>
                            </div>
                            <button
                                onClick={hub.handleGenerateCalendar}
                                disabled={hub.calendarLoading}
                                className="px-4 py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-bold rounded-lg shadow-lg disabled:opacity-50"
                            >
                                {hub.calendarLoading ? "Generating…" : "Generate MVP Calendar"}
                            </button>
                        </div>
                        {hub.calendar.length > 0 && (
                            <div className="space-y-3">
                                {hub.calendar.map((item: CalendarEntry, i: number) => (
                                    <div key={i} className="card-surface p-4 rounded-xl text-xs space-y-2">
                                        <div className="flex items-center justify-between text-zinc-300">
                                            <span className="font-bold text-violet-400">{item.clusterTopic}</span>
                                            <span className="bg-muted border border-border px-2 py-0.5 rounded text-[10px]">
                                                {item.estimatedWordCount} words
                                            </span>
                                        </div>
                                        <p className="font-medium text-sm text-white">{item.title}</p>
                                        <div className="flex items-center gap-2 text-muted-foreground font-mono">
                                            <span>/{item.slug}</span>
                                            <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded text-[10px]">
                                                Target: {item.keyword}
                                            </span>
                                        </div>
                                        <p className="text-muted-foreground border-l border-border pl-2 mt-2 leading-relaxed whitespace-pre-line">
                                            {item.outline}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                ))(hub.result)
            )}
        </div>
    );
});