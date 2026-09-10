"use client";

import { useState, useTransition, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addCompetitor, deleteCompetitor, refreshCompetitorKeywords,
  fetchCompetitorBacklinkGap,
  autoDetectAndSaveCompetitors, clearAndRedetectCompetitors,
} from "@/app/actions/competitors";
import {
  Crosshair, Plus, Trash2, RefreshCw, ExternalLink,
  TrendingUp, Search, Lock, Globe, BarChart3, FileText,
  Zap, ChevronDown, ChevronUp, Sparkles, Layers, Link2, ArrowUpRight,
  CheckCircle2, AlertCircle, X, MoreHorizontal, ArrowUpDown,
  ChevronLeft, ChevronRight, Eye, Target, ArrowRight,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import { clusterKey as gscClusterKey } from "@/lib/gsc";


type Snapshot = { month: string; traffic: number; organicKeywords: number | null };
type KW = { id: string; keyword: string; position: number; searchVolume: number; difficulty: number | null; clicks: number | null; dataSource: string | null };
type Competitor = { id: string; domain: string; addedAt: string | Date; metadata: Record<string, unknown> | null; keywords: KW[]; snapshots: Snapshot[] };
type Site = { id: string; domain: string };
type GapReport = { gap: { referringDomains: number; domainRating: number; totalBacklinks: number; opportunityDomains: string[] }; you: { domainRating: number; referringDomains: number }; competitor: { domainRating: number; referringDomains: number } };
interface Props { sites: Site[]; activeSiteId: string | null; activeSiteDomain: string | null; competitors: Competitor[]; isPaid: boolean; tier: string }

type SortKey = "gaps" | "traffic" | "keywords" | "newest" | "alpha";
type FilterKey = "all" | "growing" | "stable" | "declining";
const PAGE_SIZE = 10;

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function getTrafficDelta(snapshots: Snapshot[]): { pct: number; direction: "up" | "down" | "flat" } {
  if (snapshots.length < 2) return { pct: 0, direction: "flat" };
  const sorted = [...snapshots].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const prev = sorted[sorted.length - 2].traffic;
  const curr = sorted[sorted.length - 1].traffic;
  if (prev === 0) return { pct: 0, direction: "flat" };
  const pct = Math.round(((curr - prev) / prev) * 100);
  return { pct, direction: pct > 3 ? "up" : pct < -3 ? "down" : "flat" };
}

function getKeywordDelta(snapshots: Snapshot[]): { pct: number; direction: "up" | "down" | "flat" } {
  if (snapshots.length < 2) return { pct: 0, direction: "flat" };
  const sorted = [...snapshots].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const prev = sorted[sorted.length - 2].organicKeywords;
  const curr = sorted[sorted.length - 1].organicKeywords;
  if (prev == null || curr == null || prev === 0) return { pct: 0, direction: "flat" };
  const pct = Math.round(((curr - prev) / prev) * 100);
  return { pct, direction: pct > 3 ? "up" : pct < -3 ? "down" : "flat" };
}

function getTrend(comp: Competitor): "growing" | "declining" | "stable" {
  const meta = comp.metadata as Record<string, unknown> | null;
  const trend = meta?.growthTrend as string | null;
  if (trend === "growing" || trend === "declining") return trend;
  const { direction } = getTrafficDelta(comp.snapshots);
  if (direction === "up") return "growing";
  if (direction === "down") return "declining";
  return "stable";
}

function Favicon({ domain }: { domain: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt=""
      className="w-5 h-5 rounded-sm"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
  );
}

function KdBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground text-xs">—</span>;
  const c = score >= 70 ? "text-rose-400 bg-rose-500/10" : score >= 40 ? "text-amber-400 bg-amber-500/10" : "text-emerald-400 bg-emerald-500/10";
  return <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${c}`}>{score}</span>;
}

function TrendBadge({ trend, pct }: { trend: "growing" | "declining" | "stable"; pct: number }) {
  if (trend === "growing")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
        <ArrowUpRight className="h-3 w-3" />
        Growing {pct > 0 && `+${pct}%`}
      </span>
    );
  if (trend === "declining")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400">
        <TrendingUp className="h-3 w-3 rotate-180" />
        Declining {pct < 0 && `${pct}%`}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <ArrowRight className="h-3 w-3" />
      Stable {pct !== 0 && `${pct > 0 ? "+" : ""}${pct}%`}
    </span>
  );
}

function MiniSparkline({ snapshots, color }: { snapshots: Snapshot[]; color: string }) {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const data = sorted.map(s => ({ v: s.traffic }));
  return (
    <ResponsiveContainer width={64} height={24}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function KeywordGapBadge({ count }: { count: number }) {
  const bg = count >= 15 ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/25"
    : count >= 5 ? "bg-blue-500/15 text-blue-300 border-blue-500/25"
    : count > 0 ? "bg-muted text-foreground border-border"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-bold ${bg}`}>
      {count}<span className="ml-1 font-normal text-[10px] opacity-70">keywords</span>
    </span>
  );
}

