"use client";

import { useEffect, useState } from "react";
import {
    X, Loader2, AlertTriangle, CheckCircle2, Zap, Target,
    ChevronDown, ChevronUp, Clock, BarChart2, Calendar,
    ArrowUpRight, Bot, User, BookOpen, Link2, ChevronRight,
    Info, FileText, TrendingUp,
} from "lucide-react";
import type { ContentSection, AuthorityStep } from "@/lib/serp-gap/plan-generator";

interface PlanTask {
    id: string;
    week: 1 | 2 | 3 | 4;
    priority: "critical" | "high" | "medium" | "low";
    category: string;
    title: string;
    description: string;
    manualSteps: string[];
    ariaCanAutomate: boolean;
    ariaAction?: string;
    estimatedTimeMinutes: number;
    expectedOutcome: string;
    sourceGap: string;
}

interface ImplementationPlan {
    executiveSummary: string;
    topPriority: string;
    formatInsight: string;
    estimatedPositionGain: string;
    estimatedTimeToResult: string;
    rankingTimelineNote: string | null;
    week1Focus: string;
    week2Focus: string;
    week3Focus: string;
    week4Focus: string;
    tasks: PlanTask[];
    contentBlueprint: ContentSection[];
    authorityRoadmap: AuthorityStep[];
}

interface ContentGap {
    dimension: string;
    clientValue: string | number | boolean;
    topCompetitorAvg: string | number;
    gap: "critical" | "high" | "medium" | "low";
    impact: string;
    recommendation: string;
}

interface FullAnalysis {
    id: string;
    keyword: string;
    clientUrl: string;
    clientPosition: number;
    status: string;
    gapReport: {
        gaps: ContentGap[];
        serpFormat: string;
        serpHasAiOverview: boolean;
        serpHasFeaturedSnippet: boolean;
        topCompetitorAvgWordCount: number;
        clientSignals: { wordCount: number };
        rankingTimelineNote: string | null;
    } | null;
    implementationPlan: ImplementationPlan | null;
    estimatedPositionGain: string | null;
    executiveSummary: string | null;
    topPriority: string | null;
    gapCount: number | null;
    criticalGapCount: number | null;
}


