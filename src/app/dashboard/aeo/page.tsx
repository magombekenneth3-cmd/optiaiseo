"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
    getAllSitesWithMentions,
    checkLlmMentions,
    type AeoCategoryScore,
} from "@/app/actions/llmMentions";
import { GsiMetrics } from "@/components/dashboard/GsiMetrics";
import { PromptSimulator } from "@/components/aeo/PromptSimulator";
import type { AeoResult } from "@/lib/aeo";
import { runAeoReport, getAeoReportStatus } from "@/app/actions/aeo";
import { generateAeoRecommendationFix, type AeoRecommendationFix } from "@/app/actions/aeoFix";
import Link from "next/link";
import {
    Bot, Zap, ChevronDown, ChevronUp, Lightbulb, Globe,
    TrendingUp, HelpCircle, BarChart2, BookOpen, Target,
    Users, Search, Wrench, Loader2, Copy, Check, AlertCircle,
    ArrowUpRight, Sparkles, Activity, Shield, Clock,
} from "lucide-react";
import { BrandEntityPanel } from "@/components/aeo/BrandEntityPanel";
import { CitationGapPanel } from "@/components/aeo/CitationGapPanel";
import { CitationBreakdownPanel } from "@/components/aeo/CitationBreakdownPanel";
import { AeoScoreTrendChart } from "@/components/aeo/AeoScoreTrendChart";
import { VisibilityForecastPanel } from "@/components/aeo/VisibilityForecastPanel";
import { SemanticGapPanel } from "@/components/aeo/SemanticGapPanel";
import { GenerativeSOVPanel } from "@/components/dashboard/GenerativeSOVPanel";
import QueryLibraryPanel from "@/components/aeo/QueryLibraryPanel";
import { BacklinkPanel } from "@/components/dashboard/BacklinkPanel";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { PdfDownloadButton } from "@/components/PdfDownloadButton";
import { CreditGate } from "@/components/ui/CreditGate";
import { AasCard } from "@/components/aeo/AasCard";
import { ProofTimeline } from "@/components/aeo/ProofTimeline";

// New component files
import { AeoHeroCard } from "@/components/dashboard/aeo/AeoHeroCard";
import { ScanProgress } from "@/components/dashboard/aeo/ScanProgress";
import { AiSearchPresence } from "@/components/dashboard/aeo/AiSearchPresence";
import { TopOpportunities } from "@/components/dashboard/aeo/TopOpportunities";
import { BrandEntityCard } from "@/components/dashboard/aeo/BrandEntityCard";
import { CitationPerformance } from "@/components/dashboard/aeo/CitationPerformance";
import { SiteHealthPanel } from "@/components/dashboard/aeo/SiteHealthPanel";

// ─── Score utilities (shared across inline components) ─────────────────────

function scoreColor(score: number) {
    return score >= 65 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-rose-400";
}
function scoreBg(score: number) {
    return score >= 65 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-rose-500";
}
function gradeColor(grade: string) {
    const map: Record<string, string> = {
        A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
        B: "text-blue-400   border-blue-500/30   bg-blue-500/10",
        C: "text-amber-400  border-amber-500/30  bg-amber-500/10",
        D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
        F: "text-rose-400   border-rose-500/30   bg-rose-500/10",
    };
    return map[grade] ?? "text-zinc-400 border-zinc-500/30 bg-zinc-500/10";
}

const GRADE_LABELS: Record<string, string> = {
    A: "Excellent — AI frequently cites you",
    B: "Good foundations — needs content depth",
    C: "Moderate — AI rarely cites you",
    D: "Weak — AI mostly ignores you",
    F: "Critical — invisible to AI systems",
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
    brand_authority: Globe,
    topic_coverage: TrendingUp,
    faq_readiness: HelpCircle,
    competitor_comparison: BarChart2,
    how_to_guidance: BookOpen,
};

// ─── Shared ScoreRing (small, for inline use) ──────────────────────────────

