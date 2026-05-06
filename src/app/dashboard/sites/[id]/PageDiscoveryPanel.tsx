// src/app/dashboard/sites/[id]/PageDiscoveryPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { getPageDiscovery, PageDiscoveryResult, DiscoveredPage } from "@/app/actions/pageDiscovery";
import {
    Globe, AlertTriangle, CheckCircle, Search,
    ExternalLink, RefreshCw, Info, TrendingUp, FileX, MapPin
} from "lucide-react";

interface Props {
    siteId: string;
    domain: string;
}

const SOURCE_LABELS: Record<DiscoveredPage["source"], { label: string; color: string }> = {
    both:    { label: "GSC + Sitemap",     color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    gsc:     { label: "GSC only",          color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    sitemap: { label: "Not in Google yet", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
};

function StatCard({ value, label, icon, color = "" }: {
    value: number | string;
    label: string;
    icon: React.ReactNode;
    color?: string;
}) {
    return (
        <div className="p-4 rounded-xl border border-border bg-muted/30 flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{icon}</span>
                <span className={`text-2xl font-bold ${color}`}>{value}</span>
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

function ExplainerBanner({ result }: { result: PageDiscoveryResult }) {
    const issues: { icon: React.ReactNode; text: string; color: string }[] = [];

    if (!result.gscConnected) {
        issues.push({
            icon: <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />,
            text: "Google Search Console is not connected. Connect GSC in Site Settings to see which pages Google has indexed.",
            color: "border-red-500/20 bg-red-500/5 text-red-400",
        });
    }

    if (result.gscCapped) {
        issues.push({
            icon: <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />,
            text: `GSC data was capped at ${result.gscPageCount.toLocaleString()} rows. Your site may have more pages than shown — upgrade to Pro for full pagination.`,
            color: "border-amber-500/20 bg-amber-500/5 text-amber-400",
        });
    }

    if (result.notInGsc > 0) {
        issues.push({
            icon: <Info className="w-4 h-4 shrink-0 mt-0.5" />,
            text: `${result.notInGsc} page${result.notInGsc === 1 ? "" : "s"} found in your sitemap but not in Google Search Console. These pages have never appeared in Google search — they may be new, unindexed, or blocked.`,
            color: "border-amber-500/20 bg-amber-500/5 text-amber-400",
        });
    }

    if (!result.sitemapFound) {
        issues.push({
            icon: <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />,
            text: "No sitemap found at common locations (/sitemap.xml, /sitemap_index.xml). Add a sitemap and submit it in Google Search Console to help Google discover all your pages.",
            color: "border-red-500/20 bg-red-500/5 text-red-400",
        });
    }

    if (result.notInSitemap > 0) {
        issues.push({
            icon: <Info className="w-4 h-4 shrink-0 mt-0.5" />,
            text: `${result.notInSitemap} page${result.notInSitemap === 1 ? "" : "s"} appear in Google but aren't in your sitemap. Add them to your sitemap so Google keeps them indexed.`,
            color: "border-blue-500/20 bg-blue-500/5 text-blue-400",
        });
    }

    if (issues.length === 0) {
        return (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-400">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-sm">All pages found in both GSC and your sitemap. Page discovery looks healthy.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {issues.map((issue, i) => (
                <div key={i} className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${issue.color}`}>
                    {issue.icon}
                    <p>{issue.text}</p>
                </div>
            ))}
        </div>
    );
}

function PageRow({ page }: { page: DiscoveredPage }) {
    const source = SOURCE_LABELS[page.source];
    const slug = page.url.replace(/^https?:\/\/[^/]+/, "") || "/";

    return (
        <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0 group text-sm">
            <div className="flex-1 min-w-0">
                <p className="truncate text-foreground font-medium">{slug}</p>
                <p className="text-[11px] text-muted-foreground truncate">{page.url}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
                {page.impressions !== undefined && (
                    <span className="text-xs text-muted-foreground hidden sm:block">
                        {page.impressions.toLocaleString()} imp
                    </span>
                )}
                {page.position !== undefined && (
                    <span className={`text-xs font-semibold hidden sm:block ${
                        page.position <= 3  ? "text-emerald-400" :
                        page.position <= 10 ? "text-blue-400" :
                        page.position <= 20 ? "text-amber-400" : "text-red-400"
                    }`}>
                        #{Math.round(page.position)}
                    </span>
                )}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${source.color}`}>
                    {source.label}
                </span>
                <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-emerald-400"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </a>
            </div>
        </div>
    );
}

export function PageDiscoveryPanel({ siteId, domain }: Props) {
    const [result, setResult]   = useState<PageDiscoveryResult | null>(null);
    const [isPending, startTransition] = useTransition();
    const [filter, setFilter]   = useState<"all" | DiscoveredPage["source"]>("all");
    const [search, setSearch]   = useState("");
    const [showAll, setShowAll] = useState(false);

    const scan = () => {
        startTransition(async () => {
            const data = await getPageDiscovery(siteId);
            setResult(data);
            setShowAll(false);
        });
    };

    const filteredPages = (result?.pages ?? []).filter(p => {
        const matchesFilter = filter === "all" || p.source === filter;
        const matchesSearch = !search || p.url.toLowerCase().includes(search.toLowerCase());
        return matchesFilter && matchesSearch;
    });

    const displayedPages = showAll ? filteredPages : filteredPages.slice(0, 25);

    return (
        <div className="card-surface p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h2 className="text-base font-semibold flex items-center gap-2">
                        <Globe className="w-4 h-4 text-emerald-400" />
                        Page Discovery
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        See every page Google knows about — and every page it doesn&apos;t.
                    </p>
                </div>
                <button
                    onClick={scan}
                    disabled={isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-semibold hover:bg-emerald-500/20 transition-all disabled:opacity-50 shrink-0"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPending ? "animate-spin" : ""}`} />
                    {isPending ? "Scanning..." : result ? "Re-scan" : "Scan pages"}
                </button>
            </div>

            {/* Empty state */}
            {!result && !isPending && (
                <div className="py-10 text-center">
                    <Globe className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                        Click &ldquo;Scan pages&rdquo; to discover all pages across GSC and your sitemap.
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                        Cross-references Google Search Console with your sitemap to find pages Google doesn&apos;t know about.
                    </p>
                </div>
            )}

            {/* Loading */}
            {isPending && (
                <div className="py-10 text-center">
                    <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Scanning GSC and sitemap&hellip;</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Checking {domain}</p>
                </div>
            )}

            {result && !isPending && (
                <>
                    {/* Error */}
                    {result.error && (
                        <div className="flex items-center gap-2 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            {result.error}
                        </div>
                    )}

                    {/* Stat cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard
                            value={result.totalUniquePages.toLocaleString()}
                            label="Total pages found"
                            icon={<Globe className="w-4 h-4" />}
                        />
                        <StatCard
                            value={result.gscPageCount.toLocaleString()}
                            label={`In Google${result.gscCapped ? " (capped)" : ""}`}
                            icon={<Search className="w-4 h-4" />}
                            color={result.gscCapped ? "text-amber-400" : "text-emerald-400"}
                        />
                        <StatCard
                            value={result.sitemapPageCount.toLocaleString()}
                            label="In sitemap"
                            icon={<MapPin className="w-4 h-4" />}
                            color={result.sitemapFound ? "text-blue-400" : "text-red-400"}
                        />
                        <StatCard
                            value={result.notInGsc.toLocaleString()}
                            label="Not in Google yet"
                            icon={<FileX className="w-4 h-4" />}
                            color={result.notInGsc > 0 ? "text-amber-400" : "text-emerald-400"}
                        />
                    </div>

                    {/* Sitemap URL */}
                    {result.sitemapUrl && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            Sitemap found at&nbsp;
                            <a href={result.sitemapUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate max-w-[280px]">
                                {result.sitemapUrl}
                            </a>
                        </div>
                    )}

                    {/* Explainer banners */}
                    <ExplainerBanner result={result} />

                    {/* Filter + search */}
                    {result.totalUniquePages > 0 && (
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="flex gap-1 flex-wrap">
                                {(["all", "both", "gsc", "sitemap"] as const).map(f => {
                                    const counts: Record<string, number> = {
                                        all:     result.totalUniquePages,
                                        both:    result.pages.filter(p => p.source === "both").length,
                                        gsc:     result.notInSitemap,
                                        sitemap: result.notInGsc,
                                    };
                                    const labels: Record<string, string> = {
                                        all:     `All (${counts.all})`,
                                        both:    `In Google (${counts.both})`,
                                        gsc:     `GSC only (${counts.gsc})`,
                                        sitemap: `Not indexed (${counts.sitemap})`,
                                    };
                                    return (
                                        <button
                                            key={f}
                                            onClick={() => { setFilter(f); setShowAll(false); }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                                filter === f
                                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                    : "text-muted-foreground border border-border hover:text-foreground"
                                            }`}
                                        >
                                            {labels[f]}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-1.5 flex-1 sm:max-w-[220px]">
                                <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <input
                                    value={search}
                                    onChange={e => { setSearch(e.target.value); setShowAll(false); }}
                                    placeholder="Filter by URL..."
                                    className="bg-transparent text-sm outline-none flex-1 min-w-0 text-foreground placeholder:text-muted-foreground"
                                />
                            </div>
                        </div>
                    )}

                    {/* Pages list */}
                    {filteredPages.length > 0 ? (
                        <div>
                            <div className="flex items-center gap-3 pb-2 border-b border-border text-[11px] uppercase font-bold tracking-wider text-muted-foreground">
                                <span className="flex-1">Page</span>
                                <span className="hidden sm:block w-16 text-right">Impr.</span>
                                <span className="hidden sm:block w-10 text-right">Pos.</span>
                                <span className="w-28 text-right">Source</span>
                                <span className="w-4" />
                            </div>
                            {displayedPages.map(page => <PageRow key={page.url} page={page} />)}
                            {!showAll && filteredPages.length > 25 && (
                                <button
                                    onClick={() => setShowAll(true)}
                                    className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-emerald-400 border border-dashed border-border rounded-xl transition-colors"
                                >
                                    Show all {filteredPages.length} pages
                                </button>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-6">No pages match this filter.</p>
                    )}

                    {/* "What to do" CTA */}
                    {result.notInGsc > 0 && (
                        <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-2">
                            <p className="text-sm font-semibold flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-emerald-400" />
                                What to do with &ldquo;Not in Google yet&rdquo; pages
                            </p>
                            <ul className="text-xs text-muted-foreground space-y-1 pl-1">
                                <li>• Open Google Search Console → URL Inspection → request indexing for each page</li>
                                <li>• Make sure these pages have at least one internal link pointing to them</li>
                                <li>• Check they aren&apos;t blocked by robots.txt or a noindex tag</li>
                                <li>• If they&apos;re thin or duplicate pages, consider consolidating them first</li>
                            </ul>
                        </div>
                    )}

                    {result.lastScanned && (
                        <p className="text-[11px] text-muted-foreground text-right">
                            Scanned {new Date(result.lastScanned).toLocaleString()}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
