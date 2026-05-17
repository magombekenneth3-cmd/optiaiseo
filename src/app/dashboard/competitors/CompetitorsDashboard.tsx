"use client";

import { useState, useTransition, useEffect } from "react";
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
  CheckCircle2, AlertCircle, X,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip as RTooltip } from "recharts";


type Snapshot = { month: string; traffic: number; organicKeywords: number | null };
type KW = { id: string; keyword: string; position: number; searchVolume: number; difficulty: number | null; clicks: number | null; dataSource: string | null };
type Competitor = { id: string; domain: string; addedAt: string | Date; metadata: Record<string, unknown> | null; keywords: KW[]; snapshots: Snapshot[] };
type Site = { id: string; domain: string };
type GapReport = { gap: { referringDomains: number; domainRating: number; totalBacklinks: number; opportunityDomains: string[] }; you: { domainRating: number; referringDomains: number }; competitor: { domainRating: number; referringDomains: number } };
interface Props { sites: Site[]; activeSiteId: string | null; activeSiteDomain: string | null; competitors: Competitor[]; isPaid: boolean; tier: string }


function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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


function Sparkline({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length < 2) return <span className="text-xs text-muted-foreground italic">No trend yet</span>;
  const sorted = [...snapshots].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const data = sorted.map(s => ({ m: new Date(s.month).toLocaleDateString("en", { month: "short" }), v: s.traffic }));
  const growing = data[data.length - 1].v >= data[0].v;
  return (
    <div className="flex items-center gap-2">
      <ResponsiveContainer width={80} height={28}>
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke={growing ? "#34d399" : "#f87171"} strokeWidth={1.5} dot={false} />
          <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px", padding: "4px 8px" }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={((v: number) => [fmt(v), "Traffic"]) as any} labelFormatter={l => String(l)} />
        </LineChart>
      </ResponsiveContainer>
      <span className={`text-xs font-semibold ${growing ? "text-emerald-400" : "text-rose-400"}`}>
        {growing ? "↑" : "↓"} {fmt(data[data.length - 1].v)}
      </span>
    </div>
  );
}


type Cluster = { topic: string; keywords: KW[]; vol: number };

