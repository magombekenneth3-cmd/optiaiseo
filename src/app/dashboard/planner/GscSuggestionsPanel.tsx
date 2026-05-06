"use client";

/**
 * GscSuggestionsPanel
 * ───────────────────
 * Surfaces the top GSC keyword opportunities (positions 11-50) directly
 * inside the Content Planner, allowing one-click "Add to Planner" for each.
 *
 * Logic:
 *  • Calls getGscSuggestionsForPlanner on mount
 *  • Shows position, impressions, opportunity score per keyword
 *  • Tracks "already added" state so the user doesn't see stale buttons
 *  • Lets the user bulk-select and add in one shot
 */

import { useEffect, useState, useTransition } from "react";
import {
    getGscSuggestionsForPlanner,
    addGscKeywordsToPlanner,
    type GscPlannerSuggestion,
} from "@/app/actions/planner";
import { TrendingUp, Plus, Check, Loader2, RefreshCw, AlertCircle } from "lucide-react";

interface Props {
    siteId: string;
    onAdded?: () => void;
}

function intentColor(intent: string | null) {
    if (!intent) return { bg: "rgba(255,255,255,.04)", text: "rgba(255,255,255,.3)", border: "rgba(255,255,255,.08)" };
    const map: Record<string, { bg: string; text: string; border: string }> = {
        informational: { bg: "rgba(59,130,246,.08)", text: "#60a5fa", border: "rgba(59,130,246,.2)" },
        commercial:    { bg: "rgba(251,191,36,.08)", text: "#fbbf24", border: "rgba(251,191,36,.2)" },
        transactional: { bg: "rgba(16,185,129,.08)", text: "#34d399", border: "rgba(16,185,129,.2)" },
        navigational:  { bg: "rgba(167,139,250,.08)", text: "#a78bfa", border: "rgba(167,139,250,.2)" },
    };
    return map[intent.toLowerCase()] ?? { bg: "rgba(255,255,255,.04)", text: "rgba(255,255,255,.3)", border: "rgba(255,255,255,.08)" };
}

