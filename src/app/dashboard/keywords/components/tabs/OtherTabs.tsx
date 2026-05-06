"use client";

import { memo, useEffect } from "react";
import { Badge, ErrorBanner, AddButton, Spinner } from "../atoms";
import { INTENT_COLORS, DIFFICULTY_COLORS } from "../../types";
import {
    useSeedKeywords,
    useSitemapImport,
    useFreeIdeas,
    useGscPatterns,
    useCommunity,
} from "../hooks";

// ─── SeedKeywordsTab ──────────────────────────────────────────────────────────
export const SeedKeywordsTab = memo(function SeedKeywordsTab({ siteId }: { siteId: string }) {
    const {
        keywords,
        input, setInput,
        notes, setNotes,
        adding,
        deleting,
        loading,
        error,
        load,
        handleAdd,
        handleDelete,
    } = useSeedKeywords(siteId);

    // load is stable across renders (useCallback on [siteId]) so this runs
    // once on mount and again only if siteId changes.
    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Add keywords you want to target and track over time. These become your SEO goals.
            </p>

            <div className="flex gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    placeholder="e.g. best OptiAISEO 2024"
                    className="flex-1 bg-muted border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-muted-foreground"
                />
                <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    className="w-40 bg-muted border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white/20 placeholder:text-muted-foreground"
                />
                <button
                    onClick={handleAdd}
                    disabled={adding || !input.trim()}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-all disabled:opacity-50"
                >
                    {adding ? "…" : "Track"}
                </button>
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}

            {loading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : keywords.length === 0 ? (
                <div className="card-surface p-8 text-center">
                    <p className="text-4xl mb-3">🎯</p>
                    <p className="text-muted-foreground text-sm">
                        No seed keywords yet. Add the keywords you want to rank for above.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {keywords.map((kw) => (
                        <div key={kw.id} className="flex items-center gap-3 p-3 card-surface rounded-xl">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <p className="font-medium text-sm">{kw.keyword}</p>
                                    {kw.intent && (
                                        <Badge text={kw.intent} className={INTENT_COLORS[kw.intent] ?? ""} />
                                    )}
                                </div>
                                {kw.notes && (
                                    <p className="text-xs text-muted-foreground mt-0.5">{kw.notes}</p>
                                )}
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Added {new Date(kw.addedAt).toLocaleDateString()}
                                </p>
                            </div>
                            {/* Bug 2 fix: delete is gated on server response inside the hook */}
                            <button
                                onClick={() => handleDelete(kw.id)}
                                disabled={deleting === kw.id}
                                className="text-muted-foreground hover:text-red-400 text-xs transition-colors px-2 py-1"
                            >
                                {deleting === kw.id ? "…" : "✕"}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

// ─── SitemapImportTab ─────────────────────────────────────────────────────────
export const SitemapImportTab = memo(function SitemapImportTab({ siteId }: { siteId: string }) {
    const { pages, loading, error, adding, addedSet, handleImport, handleAdd } =
        useSitemapImport(siteId);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <p className="flex-1 text-sm text-muted-foreground">
                    Fetches your sitemap, then AI suggests target keywords for each page — no GSC needed.
                </p>
                <button
                    onClick={handleImport}
                    disabled={loading}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-xl text-sm hover:opacity-90 transition-all disabled:opacity-40"
                >
                    {loading ? <><Spinner /> Scanning…</> : "🗺 Import from Sitemap"}
                </button>
            </div>

            <ErrorBanner message={error} />

            {pages.length > 0 && (
                <div className="space-y-4">
                    {pages.map((page, pi) => (
                        <div key={pi} className="card-surface p-4 rounded-xl">
                            <p className="text-xs font-mono text-muted-foreground mb-3 truncate" title={page.url}>
                                🔗 {page.url}
                            </p>
                            <div className="space-y-2">
                                {(page.keywords ?? []).map((kw, ki) => {
                                    const key = `${page.url}::${kw.keyword}`;
                                    const isAdded = addedSet.has(key);
                                    return (
                                        <div key={ki} className="flex items-center gap-2">
                                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium">{kw.keyword}</span>
                                                <Badge text={kw.intent} className={INTENT_COLORS[kw.intent] ?? ""} />
                                                <span className={`text-[10px] font-bold ${DIFFICULTY_COLORS[kw.difficulty] ?? ""}`}>
                                                    {kw.difficulty}
                                                </span>
                                            </div>
                                            <AddButton
                                                added={isAdded}
                                                loading={adding === key}
                                                onClick={() => handleAdd(kw, page.url)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

// ─── FreeKeywordIdeasTab ──────────────────────────────────────────────────────
export const FreeKeywordIdeasTab = memo(function FreeKeywordIdeasTab({ siteId }: { siteId: string }) {
    const {
        seed, setSeed,
        keywords,
        loading,
        error,
        adding,
        addedSet,
        handleDiscover,
        handleAdd,
    } = useFreeIdeas(siteId);

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Enter a seed phrase. We query Google Autocomplete to surface hundreds of long-tail variations
                people actually search for.
            </p>

            <div className="flex gap-2">
                <input
                    type="text"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
                    placeholder="e.g. SEO tips"
                    className="flex-1 bg-muted border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-muted-foreground"
                />
                <button
                    onClick={handleDiscover}
                    disabled={loading || !seed.trim()}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-sm hover:opacity-90 transition-all disabled:opacity-40"
                >
                    {loading ? <><Spinner /> Fetching…</> : "🔍 Get Ideas"}
                </button>
            </div>

            <ErrorBanner message={error} />

            {keywords.length > 0 && (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                        {keywords.length} ideas found
                    </p>
                    {keywords.map((kw, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between gap-3 p-3 card-surface rounded-xl hover:border-white/15 transition-all"
                        >
                            <span className="font-medium text-sm text-foreground">{kw.keyword}</span>
                            <AddButton
                                added={addedSet.has(kw.keyword)}
                                loading={adding === kw.keyword}
                                onClick={() => handleAdd(kw.keyword)}
                                title={addedSet.has(kw.keyword) ? "Added" : "Add to seed keywords"}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

// ─── GSCPatternsTab ───────────────────────────────────────────────────────────
export const GSCPatternsTab = memo(function GSCPatternsTab({ siteId }: { siteId: string }) {
    const { data, loading, error, copied, handleGenerate, copyLine } = useGscPatterns(siteId);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <p className="flex-1 text-sm text-muted-foreground">
                    Generate advanced Custom Regex patterns for Google Search Console to filter branded queries
                    or extract long-tail question keywords.
                </p>
                <button
                    onClick={handleGenerate}
                    disabled={loading}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold rounded-xl text-sm disabled:opacity-40"
                >
                    {loading ? "Generating…" : "🧬 Generate Patterns"}
                </button>
            </div>

            <ErrorBanner message={error} />

            {data && (
                <div className="space-y-4">
                    {[
                        { title: "Branded Filter (Includes Typos)", pattern: data.brandedPattern, color: "text-indigo-300" },
                        { title: "Question Intent Filter", pattern: data.questionPattern, color: "text-blue-300" },
                    ].map(({ title, pattern, color }) => (
                        <div key={title} className="card-surface p-4 rounded-xl space-y-3">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-bold text-white">{title}</p>
                                <button
                                    onClick={() => copyLine(pattern)}
                                    className="px-3 py-1 bg-muted border border-border rounded text-xs text-zinc-300 hover:text-white transition"
                                >
                                    {copied === pattern ? "Copied!" : "Copy Regex"}
                                </button>
                            </div>
                            <code className={`block p-3 bg-black/30 border border-white/5 rounded ${color} text-xs overflow-x-auto`}>
                                {pattern}
                            </code>
                        </div>
                    ))}

                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 space-y-2">
                        <p className="text-sm font-bold text-indigo-400 mb-2">💡 Tips</p>
                        <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside">
                            {data.tips.map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
});

// ─── CommunityTab ─────────────────────────────────────────────────────────────
export const CommunityTab = memo(function CommunityTab({ siteId }: { siteId: string }) {
    const { keywords, loading, error, adding, addedSet, handleMine, handleAdd } =
        useCommunity(siteId);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <p className="flex-1 text-sm text-muted-foreground">
                    Mine Reddit to find real pain-point questions your target audience is asking.
                </p>
                <button
                    onClick={handleMine}
                    disabled={loading}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold rounded-xl text-sm hover:opacity-90 transition-all shadow-[0_0_20px_rgba(249,115,22,0.3)] disabled:opacity-40"
                >
                    {loading ? <><Spinner /> Mining Communities…</> : "⛏️ Mine Keywords"}
                </button>
            </div>

            <ErrorBanner message={error} />

            {keywords.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                        {keywords.length} painful questions discovered
                    </p>
                    {keywords.map((kw, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-3 p-3 card-surface rounded-xl hover:border-white/15 transition-all"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <p className="font-medium text-sm">{kw.keyword}</p>
                                    <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded px-1.5 py-0.5 font-bold">
                                        {kw.source}{kw.subreddit ? ` / r/${kw.subreddit}` : ""}
                                    </span>
                                    <span className="text-[10px] font-bold text-muted-foreground">
                                        ⬆ {kw.upvotes} upvotes
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground break-words">{kw.questionPattern}</p>
                            </div>
                            <AddButton
                                added={addedSet.has(kw.keyword)}
                                loading={adding === kw.keyword}
                                onClick={() => handleAdd(kw)}
                                title={addedSet.has(kw.keyword) ? "Added" : "Add to seed keywords"}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});