function buildClusters(keywords: KW[]): Cluster[] {
  const map = new Map<string, KW[]>();
  for (const kw of keywords) {
    const words = kw.keyword.toLowerCase().split(/\s+/);
    const key = words.slice(0, Math.min(2, words.length)).join(" ");
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
    loading: {
      bg: "bg-violet-500/10 border-violet-500/20",
      text: "text-violet-300",
      icon: <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />,
    },
    success: {
      bg: "bg-emerald-500/10 border-emerald-500/20",
      text: "text-emerald-400",
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
    },
    error: {
      bg: "bg-rose-500/10 border-rose-500/20",
      text: "text-rose-400",
      icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" />,
    },
  };

  const cfg = configs[state.type as keyof typeof configs];

  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 border-t ${cfg.bg} ${cfg.text} text-xs font-medium`}>
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


type Tab = "keywords" | "topics" | "pages" | "backlinks";

function CompCard({ comp, siteId, isPaid, onDeleted }: { comp: Competitor; siteId: string; isPaid: boolean; onDeleted: (id: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("keywords");
  const [pending, go] = useTransition();
  const [actionState, setActionState] = useState<ActionState>({ type: "idle" });
  const [gapReport, setGapReport] = useState<GapReport | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);
  const meta = comp.metadata as Record<string, unknown> | null;
  const visits = meta?.estimatedMonthlyVisits as number | null ?? null;
  const orgKws = meta?.organicKeywords as number | null ?? null;
  const trend = meta?.growthTrend as string | null ?? null;
  const topPages = (meta?.topPages as { url: string; traffic: number }[] | null) ?? [];
  const clusters = buildClusters(comp.keywords);
  const maxVol = clusters.length ? Math.max(...clusters.map(c => c.vol)) : 1;

  const del = () => {
    if (!confirm(`Remove ${comp.domain}?`)) return;
    go(async () => {
      const r = await deleteCompetitor(siteId, comp.id);
      if (r.success) { toast.success(`${comp.domain} removed.`); onDeleted(comp.id); }
      else toast.error(r.error ?? "Failed.");
    });
  };

  const refresh = () => {
    if (!isPaid) { toast.error("Upgrade to refresh."); return; }
    go(async () => {
      setActionState({ type: "loading", message: `Refreshing ${comp.domain} — fetching keyword gaps…` });
      const r = await refreshCompetitorKeywords(siteId, comp.id);
      if (r.success) {
        setActionState({ type: "success", message: `Updated ${r.count ?? 0} keyword gaps for ${comp.domain}` });
        router.refresh();
      } else {
        setActionState({ type: "error", message: r.error ?? "Refresh failed — please try again." });
        toast.error(r.error ?? "Failed.");
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

  // Auto-load when backlinks tab is selected
  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === "backlinks") loadGap();
  };

  const trendColor = trend === "growing" ? "text-emerald-400" : trend === "declining" ? "text-rose-400" : "text-muted-foreground";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Row */}
      <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Domain + trend */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Favicon domain={comp.domain} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">{comp.domain}</span>
              <a href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer"
                className="text-muted-foreground hover:text-blue-400 shrink-0 transition-colors">
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {trend && (
              <span className={`text-xs font-medium ${trendColor}`}>
                {trend === "growing" ? "↑" : trend === "declining" ? "↓" : "→"} {trend}
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 shrink-0 flex-wrap">
          {comp.snapshots.length >= 2 && (
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Traffic trend</div>
              <Sparkline snapshots={comp.snapshots} />
            </div>
          )}
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Visits/mo</div>
            <div className="text-sm font-bold">{fmt(visits)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Organic KWs</div>
            <div className="text-sm font-bold">{fmt(orgKws)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">KW gaps</div>
            <div className="text-sm font-bold text-indigo-400">{comp.keywords.length}</div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={refresh}
            disabled={pending || !isPaid}
            title={!isPaid ? "Upgrade to refresh competitor data" : `Refresh keyword gaps for ${comp.domain}`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors
              ${
                pending
                  ? "bg-violet-500/10 border-violet-500/20 text-violet-300 cursor-wait"
                  : isPaid
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-muted border-border text-muted-foreground cursor-not-allowed"
              } disabled:opacity-60`}
          >
            {pending
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>Refreshing…</span></>
              : !isPaid
              ? <><Lock className="w-3.5 h-3.5" /><span className="hidden sm:inline">Refresh</span></>
              : <><RefreshCw className="w-3.5 h-3.5" /><span>Refresh</span></>}
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={del}
            disabled={pending}
            title={`Remove ${comp.domain}`}
            className="p-1.5 rounded-lg border border-transparent text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Inline action status bar */}
      <ActionStatusBar state={actionState} onDismiss={() => setActionState({ type: "idle" })} />

      {/* Expanded */}
      {open && (
        <div className="border-t border-border">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            {([
              { id: "keywords"  as Tab, icon: TrendingUp, label: `Keyword Gaps (${comp.keywords.length})` },
              { id: "topics"    as Tab, icon: Layers,     label: `Topic Clusters (${clusters.length})` },
              { id: "pages"     as Tab, icon: FileText,   label: `Top Pages (${topPages.length})` },
              { id: "backlinks" as Tab, icon: Link2,      label: "Backlink Gap" },
            ]).map(({ id, icon: Icon, label }) => (
              <button key={id} onClick={() => handleTabChange(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === id ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* Keywords */}
            {tab === "keywords" && (
              comp.keywords.length === 0
                ? <p className="text-xs text-muted-foreground py-4 text-center">Click <strong>Refresh</strong> to fetch keyword gaps.</p>
                : <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
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

            {/* Topic clusters */}
            {tab === "topics" && (
              clusters.length === 0
                ? <p className="text-xs text-muted-foreground py-4 text-center">Refresh keyword gaps to see topic clusters.</p>
                : <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
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

            {/* Top pages */}
            {tab === "pages" && (
              topPages.length === 0
                ? <p className="text-xs text-muted-foreground py-4 text-center">Top pages loaded on Refresh.</p>
                : <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
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
            {/* Backlink gap tab */}
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
                    {!isPaid && (
                      <a href="/dashboard/billing" className="ml-2 underline text-violet-400">Upgrade</a>
                    )}
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
                    {/* Metric comparison */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Domain Rating",      yours: gapReport.you.domainRating,      theirs: gapReport.competitor.domainRating,      delta: gapReport.gap.domainRating },
                        { label: "Referring Domains",  yours: gapReport.you.referringDomains,   theirs: gapReport.competitor.referringDomains,   delta: gapReport.gap.referringDomains },
                        { label: "Total Backlinks",    yours: 0,                                theirs: 0,                                       delta: gapReport.gap.totalBacklinks },
                      ].map(({ label, yours, theirs, delta }) => (
                        <div key={label} className="p-3 bg-muted/50 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">{label}</div>
                          <div className="flex items-end justify-between gap-1">
                            <div>
                              <div className="text-xs text-muted-foreground">You</div>
                              <div className="text-sm font-bold">{fmt(yours)}</div>
                            </div>
                            <div className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${
                              delta > 0 ? "bg-rose-500/10 text-rose-400" : delta < 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"
                            }`}>
                              {delta > 0 ? `+${fmt(delta)}` : fmt(delta)}
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Them</div>
                              <div className="text-sm font-bold">{fmt(theirs)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Opportunity domains */}
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
                              <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 shrink-0">
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
        </div>
      )}
    </div>
  );
}


function AddForm({ siteId, onAdded, existingCount }: { siteId: string; onAdded: (c: Competitor) => void; existingCount: number }) {
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
        setDomain("");
      } else toast.error(r.error ?? "Failed.");
    });
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input type="text" value={domain} onChange={e => setDomain(e.target.value)} placeholder="e.g. semrush.com"
        disabled={maxReached || pending}
        className="flex-1 min-w-0 px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand placeholder:text-muted-foreground disabled:opacity-50" />
      <button type="submit" disabled={!domain.trim() || maxReached || pending}
        className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0">
        {pending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Add
      </button>
    </form>
  );
}


const DETECT_STEPS = [
  { icon: Search, label: "Scraping site pages for services…" },
  { icon: Globe, label: "Searching SERPs for service-matched sites…" },
  { icon: Sparkles, label: "AI verifying direct competitors…" },
  { icon: CheckCircle2, label: "Saving verified competitors…" },
];

export function CompetitorsDashboard({ sites, activeSiteId, activeSiteDomain, competitors: init, isPaid, tier }: Props) {
  const router = useRouter();
  const [competitors, setCompetitors] = useState<Competitor[]>(init);
  const [detecting, setDetecting] = useState(false);
  const [detectStep, setDetectStep] = useState(0);
  const [, startDetect] = useTransition();

  // Advance step indicator while detecting
  useEffect(() => {
    if (!detecting) { setDetectStep(0); return; }
    const timings = [0, 8000, 22000, 38000];
    const timers = timings.map((delay, i) =>
      setTimeout(() => setDetectStep(i), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [detecting]);

  const totalGaps = competitors.reduce((s, c) => s + c.keywords.length, 0);
  const totalVisits = competitors.reduce((s, c) => s + ((c.metadata?.estimatedMonthlyVisits as number) ?? 0), 0);

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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* ── Detection loading overlay ──────────────────────────────── */}
      {detecting && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.82)", backdropFilter: "blur(4px)" }}
          aria-modal="true"
          role="dialog"
          aria-label="AI competitor detection in progress"
        >
          <div className="w-full max-w-sm mx-4 rounded-2xl shadow-2xl p-6 flex flex-col gap-5"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            {/* Header */}
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

            {/* Progress steps */}
            <div className="space-y-2">
              {DETECT_STEPS.map((step, i) => {
                const isDone   = i < detectStep;
                const isActive = i === detectStep;
                const StepIcon = step.icon;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-500"
                    style={{
                      background: isActive ? "rgba(139,92,246,0.10)" : "transparent",
                      border: isActive ? "1px solid rgba(139,92,246,0.25)" : "1px solid transparent",
                      opacity: isDone ? 0.45 : i > detectStep ? 0.28 : 1,
                    }}
                  >
                    <span className="w-6 flex items-center justify-center shrink-0">
                      {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <StepIcon className={`w-4 h-4 ${isActive ? "text-violet-400" : "text-muted-foreground"}`} />}
                    </span>
                    <span className={`text-xs font-medium flex-1 ${
                      isActive ? "text-violet-300" : isDone ? "text-muted-foreground line-through" : "text-muted-foreground"
                    }`}>
                      {step.label}
                    </span>
                    {isActive && <RefreshCw className="w-3 h-3 text-violet-400 animate-spin shrink-0" />}
                  </div>
                );
              })}
            </div>

            {/* Animated progress bar */}
            <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{
                  width: `${Math.max(5, Math.round((detectStep / (DETECT_STEPS.length - 1)) * 100))}%`,
                  background: "linear-gradient(90deg, #8b5cf6, #a78bfa)",
                }}
              />
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Crosshair className="w-4 h-4 text-indigo-400" />
            </div>
            <h1 className="text-xl font-bold">Competitors</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Track keyword gaps, topic clusters, and traffic trends.</p>
        </div>
        {sites.length > 1 && (
          <select value={activeSiteId ?? ""} onChange={e => router.push(`/dashboard/competitors?siteId=${e.target.value}`)}
            className="text-sm px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand">
            {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
          </select>
        )}
      </div>

      {/* Stats bar */}
      {competitors.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Crosshair, label: "Tracked", value: competitors.length, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
            { icon: BarChart3,  label: "KW gaps", value: fmt(totalGaps),   color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
            { icon: Globe,      label: "Visits/mo", value: fmt(totalVisits), color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
          ].map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className={`p-4 rounded-xl border ${bg} flex flex-col gap-1`}>
              <div className="flex items-center gap-1.5"><Icon className={`w-3.5 h-3.5 ${color}`} /><span className="text-xs text-muted-foreground">{label}</span></div>
              <span className={`text-xl font-bold ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Add panel */}
      {activeSiteId && (
        <div className="p-4 bg-card border border-border rounded-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-muted-foreground" />Add a competitor</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeSiteDomain && <span className="text-brand font-medium">{activeSiteDomain} · </span>}
                {competitors.length}/12 used
              </p>
            </div>
            <button onClick={handleAutoDetect} disabled={detecting || !isPaid || competitors.length >= 12}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors shrink-0 ${isPaid ? "bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20" : "bg-muted border-border text-muted-foreground cursor-not-allowed"} disabled:opacity-50`}>
              {detecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : isPaid ? <Sparkles className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {detecting ? "Detecting…" : "Auto-detect services"}
            </button>
            {competitors.length > 0 && (
              <button onClick={handleReset} disabled={detecting || !isPaid}
                title="Delete current competitors and re-detect service-matched ones"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors shrink-0 bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20 disabled:opacity-50">
                <RefreshCw className="w-3.5 h-3.5" />
                Reset &amp; Re-detect
              </button>
            )}
          </div>
          {competitors.length < 12
            ? <AddForm siteId={activeSiteId} onAdded={c => setCompetitors(p => [c, ...p])} existingCount={competitors.length} />
            : <p className="text-xs text-muted-foreground border border-border rounded-lg px-3 py-2">Max 12 competitors. Remove one to add another.</p>
          }
        </div>
      )}

      {/* List */}
      {competitors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl gap-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Search className="w-8 h-8 text-indigo-400/60" />
          </div>
          <div>
            <p className="font-semibold text-base">No competitors tracked yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">Add a domain above, or use <strong>Auto-detect</strong> to let AI find who&apos;s outranking you.</p>
          </div>
          {!isPaid && (
            <a href="/dashboard/billing" className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:opacity-90">
              <Zap className="w-3.5 h-3.5" />Upgrade to unlock Auto-detect
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{competitors.length} competitor{competitors.length !== 1 ? "s" : ""} tracked</h2>
          {competitors.map(comp => (
            <CompCard key={comp.id} comp={comp} siteId={activeSiteId!} isPaid={isPaid}
              onDeleted={id => setCompetitors(p => p.filter(c => c.id !== id))} />
          ))}
        </div>
      )}

      {/* Upgrade CTA */}
      {!isPaid && (
        <div className="p-5 rounded-xl border border-violet-500/20 bg-violet-500/5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="font-semibold text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-400" />Unlock full competitor intelligence</p>
            <p className="text-xs text-muted-foreground mt-1">Auto-refresh weekly · AI-detected competitors · Keyword gap alerts</p>
          </div>
          <a href="/dashboard/billing" className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-violet-500 text-white text-sm font-bold rounded-lg hover:bg-violet-600 transition-colors">
            <Zap className="w-3.5 h-3.5" />Upgrade to {tier === "FREE" ? "Starter" : "Pro"}
          </a>
        </div>
      )}
    </div>
  );
}
