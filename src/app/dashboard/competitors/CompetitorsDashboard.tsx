"use client";

import { useState, useTransition, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addCompetitor, deleteCompetitor, refreshCompetitorKeywords,
  autoDetectAndSaveCompetitors, clearAndRedetectCompetitors,
} from "@/app/actions/competitors";
import {
  Crosshair, Plus, Trash2, RefreshCw, ExternalLink,
  TrendingUp, Search, Lock, Globe,
  Zap, Sparkles, ArrowUpRight,
  CheckCircle2, X, MoreHorizontal, ArrowUpDown,
  ChevronLeft, ChevronRight, ArrowRight,
} from "lucide-react";
import { CompetitorMovement } from "./CompetitorMovement";
import { CompetitorOpportunities } from "./CompetitorOpportunities";
import { CompetitorDetailDrawer } from "./CompetitorDetailDrawer";

type Snapshot = { month: string; traffic: number; organicKeywords: number | null };
type KW = { id: string; keyword: string; position: number; searchVolume: number; difficulty: number | null; clicks: number | null; dataSource: string | null };
type Competitor = { id: string; domain: string; addedAt: string | Date; metadata: Record<string, unknown> | null; keywords: KW[]; snapshots: Snapshot[] };
type Site = { id: string; domain: string };
interface Props { sites: Site[]; activeSiteId: string | null; activeSiteDomain: string | null; competitors: Competitor[]; isPaid: boolean; tier: string }

type SortKey = "opportunity" | "traffic" | "keywords" | "newest" | "alpha";
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
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt="" className="w-4 h-4 rounded-sm"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

