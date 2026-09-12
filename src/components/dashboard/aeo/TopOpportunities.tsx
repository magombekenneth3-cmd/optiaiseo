"use client";
import React, { useState, useCallback } from "react";
import { Wrench, Loader2, AlertCircle, Copy, Check, Search, ArrowRight, Lightbulb } from "lucide-react";
import { generateAeoRecommendationFix, type AeoRecommendationFix } from "@/app/actions/aeoFix";

// ── Impact badge ──────────────────────────────────────────────────────────────

function ImpactBadge({ idx }: { idx: number }) {
    const cfg =
        idx === 0
            ? { label: "Critical", cls: "bg-rose-500/10 text-rose-400 border-rose-500/25" }
            : idx === 1
            ? { label: "High", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25" }
            : { label: "Medium", cls: "bg-blue-500/10 text-blue-400 border-blue-500/25" };
    return (
        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${cfg.cls}`}>
            {cfg.label}
        </span>
    );
}

// ── Fix panel (inline) ────────────────────────────────────────────────────────

function FixPanel({
    siteId,
    recommendation,
    competitors,
    category,
}: {
    siteId: string;
    recommendation: string;
    competitors: string[];
    category?: string;
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

    if (state.status === "idle") {
        return (
            <button
                onClick={handleFix}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg
                  bg-emerald-500/10 border border-emerald-500/25 text-emerald-400
                  hover:bg-emerald-500/20 hover:border-emerald-500/50 active:scale-95 transition-all shrink-0"
            >
                <Wrench className="w-3 h-3" /> Fix automatically
            </button>
        );
    }
    if (state.status === "loading") {
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" /> Generating…
            </span>
        );
    }
    if (state.status === "error") {
        return (
            <div className="w-full flex items-start gap-2 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 mt-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{state.message}</span>
                <button onClick={() => setState({ status: "idle" })} className="underline text-muted-foreground hover:text-foreground">
                    Retry
                </button>
            </div>
        );
    }

    const r = state.result;
    return (
        <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col gap-3 mt-2">
            {r.competitorInsight && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground border-l-2 border-blue-500/40 pl-3">
                    <Search className="w-3 h-3 shrink-0 mt-0.5 text-blue-400" />
                    <span>
                        <span className="font-semibold text-blue-300">Competitor intel: </span>
                        {r.competitorInsight}
                    </span>
                </div>
            )}
            <div>
                <p className="text-sm font-bold text-emerald-400 mb-1">{r.headline}</p>
                <p className="text-xs text-foreground/80 leading-relaxed">{r.why}</p>
            </div>
            <ol className="space-y-2">
                {r.steps.map((step, si) => (
                    <li key={si} className="flex gap-2.5 items-start text-xs text-foreground/80">
                        <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black flex items-center justify-center shrink-0 mt-0.5">
                            {si + 1}
                        </span>
                        {step}
                    </li>
                ))}
            </ol>
            {r.copySnippet && (
                <div className="relative">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Ready-to-paste snippet
                    </p>
                    <pre className="text-xs text-zinc-300 bg-zinc-950/80 border border-zinc-700/60 rounded-xl p-3 pr-10 overflow-x-auto font-mono whitespace-pre-wrap">
                        {r.copySnippet}
                    </pre>
                    <button
                        onClick={() => handleCopy(r.copySnippet!)}
                        className="absolute top-7 right-2 p-1.5 rounded-lg bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors"
                    >
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                </div>
            )}
            <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground/60">
                    Creates PR · Review needed
                </span>
                <button
                    onClick={() => setState({ status: "idle" })}
                    className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TopOpportunitiesProps {
    recommendations: string[];
    responses: any[];
    domain: string;
    siteId: string;
    onViewAll?: () => void;
}

const CAT_KEYS = ["brand_authority", "industry", "services", "geography", "legitimacy"] as const;

function extractCompetitors(responses: any[], domain: string): string[] {
    const domains = responses
        .filter((r: any) => !r.cited && r.excerpt)
        .flatMap((r: any) =>
            ((r.excerpt as string).match(/\b([a-z0-9-]+\.(?:com|org|net|io|co|ai|app|dev))\b/gi) ?? [])
        )
        .filter((d: string) => !d.toLowerCase().includes(domain.toLowerCase()));
    return [...new Set(domains)].slice(0, 3);
}

const FALLBACK_OPPS = [
    { text: "Allow AI crawlers access", sub: "GPTBot · PerplexityBot may be blocked by robots.txt", tag: "GPTBot Blocked" },
    { text: "Add HowTo structured data", sub: "Increase eligibility for AI answer citations.", tag: null },
    { text: "Strengthen brand entity signals", sub: "Improve entity associations and brand mentions.", tag: null },
];

export function TopOpportunities({
    recommendations,
    responses,
    domain,
    siteId,
    onViewAll,
}: TopOpportunitiesProps) {
    const competitors = extractCompetitors(responses, domain);
    const hasData = recommendations.length > 0;
    const display = hasData ? recommendations.slice(0, 5) : FALLBACK_OPPS.map((o) => o.text);

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
                        <Lightbulb className="w-3.5 h-3.5 text-emerald-400" />
                    </span>
                    <div>
                        <p className="text-sm font-bold text-foreground">Top Opportunities</p>
                        <p className="text-[11px] text-muted-foreground">
                            Focus on these high-impact fixes to improve your AI visibility.
                        </p>
                    </div>
                </div>
                {onViewAll && (
                    <button
                        onClick={onViewAll}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        View all <ArrowRight className="w-3 h-3" />
                    </button>
                )}
            </div>

            {/* Opportunity list */}
            <div className="flex flex-col gap-3">
                {display.map((rec, i) => {
                    const fallback = !hasData ? FALLBACK_OPPS[i] : null;
                    return (
                        <div
                            key={i}
                            className="rounded-xl border border-border/60 bg-muted/10 p-4 flex flex-col gap-2 hover:bg-muted/20 transition-colors"
                        >
                            <div className="flex items-start gap-3">
                                {/* Number badge */}
                                <span className="w-6 h-6 rounded-full bg-muted border border-border text-[11px] font-black text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                                    {i + 1}
                                </span>

                                {/* Text */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground font-medium leading-snug">{rec}</p>
                                    {fallback?.sub && (
                                        <p className="text-xs text-muted-foreground mt-0.5">{fallback.sub}</p>
                                    )}
                                    {/* Tags */}
                                    {fallback?.tag && (
                                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                            {fallback.tag.split(" · ").map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Impact badge */}
                                <ImpactBadge idx={i} />
                            </div>

                            {/* Fix panel */}
                            {hasData && siteId && (
                                <div className="pl-9">
                                    <FixPanel
                                        siteId={siteId}
                                        recommendation={rec}
                                        competitors={competitors}
                                        category={CAT_KEYS[i] ?? "brand_authority"}
                                    />
                                </div>
                            )}

                            {/* Placeholder CTA */}
                            {!hasData && (
                                <div className="pl-9">
                                    <button className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-muted/60 border border-border text-muted-foreground cursor-not-allowed opacity-60">
                                        <Wrench className="w-3 h-3" />
                                        {i < 2 ? "Fix automatically" : "Improve entity"}
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
