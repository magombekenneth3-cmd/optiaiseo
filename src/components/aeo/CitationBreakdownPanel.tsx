"use client";

/**
 * CitationBreakdownPanel
 * ─────────────────────
 * Shows a per-category, per-AI-engine citation comparison:
 *   • Your brand: cited / not cited per engine per category
 *   • Top competitor domains extracted from response excerpts
 *   • A "win rate" summary row per engine
 *
 * Props:
 *   responses  — the full responses[] array from the AEO check result
 *   domain     — the user's own site domain (to distinguish self vs competitor)
 *   multiModel — optional multiModelResults.models[] for per-engine citation rates
 */

import React, { useMemo } from "react";
import { BarChart2, CheckCircle2, XCircle, Minus } from "lucide-react";

interface ResponseRow {
    query?: string;
    category?: string;
    cited: boolean;
    excerpt?: string;
    modelName?: string;
}

interface ModelResult {
    modelName: string;
    citationRate: number;
    citationCount: number;
    queriesRun: number;
}

interface Props {
    responses: ResponseRow[];
    domain: string;
    multiModel?: ModelResult[];
}

const CATEGORY_LABELS: Record<string, string> = {
    brand_authority:      "Brand Authority",
    topic_coverage:       "Topic Coverage",
    faq_readiness:        "FAQ Readiness",
    competitor_comparison:"Competitor Comparison",
    how_to_guidance:      "How-To Guidance",
    geo_recommendation:   "GEO Recommendation",
    aio_brand:            "AIO Brand",
};

const ENGINE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    chatgpt:   { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    gemini:    { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20" },
    perplexity:{ bg: "bg-purple-500/10",  text: "text-purple-400",  border: "border-purple-500/20" },
    claude:    { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/20" },
    default:   { bg: "bg-zinc-500/10",    text: "text-zinc-400",    border: "border-zinc-500/20" },
};

function engineColor(name: string) {
    return ENGINE_COLORS[name.toLowerCase()] ?? ENGINE_COLORS.default;
}

/** Extract competitor domains mentioned in an excerpt */
function extractCompetitorDomains(excerpt: string, ownDomain: string): string[] {
    const matches = excerpt.match(/\b([a-z0-9-]+\.(?:com|org|net|io|co|ai|app|dev|info))\b/gi) ?? [];
    return [...new Set(matches.filter(d => !d.includes(ownDomain) && d.length > 4))].slice(0, 3);
}

export function CitationBreakdownPanel({ responses, domain, multiModel }: Props) {
    // Group responses by category
    const byCategory = useMemo(() => {
        const map: Record<string, ResponseRow[]> = {};
        for (const r of responses) {
            const cat = r.category ?? "other";
            (map[cat] ??= []).push(r);
        }
        return map;
    }, [responses]);

    const categories = Object.keys(byCategory);

    // Gather competitor domains from non-cited responses
    const competitorMap = useMemo(() => {
        const map: Record<string, string[]> = {};
        for (const [cat, rows] of Object.entries(byCategory)) {
            const domains: string[] = [];
            for (const r of rows) {
                if (!r.cited && r.excerpt) {
                    domains.push(...extractCompetitorDomains(r.excerpt, domain));
                }
            }
            map[cat] = [...new Set(domains)].slice(0, 3);
        }
        return map;
    }, [byCategory, domain]);

    if (responses.length === 0) return null;

    const totalCited = responses.filter(r => r.cited).length;
    const citationRate = Math.round((totalCited / responses.length) * 100);

    return (
        <div className="mt-2 flex flex-col gap-6">
            {/* ── Header ── */}
            <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-400" />
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Citation Breakdown
                </p>
                <span className={`ml-auto text-xs font-black tabular-nums ${
                    citationRate >= 65 ? "text-emerald-400" : citationRate >= 40 ? "text-amber-400" : "text-rose-400"
                }`}>
                    {citationRate}% overall
                </span>
            </div>

            {/* ── Per-engine summary row ── */}
            {multiModel && multiModel.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {multiModel.map(m => {
                        const c = engineColor(m.modelName);
                        return (
                            <div
                                key={m.modelName}
                                className={`flex flex-col gap-1.5 p-3 rounded-xl border ${c.bg} ${c.border}`}
                            >
                                <p className={`text-[11px] font-bold capitalize ${c.text}`}>{m.modelName}</p>
                                <div className="h-1.5 rounded-full bg-black/20 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-700 ${
                                            m.citationRate >= 65 ? "bg-emerald-500" : m.citationRate >= 40 ? "bg-amber-500" : "bg-rose-500"
                                        }`}
                                        style={{ width: `${m.citationRate}%` }}
                                    />
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                    {m.citationCount}/{m.queriesRun} cited · <span className="font-bold">{m.citationRate}%</span>
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Per-category breakdown ── */}
            <div className="flex flex-col gap-3">
                {categories.map(cat => {
                    const rows = byCategory[cat];
                    const cited = rows.filter(r => r.cited).length;
                    const total = rows.length;
                    const pct = Math.round((cited / total) * 100);
                    const catLabel = CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ");
                    const competitors = competitorMap[cat] ?? [];

                    return (
                        <div
                            key={cat}
                            className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden"
                        >
                            {/* Category header */}
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{catLabel}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className={`text-[11px] font-black tabular-nums ${
                                        pct >= 65 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-rose-400"
                                    }`}>{pct}%</span>
                                    <span className="text-[10px] text-muted-foreground">{cited}/{total} cited</span>
                                </div>
                            </div>

                            {/* Individual queries */}
                            <div className="divide-y divide-border/30">
                                {rows.map((r, i) => {
                                    const queryLabel = r.query && !r.query.startsWith("AEO batch") ? r.query : null;
                                    return (
                                        <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-xs">
                                            {r.cited ? (
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                            ) : (
                                                <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                {queryLabel && (
                                                    <p className="text-muted-foreground font-medium truncate" title={queryLabel}>
                                                        &ldquo;{queryLabel}&rdquo;
                                                    </p>
                                                )}
                                                {!r.cited && r.excerpt && (
                                                    <p className="text-muted-foreground/60 text-[10px] mt-0.5 leading-relaxed line-clamp-2">
                                                        {r.excerpt}
                                                    </p>
                                                )}
                                            </div>
                                            {r.modelName && (
                                                <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border capitalize ${engineColor(r.modelName).bg} ${engineColor(r.modelName).text} ${engineColor(r.modelName).border}`}>
                                                    {r.modelName}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Competitor intelligence */}
                            {competitors.length > 0 && (
                                <div className="px-4 py-2.5 bg-rose-500/5 border-t border-rose-500/10 flex items-center gap-2 flex-wrap">
                                    <Minus className="w-3 h-3 text-rose-400 shrink-0" />
                                    <span className="text-[10px] text-rose-400 font-semibold">Competitors cited instead:</span>
                                    {competitors.map(d => (
                                        <span key={d} className="text-[10px] font-mono text-rose-300 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded">
                                            {d}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
