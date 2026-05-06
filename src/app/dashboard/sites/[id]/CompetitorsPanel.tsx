/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addCompetitor, removeCompetitor, getKeywordGaps } from "@/app/actions/competitor";
import { generateAttackBlog } from "@/app/actions/blog";
import { toast } from "sonner";

type Competitor = {
    id: string;
    domain: string;
    _count?: {
        keywords: number;
    };
};

type KeywordGap = {
    keyword: string;
    searchVolume: number;
    difficulty: number;
    position: number;
    url?: string;
    competitorDomain: string;
};

export function CompetitorsPanel({ siteId, initialCompetitors, userRole = "AGENCY_ADMIN" }: { siteId: string, initialCompetitors: Competitor[], userRole?: string }) {
    const router = useRouter();
    const [competitors, setCompetitors] = useState<Competitor[]>(initialCompetitors);
    const [domain, setDomain] = useState("");
    const [isAdding, setIsAdding] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    // Track which keyword attack is in-flight to prevent duplicate submissions
    const [attackingKeyword, setAttackingKeyword] = useState<string | null>(null);

    const [gaps, setGaps] = useState<KeywordGap[]>([]);
    const [isLoadingGaps, setIsLoadingGaps] = useState(false);

    // Only re-fetch keyword gaps when competitors are ADDED (count increases),
    // not when they are removed. We derive a stable join-key from the sorted IDs
    // so the effect only fires on set-membership changes, not object identity.
    const competitorJoinKey = competitors
        .map((c) => c.id)
        .sort()
        .join(",");

    useEffect(() => {
        if (competitors.length > 0) {
            loadGaps();
        } else {
            setGaps([]);
        }
    }, [competitorJoinKey]);

    const loadGaps = async () => {
        setIsLoadingGaps(true);
        const result = await getKeywordGaps(siteId);
        if (result.success && result.data) {
            setGaps(result.data);
        } else if (!result.success) {
            toast.error(result.error || "Failed to load keyword gaps.");
        }
        setIsLoadingGaps(false);
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!domain.trim()) return;

        setIsAdding(true);
        const addResult = await addCompetitor(siteId, domain);

        if (addResult.success) {
            toast.success("Competitor added for tracking.");
            setDomain("");
            // Use router.refresh() (soft Next.js re-render) instead of
            // window.location.reload() to avoid a white flash and losing scroll position.
            // The server component re-runs and returns fresh competitor data.
            router.refresh();
        } else {
            toast.error(addResult.error || "Failed to add competitor.");
        }
        setIsAdding(false);
    };

    const handleRemove = async (compId: string) => {
        setRemovingId(compId);
        const removeResult = await removeCompetitor(compId);

        if (removeResult.success) {
            toast.success("Competitor removed.");
            setCompetitors(prev => prev.filter(c => c.id !== compId));
        } else {
            toast.error(removeResult.error || "Failed to remove competitor.");
        }
        setRemovingId(null);
    };

    const handleGenerateAttack = async (gap: KeywordGap) => {
        // Prevent duplicate submissions: disable this keyword's button while in-flight.
        if (attackingKeyword === gap.keyword) return;

        setAttackingKeyword(gap.keyword);
        toast.loading(`Drafting attack content for "${gap.keyword}"...`, { id: gap.keyword });
        const attackResult = await generateAttackBlog(
            siteId,
            gap.keyword,
            gap.competitorDomain,
            gap.searchVolume,
            gap.difficulty
        );

        if (attackResult.success && attackResult.blog) {
            toast.success("Attack Content Generated! Check the Blogs tab for your draft.", { id: gap.keyword });
        } else {
            toast.error(!attackResult.success ? attackResult.error : "Failed to generate content.", { id: gap.keyword });
        }
        setAttackingKeyword(null);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="card-surface p-6 border-border">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        Competitor Intelligence
                    </h2>
                    <span className="px-2.5 py-1 rounded-full bg-muted border border-border text-xs font-medium text-muted-foreground">
                        {competitors.length} / 3 tracked
                    </span>
                </div>

                <p className="text-sm text-muted-foreground mb-6">
                    Track up to 3 competitors. Identify high-value &quot;Keyword Gaps&quot; (keywords they rank for, but you don&apos;t) and use AI to automatically generate content to steal their share of voice.
                </p>

                <div className="flex flex-col gap-4">
                    {competitors.length > 0 ? (
                        <div className="flex flex-col gap-3">
                            {competitors.map((comp) => (
                                <div key={comp.id} className="p-4 rounded-xl border border-border bg-muted flex items-center justify-between hover:bg-white/[0.07] transition-colors group">
                                    <div className="flex flex-col gap-1">
                                        <span className="font-semibold text-sm">{comp.domain}</span>
                                        <span className="text-xs text-muted-foreground">
                                            Tracking {comp._count?.keywords || 0} overlapping keywords
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 text-xs font-semibold border border-amber-500/20 whitespace-nowrap">
                                            Active Tracking
                                        </span>
                                        {userRole === "AGENCY_ADMIN" && (
                                            <button
                                                onClick={() => handleRemove(comp.id)}
                                                disabled={removingId === comp.id}
                                                className="text-muted-foreground hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                                                title="Remove competitor"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-6 rounded-xl border border-dashed border-border flex flex-col items-center justify-center text-center">
                            <svg className="w-8 h-8 text-muted-foreground/50 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="text-sm font-medium">No Competitors Tracked</span>
                            <span className="text-xs text-muted-foreground mt-1 max-w-[250px]">
                                Add a competitor domain below to discover hidden traffic opportunities.
                            </span>
                        </div>
                    )}

                    {competitors.length < 3 && userRole === "AGENCY_ADMIN" && (
                        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3 mt-2">
                            <input
                                type="text"
                                value={domain}
                                onChange={(e) => setDomain(e.target.value)}
                                placeholder="e.g. stripe.com"
                                className="flex-1 bg-background/50 border border-border focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white placeholder:text-muted-foreground outline-none"
                                disabled={isAdding}
                            />
                            <button
                                type="submit"
                                disabled={isAdding || !domain.trim()}
                                className="bg-amber-500 hover:bg-amber-600 text-amber-950 px-5 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-[0_0_15px_rgba(245,158,11,0.2)]"
                            >
                                {isAdding ? "Adding..." : "Add Competitor"}
                            </button>
                        </form>
                    )}
                </div>
            </div>

            {/* Keyword Gaps Section */}
            {competitors.length > 0 && (
                <div className="card-surface p-6 border-border">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Discovered Keyword Gaps
                        </h3>
                        <button
                            onClick={loadGaps}
                            disabled={isLoadingGaps}
                            className="text-xs font-medium text-muted-foreground hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
                        >
                            <svg className={`w-3.5 h-3.5 ${isLoadingGaps ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh
                        </button>
                    </div>

                    {isLoadingGaps && gaps.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                            <svg className="animate-spin h-8 w-8 mb-4 text-emerald-500/50" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="text-sm">Analyzing competitor rankings...</span>
                        </div>
                    ) : gaps.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-muted-foreground bg-muted border-y border-border">
                                    <tr>
                                        <th scope="col" className="px-4 py-3 font-medium rounded-tl-lg">Keyword Gap</th>
                                        <th scope="col" className="px-4 py-3 font-medium">Vol</th>
                                        <th scope="col" className="px-4 py-3 font-medium">KD</th>
                                        <th scope="col" className="px-4 py-3 font-medium">Competitor</th>
                                        <th scope="col" className="px-4 py-3 font-medium text-right rounded-tr-lg">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {gaps.map((gap, i) => (
                                        <tr key={i} className="border-b border-border hover:bg-card transition-colors">
                                            <td className="px-4 py-3 font-medium text-white">{gap.keyword}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{gap.searchVolume.toLocaleString()}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${gap.difficulty > 70 ? 'bg-rose-500/10 text-rose-400' :
                                                    gap.difficulty > 40 ? 'bg-amber-500/10 text-amber-400' :
                                                        'bg-emerald-500/10 text-emerald-400'
                                                    }`}>
                                                    {gap.difficulty}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">
                                                <div className="flex flex-col">
                                                    <span className="truncate max-w-[120px]" title={gap.competitorDomain}>
                                                        {gap.competitorDomain}
                                                    </span>
                                                    <span className="text-[10px] opacity-70">Pos: #{gap.position}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {userRole === "AGENCY_ADMIN" && (
                                                    <button
                                                        onClick={() => handleGenerateAttack(gap)}
                                                        disabled={attackingKeyword === gap.keyword}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-md text-xs font-semibold transition-colors border border-emerald-500/20 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {attackingKeyword === gap.keyword ? (
                                                            <>
                                                                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                                </svg>
                                                                Attacking...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                                </svg>
                                                                Attack
                                                            </>
                                                        )}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-xl">
                            <p className="text-sm">No significant keyword gaps found against tracked competitors.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
