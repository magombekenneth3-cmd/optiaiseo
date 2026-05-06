"use client";

import { memo } from "react";
import { Badge, ErrorBanner, PlannerMessage, AddButton, Spinner } from "../atoms";
import { INTENT_COLORS, DIFFICULTY_COLORS } from "../../types";
import { useAIDiscovery, type DiscoveredKeyword } from "../hooks";

const KeywordRow = memo(function KeywordRow({
    kw,
    added,
    adding,
    onAdd,
}: {
    kw: DiscoveredKeyword;
    added: boolean;
    adding: boolean;
    onAdd: () => void;
}) {
    return (
        <div className="flex items-start gap-3 p-3 card-surface rounded-xl hover:border-white/15 transition-all">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-medium text-sm">{kw.keyword}</p>
                    <Badge text={kw.intent} className={INTENT_COLORS[kw.intent] ?? ""} />
                    <span className={`text-[10px] font-bold uppercase ${DIFFICULTY_COLORS[kw.difficulty] ?? ""}`}>
                        {kw.difficulty} difficulty
                    </span>
                </div>
                <p className="text-xs text-muted-foreground">{kw.reason}</p>
            </div>
            <AddButton
                added={added}
                loading={adding}
                onClick={onAdd}
                title={added ? "Added" : "Add to seed keywords"}
            />
        </div>
    );
});

export const AIDiscoveryTab = memo(function AIDiscoveryTab({ siteId }: { siteId: string }) {
    const {
        keywords,
        loading,
        error,
        adding,
        addedSet,
        isAdded,
        savingToPlanner,
        plannerMsg,
        handleDiscover,
        handleAdd,
        handleSaveAllToPlanner,
    } = useAIDiscovery(siteId);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <p className="flex-1 text-sm text-muted-foreground">
                    Gemini analyzes your live site content and suggests 20 high-value keywords tailored to your niche.
                </p>
                <button
                    onClick={handleDiscover}
                    disabled={loading}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-500 to-blue-500 text-white font-bold rounded-xl text-sm hover:opacity-90 transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] disabled:opacity-40"
                >
                    {loading ? <><Spinner /> Analyzing…</> : "🤖 Discover Keywords"}
                </button>
            </div>

            <ErrorBanner message={error} />
            <PlannerMessage msg={plannerMsg} siteId={siteId} />

            {keywords.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                            {keywords.length} keywords discovered
                        </p>
                        <button
                            onClick={handleSaveAllToPlanner}
                            disabled={savingToPlanner}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold rounded-xl text-xs hover:opacity-90 transition-all shadow-lg disabled:opacity-50"
                        >
                            {savingToPlanner
                                ? "Saving…"
                                : `📅 Save ${addedSet.size > 0 ? addedSet.size + " tracked" : "all"} to Planner`}
                        </button>
                    </div>
                    {keywords.map((kw, i) => (
                        <KeywordRow
                            key={i}
                            kw={kw}
                            added={isAdded(kw.keyword)}
                            adding={adding === kw.keyword}
                            onAdd={() => handleAdd(kw)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});