function KpiCard({ label, value, sub, icon: Icon }: {
  label: string; value: string; sub: string; icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl border border-[#21262d] bg-[#0d1117] px-4 py-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-[#8b949e]">{label}</span>
        <Icon className="w-3.5 h-3.5 text-[#30363d]" />
      </div>
      <p className="text-[26px] font-black tabular-nums leading-none text-[#e6edf3]">{value}</p>
      <p className="text-[11px] text-[#6e7681] mt-1.5">{sub}</p>
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
  { key: "opportunity", label: "Opportunity" },
  { key: "traffic", label: "Traffic" },
  { key: "keywords", label: "Keywords" },
  { key: "newest", label: "Newest first" },
  { key: "alpha", label: "Alphabetical" },
];

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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Add competitor"
    >
      <div className="w-full max-w-md rounded-xl border border-[#21262d] bg-[#0d1117] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#161b22] px-5 py-4">
          <div>
            <h3 className="font-bold text-[14px] text-[#e6edf3]">Add competitor</h3>
            <p className="mt-0.5 text-[11px] text-[#6e7681]">{existingCount}/12 slots used</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-[#6e7681] hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-[#8b949e]">Competitor domain</label>
            <input
              type="text" value={domain} onChange={e => setDomain(e.target.value)}
              placeholder="e.g. semrush.com" autoFocus disabled={maxReached || pending}
              className="mt-1.5 w-full px-3 py-2.5 text-[13px] bg-[#161b22] border border-[#30363d] rounded-lg focus:outline-none focus:border-[#388bfd] focus:ring-1 focus:ring-[#388bfd] text-[#c9d1d9] placeholder:text-[#6e7681] disabled:opacity-50"
            />
          </div>
          {maxReached && <p className="text-[11px] text-[#d29922]">Maximum 12 competitors reached. Remove one to add another.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[11px] font-semibold text-[#8b949e] rounded-lg hover:bg-[#21262d] transition-colors">Cancel</button>
            <button
              type="submit" disabled={!domain.trim() || maxReached || pending}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#388bfd] text-white text-[11px] font-bold rounded-lg hover:bg-[#58a6ff] transition-colors disabled:opacity-40"
            >
              {pending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Add competitor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RowMenu({ comp, siteId, isPaid, onRefresh, onDelete }: {
  comp: Competitor; siteId: string; isPaid: boolean;
  onRefresh: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pending, go] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
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
      <button onClick={() => setOpen(!open)} disabled={pending} className="rounded-md p-1.5 text-[#6e7681] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3] disabled:opacity-50">
        {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-xl">
          <a href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-medium text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3]">
            <ExternalLink className="h-3.5 w-3.5" /> View website
          </a>
          <button onClick={handleRefresh} disabled={!isPaid} className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-medium text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3] disabled:opacity-40">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh data
          </button>
          <button onClick={handleDelete} className="flex w-full items-center gap-2 border-t border-[#21262d] px-3 py-2 text-[11px] font-medium text-[#f85149] transition-colors hover:bg-[#21262d]">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        </div>
      )}
    </div>
  );
}

export function CompetitorsDashboard({ sites, activeSiteId, activeSiteDomain, competitors: init, isPaid, tier }: Props) {
  const router = useRouter();
  const [competitors, setCompetitors] = useState<Competitor[]>(init);
  const [detecting, setDetecting] = useState(false);
  const [detectStep, setDetectStep] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("opportunity");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [page, setPage] = useState(0);
  const [showSort, setShowSort] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [drawerComp, setDrawerComp] = useState<Competitor | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const landscapeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSort) return;
    const h = (e: MouseEvent) => { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSort(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showSort]);

  useEffect(() => {
    if (!detecting) { setDetectStep(0); return; }
    const timings = [0, 8000, 22000, 38000];
    const timers = timings.map((delay, i) => setTimeout(() => setDetectStep(i), delay));
    return () => timers.forEach(clearTimeout);
  }, [detecting]);

  const totalGapCount = useMemo(() =>
    competitors.reduce((s, c) => {
      const meta = c.metadata as Record<string, unknown> | null;
      return s + ((meta?.topKeywordGapCount as number | null) ?? c.keywords.length);
    }, 0)
  , [competitors]);

  const totalOrgKws = competitors.reduce((s, c) => s + ((c.metadata?.organicKeywords as number) ?? 0), 0);
  const totalVisits = competitors.reduce((s, c) => s + ((c.metadata?.estimatedMonthlyVisits as number) ?? 0), 0);

  const winningOpportunities = useMemo(() =>
    competitors.reduce((s, c) => s + c.keywords.filter(kw => kw.position <= 20 && kw.searchVolume >= 100).length, 0)
  , [competitors]);

  const lastUpdated = useMemo(() => {
    let latest: string | null = null;
    for (const c of competitors) {
      const meta = c.metadata as Record<string, unknown> | null;
      const ts = meta?.profileUpdatedAt as string | null;
      if (ts && (!latest || ts > latest)) latest = ts;
    }
    return latest;
  }, [competitors]);

  const newThisMonth = useMemo(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    return competitors.filter(c => new Date(c.addedAt) >= start).length;
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
          toast.info("No new competitors found.");
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
    toast.info("Refreshing all competitors…");
    let ok = 0, fail = 0;
    for (const comp of competitors) {
      try {
        const r = await refreshCompetitorKeywords(activeSiteId, comp.id);
        if (r.success) ok++; else fail++;
      } catch { fail++; }
    }
    if (fail === 0) toast.success(`Refreshed all ${ok} competitors.`);
    else toast.error(`Refreshed ${ok}, failed ${fail}.`);
    router.refresh();
  };

  const filtered = useMemo(() => {
    let result = [...competitors];
    if (filterKey !== "all") result = result.filter(c => getTrend(c) === filterKey);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.domain.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      const metaA = a.metadata as Record<string, unknown> | null;
      const metaB = b.metadata as Record<string, unknown> | null;
      switch (sortKey) {
        case "opportunity": return b.keywords.length - a.keywords.length;
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

  const filterCounts = useMemo(() => ({
    all: competitors.length,
    growing: competitors.filter(c => getTrend(c) === "growing").length,
    stable: competitors.filter(c => getTrend(c) === "stable").length,
    declining: competitors.filter(c => getTrend(c) === "declining").length,
  }), [competitors]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">

      {detecting && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-[2px]"
          aria-modal="true" role="dialog" aria-label="AI competitor detection in progress"
        >
          <div className="w-full max-w-sm mx-4 rounded-xl shadow-2xl p-6 flex flex-col gap-5 bg-[#0d1117] border border-[#21262d]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-[#d29922]/10 border border-[#d29922]/25">
                <Sparkles className="w-5 h-5 text-[#d29922] animate-pulse" />
              </div>
              <div>
                <p className="font-semibold text-[13px] text-[#e6edf3]">AI Competitor Detection</p>
                <p className="text-[11px] text-[#6e7681]">This takes 20–60 seconds</p>
              </div>
            </div>
            <div className="space-y-2">
              {DETECT_STEPS.map((step, i) => {
                const isDone = i < detectStep;
                const isActive = i === detectStep;
                const StepIcon = step.icon;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-500"
                    style={{
                      background: isActive ? "rgba(210,153,34,0.08)" : "transparent",
                      border: isActive ? "1px solid rgba(210,153,34,0.20)" : "1px solid transparent",
                      opacity: isDone ? 0.45 : i > detectStep ? 0.28 : 1,
                    }}
                  >
                    <span className="w-6 flex items-center justify-center shrink-0">
                      {isDone ? <CheckCircle2 className="w-4 h-4 text-[#2ea043]" /> : <StepIcon className={`w-4 h-4 ${isActive ? "text-[#d29922]" : "text-[#6e7681]"}`} />}
                    </span>
                    <span className={`text-[11px] font-medium flex-1 ${isActive ? "text-[#d29922]" : isDone ? "text-[#6e7681] line-through" : "text-[#6e7681]"}`}>
                      {step.label}
                    </span>
                    {isActive && <RefreshCw className="w-3 h-3 text-[#d29922] animate-spin shrink-0" />}
                  </div>
                );
              })}
            </div>
            <div className="w-full h-1 rounded-full overflow-hidden bg-[#21262d]">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out bg-[#d29922]"
                style={{ width: `${Math.max(5, Math.round((detectStep / (DETECT_STEPS.length - 1)) * 100))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#e6edf3] mb-1">Competitors</h1>
          <p className="text-[13px] text-[#8b949e] mb-1.5">See where competitors are winning — and where you can overtake them.</p>
          <div className="flex items-center gap-1.5 text-[11px] text-[#6e7681] flex-wrap">
            {lastUpdated && (
              <>
                <span>Last updated {timeAgo(lastUpdated)}</span>
                <span className="text-[#30363d]">·</span>
              </>
            )}
            <span>Google Search Console + GA4</span>
            {activeSiteDomain && (
              <>
                <span className="text-[#30363d]">·</span>
                <span className="text-[#c9d1d9] font-medium">{activeSiteDomain}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {sites.length > 1 && (
            <select
              value={activeSiteId ?? ""}
              onChange={e => router.push(`/dashboard/competitors?siteId=${e.target.value}`)}
              className="text-[11px] px-3 py-2 bg-[#161b22] border border-[#30363d] rounded-lg focus:outline-none focus:border-[#388bfd] text-[#c9d1d9]"
            >
              {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
            </select>
          )}
          {activeSiteId && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold text-[#e6edf3] bg-[#21262d] hover:bg-[#30363d] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add competitor
            </button>
          )}
        </div>
      </div>

      {competitors.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Total Competitors"
            value={`${competitors.length}`}
            sub={newThisMonth > 0 ? `+${newThisMonth} new this month` : `${competitors.length}/12 slots used`}
            icon={Crosshair}
          />
          <KpiCard
            label="Keywords They Rank For"
            value={fmt(totalOrgKws)}
            sub="Across all tracked competitors"
            icon={TrendingUp}
          />
          <KpiCard
            label="Keyword Gaps"
            value={fmt(totalGapCount)}
            sub="Keywords they rank for that you can target"
            icon={Search}
          />
          <KpiCard
            label="Winning Opportunities"
            value={String(winningOpportunities)}
            sub="Page 1–2 keywords with 100+ volume"
            icon={ArrowUpRight}
          />
        </div>
      )}

      {competitors.length >= 2 && (
        <CompetitorMovement
          competitors={competitors}
          onViewAll={() => landscapeRef.current?.scrollIntoView({ behavior: "smooth" })}
        />
      )}

      {competitors.length > 0 && (
        <CompetitorOpportunities
          competitors={competitors}
          totalGapCount={totalGapCount}
          onReview={(comp) => setDrawerComp(comp)}
        />
      )}

      <div ref={landscapeRef}>
        {competitors.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#30363d] bg-[#0d1117] px-6 py-16 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-xl border border-[#21262d] bg-[#161b22]">
              <Search className="h-7 w-7 text-[#6e7681]" />
            </div>
            <h2 className="text-[18px] font-bold tracking-tight text-[#e6edf3]">No competitors tracked yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-[#6e7681]">
              Add a domain manually, or use <strong className="text-[#e6edf3]">Auto-detect</strong> to let AI find who&apos;s outranking you.
            </p>
            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={handleAutoDetect}
                disabled={detecting || !isPaid}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${
                  isPaid
                    ? "bg-[#388bfd] text-white hover:bg-[#58a6ff]"
                    : "bg-[#21262d] text-[#6e7681] cursor-not-allowed"
                } disabled:opacity-50`}
              >
                {detecting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : isPaid ? <Sparkles className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                Auto-detect competitors
              </button>
              {activeSiteId && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Add manually
                </button>
              )}
            </div>
            {!isPaid && (
              <a href="/dashboard/billing" className="mt-4 flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-[#388bfd] hover:text-[#58a6ff] transition-colors">
                <Zap className="w-3.5 h-3.5" />Upgrade to unlock Auto-detect
              </a>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#161b22]">
              <h2 className="text-[14px] font-semibold text-[#e6edf3]">Competitor Landscape</h2>
              <div className="flex items-center gap-2">
                {competitors.length > 0 && (
                  <button onClick={handleRefreshAll} disabled={!isPaid || detecting}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors disabled:opacity-30">
                    <RefreshCw className="h-3 w-3" /> Refresh all
                  </button>
                )}
                <button onClick={handleAutoDetect} disabled={detecting || !isPaid || competitors.length >= 12}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#388bfd] hover:bg-[#388bfd]/10 transition-colors disabled:opacity-30">
                  {detecting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Auto-detect
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 px-5 py-3 border-b border-[#161b22] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["all", "growing", "stable", "declining"] as FilterKey[]).map(fk => (
                  <button
                    key={fk}
                    onClick={() => setFilterKey(fk)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                      filterKey === fk
                        ? "bg-[#388bfd]/15 text-[#388bfd]"
                        : "text-[#6e7681] hover:text-[#c9d1d9] hover:bg-[#161b22]"
                    }`}
                  >
                    {fk === "all" ? "All" : fk.charAt(0).toUpperCase() + fk.slice(1)} <span className="opacity-60">{filterCounts[fk]}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6e7681] pointer-events-none" />
                  <input
                    type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search competitors…"
                    className="w-44 pl-8 pr-3 py-1.5 text-[11px] rounded-lg bg-[#161b22] border border-[#30363d] focus:outline-none focus:border-[#388bfd] text-[#c9d1d9] placeholder:text-[#6e7681] transition-colors"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6e7681] hover:text-[#e6edf3]">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div ref={sortRef} className="relative">
                  <button onClick={() => setShowSort(!showSort)} className="flex h-7 items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#161b22] px-2.5 text-[11px] text-[#8b949e] transition-colors hover:text-[#e6edf3]">
                    <ArrowUpDown className="h-3 w-3" />
                    <span className="hidden sm:inline">Sort: {SORT_OPTIONS.find(s => s.key === sortKey)?.label}</span>
                  </button>
                  {showSort && (
                    <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-xl">
                      {SORT_OPTIONS.map(opt => (
                        <button key={opt.key} onClick={() => { setSortKey(opt.key); setShowSort(false); }}
                          className={`flex w-full px-3 py-2 text-[11px] font-medium transition-colors hover:bg-[#21262d] ${sortKey === opt.key ? "text-[#e6edf3]" : "text-[#8b949e]"}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-[12px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#21262d] bg-[#0a0d11]">
                    <th className="px-5 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Competitor</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Keywords</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Organic Traffic</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Keyword Gap</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Trend</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#161b22]">
                  {paged.length > 0 ? paged.map(comp => {
                    const meta = comp.metadata as Record<string, unknown> | null;
                    const visits = meta?.estimatedMonthlyVisits as number | null;
                    const orgKws = meta?.organicKeywords as number | null;
                    const gapCount = (meta?.topKeywordGapCount as number | null) ?? comp.keywords.length;
                    const trend = getTrend(comp);
                    const tDelta = getTrafficDelta(comp.snapshots);
                    const trendColor = trend === "growing" ? "#2ea043" : trend === "declining" ? "#f85149" : "#6e7681";

                    return (
                      <tr key={comp.id} className="group hover:bg-[#0f1318] transition-colors cursor-pointer" onClick={() => setDrawerComp(comp)}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <Favicon domain={comp.domain} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-[#e6edf3] truncate max-w-[160px]">{comp.domain}</span>
                                <a
                                  href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer"
                                  className="text-[#30363d] hover:text-[#388bfd] transition-colors opacity-0 group-hover:opacity-100"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                              {Array.isArray(meta?.topContentPillars) && (meta.topContentPillars as string[]).length > 0 && (
                                <p className="text-[10px] text-[#6e7681] truncate max-w-[160px]">
                                  {(meta.topContentPillars as string[]).slice(0, 2).join(" · ")}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[#c9d1d9] font-bold tabular-nums">{fmt(orgKws)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[#c9d1d9] font-bold tabular-nums">{fmt(visits)}</span>
                            {tDelta.pct !== 0 && (
                              <span className="text-[10px] font-semibold" style={{ color: tDelta.direction === "up" ? "#2ea043" : "#f85149" }}>
                                {tDelta.pct > 0 ? "+" : ""}{tDelta.pct}%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[#388bfd] font-bold tabular-nums">{gapCount}</td>
                        <td className="px-3 py-3">
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ color: trendColor, background: `${trendColor}12` }}
                          >
                            {trend === "growing" ? `↑ ${tDelta.pct > 0 ? `+${tDelta.pct}%` : "Growing"}` : trend === "declining" ? `↓ ${tDelta.pct < 0 ? `${tDelta.pct}%` : "Declining"}` : "Stable"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setDrawerComp(comp)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-[#388bfd] hover:bg-[#388bfd]/10 transition-colors"
                            >
                              View analysis <ArrowRight className="w-3 h-3" />
                            </button>
                            <RowMenu
                              comp={comp} siteId={activeSiteId!} isPaid={isPaid}
                              onRefresh={() => router.refresh()}
                              onDelete={() => setCompetitors(p => p.filter(c => c.id !== comp.id))}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <p className="font-medium text-[#8b949e]">No competitors match this filter</p>
                        <p className="mt-1 text-[11px] text-[#6e7681]">Try a different filter or clear your search.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-[#161b22]">
              {paged.length > 0 ? paged.map(comp => {
                const meta = comp.metadata as Record<string, unknown> | null;
                const visits = meta?.estimatedMonthlyVisits as number | null;
                const gapCount = (meta?.topKeywordGapCount as number | null) ?? comp.keywords.length;
                const trend = getTrend(comp);
                const tDelta = getTrafficDelta(comp.snapshots);
                const trendColor = trend === "growing" ? "#2ea043" : trend === "declining" ? "#f85149" : "#6e7681";

                return (
                  <button key={comp.id} onClick={() => setDrawerComp(comp)} className="w-full text-left space-y-2 p-4 hover:bg-[#0f1318] transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Favicon domain={comp.domain} />
                        <span className="text-[12px] font-medium text-[#e6edf3] truncate">{comp.domain}</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ color: trendColor, background: `${trendColor}12` }}>
                        {trend === "growing" ? `↑${tDelta.pct}%` : trend === "declining" ? `↓${Math.abs(tDelta.pct)}%` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#6e7681]">
                      <span>Traffic: <span className="font-semibold text-[#c9d1d9]">{fmt(visits)}</span></span>
                      <span>Gaps: <span className="font-semibold text-[#388bfd]">{gapCount}</span></span>
                    </div>
                  </button>
                );
              }) : (
                <div className="px-6 py-12 text-center text-[12px] text-[#6e7681]">No competitors match</div>
              )}
            </div>

            {filtered.length > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-[#161b22] px-5 py-3">
                <p className="text-[11px] text-[#6e7681]">
                  Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                    className="rounded-md p-1.5 text-[#6e7681] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3] disabled:opacity-30">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button key={i} onClick={() => setPage(i)}
                      className={`h-6 w-6 rounded-md text-[11px] font-semibold transition-colors ${i === safePage ? "bg-[#21262d] text-[#e6edf3]" : "text-[#6e7681] hover:bg-[#161b22]"}`}>
                      {i + 1}
                    </button>
                  ))}
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                    className="rounded-md p-1.5 text-[#6e7681] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3] disabled:opacity-30">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!isPaid && competitors.length > 0 && (
        <div className="flex flex-col gap-4 rounded-xl border border-[#21262d] bg-[#0d1117] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-semibold text-[#e6edf3] flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#d29922]" />Unlock full competitor intelligence
            </p>
            <p className="mt-1 text-[11px] leading-5 text-[#6e7681]">
              Auto-refresh weekly · AI-detected competitors · Keyword gap alerts · Backlink gap analysis
            </p>
          </div>
          <a href="/dashboard/billing" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#388bfd] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#58a6ff]">
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

      {drawerComp && activeSiteId && (
        <CompetitorDetailDrawer
          comp={drawerComp}
          siteId={activeSiteId}
          isPaid={isPaid}
          onClose={() => setDrawerComp(null)}
          onRefresh={() => router.refresh()}
        />
      )}
    </div>
  );
}