type Cluster = { topic: string; keywords: KW[]; vol: number };

function buildClusters(keywords: KW[]): Cluster[] {
  const map = new Map<string, KW[]>();
  for (const kw of keywords) {
    const key = gscClusterKey(kw.keyword);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(kw);
  }
  const result: Cluster[] = [];
  const other: KW[] = [];
  for (const [topic, kws] of map) {
    if (kws.length >= 2) result.push({ topic, keywords: kws.sort((a, b) => b.searchVolume - a.searchVolume), vol: kws.reduce((s, k) => s + k.searchVolume, 0) });
    else other.push(...kws);
  }
  if (other.length > 0) result.push({ topic: "other", keywords: other.sort((a, b) => b.searchVolume - a.searchVolume), vol: other.reduce((s, k) => s + k.searchVolume, 0) });
  return result.sort((a, b) => b.vol - a.vol).slice(0, 8);
}

type ActionState =
  | { type: "idle" }
  | { type: "loading"; message: string }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

function ActionStatusBar({ state, onDismiss }: { state: ActionState; onDismiss: () => void }) {
  if (state.type === "idle") return null;
  const configs = {
    loading: { bg: "bg-violet-500/10 border-violet-500/20", text: "text-violet-300", icon: <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> },
    success: { bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-400", icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> },
    error: { bg: "bg-rose-500/10 border-rose-500/20", text: "text-rose-400", icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" /> },
  };
  const cfg = configs[state.type as keyof typeof configs];
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border ${cfg.bg} ${cfg.text} text-xs font-medium`}>
      {cfg.icon}
      <span className="flex-1">{state.message}</span>
      {state.type !== "loading" && (
        <button onClick={onDismiss} className="p-0.5 rounded hover:opacity-70 transition-opacity shrink-0" aria-label="Dismiss">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

type DetailTab = "keywords" | "topics" | "pages" | "backlinks";

function CompDetailModal({
  comp, siteId, isPaid, onClose, onRefresh, onDelete,
}: {
  comp: Competitor; siteId: string; isPaid: boolean;
  onClose: () => void; onRefresh: () => void; onDelete: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<DetailTab>("keywords");
  const [pending, go] = useTransition();
  const [actionState, setActionState] = useState<ActionState>({ type: "idle" });
  const [gapReport, setGapReport] = useState<GapReport | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);

  const meta = comp.metadata as Record<string, unknown> | null;
  const visits = meta?.estimatedMonthlyVisits as number | null ?? null;
  const orgKws = meta?.organicKeywords as number | null ?? null;
  const topPages = (meta?.topPages as { url: string; traffic: number }[] | null) ?? [];
  const clusters = buildClusters(comp.keywords);
  const maxVol = clusters.length ? Math.max(...clusters.map(c => c.vol)) : 1;
  const trend = getTrend(comp);
  const { pct } = getTrafficDelta(comp.snapshots);

  const refresh = () => {
    if (!isPaid) { toast.error("Upgrade to refresh."); return; }
    go(async () => {
      setActionState({ type: "loading", message: `Refreshing ${comp.domain} — fetching keyword gaps…` });
      const r = await refreshCompetitorKeywords(siteId, comp.id);
      if (r.success) {
        setActionState({ type: "success", message: `Updated ${r.count ?? 0} keyword gaps for ${comp.domain}` });
        onRefresh();
        router.refresh();
      } else {
        setActionState({ type: "error", message: r.error ?? "Refresh failed — please try again." });
      }
    });
  };

  const loadGap = async () => {
    if (gapReport || gapLoading) return;
    if (!isPaid) { toast.error("Upgrade to view backlink gap."); return; }
    setGapLoading(true);
    setGapError(null);
    try {
      const r = await fetchCompetitorBacklinkGap(siteId, comp.id);
      if (r.success) setGapReport(r.report as unknown as GapReport);
      else setGapError(r.error ?? "Failed to load backlink gap.");
    } catch {
      setGapError("Failed to load backlink gap.");
    } finally {
      setGapLoading(false);
    }
  };

  const handleTabChange = (t: DetailTab) => {
    setTab(t);
    if (t === "backlinks") loadGap();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label={`${comp.domain} analysis`}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Favicon domain={comp.domain} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm truncate">{comp.domain}</span>
                <a href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-blue-400 transition-colors">
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <TrendBadge trend={trend} pct={pct} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-4 mr-4 text-center">
              <div><div className="text-[10px] text-muted-foreground">Traffic</div><div className="text-sm font-bold">{fmt(visits)}</div></div>
              <div><div className="text-[10px] text-muted-foreground">Keywords</div><div className="text-sm font-bold">{fmt(orgKws)}</div></div>
              <div><div className="text-[10px] text-muted-foreground">Gaps</div><div className="text-sm font-bold text-indigo-400">{comp.keywords.length}</div></div>
            </div>
            <button onClick={refresh} disabled={pending || !isPaid}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${pending ? "border-violet-500/20 text-violet-300 cursor-wait" : isPaid ? "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10" : "border-border text-muted-foreground cursor-not-allowed"}`}>
              {pending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Refreshing…</> : <><RefreshCw className="w-3.5 h-3.5" />Refresh</>}
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <ActionStatusBar state={actionState} onDismiss={() => setActionState({ type: "idle" })} />

        <div className="flex border-b border-border">
          {([
            { id: "keywords" as DetailTab, icon: TrendingUp, label: `Keyword Gaps (${comp.keywords.length})` },
            { id: "topics" as DetailTab, icon: Layers, label: `Topic Clusters (${clusters.length})` },
            { id: "pages" as DetailTab, icon: FileText, label: `Top Pages (${topPages.length})` },
            { id: "backlinks" as DetailTab, icon: Link2, label: "Backlink Gap" },
          ]).map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => handleTabChange(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === id ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "keywords" && (
            comp.keywords.length === 0
              ? <p className="text-xs text-muted-foreground py-4 text-center">Click <strong>Refresh</strong> to fetch keyword gaps.</p>
              : <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                  {comp.keywords.map(kw => (
                    <div key={kw.id} className="flex items-center justify-between px-2.5 py-2 bg-muted/50 rounded-lg text-xs gap-2">
                      <span className="truncate font-medium flex-1">{kw.keyword}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground w-8 text-right">#{kw.position}</span>
                        <span className="text-blue-400 w-10 text-right">{fmt(kw.searchVolume)}</span>
                        <KdBadge score={kw.difficulty} />
                      </div>
                    </div>
                  ))}
                </div>
          )}

          {tab === "topics" && (
            clusters.length === 0
              ? <p className="text-xs text-muted-foreground py-4 text-center">Refresh keyword gaps to see topic clusters.</p>
              : <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {clusters.map(cl => (
                    <div key={cl.topic}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold capitalize">{cl.topic}</span>
                        <span className="text-xs text-muted-foreground">{cl.keywords.length} kw · {fmt(cl.vol)} vol</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.round((cl.vol / maxVol) * 100)}%` }} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {cl.keywords.slice(0, 3).map(kw => (
                          <span key={kw.id} className="text-xs px-1.5 py-0.5 bg-muted rounded-md text-muted-foreground truncate max-w-[160px]">{kw.keyword}</span>
                        ))}
                        {cl.keywords.length > 3 && <span className="text-xs text-muted-foreground">+{cl.keywords.length - 3} more</span>}
                      </div>
                    </div>
                  ))}
                </div>
          )}

          {tab === "pages" && (
            topPages.length === 0
              ? <p className="text-xs text-muted-foreground py-4 text-center">Top pages loaded on Refresh.</p>
              : <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                  {topPages.slice(0, 15).map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-2.5 py-2 bg-muted/50 rounded-lg text-xs gap-2">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="truncate text-blue-400 hover:underline flex-1">
                        {p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                      </a>
                      <span className="text-amber-400 shrink-0 font-semibold">{fmt(p.traffic)}</span>
                    </div>
                  ))}
                </div>
          )}

          {tab === "backlinks" && (
            <div>
              {gapLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-xs">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />Fetching backlink data…
                </div>
              )}
              {gapError && !gapLoading && (
                <div className="text-xs text-rose-400 py-4 text-center">
                  {gapError}
                  {!isPaid && <a href="/dashboard/billing" className="ml-2 underline text-violet-400">Upgrade</a>}
                </div>
              )}
              {!gapLoading && !gapError && !gapReport && !isPaid && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Lock className="w-6 h-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Backlink gap analysis is a paid feature.</p>
                  <a href="/dashboard/billing" className="text-xs px-3 py-1.5 bg-violet-500 text-white rounded-lg font-semibold hover:bg-violet-600">Upgrade to unlock</a>
                </div>
              )}
              {gapReport && !gapLoading && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Domain Rating", yours: gapReport.you.domainRating, theirs: gapReport.competitor.domainRating, delta: gapReport.gap.domainRating },
                      { label: "Referring Domains", yours: gapReport.you.referringDomains, theirs: gapReport.competitor.referringDomains, delta: gapReport.gap.referringDomains },
                      { label: "Total Backlinks", yours: 0, theirs: 0, delta: gapReport.gap.totalBacklinks },
                    ].map(({ label, yours, theirs, delta }) => (
                      <div key={label} className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-xs text-muted-foreground mb-1">{label}</div>
                        <div className="flex items-end justify-between gap-1">
                          <div><div className="text-xs text-muted-foreground">You</div><div className="text-sm font-bold">{fmt(yours)}</div></div>
                          <div className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${delta > 0 ? "bg-rose-500/10 text-rose-400" : delta < 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                            {delta > 0 ? `+${fmt(delta)}` : fmt(delta)}
                          </div>
                          <div><div className="text-xs text-muted-foreground">Them</div><div className="text-sm font-bold">{fmt(theirs)}</div></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <ArrowUpRight className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {gapReport.gap.opportunityDomains.length} link-building opportunities
                      </span>
                    </div>
                    {gapReport.gap.opportunityDomains.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No gap domains found — you may already have all their referring domains!</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {gapReport.gap.opportunityDomains.map((domain, i) => (
                          <div key={domain} className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 rounded-lg text-xs">
                            <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                            <span className="font-medium flex-1 truncate">{domain}</span>
                            <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 shrink-0">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button onClick={onDelete} className="flex items-center gap-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />Remove competitor
          </button>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function RowContextMenu({ comp, siteId, isPaid, onAnalyze, onRefresh, onDelete }: {
  comp: Competitor; siteId: string; isPaid: boolean;
  onAnalyze: () => void; onRefresh: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pending, go] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleRefresh = () => {
    if (!isPaid) { toast.error("Upgrade to refresh."); return; }
    setOpen(false);
    go(async () => {
      const r = await refreshCompetitorKeywords(siteId, comp.id);
      if (r.success) { toast.success(`Updated ${r.count ?? 0} keyword gaps`); onRefresh(); router.refresh(); }
      else toast.error(r.error ?? "Failed.");
    });
  };

  const handleDelete = () => {
    if (!confirm(`Remove ${comp.domain}?`)) return;
    setOpen(false);
    go(async () => {
      const r = await deleteCompetitor(siteId, comp.id);
      if (r.success) { toast.success(`${comp.domain} removed.`); onDelete(); }
      else toast.error(r.error ?? "Failed.");
    });
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} disabled={pending} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">
        {pending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <a href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Eye className="h-3.5 w-3.5" /> View competitor
          </a>
          <button onClick={handleRefresh} disabled={!isPaid} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh data
          </button>
          <button onClick={() => { setOpen(false); onAnalyze(); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-blue-400 transition-colors hover:bg-accent">
            <TrendingUp className="h-3.5 w-3.5" /> Re-run keyword analysis
          </button>
          <button onClick={handleDelete} className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-xs font-medium text-rose-400 transition-colors hover:bg-accent">
            <Trash2 className="h-3.5 w-3.5" /> Remove competitor
          </button>
        </div>
      )}
    </div>
  );
}

function AddCompetitorModal({ siteId, existingCount, onAdded, onClose }: {
  siteId: string; existingCount: number;
  onAdded: (c: Competitor) => void; onClose: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [pending, go] = useTransition();
  const maxReached = existingCount >= 12;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || maxReached) return;
    go(async () => {
      const r = await addCompetitor(siteId, domain.trim());
      if (r.success && r.competitor) {
        toast.success(`${domain} added.`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onAdded({ ...r.competitor, keywords: [], snapshots: [], metadata: null } as any);
        onClose();
      } else toast.error(r.error ?? "Failed.");
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Add competitor">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-bold text-foreground">Add competitor</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{existingCount}/12 slots used</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Competitor domain</label>
            <input
              type="text" value={domain} onChange={e => setDomain(e.target.value)}
              placeholder="e.g. semrush.com" autoFocus disabled={maxReached || pending}
              className="mt-1.5 w-full px-3 py-2.5 text-sm bg-card border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-brand placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
          {maxReached && <p className="text-xs text-amber-400">Maximum 12 competitors reached. Remove one to add another.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-muted-foreground rounded-lg hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={!domain.trim() || maxReached || pending}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white text-xs font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40">
              {pending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Add competitor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const DETECT_STEPS = [
  { icon: Search, label: "Scraping site pages for services…" },
  { icon: Globe, label: "Searching SERPs for service-matched sites…" },
  { icon: Sparkles, label: "AI verifying direct competitors…" },
  { icon: CheckCircle2, label: "Saving verified competitors…" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "gaps", label: "Keyword gaps" },
  { key: "traffic", label: "Traffic" },
  { key: "keywords", label: "Organic keywords" },
  { key: "newest", label: "Newest first" },
  { key: "alpha", label: "Alphabetical" },
];

export function CompetitorsDashboard({ sites, activeSiteId, activeSiteDomain, competitors: init, isPaid, tier }: Props) {
  const router = useRouter();
  const [competitors, setCompetitors] = useState<Competitor[]>(init);
  const [detecting, setDetecting] = useState(false);
  const [detectStep, setDetectStep] = useState(0);
  const [, startDetect] = useTransition();

  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("gaps");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [page, setPage] = useState(0);
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailComp, setDetailComp] = useState<Competitor | null>(null);
  const [globalAction, setGlobalAction] = useState<ActionState>({ type: "idle" });
  const sortRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSort) return;
    const h = (e: MouseEvent) => { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSort(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showSort]);

  useEffect(() => {
    if (!showFilter) return;
    const h = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilter(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showFilter]);

  useEffect(() => {
    if (!detecting) { setDetectStep(0); return; }
    const timings = [0, 8000, 22000, 38000];
    const timers = timings.map((delay, i) => setTimeout(() => setDetectStep(i), delay));
    return () => timers.forEach(clearTimeout);
  }, [detecting]);

  const totalGaps = competitors.reduce((s, c) => s + c.keywords.length, 0);
  const totalVisits = competitors.reduce((s, c) => s + ((c.metadata?.estimatedMonthlyVisits as number) ?? 0), 0);
  const totalOrgKws = competitors.reduce((s, c) => s + ((c.metadata?.organicKeywords as number) ?? 0), 0);

  const biggestOpportunity = useMemo(() =>
    [...competitors].sort((a, b) => b.keywords.length - a.keywords.length)[0] ?? null
  , [competitors]);

  const fastestGrowing = useMemo(() => {
    const withDelta = competitors
      .filter(c => c.snapshots.length >= 2)
      .map(c => ({ comp: c, ...getTrafficDelta(c.snapshots) }))
      .filter(c => c.direction === "up")
      .sort((a, b) => b.pct - a.pct);
    return withDelta[0] ?? null;
  }, [competitors]);

  const handleAutoDetect = async () => {
    if (!activeSiteId) return;
    if (!isPaid) { toast.error("Auto-detect requires a paid plan."); return; }
    setDetecting(true);
    try {
      const res = await autoDetectAndSaveCompetitors(activeSiteId);
      if (res.success) {
        if (res.added.length > 0) {
          toast.success(`Added ${res.added.length} verified competitor${res.added.length !== 1 ? "s" : ""}: ${res.added.slice(0, 3).join(", ")}${res.added.length > 3 ? "…" : ""}`);
          router.refresh();
        } else {
          toast.info("No new competitors found — your niche may be very specialised.");
        }
        if (res.warnings?.length) res.warnings.forEach(w => toast.info(w, { duration: 4000 }));
      } else {
        toast.error(res.error ?? "Auto-detection failed.");
      }
    } finally {
      setDetecting(false);
    }
  };

  const handleRefreshAll = async () => {
    if (!activeSiteId || !isPaid) { toast.error("Upgrade to refresh."); return; }
    setGlobalAction({ type: "loading", message: "Refreshing all competitors…" });
    let ok = 0;
    let fail = 0;
    for (const comp of competitors) {
      try {
        const r = await refreshCompetitorKeywords(activeSiteId, comp.id);
        if (r.success) ok++; else fail++;
      } catch { fail++; }
    }
    if (fail === 0) {
      setGlobalAction({ type: "success", message: `Refreshed all ${ok} competitors.` });
    } else {
      setGlobalAction({ type: "error", message: `Refreshed ${ok}, failed ${fail}.` });
    }
    router.refresh();
  };

  const handleReset = async () => {
    if (!activeSiteId) return;
    if (!isPaid) { toast.error("Requires a paid plan."); return; }
    if (!confirm(`Delete all ${competitors.length} current competitors and re-scan? This cannot be undone.`)) return;
    setDetecting(true);
    try {
      const res = await clearAndRedetectCompetitors(activeSiteId);
      if (res.success) {
        toast.success(`Cleared ${res.cleared} stale. Added ${res.added.length} verified: ${res.added.slice(0, 3).join(", ")}${res.added.length > 3 ? "…" : ""}`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Reset failed.");
      }
    } finally {
      setDetecting(false);
    }
  };

  const filtered = useMemo(() => {
    let result = [...competitors];

    if (filterKey !== "all") {
      result = result.filter(c => getTrend(c) === filterKey);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.domain.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      const metaA = a.metadata as Record<string, unknown> | null;
      const metaB = b.metadata as Record<string, unknown> | null;
      switch (sortKey) {
        case "gaps": return b.keywords.length - a.keywords.length;
        case "traffic": return ((metaB?.estimatedMonthlyVisits as number) ?? 0) - ((metaA?.estimatedMonthlyVisits as number) ?? 0);
        case "keywords": return ((metaB?.organicKeywords as number) ?? 0) - ((metaA?.organicKeywords as number) ?? 0);
        case "newest": return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
        case "alpha": return a.domain.localeCompare(b.domain);
        default: return 0;
      }
    });

    return result;
  }, [competitors, filterKey, searchQuery, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [filterKey, searchQuery, sortKey]);

  const newThisMonth = useMemo(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    return competitors.filter(c => new Date(c.addedAt) >= start).length;
  }, [competitors]);

  const discoveredGaps = useMemo(() => {
    return competitors.reduce((sum, c) => {
      const profileUpdated = (c.metadata as Record<string, unknown> | null)?.profileUpdatedAt as string | null;
      if (!profileUpdated) return sum;
      const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
      if (new Date(profileUpdated) >= start) return sum + c.keywords.length;
      return sum;
    }, 0);
  }, [competitors]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-7">

      {detecting && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.82)", backdropFilter: "blur(4px)" }}
          aria-modal="true" role="dialog" aria-label="AI competitor detection in progress">
          <div className="w-full max-w-sm mx-4 rounded-2xl shadow-2xl p-6 flex flex-col gap-5"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)" }}>
                <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
              </div>
              <div>
                <p className="font-semibold text-sm">AI Competitor Detection</p>
                <p className="text-xs text-muted-foreground">This takes 20–60 seconds — please don&apos;t close this tab</p>
              </div>
            </div>
            <div className="space-y-2">
              {DETECT_STEPS.map((step, i) => {
                const isDone = i < detectStep;
                const isActive = i === detectStep;
                const StepIcon = step.icon;
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-500"
                    style={{
                      background: isActive ? "rgba(139,92,246,0.10)" : "transparent",
                      border: isActive ? "1px solid rgba(139,92,246,0.25)" : "1px solid transparent",
                      opacity: isDone ? 0.45 : i > detectStep ? 0.28 : 1,
                    }}>
                    <span className="w-6 flex items-center justify-center shrink-0">
                      {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <StepIcon className={`w-4 h-4 ${isActive ? "text-violet-400" : "text-muted-foreground"}`} />}
                    </span>
                    <span className={`text-xs font-medium flex-1 ${isActive ? "text-violet-300" : isDone ? "text-muted-foreground line-through" : "text-muted-foreground"}`}>
                      {step.label}
                    </span>
                    {isActive && <RefreshCw className="w-3 h-3 text-violet-400 animate-spin shrink-0" />}
                  </div>
                );
              })}
            </div>
            <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
              <div className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${Math.max(5, Math.round((detectStep / (DETECT_STEPS.length - 1)) * 100))}%`, background: "linear-gradient(90deg, #8b5cf6, #a78bfa)" }} />
            </div>
          </div>
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[1fr_auto] xl:items-start">
        <div className="flex min-h-[140px] flex-col justify-between rounded-2xl border border-border bg-card/40 p-6 shadow-sm">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10">
                <Crosshair className="h-4 w-4 text-indigo-400" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Competitor intelligence
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Competitors</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Track your search competitors, discover keyword gaps, and monitor market movement.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {competitors.length > 0 && (
              <button onClick={handleRefreshAll} disabled={!isPaid || detecting}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground disabled:opacity-40">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh all
              </button>
            )}
            <button onClick={handleAutoDetect} disabled={detecting || !isPaid || competitors.length >= 12}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
                isPaid
                  ? "bg-violet-500 text-white hover:bg-violet-600 shadow-sm shadow-violet-500/20"
                  : "border border-border bg-muted text-muted-foreground cursor-not-allowed"
              } disabled:opacity-50`}>
              {detecting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : isPaid ? <Sparkles className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              Auto-detect competitors
            </button>
            {activeSiteId && (
              <button onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 shadow-sm shadow-brand/20">
                <Plus className="h-3.5 w-3.5" /> Add competitor
              </button>
            )}
          </div>
        </div>

        {sites.length > 1 && (
          <select value={activeSiteId ?? ""} onChange={e => router.push(`/dashboard/competitors?siteId=${e.target.value}`)}
            className="mt-1 text-sm px-3 py-2 bg-card border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-brand">
            {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
          </select>
        )}
      </section>

      {competitors.length > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {[
            {
              icon: Crosshair, label: "Competitors", color: "indigo",
              value: `${competitors.length} / 12`,
              sub: newThisMonth > 0 ? `+${newThisMonth} this month` : "Tracked competitors",
              sparkData: null,
            },
            {
              icon: Target, label: "Keyword opportunities", color: "blue",
              value: fmt(totalGaps),
              sub: discoveredGaps > 0 ? `+${discoveredGaps} discovered` : "Missing keywords you can rank for",
              sparkData: null,
            },
            {
              icon: Globe, label: "Competitor traffic", color: "amber",
              value: fmt(totalVisits),
              sub: "Estimated monthly visits (top competitors)",
              sparkData: null,
            },
          ].map(stat => {
            const iconColors: Record<string, { icon: string; value: string; bg: string }> = {
              indigo: { icon: "text-indigo-400", value: "text-indigo-300", bg: "bg-indigo-500/10 border-indigo-500/20" },
              blue: { icon: "text-blue-400", value: "text-blue-300", bg: "bg-blue-500/10 border-blue-500/20" },
              amber: { icon: "text-amber-400", value: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/20" },
            };
            const tone = iconColors[stat.color];
            const Icon = stat.icon;
            return (
              <div key={stat.label} className={`rounded-2xl border p-4 shadow-sm ${tone.bg}`}>
                <div className="flex items-center gap-1.5 mb-3">
                  <Icon className={`w-3.5 h-3.5 ${tone.icon}`} />
                  <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
                </div>
                <p className={`text-2xl font-bold tracking-tight ${tone.value}`}>{stat.value}</p>
                <p className="mt-1 text-[11px] text-muted-foreground truncate">{stat.sub}</p>
              </div>
            );
          })}
        </section>
      )}

      {competitors.length >= 2 && (biggestOpportunity || fastestGrowing) && (
        <section className="rounded-2xl border border-purple-500/20 bg-gradient-to-r from-purple-500/[0.08] via-indigo-500/[0.04] to-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300">
                <Sparkles className="h-4 w-4" />
              </div>
              <p className="text-sm font-semibold text-foreground">Competitive Insights</p>
            </div>
            <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
              AI Analysis
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {biggestOpportunity && biggestOpportunity.keywords.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-amber-400">🏆</span>
                  <span className="text-xs font-semibold text-foreground">Biggest opportunity</span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  <span className="font-semibold text-foreground">{biggestOpportunity.domain}</span> ranks for{" "}
                  <span className="font-semibold text-indigo-400">{biggestOpportunity.keywords.length}</span> high-value keywords you don&apos;t rank for.
                </p>
                <button onClick={() => setDetailComp(biggestOpportunity)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                  Explore gaps <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            )}
            {fastestGrowing && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-emerald-400">📈</span>
                  <span className="text-xs font-semibold text-foreground">Fastest growing competitor</span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  <span className="font-semibold text-foreground">{fastestGrowing.comp.domain}</span> gained{" "}
                  <span className="font-semibold text-emerald-400">+{fastestGrowing.pct}%</span> organic visibility this month.
                </p>
                <button onClick={() => setDetailComp(fastestGrowing.comp)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                  View details <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-blue-400">💡</span>
                <span className="text-xs font-semibold text-foreground">Recommended action</span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Analyze <span className="font-semibold text-indigo-400">{totalGaps}</span> high-value keyword gaps to increase your organic traffic.
              </p>
              <button onClick={() => { if (biggestOpportunity) setDetailComp(biggestOpportunity); }} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                Go to keyword opportunities <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </section>
      )}

      <ActionStatusBar state={globalAction} onDismiss={() => setGlobalAction({ type: "idle" })} />

      {competitors.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-indigo-500/10 bg-indigo-500/10">
            <Search className="h-7 w-7 text-indigo-400/60" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">No competitors tracked yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Add a domain manually, or use <strong>Auto-detect</strong> to let AI find who&apos;s outranking you.
          </p>
          {!isPaid && (
            <a href="/dashboard/billing" className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-brand text-white text-sm font-semibold rounded-xl hover:opacity-90">
              <Zap className="w-3.5 h-3.5" />Upgrade to unlock Auto-detect
            </a>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card/40 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search competitors…"
                  className="h-8 w-48 rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div ref={sortRef} className="relative">
                <button onClick={() => setShowSort(!showSort)} className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sort by: {SORT_OPTIONS.find(s => s.key === sortKey)?.label}</span>
                </button>
                {showSort && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                    {SORT_OPTIONS.map(opt => (
                      <button key={opt.key} onClick={() => { setSortKey(opt.key); setShowSort(false); }}
                        className={`flex w-full px-3 py-2 text-xs font-medium transition-colors hover:bg-accent ${sortKey === opt.key ? "text-foreground" : "text-muted-foreground"}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div ref={filterRef} className="relative">
                <button onClick={() => setShowFilter(!showFilter)} className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  <span className="hidden sm:inline">Filter: {filterKey === "all" ? "All" : filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showFilter && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                    {(["all", "growing", "stable", "declining"] as FilterKey[]).map(fk => (
                      <button key={fk} onClick={() => { setFilterKey(fk); setShowFilter(false); }}
                        className={`flex w-full px-3 py-2 text-xs font-medium transition-colors hover:bg-accent ${filterKey === fk ? "text-foreground" : "text-muted-foreground"}`}>
                        {fk === "all" ? "All" : fk.charAt(0).toUpperCase() + fk.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <span className="text-xs text-muted-foreground">{filtered.length} competitor{filtered.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="border-b border-border bg-card/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Competitor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Organic traffic/mo</th>
                  <th className="px-4 py-3 font-medium">Organic keywords</th>
                  <th className="px-4 py-3 font-medium">Keyword gaps</th>
                  <th className="px-4 py-3 font-medium">Last updated</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.length > 0 ? paged.map(comp => {
                  const meta = comp.metadata as Record<string, unknown> | null;
                  const visits = meta?.estimatedMonthlyVisits as number | null;
                  const orgKws = meta?.organicKeywords as number | null;
                  const trend = getTrend(comp);
                  const tDelta = getTrafficDelta(comp.snapshots);
                  const kDelta = getKeywordDelta(comp.snapshots);
                  const lastUpdated = (meta?.profileUpdatedAt as string | null) ?? (typeof comp.addedAt === "string" ? comp.addedAt : new Date(comp.addedAt).toISOString());

                  return (
                    <tr key={comp.id} className="group transition-colors hover:bg-card/80">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <Favicon domain={comp.domain} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate max-w-[180px]">{comp.domain}</span>
                              <a href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-blue-400 transition-colors">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                            {Array.isArray(meta?.topContentPillars) && (meta.topContentPillars as string[]).length > 0 && (
                              <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                                {(meta.topContentPillars as string[]).slice(0, 2).join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5"><TrendBadge trend={trend} pct={tDelta.pct} /></td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold">{fmt(visits)}</span>
                          {tDelta.pct !== 0 && (
                            <span className={`text-[11px] font-semibold ${tDelta.direction === "up" ? "text-emerald-400" : tDelta.direction === "down" ? "text-rose-400" : "text-muted-foreground"}`}>
                              {tDelta.pct > 0 ? "+" : ""}{tDelta.pct}%
                            </span>
                          )}
                          <MiniSparkline snapshots={comp.snapshots} color={tDelta.direction === "up" ? "#34d399" : tDelta.direction === "down" ? "#f87171" : "#71717a"} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{fmt(orgKws)}</span>
                          {kDelta.pct !== 0 && (
                            <span className={`text-[11px] font-semibold ${kDelta.direction === "up" ? "text-emerald-400" : kDelta.direction === "down" ? "text-rose-400" : "text-muted-foreground"}`}>
                              {kDelta.pct > 0 ? "+" : ""}{kDelta.pct}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5"><KeywordGapBadge count={comp.keywords.length} /></td>
                      <td className="px-4 py-3.5 text-muted-foreground text-xs">{timeAgo(lastUpdated)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => setDetailComp(comp)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20">
                            <BarChart3 className="h-3.5 w-3.5" /> Analyze
                          </button>
                          <RowContextMenu
                            comp={comp} siteId={activeSiteId!} isPaid={isPaid}
                            onAnalyze={() => setDetailComp(comp)}
                            onRefresh={() => router.refresh()}
                            onDelete={() => setCompetitors(p => p.filter(c => c.id !== comp.id))}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                      <p className="font-medium text-muted-foreground">No competitors match this filter</p>
                      <p className="mt-1 text-xs text-muted-foreground">Try a different filter or clear your search.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-border">
            {paged.length > 0 ? paged.map(comp => {
              const meta = comp.metadata as Record<string, unknown> | null;
              const visits = meta?.estimatedMonthlyVisits as number | null;
              const trend = getTrend(comp);
              const tDelta = getTrafficDelta(comp.snapshots);
              return (
                <div key={comp.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Favicon domain={comp.domain} />
                      <div className="min-w-0">
                        <span className="text-sm font-medium truncate block">{comp.domain}</span>
                        <TrendBadge trend={trend} pct={tDelta.pct} />
                      </div>
                    </div>
                    <KeywordGapBadge count={comp.keywords.length} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Traffic: <span className="font-semibold text-foreground">{fmt(visits)}</span></span>
                    <span>KW Gaps: <span className="font-semibold text-indigo-400">{comp.keywords.length}</span></span>
                  </div>
                  <button onClick={() => setDetailComp(comp)}
                    className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20">
                    Analyze
                  </button>
                </div>
              );
            }) : (
              <div className="px-6 py-16 text-center">
                <p className="font-medium text-muted-foreground">No competitors match</p>
              </div>
            )}
          </div>

          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button key={i} onClick={() => setPage(i)}
                    className={`h-7 w-7 rounded-lg text-xs font-semibold transition-colors ${i === safePage ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                    {i + 1}
                  </button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!isPaid && competitors.length > 0 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-violet-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />Unlock full competitor intelligence
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Auto-refresh weekly · AI-detected competitors · Keyword gap alerts · Backlink gap analysis
            </p>
          </div>
          <a href="/dashboard/billing" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-600">
            <Zap className="h-3.5 w-3.5" />Upgrade to {tier === "FREE" ? "Starter" : "Pro"}
          </a>
        </div>
      )}

      {showAddModal && activeSiteId && (
        <AddCompetitorModal
          siteId={activeSiteId}
          existingCount={competitors.length}
          onAdded={c => setCompetitors(p => [c, ...p])}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {detailComp && activeSiteId && (
        <CompDetailModal
          comp={detailComp}
          siteId={activeSiteId}
          isPaid={isPaid}
          onClose={() => setDetailComp(null)}
          onRefresh={() => router.refresh()}
          onDelete={() => {
            setCompetitors(p => p.filter(c => c.id !== detailComp.id));
            setDetailComp(null);
          }}
        />
      )}
    </div>
  );
}