function ScoreRing({ rate, size = 48, strokeWidth = 5 }: { rate: number; size?: number; strokeWidth?: number }) {
    const r = size / 2 - strokeWidth;
    const circ = 2 * Math.PI * r;
    const dash = Math.min(rate / 100, 1) * circ;
    const color = rate >= 65 ? "#10b981" : rate >= 40 ? "#f59e0b" : "#ef4444";
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
                    strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
                    style={{ transition: "stroke-dasharray 1.4s cubic-bezier(0.4,0,0.2,1)" }}
                />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center font-black rotate-90 tabular-nums ${scoreColor(rate)}`}
                style={{ fontSize: size > 60 ? 16 : 11 }}>
                {rate}
            </span>
        </div>
    );
}

// ─── Category bar ──────────────────────────────────────────────────────────

function CategoryBar({ cat }: { cat: AeoCategoryScore }) {
    const Icon = CATEGORY_ICONS[cat.category] ?? Globe;
    return (
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-muted/40 border border-border/60">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className={`p-1 rounded-md bg-muted ${scoreColor(cat.score)}`}>
                        <Icon className="w-3 h-3" />
                    </span>
                    <span className="text-xs font-medium text-foreground">{cat.label}</span>
                </div>
                <span className={`text-sm font-black tabular-nums ${scoreColor(cat.score)}`}>{cat.score}%</span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-1000 ${scoreBg(cat.score)}`} style={{ width: `${cat.score}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground">{cat.cited}/{cat.queriesRun} queries cited</p>
        </div>
    );
}

// ─── Section label ─────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label, accent }: {
    icon: React.ElementType; label: string; accent?: "amber" | "blue" | "emerald";
}) {
    const color = accent === "amber" ? "text-amber-400" : accent === "blue" ? "text-blue-400" : accent === "emerald" ? "text-emerald-400" : "text-muted-foreground";
    return (
        <div className="flex items-center gap-2">
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
    );
}

// ─── Recommendation fix panel ──────────────────────────────────────────────

function RecommendationFixPanel({ siteId, recommendation, competitors, category }: {
    siteId: string; recommendation: string; competitors: string[]; category?: string;
}) {
    type State =
        | { status: "idle" }
        | { status: "loading" }
        | { status: "done"; result: AeoRecommendationFix }
        | { status: "error"; message: string };
    const [state, setState] = useState<State>({ status: "idle" });
    const [copied, setCopied] = useState(false);

    const handleFix = useCallback(async () => {
        setState({ status: "loading" });
        const res = await generateAeoRecommendationFix(siteId, recommendation, competitors, category);
        if (res.success) setState({ status: "done", result: res });
        else setState({ status: "error", message: res.error });
    }, [siteId, recommendation, competitors, category]);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (state.status === "idle")
        return (
            <button onClick={handleFix} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 active:scale-95 transition-all shrink-0 whitespace-nowrap">
                <Wrench className="w-3 h-3" /> Fix this
            </button>
        );
    if (state.status === "loading")
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" /> Generating…
            </span>
        );
    if (state.status === "error")
        return (
            <div className="mt-3 w-full flex items-start gap-2 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-xl p-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{state.message}</span>
                <button onClick={() => setState({ status: "idle" })} className="underline text-muted-foreground hover:text-foreground">Retry</button>
            </div>
        );

    const r = state.result;
    return (
        <div className="mt-3 w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col gap-3">
            {r.competitorInsight && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground italic border-l-2 border-blue-500/40 pl-3">
                    <Search className="w-3 h-3 shrink-0 mt-0.5 text-blue-400" />
                    <span><span className="font-semibold text-blue-300 not-italic">Competitor intel: </span>{r.competitorInsight}</span>
                </div>
            )}
            <div>
                <p className="text-sm font-bold text-emerald-400 mb-1">{r.headline}</p>
                <p className="text-xs text-foreground/80 leading-relaxed">{r.why}</p>
            </div>
            <ol className="space-y-2">
                {r.steps.map((step, si) => (
                    <li key={si} className="flex gap-2.5 items-start text-xs text-foreground/80">
                        <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black flex items-center justify-center shrink-0 mt-0.5">{si + 1}</span>
                        {step}
                    </li>
                ))}
            </ol>
            {r.copySnippet && (
                <div className="relative">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Ready-to-paste snippet</p>
                    <pre className="text-xs text-zinc-300 bg-zinc-950/80 border border-zinc-700/60 rounded-xl p-3 pr-10 overflow-x-auto font-mono whitespace-pre-wrap">{r.copySnippet}</pre>
                    <button onClick={() => handleCopy(r.copySnippet!)} className="absolute top-7 right-2 p-1.5 rounded-lg bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors">
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                </div>
            )}
            <button onClick={() => setState({ status: "idle" })} className="self-end text-[10px] text-muted-foreground hover:text-foreground underline">Reset</button>
        </div>
    );
}

// ─── Benchmark Banner (sidebar) ────────────────────────────────────────────

function BenchmarkSidebar({ yourScore, siteId }: { yourScore: number; siteId: string }) {
    const [dismissed, setDismissed] = useState(true);
    const [stats, setStats] = useState<{ average: number; topTenPercent: number } | null>(null);

    useEffect(() => {
        const isDismissed = localStorage.getItem(`benchmark-dismissed-${siteId}`) === "true";
        setDismissed(isDismissed);
        fetch("/api/aeo/benchmark").then(r => r.json()).then(data => {
            if (data.success) setStats({ average: data.average, topTenPercent: data.topTenPercent });
        }).catch(() => {});
    }, [siteId]);

    const average = stats?.average ?? 38;
    const topTen = stats?.topTenPercent ?? 71;

    if (dismissed) {
        return (
            <button
                onClick={() => { localStorage.removeItem(`benchmark-dismissed-${siteId}`); setDismissed(false); }}
                className="w-full text-[10px] text-muted-foreground/60 border border-dashed border-border rounded-xl py-2 px-3 text-center hover:text-muted-foreground transition-colors"
            >
                Show industry comparison
            </button>
        );
    }

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-400" />
                    <p className="text-sm font-bold text-foreground">Industry Comparison</p>
                </div>
                <button onClick={() => { localStorage.setItem(`benchmark-dismissed-${siteId}`, "true"); setDismissed(true); }} className="text-muted-foreground/60 hover:text-foreground text-sm transition-colors">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {[
                    { label: "Your score", value: yourScore, color: "text-foreground" },
                    { label: "Category avg", value: average, color: "text-muted-foreground" },
                    { label: "Top 10%", value: topTen, color: "text-amber-400" },
                ].map(item => (
                    <div key={item.label} className="text-center">
                        <div className={`text-xl font-black tabular-nums ${item.color}`}>{item.value}</div>
                        <div className="text-[9px] text-muted-foreground/70 mt-0.5">{item.label}</div>
                    </div>
                ))}
            </div>
            <div className="h-1.5 rounded-full bg-muted/40 relative overflow-visible">
                <div className="absolute top-[-3px] w-0.5 h-3 bg-muted-foreground/50 rounded-full" style={{ left: `${Math.min(average, 100)}%` }} />
                <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full" style={{ width: `${Math.min(yourScore, 100)}%` }} />
                <div className="absolute top-[-3px] w-0.5 h-3 bg-amber-400 rounded-full" style={{ left: `${Math.min(topTen, 100)}%` }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground/50 font-mono">
                <span>0</span>
                <span>avg {average}</span>
                <span className="text-amber-400">top {topTen}</span>
                <span>100</span>
            </div>
        </div>
    );
}

// ─── Recent Activity (sidebar) ────────────────────────────────────────────

function RecentActivity({ sites }: { sites: any[] }) {
    const events = sites
        .flatMap((s) => {
            const events = [];
            if (s.latest?.createdAt) events.push({ label: "AI visibility scan completed", date: s.latest.createdAt, domain: s.site?.domain });
            return events;
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 4);

    if (events.length === 0) return null;

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-bold text-foreground">Recent Activity</p>
            </div>
            <div className="flex flex-col gap-3">
                {events.map((e, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-xs text-foreground leading-snug">{e.label}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                {" · "}
                                {new Date(e.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Tab definitions ───────────────────────────────────────────────────────

const MAIN_TABS = [
    { id: "overview",         label: "Overview" },
    { id: "citations",        label: "Citations" },
    { id: "recommendations",  label: "Recommendations" },
    { id: "competitors",      label: "Competitors" },
    { id: "queries",          label: "Queries" },
    { id: "brand",            label: "Brand Entity" },
    { id: "evidence",         label: "Evidence" },
] as const;

type MainTabId = typeof MAIN_TABS[number]["id"];

// ─── Tab nav ───────────────────────────────────────────────────────────────

function MainTabNav({ active, onChange }: { active: MainTabId; onChange: (t: MainTabId) => void }) {
    return (
        <div className="flex items-center gap-0 border-b border-border overflow-x-auto scrollbar-none">
            {MAIN_TABS.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => onChange(tab.id)}
                    className={[
                        "shrink-0 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px",
                        active === tab.id
                            ? "border-emerald-500 text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                    ].join(" ")}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

// ─── Tab content ───────────────────────────────────────────────────────────

function TabContent({
    tab, siteId, domain, rate, result, recommendations, responses,
    categoryScores, models, brandFacts, competitorDomains, hasCompetitors,
    onTabChange,
}: {
    tab: MainTabId;
    siteId: string;
    domain: string;
    rate: number | null;
    result: any;
    recommendations: string[];
    responses: any[];
    categoryScores: AeoCategoryScore[];
    models: any[];
    brandFacts: { factType: string; value: string; verified: boolean }[];
    competitorDomains: string[];
    hasCompetitors: boolean;
    onTabChange: (t: MainTabId) => void;
}) {
    // ── OVERVIEW ──────────────────────────────────────────────────────────
    if (tab === "overview") {
        return (
            <div className="flex flex-col gap-6">
                {/* Top row: opportunities + brand entity side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2">
                        <TopOpportunities
                            recommendations={recommendations}
                            responses={responses}
                            domain={domain}
                            siteId={siteId}
                            onViewAll={() => onTabChange("recommendations")}
                        />
                    </div>
                    <BrandEntityCard
                        brandFacts={brandFacts}
                        siteId={siteId}
                        onViewDetails={() => onTabChange("brand")}
                    />
                </div>

                {/* Category score breakdown */}
                {categoryScores.length > 0 && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <SectionLabel icon={TrendingUp} label="AEO Category Scores" />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                            {categoryScores.map(cat => <CategoryBar key={cat.category} cat={cat} />)}
                        </div>
                    </div>
                )}

                {/* Citation performance */}
                <CitationPerformance
                    models={models}
                    lastScanAt={result?.createdAt}
                    onViewEvidence={() => onTabChange("evidence")}
                />
            </div>
        );
    }

    // ── CITATIONS ─────────────────────────────────────────────────────────
    if (tab === "citations") {
        return (
            <div className="flex flex-col gap-6">
                <PanelErrorBoundary fallbackTitle="Citation Gap panel failed to load">
                    <CitationGapPanel siteId={siteId} hasCompetitors={hasCompetitors} />
                </PanelErrorBoundary>
                {responses.length > 0 && (
                    <PanelErrorBoundary fallbackTitle="Citation Breakdown failed to load">
                        <CitationBreakdownPanel responses={responses} domain={domain} multiModel={models} />
                    </PanelErrorBoundary>
                )}
            </div>
        );
    }

    // ── RECOMMENDATIONS ───────────────────────────────────────────────────
    if (tab === "recommendations") {
        const competitors = responses
            .filter((r: any) => !r.cited && r.excerpt)
            .flatMap((r: any) => ((r.excerpt as string).match(/\b([a-z0-9-]+\.(?:com|org|net|io|co|ai|app|dev))\b/gi) ?? []))
            .filter((d: string) => !d.includes(domain));
        const uniqueCompetitors = [...new Set(competitors)].slice(0, 3);
        const catKeys = ["brand_authority", "industry", "services", "geography", "legitimacy"];

        return (
            <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border bg-card p-5">
                    <SectionLabel icon={Lightbulb} label="Actionable Recommendations" accent="amber" />
                    {recommendations.length === 0 ? (
                        <p className="text-sm text-muted-foreground mt-4">
                            Run an AEO Scan to generate personalised recommendations.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-4 mt-4">
                            {recommendations.map((rec, i) => (
                                <div key={i} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                                    <div className="flex items-start gap-3">
                                        <span className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                                        <p className="text-sm text-foreground/85 leading-relaxed flex-1">{rec}</p>
                                        <RecommendationFixPanel siteId={siteId} recommendation={rec} competitors={uniqueCompetitors} category={catKeys[i]} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Schema gaps */}
                {result?.schemaGaps?.length > 0 && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <SectionLabel icon={AlertCircle} label="Missing Schema" accent="amber" />
                        <div className="flex flex-col gap-2 mt-4">
                            {result.schemaGaps.map((gap: string, i: number) => (
                                <div key={i} className="flex items-start gap-2.5 text-sm p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                                    <span className="text-amber-400 text-base mt-0.5">⚠</span>
                                    <span className="text-foreground/85">{gap}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* What AI knows about brand */}
                {result?.checks?.aiExcerpt && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <SectionLabel icon={Users} label="What AI Knows About Your Brand" accent="amber" />
                        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 flex flex-col gap-4">
                            <p className="text-sm text-foreground/85 leading-relaxed italic">&ldquo;{result.checks.aiExcerpt}&rdquo;</p>
                            {Array.isArray(result.checks.benchmarkChecks) && result.checks.benchmarkChecks.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {result.checks.benchmarkChecks.map((bc: any) => (
                                        <div key={bc.id} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-xs ${bc.passed ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300" : "bg-rose-500/5 border-rose-500/20 text-rose-300"}`}>
                                            <span className="mt-0.5">{bc.passed ? "✅" : "❌"}</span>
                                            <div>
                                                <p className="font-semibold">{bc.label}</p>
                                                <p className="text-[10px] text-muted-foreground mt-0.5">{bc.detail}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── COMPETITORS ───────────────────────────────────────────────────────
    if (tab === "competitors") {
        return (
            <PanelErrorBoundary fallbackTitle="Competitor panel failed to load">
                <BacklinkPanel siteId={siteId} competitorDomains={competitorDomains} />
            </PanelErrorBoundary>
        );
    }

    // ── QUERIES ───────────────────────────────────────────────────────────
    if (tab === "queries") {
        const categoryLabels: Record<string, string> = {
            aio_brand: "AIO — Brand", brand_authority: "Brand Authority",
            topic_coverage: "Topic Coverage", faq_readiness: "FAQ Readiness",
            competitor_comparison: "Competitors", how_to_guidance: "How-To",
            geo_recommendation: "GEO — Recommendation",
        };
        return (
            <div className="flex flex-col gap-6">
                <PanelErrorBoundary fallbackTitle="Prompt Simulator failed to load">
                    <PromptSimulator siteId={siteId} domain={domain} />
                </PanelErrorBoundary>
                <PanelErrorBoundary fallbackTitle="Query Library failed to load">
                    <QueryLibraryPanel siteId={siteId} />
                </PanelErrorBoundary>

                {/* Raw query responses */}
                {responses.length > 0 && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <SectionLabel icon={Search} label={`AI Query Results (${responses.length})`} />
                        <div className="flex flex-col gap-2 mt-4">
                            {responses.map((r: any, i: number) => {
                                const categoryLabel = r.category
                                    ? (categoryLabels[r.category] ?? r.category.replace(/_/g, " "))
                                    : null;
                                const queryLabel = r.query && r.query !== `AEO batch analysis for ${r.category}` ? r.query : null;
                                return (
                                    <div key={i} className={`p-3.5 rounded-xl text-xs border ${r.cited ? "bg-emerald-500/5 border-emerald-500/15" : "bg-muted/20 border-border/60"}`}>
                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                            <span className={`font-bold px-2 py-0.5 rounded-lg border text-[11px] ${r.cited ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}>
                                                {r.cited ? "✅ Cited" : "❌ Not cited"}
                                            </span>
                                            {categoryLabel && (
                                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted border border-border text-muted-foreground">{categoryLabel}</span>
                                            )}
                                        </div>
                                        {queryLabel && <p className="font-semibold text-foreground mb-1.5">&ldquo;{queryLabel}&rdquo;</p>}
                                        {r.excerpt
                                            ? <p className="text-muted-foreground leading-relaxed">{r.excerpt}</p>
                                            : <p className="text-muted-foreground/60 italic">No excerpt available.</p>
                                        }
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── BRAND ENTITY ──────────────────────────────────────────────────────
    if (tab === "brand") {
        return (
            <PanelErrorBoundary fallbackTitle="Brand Entity panel failed to load">
                <BrandEntityPanel
                    siteId={siteId}
                    domain={domain}
                    brandFacts={brandFacts}
                    competitorDomains={competitorDomains}
                />
            </PanelErrorBoundary>
        );
    }

    // ── EVIDENCE ──────────────────────────────────────────────────────────
    if (tab === "evidence") {
        const isDeepAudit = Array.isArray(result?.checks);
        const deepChecks: any[] = isDeepAudit ? result.checks : [];
        return (
            <div className="flex flex-col gap-6">
                <PanelErrorBoundary fallbackTitle="Proof Timeline failed to load">
                    <ProofTimeline siteId={siteId} domain={domain} />
                </PanelErrorBoundary>
                <AeoScoreTrendChart siteId={siteId} domain={domain} />
                <PanelErrorBoundary fallbackTitle="Visibility Forecast failed to load">
                    <VisibilityForecastPanel siteId={siteId} />
                </PanelErrorBoundary>

                {/* Multi-model comparison */}
                {models.length > 0 && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <SectionLabel icon={BarChart2} label="Model Citation Comparison" />
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                            {models.map((m: any) => (
                                <div key={m.modelName} className="p-4 rounded-xl bg-muted/20 border border-border/60">
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="font-semibold capitalize text-sm text-foreground">{m.modelName}</p>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${m.citationRate >= 50 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                                            {m.citationRate}%
                                        </span>
                                    </div>
                                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                                        <div className={`h-full rounded-full transition-all duration-700 ${m.citationRate >= 50 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${m.citationRate}%` }} />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">{m.citationCount}/{m.queriesRun} queries</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* GSI metrics */}
                {result?.multiEngineScore && <GsiMetrics result={result as AeoResult} />}

                {/* Deep audit layers */}
                {deepChecks.length > 0 && (() => {
                    const layerGroups = [
                        { key: "aeo", label: "AEO — Answer Engine", color: "text-blue-400", icon: Search, cats: ["schema", "eeat", "content", "technical", "citation"] },
                        { key: "geo", label: "GEO — Generative Recommendation", color: "text-purple-400", icon: Target, cats: ["geo"] },
                        { key: "aio", label: "AIO — Brand Understanding", color: "text-amber-400", icon: Users, cats: ["aio"] },
                    ];
                    return (
                        <div className="flex flex-col gap-8">
                            {layerGroups.map(({ key, label, color, icon: LIcon, cats }) => {
                                const groupChecks = deepChecks.filter((c: any) => cats.includes(c.category));
                                if (!groupChecks.length) return null;
                                const passed = groupChecks.filter((c: any) => c.passed).length;
                                return (
                                    <div key={key} className="rounded-2xl border border-border bg-card p-5">
                                        <div className={`flex items-center gap-2 mb-4 ${color}`}>
                                            <LIcon className="w-4 h-4" />
                                            <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
                                            <span className="text-muted-foreground font-normal normal-case tracking-normal text-xs">— {passed}/{groupChecks.length} passed</span>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {groupChecks.map((c: any) => (
                                                <div key={c.id} className={`p-4 rounded-xl border flex flex-col gap-2 ${c.passed ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20"}`}>
                                                    <div className="flex items-start justify-between gap-2">
                                                        <p className="font-semibold text-sm text-foreground">{c.passed ? "✅" : "❌"} {c.label}</p>
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase shrink-0 ${c.impact === "high" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : c.impact === "medium" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"}`}>{c.impact}</span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground leading-relaxed">{c.detail}</p>
                                                    {!c.passed && c.recommendation && (
                                                        <div className="mt-1 p-3 bg-muted/40 rounded-xl border border-border/60">
                                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                                                <Lightbulb className="w-3 h-3 text-amber-400" /> How to fix
                                                            </p>
                                                            <p className="text-xs text-muted-foreground leading-relaxed">{c.recommendation}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}

                {/* Semantic gaps */}
                {result?.semanticGaps?.length > 0 && (
                    <PanelErrorBoundary fallbackTitle="Semantic Gap panel failed to load">
                        <SemanticGapPanel gaps={result.semanticGaps} />
                    </PanelErrorBoundary>
                )}
            </div>
        );
    }

    return null;
}

// ─── Skeleton ──────────────────────────────────────────────────────────────

function PageSkeleton() {
    return (
        <div className="flex gap-6">
            <div className="flex-1 min-w-0 flex flex-col gap-4">
                <div className="h-10 w-48 rounded-lg shimmer" />
                <div className="h-44 rounded-2xl shimmer" />
                <div className="h-10 rounded-xl shimmer" />
                <div className="h-72 rounded-2xl shimmer" />
            </div>
            <div className="w-72 shrink-0 flex flex-col gap-4">
                <div className="h-52 rounded-2xl shimmer" />
                <div className="h-36 rounded-2xl shimmer" />
                <div className="h-28 rounded-2xl shimmer" />
            </div>
        </div>
    );
}

// ─── Main inner page ───────────────────────────────────────────────────────

function AeoRankPageInner() {
    const [sites, setSites] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [primaryBrandFacts, setPrimaryBrandFacts] = useState<{ factType: string; value: string; verified: boolean }[]>([]);
    const [mainTab, setMainTab] = useState<MainTabId>("overview");

    // Scan state — lifted from individual SiteRow to page level
    const [activeResult, setActiveResult] = useState<any>(null);
    const [scanning, setScanning] = useState(false);
    const [deepScanning, setDeepScanning] = useState(false);
    const [pollingStatus, setPollingStatus] = useState<"idle" | "polling" | "done" | "timeout">("idle");
    const [currentStep, setCurrentStep] = useState(0);
    const [pendingReportId, setPendingReportId] = useState<string | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);

    const searchParams = useSearchParams();
    const router = useRouter();
    const urlSiteId = searchParams.get("siteId");

    // Load all sites
    useEffect(() => {
        getAllSitesWithMentions().then((res) => {
            setLoading(false);
            if (res.success) {
                setSites(res.sites);
                const entry = res.sites.find((s: any) => s.site?.id === urlSiteId) ?? res.sites[0];
                setActiveResult(entry?.latest ?? null);
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const activeSiteEntry = sites.find((s) => s.site?.id === urlSiteId) ?? sites[0];
    const activeSite = activeSiteEntry?.site;

    // Load brand facts when active site changes
    useEffect(() => {
        if (!activeSite?.id) return;
        fetch(`/api/entity-panel?siteId=${activeSite.id}`)
            .then((r) => r.json())
            .then((data) => setPrimaryBrandFacts(data.brandFacts ?? []))
            .catch(() => {});
    }, [activeSite?.id]);

    // Sync activeResult when URL siteId changes
    useEffect(() => {
        if (!sites.length) return;
        const entry = sites.find((s: any) => s.site?.id === urlSiteId) ?? sites[0];
        setActiveResult(entry?.latest ?? null);
    }, [urlSiteId, sites]);

    // Scan handlers
    const handleScan = useCallback(async () => {
        if (!activeSite?.id) return;
        setScanning(true); setScanError(null);
        try {
            const res = await checkLlmMentions(activeSite.id);
            if (res.success && res.reportId) { setPendingReportId(res.reportId); setPollingStatus("polling"); }
            else setScanError((res as any).error ?? "Scan failed to start.");
        } catch (e: unknown) {
            setScanError((e as Error)?.message ?? "Network error — please try again.");
        } finally {
            setScanning(false);
        }
    }, [activeSite?.id]);

    const handleDeepScan = useCallback(async () => {
        if (!activeSite?.id) return;
        setDeepScanning(true); setScanError(null);
        try {
            const res = await runAeoReport(activeSite.id);
            if (res.success && res.reportId) { setPendingReportId(res.reportId); setPollingStatus("polling"); }
            else setScanError((res as any).error ?? "Deep audit failed to start.");
        } catch (e: unknown) {
            setScanError((e as Error)?.message ?? "Network error — please try again.");
        } finally {
            setDeepScanning(false);
        }
    }, [activeSite?.id]);

    // Polling effect
    useEffect(() => {
        if (!pendingReportId || pollingStatus !== "polling") return;
        let attempts = 0;
        let timeoutId: ReturnType<typeof setTimeout>;
        const poll = async () => {
            attempts++;
            try {
                const status = await getAeoReportStatus(pendingReportId);
                if (status.done && status.report) {
                    setPollingStatus("done"); setScanError(null); setPendingReportId(null);
                    setActiveResult(status.report); router.refresh();
                    setTimeout(() => setPollingStatus("idle"), 3000);
                    return;
                } else if (!status.done) {
                    if (typeof status.currentStep === "number") setCurrentStep(status.currentStep);
                } else if (status.done && !status.report) {
                    setPollingStatus("timeout");
                    setScanError("Audit failed — please try again.");
                    setPendingReportId(null); router.refresh(); return;
                } else if (attempts >= 60) {
                    setPollingStatus("timeout");
                    setScanError("Still running in the background — refresh in a few minutes.");
                    setPendingReportId(null); return;
                }
            } catch { /* retry silently */ }
            timeoutId = setTimeout(poll, attempts <= 3 ? 5000 : 15000);
        };
        timeoutId = setTimeout(poll, 5000);
        return () => clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingReportId, pollingStatus]);

    const isPolling = pollingStatus === "polling";

    // Derived data from activeResult
    const rate = activeResult?.citationScore ?? activeResult?.score ?? null;
    const grade = activeResult?.grade ?? null;
    const scoreDelta = activeResult?.scoreDelta ?? activeSiteEntry?.latest?.scoreDelta ?? 0;
    const layerScores = activeResult?.layerScores ?? null;
    const checks = activeResult?.checks;
    const isDeepAudit = Array.isArray(checks);
    const recommendations: string[] = activeResult?.topRecommendations ?? (!isDeepAudit ? checks?.recommendations : []) ?? [];
    const responses: any[] = !isDeepAudit ? (checks?.responses ?? []) : [];
    const categoryScores: AeoCategoryScore[] = !isDeepAudit ? (checks?.categoryScores ?? []) : [];
    const models: any[] = activeResult?.multiModelResults?.models ?? [];

    // Insight banner text
    const insight = rate !== null
        ? rate >= 65
            ? `Your brand is well optimized for AI discovery. Focus on improving crawler access and creating more citation-worthy content to increase your actual AI visibility across ChatGPT, Gemini, Perplexity and Claude.`
            : rate >= 40
            ? `Your brand has moderate AI visibility. Improving schema markup and brand entity signals can significantly increase your citation rates across major AI platforms.`
            : `Your brand has low AI visibility. AI models are not citing you in their responses. Run a full audit to identify the specific blockers preventing citations.`
        : null;

    return (
        <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-12 fade-in-up">
            {/* Page header */}
            <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <span>←</span>
                    <span>AI Visibility</span>
                </div>
                <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-2xl font-black text-foreground">AI Visibility</h1>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">AEO</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20">GEO</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">AIO</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                    Understand how AI search engines discover, cite and recommend your brand.
                </p>
            </div>

            {/* Loading */}
            {loading && <PageSkeleton />}

            {/* Empty state */}
            {!loading && sites.length === 0 && (
                <div className="rounded-2xl border border-border bg-card p-16 text-center flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center">
                        <Bot className="w-8 h-8 text-muted-foreground/50" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold mb-2">No sites registered yet</h2>
                        <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
                            Register a site first, then run a 15-query AEO audit to see how AI models rank your content.
                        </p>
                    </div>
                    <Link
                        href="/dashboard/sites/new"
                        className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-all"
                    >
                        Register a site <ArrowUpRight className="w-4 h-4" />
                    </Link>
                </div>
            )}

            {/* Main 2-column layout */}
            {!loading && sites.length > 0 && (
                <div className="flex gap-6 items-start">
                    {/* ── Left: main content ── */}
                    <div className="flex-1 min-w-0 flex flex-col gap-4">

                        {/* Hero card */}
                        <AeoHeroCard
                            domain={activeSite?.domain ?? ""}
                            rate={rate}
                            scoreDelta={scoreDelta}
                            grade={grade}
                            layerScores={layerScores}
                            lastScanAt={activeResult?.createdAt ?? null}
                            insight={insight}
                            scanning={scanning}
                            deepScanning={deepScanning}
                            isPolling={isPolling}
                            pollingStatus={pollingStatus}
                            onScan={handleScan}
                            onDeepScan={handleDeepScan}
                        />

                        {/* PDF export (shown when report exists) */}
                        {rate !== null && activeResult?.id && (
                            <div className="flex justify-end">
                                <PdfDownloadButton
                                    endpoint="/api/pdf/aeo"
                                    params={{ reportId: activeResult.id }}
                                    label="Download PDF Report"
                                    filename={`aeo-report-${activeSite?.domain ?? "site"}.pdf`}
                                />
                            </div>
                        )}

                        {/* Scan progress */}
                        {isPolling && <ScanProgress currentStep={currentStep} />}

                        {/* Scan error */}
                        {scanError && (
                            <div className="px-4 py-3 rounded-xl bg-rose-500/8 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                {scanError}
                                <button onClick={() => setScanError(null)} className="ml-auto text-[11px] underline text-muted-foreground hover:text-foreground">Dismiss</button>
                            </div>
                        )}

                        {/* AAS Card */}
                        {activeSite && <AasCard siteId={activeSite.id} />}

                        {/* Tab nav */}
                        <MainTabNav active={mainTab} onChange={setMainTab} />

                        {/* Tab content */}
                        <TabContent
                            tab={mainTab}
                            siteId={activeSite?.id ?? ""}
                            domain={activeSite?.domain ?? ""}
                            rate={rate}
                            result={activeResult}
                            recommendations={recommendations}
                            responses={responses}
                            categoryScores={categoryScores}
                            models={models}
                            brandFacts={primaryBrandFacts}
                            competitorDomains={activeSite?.competitors?.map((c: { domain: string }) => c.domain) ?? []}
                            hasCompetitors={(activeSite?.competitors?.length ?? 0) > 0}
                            onTabChange={setMainTab}
                        />
                    </div>

                    {/* ── Right: sticky sidebar ── */}
                    <aside className="w-[280px] shrink-0 flex flex-col gap-4 sticky top-4">
                        {/* Per-LLM citation rates */}
                        <AiSearchPresence
                            models={models.map((m: any) => ({
                                name: m.modelName.replace(/^./, (c: string) => c.toUpperCase()),
                                score: m.citationRate ?? 0,
                            }))}
                            onScan={handleScan}
                            scanning={scanning || isPolling || deepScanning}
                        />

                        {/* Industry benchmark */}
                        {rate !== null && (
                            <BenchmarkSidebar yourScore={rate} siteId={activeSite?.id ?? ""} />
                        )}

                        {/* Recent activity */}
                        <RecentActivity sites={sites} />

                        {/* All registered sites */}
                        <SiteHealthPanel sites={sites} activeSiteId={activeSite?.id} />
                    </aside>
                </div>
            )}
        </div>
    );
}

// ─── Suspense shell ────────────────────────────────────────────────────────

export default function AeoRankPage() {
    return (
        <Suspense fallback={null}>
            <AeoRankPageInner />
        </Suspense>
    );
}