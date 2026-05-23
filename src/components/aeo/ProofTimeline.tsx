"use client";

import React, { useState, useEffect } from "react";
import { Loader2, AlertCircle, ChevronDown, ChevronUp, Check, X } from "lucide-react";

interface Proof {
    id: string;
    query: string;
    responseText: string;
    cited: boolean;
    createdAt: string;
}

interface GroupedQuery {
    query: string;
    history: Array<{
        date: string;
        cited: boolean;
        pos: number | null;
    }>;
}

interface Props {
    siteId: string;
    domain?: string;
}

export function ProofTimeline({ siteId, domain }: Props) {
    const [proofs, setProofs] = useState<Proof[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        if (!siteId) return;
        setLoading(true);
        setError(null);
        fetch(`/api/aeo/proof/timeline?siteId=${siteId}`)
            .then(res => {
                if (!res.ok) throw new Error("Failed to fetch citation history.");
                return res.json();
            })
            .then(data => {
                if (data.success && Array.isArray(data.proofs)) {
                    setProofs(data.proofs);
                } else {
                    throw new Error("Invalid response format.");
                }
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [siteId]);

    if (loading) {
        return (
            <div className="card-surface p-6 flex flex-col justify-center items-center h-[200px] border border-[#30363d] bg-[#0d1117] rounded-2xl">
                <Loader2 className="w-6 h-6 animate-spin text-brand mb-2" />
                <span className="text-xs text-muted-foreground">Loading citation history...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="card-surface p-6 flex flex-col justify-center items-center h-[200px] border border-red-500/20 bg-[#0d1117] rounded-2xl">
                <AlertCircle className="w-8 h-8 text-red-500/60 mb-2" />
                <p className="text-xs font-semibold text-red-400">Error Loading Citation History</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">{error}</p>
            </div>
        );
    }

    if (proofs.length === 0) {
        return (
            <div className="card-surface p-6 flex flex-col justify-center items-center h-[200px] border border-[#30363d] bg-[#0d1117] rounded-2xl">
                <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs font-semibold text-muted-foreground">No Citation History Yet</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1 max-w-[240px] text-center">
                    Citations will be tracked here once you run queries in the Prompt Simulator.
                </p>
            </div>
        );
    }

    const getPosition = (responseText: string, searchDomain?: string) => {
        if (!responseText || !searchDomain) return null;
        const cleanDomain = searchDomain.toLowerCase();
        const cleanBrand = searchDomain.split(".")[0].toLowerCase();
        const paragraphs = responseText.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
        for (let i = 0; i < paragraphs.length; i++) {
            const pLower = paragraphs[i].toLowerCase();
            if (pLower.includes(cleanDomain) || pLower.includes(cleanBrand)) {
                return i + 1;
            }
        }
        return null;
    };

    const grouped: { [key: string]: GroupedQuery } = {};
    for (const p of proofs) {
        if (!grouped[p.query]) {
            grouped[p.query] = {
                query: p.query,
                history: [],
            };
        }
        const parsedDate = new Date(p.createdAt);
        const formattedDate = parsedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        grouped[p.query].history.push({
            date: formattedDate,
            cited: p.cited,
            pos: p.cited ? getPosition(p.responseText, domain) : null,
        });
    }

    const queryList = Object.values(grouped);

    return (
        <div className="card-surface p-6 border border-[#30363d] bg-[#0d1117] rounded-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <span className="text-brand">◑</span> Citation History by Query
                </span>
                <span className="text-[10px] text-muted-foreground">Last 90 days</span>
            </div>

            <div className="flex flex-col gap-3">
                {queryList.map(q => {
                    const isExpanded = expanded === q.query;
                    const citedCount = q.history.filter(h => h.cited).length;
                    return (
                        <div key={q.query} className="border border-[#21262d] rounded-xl overflow-hidden bg-card/10">
                            <button
                                onClick={() => setExpanded(isExpanded ? null : q.query)}
                                className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors"
                            >
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="text-xs font-medium text-foreground truncate">
                                        &ldquo;{q.query}&rdquo;
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1.5">
                                        <div className="flex items-center gap-1">
                                            {q.history.map((h, i) => (
                                                <div
                                                    key={i}
                                                    className={`w-2 h-2 rounded-full border ${
                                                        h.cited
                                                            ? "bg-emerald-400/90 border-emerald-500/30"
                                                            : "bg-rose-400/40 border-rose-500/20"
                                                    }`}
                                                    title={`${h.date}: ${h.cited ? "Cited" : "Not cited"}${
                                                        h.pos ? ` (Pos #${h.pos})` : ""
                                                    }`}
                                                />
                                            ))}
                                        </div>
                                        <span className="text-[10px] text-muted-foreground/75 font-medium ml-1">
                                            {citedCount}/{q.history.length} cited
                                        </span>
                                    </div>
                                </div>
                                <span className="text-muted-foreground">
                                    {isExpanded ? (
                                        <ChevronUp className="w-4 h-4" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4" />
                                    )}
                                </span>
                            </button>

                            {isExpanded && (
                                <div className="border-t border-[#21262d] p-3 bg-muted/20 flex flex-col gap-2">
                                    {q.history.map((h, i) => (
                                        <div key={i} className="flex items-center justify-between text-xs py-1">
                                            <span className="text-muted-foreground w-16">{h.date}</span>
                                            <div className="flex-1 flex items-center gap-2">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                                                        h.cited
                                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                                    }`}
                                                >
                                                    {h.cited ? (
                                                        <>
                                                            <Check className="w-2.5 h-2.5" /> Cited
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X className="w-2.5 h-2.5" /> Not cited
                                                        </>
                                                    )}
                                                </span>
                                                {h.cited && h.pos && (
                                                    <span className="text-[10px] text-muted-foreground/80">
                                                        Position #{h.pos} in response
                                                    </span>
                                                )}
                                            </div>
                                            {i === 0 && (
                                                <span className="text-[9px] text-brand/80 font-bold uppercase tracking-wider">
                                                    Latest
                                                </span>
                                            )}
                                        </div>
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