export function GscSuggestionsPanel({ siteId, onAdded }: Props) {
    const [suggestions, setSuggestions] = useState<GscPlannerSuggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [addedSet, setAddedSet] = useState<Set<string>>(new Set());
    const [isPending, startTransition] = useTransition();

    async function load() {
        setLoading(true);
        setError(null);
        const res = await getGscSuggestionsForPlanner(siteId);
        if (res.success) {
            setSuggestions(res.suggestions ?? []);
            setAddedSet(new Set((res.suggestions ?? []).filter(s => s.alreadyAdded).map(s => s.keyword)));
        } else {
            setError(res.error ?? "Failed to load suggestions");
        }
        setLoading(false);
    }

    useEffect(() => { load(); }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleSelect = (kw: string) =>
        setSelected(prev => { const n = new Set(prev); if (n.has(kw)) { n.delete(kw); } else { n.add(kw); } return n; });

    const handleAdd = (items: GscPlannerSuggestion[]) => {
        startTransition(async () => {
            const res = await addGscKeywordsToPlanner(
                siteId,
                items.map(s => ({ keyword: s.keyword, intent: s.intent, avgPosition: s.avgPosition, impressions: s.impressions }))
            );
            if (res.success) {
                const newAdded = new Set(addedSet);
                items.forEach(s => newAdded.add(s.keyword));
                setAddedSet(newAdded);
                setSelected(new Set());
                setSuggestions(prev => prev.map(s => newAdded.has(s.keyword) ? { ...s, alreadyAdded: true } : s));
                onAdded?.();
            }
        });
    };

    const pending = suggestions.filter(s => selected.has(s.keyword) && !addedSet.has(s.keyword));

    return (
        <div style={{
            background: "rgba(255,255,255,.015)",
            border: "1px solid rgba(255,255,255,.07)",
            borderRadius: 16,
            overflow: "hidden",
        }}>
            {/* Header */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 18px",
                borderBottom: "1px solid rgba(255,255,255,.06)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <TrendingUp size={13} style={{ color: "#34d399" }} />
                    </div>
                    <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,.85)" }}>
                            GSC Opportunities
                        </p>
                        <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,.3)" }}>
                            Keywords ranking 11–50 with growth potential
                        </p>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {pending.length > 0 && (
                        <button
                            onClick={() => handleAdd(pending)}
                            disabled={isPending}
                            style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                padding: "6px 14px", borderRadius: 9,
                                background: "linear-gradient(135deg, #10b981, #059669)",
                                border: "none", color: "#fff",
                                fontSize: 11, fontWeight: 700, cursor: "pointer",
                                opacity: isPending ? 0.6 : 1,
                            }}
                        >
                            {isPending ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={11} />}
                            Add {pending.length}
                        </button>
                    )}
                    <button
                        onClick={load}
                        disabled={loading}
                        title="Refresh"
                        style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: 28, height: 28, borderRadius: 8, border: "none",
                            background: "rgba(255,255,255,.05)",
                            color: "rgba(255,255,255,.3)", cursor: "pointer",
                        }}
                    >
                        <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {loading && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "28px 0", color: "rgba(255,255,255,.25)", fontSize: 12 }}>
                        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                        Fetching keyword opportunities…
                    </div>
                )}

                {!loading && error && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 18px", color: "#f87171", fontSize: 12 }}>
                        <AlertCircle size={14} />
                        {error}
                    </div>
                )}

                {!loading && !error && suggestions.length === 0 && (
                    <div style={{ padding: "28px 18px", textAlign: "center", color: "rgba(255,255,255,.2)", fontSize: 12 }}>
                        No keyword opportunities found. Connect Google Search Console or wait for data.
                    </div>
                )}

                {!loading && !error && suggestions.map(s => {
                    const isAdded = addedSet.has(s.keyword);
                    const isSel = selected.has(s.keyword);
                    const ic = intentColor(s.intent);
                    return (
                        <div
                            key={s.keyword}
                            onClick={() => !isAdded && toggleSelect(s.keyword)}
                            style={{
                                display: "flex", alignItems: "center", gap: 12,
                                padding: "10px 18px",
                                borderBottom: "1px solid rgba(255,255,255,.04)",
                                background: isSel ? "rgba(16,185,129,.04)" : "transparent",
                                cursor: isAdded ? "default" : "pointer",
                                transition: "background .15s",
                            }}
                        >
                            {/* Select indicator */}
                            <div style={{
                                width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                                background: isAdded ? "rgba(16,185,129,.2)" : isSel ? "#10b981" : "rgba(255,255,255,.06)",
                                border: isAdded ? "1px solid rgba(16,185,129,.3)" : isSel ? "none" : "1px solid rgba(255,255,255,.12)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                                {(isAdded || isSel) && <Check size={9} style={{ color: isAdded ? "#34d399" : "#fff" }} />}
                            </div>

                            {/* Keyword */}
                            <p style={{ flex: 1, margin: 0, fontSize: 12, fontWeight: 600, color: isAdded ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.85)", lineHeight: 1.3 }}>
                                {s.keyword}
                            </p>

                            {/* Metrics */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                {s.intent && (
                                    <span style={{
                                        fontSize: 9, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase",
                                        padding: "2px 6px", borderRadius: 5,
                                        background: ic.bg, color: ic.text, border: `1px solid ${ic.border}`,
                                    }}>
                                        {s.intent}
                                    </span>
                                )}
                                <span style={{ fontSize: 10, color: "rgba(255,255,255,.3)", minWidth: 36, textAlign: "right" }}>
                                    #{s.avgPosition.toFixed(1)}
                                </span>
                                <span style={{ fontSize: 10, color: "rgba(255,255,255,.2)", minWidth: 40, textAlign: "right" }}>
                                    {s.impressions.toLocaleString()}
                                </span>
                                <span style={{
                                    fontSize: 10, fontWeight: 700, minWidth: 30, textAlign: "right",
                                    color: s.score >= 150 ? "#f87171" : s.score >= 80 ? "#fbbf24" : "#60a5fa",
                                }}>
                                    {s.score}
                                </span>

                                {/* Add button */}
                                {isAdded ? (
                                    <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600, minWidth: 56, textAlign: "right" }}>
                                        ✓ Added
                                    </span>
                                ) : (
                                    <button
                                        onClick={e => { e.stopPropagation(); handleAdd([s]); }}
                                        disabled={isPending}
                                        style={{
                                            display: "inline-flex", alignItems: "center", gap: 4,
                                            padding: "3px 8px", borderRadius: 6,
                                            background: "rgba(16,185,129,.08)", border: "1px solid rgba(16,185,129,.2)",
                                            color: "#34d399", fontSize: 10, fontWeight: 600,
                                            cursor: "pointer", whiteSpace: "nowrap",
                                        }}
                                    >
                                        <Plus size={9} />
                                        Add
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Column headers */}
            {suggestions.length > 0 && !loading && (
                <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "8px 18px 8px 44px",
                    borderTop: "1px solid rgba(255,255,255,.05)",
                    background: "rgba(255,255,255,.015)",
                }}>
                    <span style={{ flex: 1, fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.2)" }}>Keyword</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.2)", minWidth: 36, textAlign: "right" }}>Pos</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.2)", minWidth: 40, textAlign: "right" }}>Impr</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.2)", minWidth: 30, textAlign: "right" }}>Score</span>
                    <span style={{ minWidth: 56 }} />
                </div>
            )}
        </div>
    );
}
