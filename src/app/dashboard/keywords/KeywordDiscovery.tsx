"use client";

/**
 * KeywordDiscovery — refactored root component
 *
 * Before:  1 file, 1 176 lines, 7 tabs + helpers all inline
 * After:   1 root shell + 7 focused tab components + shared atoms & hooks
 *
 * Key improvements:
 *  • Each tab is lazy-loaded via React.lazy so the initial bundle only contains
 *    the "hub" tab. The other 6 tabs (~800 lines total) are code-split.
 *  • All tabs are wrapped in React.memo — switching tabs doesn't re-render siblings.
 *  • Shared state patterns are extracted into hooks so the tabs hold zero boilerplate.
 *  • The Spinner, Badge, AddButton, ErrorBanner etc. atoms are memoised once and
 *    reused everywhere — no more 6 copies of the same SVG.
 */

import { useState, lazy, Suspense, memo } from "react";
import type { TabId } from "@/app/dashboard/keywords/types";

// The ResearchHub tab is the default so we import it eagerly to avoid a flash.
import { ResearchHubTab } from "./components/tabs/ResearchHubTab";

const AIDiscoveryTab = lazy(() =>
    import("./components/tabs/AIDiscoveryTab").then((m) => ({ default: m.AIDiscoveryTab }))
);
const SeedKeywordsTab = lazy(() =>
    import("./components/tabs/OtherTabs").then((m) => ({ default: m.SeedKeywordsTab }))
);
const SitemapImportTab = lazy(() =>
    import("./components/tabs/OtherTabs").then((m) => ({ default: m.SitemapImportTab }))
);
const FreeKeywordIdeasTab = lazy(() =>
    import("./components/tabs/OtherTabs").then((m) => ({ default: m.FreeKeywordIdeasTab }))
);
const GSCPatternsTab = lazy(() =>
    import("./components/tabs/OtherTabs").then((m) => ({ default: m.GSCPatternsTab }))
);
const CommunityTab = lazy(() =>
    import("./components/tabs/OtherTabs").then((m) => ({ default: m.CommunityTab }))
);

import { KeywordRowSkeleton } from "./components/atoms";

// ─── Tab manifest (single source of truth) ────────────────────────────────────
const TABS: { id: TabId; label: string; activeStyle: string }[] = [
    {
        id: "hub",
        label: "🔬 Research Hub",
        activeStyle: "bg-violet-500/20 text-violet-400 border border-violet-500/30",
    },
    {
        id: "ai",
        label: "🤖 AI Discovery",
        activeStyle: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    },
    {
        id: "gsc",
        label: "📊 GSC Patterns",
        activeStyle: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    },
    {
        id: "ideas",
        label: "💡 Free Ideas",
        activeStyle: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    },
    {
        id: "community",
        label: "⛏️ Community",
        activeStyle: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    },
    {
        id: "seed",
        label: "🎯 Seed Keywords",
        activeStyle: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    },
    {
        id: "sitemap",
        label: "🗺 Sitemap Import",
        activeStyle: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    },
];

// ─── Tab Bar ─────────────────────────────────────────────────────────────────
const TabBar = memo(function TabBar({
    activeTab,
    onSelect,
}: {
    activeTab: TabId;
    onSelect: (id: TabId) => void;
}) {
    return (
        <div role="tablist" aria-label="Keyword Discovery Tabs" className="flex gap-2 mt-4 flex-wrap">
            {TABS.map((t) => (
                <button
                    key={t.id}
                    role="tab"
                    aria-selected={activeTab === t.id}
                    onClick={() => onSelect(t.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeTab === t.id
                            ? t.activeStyle
                            : "bg-muted text-muted-foreground border border-border hover:text-zinc-300"
                    }`}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
});

// ─── Tab Fallback (shown while lazy chunk loads) ──────────────────────────────
const TabFallback = () => (
    <div className="space-y-2 pt-2">
        {Array.from({ length: 5 }).map((_, i) => (
            <KeywordRowSkeleton key={i} />
        ))}
    </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export function KeywordDiscovery({ siteId }: { siteId: string }) {
    const [tab, setTab] = useState<TabId>("hub");

    return (
        <div className="card-surface overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-border">
                <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
                    <span>🔍</span> Keyword Discovery
                </h2>
                <p className="text-sm text-muted-foreground">
                    Discover, track, and grow — powered by the proven 3-step research framework.
                </p>
                <TabBar activeTab={tab} onSelect={setTab} />
            </div>

            {/* Tab content */}
            <div className="p-6">
                <Suspense fallback={<TabFallback />}>
                    {tab === "hub" && <ResearchHubTab siteId={siteId} />}
                    {tab === "ai" && <AIDiscoveryTab siteId={siteId} />}
                    {tab === "gsc" && <GSCPatternsTab siteId={siteId} />}
                    {tab === "ideas" && <FreeKeywordIdeasTab siteId={siteId} />}
                    {tab === "community" && <CommunityTab siteId={siteId} />}
                    {tab === "seed" && <SeedKeywordsTab siteId={siteId} />}
                    {tab === "sitemap" && <SitemapImportTab siteId={siteId} />}
                </Suspense>
            </div>
        </div>
    );
}