const SEV: Record<string, string> = {
    critical: "border-l-red-500 bg-red-500/5",
    high:     "border-l-amber-500 bg-amber-500/5",
    medium:   "border-l-blue-500 bg-blue-500/5",
    low:      "border-l-zinc-500 bg-zinc-500/5",
};
const SEV_BADGE: Record<string, string> = {
    critical: "bg-red-500/10 text-red-400 border-red-500/20",
    high:     "bg-amber-500/10 text-amber-400 border-amber-500/20",
    medium:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
    low:      "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};


function WeekCard({ week, focus, tasks }: { week: number; focus: string; tasks: PlanTask[] }) {
    const [open, setOpen] = useState(week === 1);
    return (
        <div className="rounded-xl border border-border overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-accent/40 transition-colors text-left"
            >
                <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold flex items-center justify-center shrink-0">
                        W{week}
                    </span>
                    <div>
                        <p className="text-sm font-semibold">Week {week}</p>
                        <p className="text-xs text-muted-foreground">{focus}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">{tasks.length} tasks</span>
                    {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
            </button>
            {open && (
                <div className="px-5 pb-5 flex flex-col gap-3">
                    {tasks.map(task => (
                        <div key={task.id} className={`border-l-4 rounded-r-xl px-4 py-3 ${SEV[task.priority] ?? SEV.low}`}>
                            <div className="flex items-start justify-between gap-3 mb-1.5">
                                <p className="text-sm font-semibold leading-snug">{task.title}</p>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${SEV_BADGE[task.priority]}`}>
                                        {task.priority}
                                    </span>
                                    {task.ariaCanAutomate && (
                                        <span className="px-1.5 py-0.5 rounded text-xs font-medium border bg-purple-500/10 text-purple-400 border-purple-500/20 flex items-center gap-1">
                                            <Bot className="w-3 h-3" /> Auto
                                        </span>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{task.description}</p>
                            {task.manualSteps.length > 0 && (
                                <ol className="list-decimal list-inside space-y-0.5">
                                    {task.manualSteps.map((step, i) => (
                                        <li key={i} className="text-xs text-muted-foreground leading-relaxed">{step}</li>
                                    ))}
                                </ol>
                            )}
                            <div className="flex items-center gap-3 mt-2.5 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {task.estimatedTimeMinutes}m</span>
                                <span className="flex items-center gap-1 text-emerald-400"><ArrowUpRight className="w-3 h-3" /> {task.expectedOutcome}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}


function BlueprintCard({ section, idx }: { section: ContentSection; idx: number }) {
    const [open, setOpen] = useState(idx === 0);
    return (
        <div className="rounded-xl border border-border overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-accent/40 transition-colors text-left"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                    </span>
                    <p className="text-sm font-semibold truncate">{section.section}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">{section.targetWordCount}w target</span>
                    {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
            </button>
            {open && (
                <div className="px-5 pb-5 flex flex-col gap-3">
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs">
                        <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                        <p className="text-muted-foreground leading-relaxed">{section.rationale}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-card border border-border">
                        <p className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-purple-400" /> What to write
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{section.guidanceNotes}</p>
                    </div>
                    {section.competitorExamples.length > 0 && (
                        <div>
                            <p className="text-xs text-muted-foreground mb-1.5 font-medium">Competitor references:</p>
                            <div className="flex flex-col gap-1">
                                {section.competitorExamples.map((url, i) => (
                                    <a
                                        key={i}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors truncate"
                                    >
                                        <Link2 className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{url}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}


function AuthorityRoadmapView({ steps }: { steps: AuthorityStep[] }) {
    return (
        <div className="flex flex-col gap-3">
            {steps.map((step) => (
                <div key={step.step} className="flex gap-4 p-4 rounded-xl border border-border bg-card/50">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                        <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center">
                            {step.step}
                        </div>
                        {step.step < steps.length && (
                            <div className="w-px flex-1 bg-border min-h-[16px]" />
                        )}
                    </div>
                    <div className="min-w-0 pb-1">
                        <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-semibold">{step.action}</p>
                            <span className="px-1.5 py-0.5 rounded text-xs bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 shrink-0">
                                {step.estimatedWeeks}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{step.detail}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}


export function SerpGapDetail({
    analysisId,
    siteId,
    onClose,
}: {
    analysisId: string;
    siteId: string;
    onClose: () => void;
}) {
    const [data, setData] = useState<FullAnalysis | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<"plan" | "blueprint" | "gaps">("plan");

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/sites/${siteId}/serp-gap/${analysisId}`);
                if (!res.ok) throw new Error("Failed to load analysis");
                setData(await res.json());
            } catch (e) {
                setError(e instanceof Error ? e.message : "Error loading analysis");
            } finally { setLoading(false); }
        })();
    }, [analysisId, siteId]);

    const plan = data?.implementationPlan as ImplementationPlan | null;
    const gaps = (data?.gapReport)?.gaps ?? [];
    const timelineNote = plan?.rankingTimelineNote ?? data?.gapReport?.rankingTimelineNote ?? null;

    const tasksByWeek = (week: 1 | 2 | 3 | 4) => plan?.tasks.filter(t => t.week === week) ?? [];
    const weekFocus = [plan?.week1Focus, plan?.week2Focus, plan?.week3Focus, plan?.week4Focus];

    const hasBlueprint = (plan?.contentBlueprint?.length ?? 0) > 0;
    const hasAuthority = (plan?.authorityRoadmap?.length ?? 0) > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="relative h-full w-full max-w-2xl bg-background border-l border-border overflow-y-auto flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs text-muted-foreground mb-0.5">SERP Gap Analysis</p>
                        <h2 className="font-bold text-base leading-snug truncate">{data?.keyword ?? "Loading…"}</h2>
                        {data && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Position #{data.clientPosition} · {data.gapCount ?? 0} gaps found
                            </p>
                        )}
                    </div>
                    <button id="serp-gap-close" onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-accent transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {loading && (
                    <div className="flex-1 flex items-center justify-center gap-3 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin" /> Loading analysis…
                    </div>
                )}

                {error && (
                    <div className="p-6">
                        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/5 border border-red-500/20 text-red-400">
                            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                        </div>
                    </div>
                )}

                {data && !loading && (
                    <div className="flex flex-col gap-6 p-6">

                        {/* Ranking timeline warning */}
                        {timelineNote && (
                            <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
                                <TrendingUp className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-xs font-semibold text-amber-400 mb-1">Ranking Timeline Note</p>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{timelineNote}</p>
                                </div>
                            </div>
                        )}

                        {/* Summary strip */}
                        {plan && (
                            <div className="rounded-xl border border-border bg-card/50 p-5 flex flex-col gap-3">
                                <p className="text-sm leading-relaxed text-muted-foreground">{plan.executiveSummary}</p>
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                                        <Target className="w-4 h-4 text-emerald-400 shrink-0" />
                                        <div>
                                            <p className="text-muted-foreground">Estimated gain</p>
                                            <p className="font-semibold text-emerald-400">{plan.estimatedPositionGain}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                                        <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
                                        <div>
                                            <p className="text-muted-foreground">Timeline</p>
                                            <p className="font-semibold text-blue-400">{plan.estimatedTimeToResult}</p>
                                        </div>
                                    </div>
                                </div>
                                {plan.topPriority && (
                                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
                                        <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-amber-400 font-semibold mb-0.5">Top Priority</p>
                                            <p className="text-muted-foreground">{plan.topPriority}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SERP signals */}
                        {data.gapReport && (
                            <div className="flex items-center gap-3 flex-wrap text-xs">
                                <span className="text-muted-foreground">SERP signals:</span>
                                <span className="px-2 py-0.5 rounded border border-border bg-card capitalize">{data.gapReport.serpFormat} format</span>
                                {data.gapReport.serpHasAiOverview && <span className="px-2 py-0.5 rounded border border-purple-500/20 bg-purple-500/10 text-purple-400">AI Overview</span>}
                                {data.gapReport.serpHasFeaturedSnippet && <span className="px-2 py-0.5 rounded border border-blue-500/20 bg-blue-500/10 text-blue-400">Featured Snippet</span>}
                                <span className="px-2 py-0.5 rounded border border-border bg-card text-muted-foreground">
                                    Competitor avg: {data.gapReport.topCompetitorAvgWordCount} words · Your page: {data.gapReport.clientSignals.wordCount} words
                                </span>
                            </div>
                        )}

                        {/* Tabs */}
                        <div className="flex gap-1 p-1 rounded-lg bg-card border border-border w-fit flex-wrap">
                            {([
                                { id: "plan", label: `4-Week Plan (${plan?.tasks.length ?? 0})`, icon: <Calendar className="w-3.5 h-3.5" /> },
                                { id: "blueprint", label: `Content Blueprint (${plan?.contentBlueprint?.length ?? 0})`, icon: <BookOpen className="w-3.5 h-3.5" /> },
                                { id: "gaps", label: `Gaps (${gaps.length})`, icon: <BarChart2 className="w-3.5 h-3.5" /> },
                            ] as { id: "plan" | "blueprint" | "gaps"; label: string; icon: React.ReactNode }[]).map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setTab(t.id)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === t.id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                >
                                    {t.icon}{t.label}
                                </button>
                            ))}
                        </div>

                        {/* Plan view */}
                        {tab === "plan" && plan && (
                            <div className="flex flex-col gap-4">
                                {([1, 2, 3, 4] as const).map(w => (
                                    <WeekCard
                                        key={w}
                                        week={w}
                                        focus={weekFocus[w - 1] ?? ""}
                                        tasks={tasksByWeek(w)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Content Blueprint view */}
                        {tab === "blueprint" && (
                            <div className="flex flex-col gap-4">
                                {hasBlueprint ? (
                                    <>
                                        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs">
                                            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                                            <p className="text-muted-foreground leading-relaxed">
                                                These are the exact sections your competitors cover that your page is missing.
                                                Add each as an H2 section. Write to the target word count for each topic.
                                            </p>
                                        </div>
                                        <div className="flex flex-col gap-3">
                                            {plan!.contentBlueprint.map((section, i) => (
                                                <BlueprintCard key={i} section={section} idx={i} />
                                            ))}
                                        </div>

                                        {hasAuthority && (
                                            <>
                                                <div className="flex items-center gap-2 pt-2">
                                                    <Link2 className="w-4 h-4 text-emerald-400" />
                                                    <h3 className="text-sm font-semibold">Authority Building Roadmap</h3>
                                                </div>
                                                <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs">
                                                    <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                                    <p className="text-muted-foreground leading-relaxed">
                                                        Content alone won&apos;t close a large referring domain gap.
                                                        Run these link-building steps in parallel with your content work.
                                                    </p>
                                                </div>
                                                <AuthorityRoadmapView steps={plan!.authorityRoadmap} />
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <div className="p-8 text-center text-muted-foreground text-sm">
                                        No content blueprint available. Run the analysis to generate one.
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Gaps view */}
                        {tab === "gaps" && (
                            <div className="flex flex-col gap-3">
                                {gaps.length === 0 && (
                                    <div className="p-8 text-center text-muted-foreground text-sm">No gaps data available.</div>
                                )}
                                {gaps.map((gap, i) => (
                                    <div key={i} className={`border-l-4 rounded-r-xl px-4 py-4 ${SEV[gap.gap] ?? SEV.low}`}>
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <p className="text-sm font-semibold">{gap.dimension}</p>
                                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium border shrink-0 ${SEV_BADGE[gap.gap]}`}>
                                                {gap.gap}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                                            <div className="p-2 rounded bg-background/60 border border-border">
                                                <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><User className="w-3 h-3" /> Your page</p>
                                                <p className="font-medium">{String(gap.clientValue)}</p>
                                            </div>
                                            <div className="p-2 rounded bg-background/60 border border-border">
                                                <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><BarChart2 className="w-3 h-3" /> Top competitors</p>
                                                <p className="font-medium">{String(gap.topCompetitorAvg)}</p>
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground leading-relaxed mb-2 whitespace-pre-line">{gap.impact}</p>
                                        <div className="p-3 rounded-lg bg-card/60 border border-border">
                                            <div className="flex items-start gap-1.5">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                                <p className="text-xs text-emerald-400 leading-relaxed whitespace-pre-line font-medium">How to fix</p>
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line mt-1 pl-5">{gap.recommendation}</p>
                                        </div>
                                        {gap.dimension.toLowerCase().includes("authority") || gap.dimension.toLowerCase().includes("link") ? (
                                            <button
                                                onClick={() => setTab("blueprint")}
                                                className="mt-2 flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                                            >
                                                <ChevronRight className="w-3 h-3" /> Go to Authority Roadmap →
                                            </button>
                                        ) : gap.dimension.toLowerCase().includes("heading") || gap.dimension.toLowerCase().includes("h2") ? (
                                            <button
                                                onClick={() => setTab("blueprint")}
                                                className="mt-2 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                            >
                                                <ChevronRight className="w-3 h-3" /> Go to Content Blueprint →
                                            </button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
