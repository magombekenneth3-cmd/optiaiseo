"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  X, ExternalLink, ArrowRight, Sparkles, RefreshCw,
  TrendingUp, ArrowUpRight, Link2, Lock,
} from "lucide-react";
import {
  refreshCompetitorKeywords,
  fetchCompetitorBacklinkGap,
} from "@/app/actions/competitors";

type Snapshot = { month: string; traffic: number; organicKeywords: number | null };
type KW = { id: string; keyword: string; position: number; searchVolume: number; difficulty: number | null; clicks: number | null; dataSource: string | null };
type Competitor = { id: string; domain: string; addedAt: string | Date; metadata: Record<string, unknown> | null; keywords: KW[]; snapshots: Snapshot[] };
type GapReport = { gap: { referringDomains: number; domainRating: number; totalBacklinks: number; opportunityDomains: string[] }; you: { domainRating: number; referringDomains: number }; competitor: { domainRating: number; referringDomains: number } };
type DetailTab = "overview" | "gaps" | "backlinks" | "trend";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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

function KdBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-[#6e7681] text-[10px]">—</span>;
  const c = score >= 70
    ? "text-[#f85149] bg-[#f85149]/10"
    : score >= 40
      ? "text-[#d29922] bg-[#d29922]/10"
      : "text-[#2ea043] bg-[#2ea043]/10";
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c}`}>{score}</span>;
}

function TrendChart({ snapshots, dataKey }: { snapshots: Snapshot[]; dataKey: "traffic" | "organicKeywords" }) {
  const sorted = [...snapshots].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const vals = sorted.map(s => (dataKey === "traffic" ? s.traffic : s.organicKeywords) ?? 0);
  if (vals.length < 2) return <p className="text-[11px] text-[#6e7681] py-4 text-center">Not enough data for trend chart.</p>;

  const w = 340, h = 100, px = 24, py = 16;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const r = hi - lo || 1;

  const pts = vals.map((v, i) => ({
    x: px + (i / (vals.length - 1)) * (w - px * 2),
    y: py + ((hi - v) / r) * (h - py * 2),
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("");
  const area = `${line}L${pts.at(-1)!.x},${h}L${pts[0].x},${h}Z`;

  const labelIdx = vals.length >= 5
    ? [0, Math.floor(vals.length / 2), vals.length - 1]
    : vals.map((_, i) => i);

  return (
    <svg viewBox={`0 0 ${w} ${h + 18}`} className="w-full" style={{ maxHeight: 140 }}>
      <defs>
        <linearGradient id="drawer-trend-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#388bfd" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#388bfd" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#drawer-trend-grad)" />
      <path d={line} fill="none" stroke="#388bfd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#0d1117" stroke="#388bfd" strokeWidth="1.5" />
      ))}
      {labelIdx.map(i => (
        <text key={i} x={pts[i].x} y={h + 14} textAnchor="middle" fill="#6e7681" style={{ fontSize: 9 }}>
          {sorted[i].month.slice(0, 7)}
        </text>
      ))}
    </svg>
  );
}

export function CompetitorDetailDrawer({ comp, siteId, isPaid, onClose, onRefresh }: {
  comp: Competitor;
  siteId: string;
  isPaid: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [pending, go] = useTransition();

  const [gapReport, setGapReport] = useState<GapReport | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);

  const meta = comp.metadata as Record<string, unknown> | null;
  const traffic = meta?.estimatedMonthlyVisits as number | null;
  const orgKws = meta?.organicKeywords as number | null;
  const gapCount = (meta?.topKeywordGapCount as number | null) ?? comp.keywords.length;
  const analysisNote = meta?.analysisNote as string | null;
  const trend = getTrend(comp);
  const { pct } = getTrafficDelta(comp.snapshots);

  const trendColor = trend === "growing" ? "#2ea043" : trend === "declining" ? "#f85149" : "#6e7681";
  const trendLabel = trend === "growing" ? `Growing +${pct}%` : trend === "declining" ? `Declining ${pct}%` : "Stable";

  const topGaps = comp.keywords.slice(0, 8);

  const onEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "";
    };
  }, [onEsc]);

  const handleRefresh = () => {
    if (!isPaid) { toast.error("Upgrade to refresh."); return; }
    go(async () => {
      const r = await refreshCompetitorKeywords(siteId, comp.id);
      if (r.success) {
        toast.success(`Updated ${r.count ?? 0} keyword gaps for ${comp.domain}`);
        onRefresh();
        router.refresh();
      } else {
        toast.error(r.error ?? "Refresh failed.");
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

  const estBestAction = topGaps.length > 0 ? topGaps[0] : null;
  const realisticTargets = comp.keywords.filter(kw => kw.position <= 20).length;

  return (
    <>
      <style>{`@keyframes compDrawerSlide{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={onClose} />
        <div
          className="relative w-full max-w-[420px] bg-[#0d1117] border-l border-[#21262d] overflow-y-auto flex flex-col"
          style={{ animation: "compDrawerSlide .2s ease-out" }}
        >
          <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur-sm border-b border-[#21262d] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${comp.domain}&sz=32`}
                    alt="" className="w-5 h-5 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <h2 className="text-[15px] font-bold text-[#e6edf3] truncate">{comp.domain}</h2>
                  <a href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#6e7681] hover:text-[#388bfd]">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                    style={{ color: trendColor, background: `${trendColor}15`, borderColor: `${trendColor}30` }}
                  >
                    ● {trendLabel}
                  </span>
                </div>
              </div>
              <button onClick={onClose} className="shrink-0 p-1.5 rounded-md hover:bg-[#21262d] text-[#6e7681] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex border-b border-[#21262d]">
            {([
              { id: "overview" as DetailTab, label: "Overview" },
              { id: "gaps" as DetailTab, label: "Keyword Gaps" },
              { id: "backlinks" as DetailTab, label: "Backlinks" },
              { id: "trend" as DetailTab, label: "Trend" },
            ]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => handleTabChange(id)}
                className={`flex-1 px-4 py-2.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors ${
                  tab === id
                    ? "border-[#388bfd] text-[#e6edf3]"
                    : "border-transparent text-[#6e7681] hover:text-[#c9d1d9]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="flex-1 px-5 py-4 space-y-5">
              <div>
                <h3 className="text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] mb-3">Competitive Position</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Organic Traffic", value: fmt(traffic), delta: pct !== 0 ? `${pct > 0 ? "+" : ""}${pct}%` : null, deltaColor: pct > 0 ? "#2ea043" : pct < 0 ? "#f85149" : "#6e7681" },
                    { label: "Keywords", value: fmt(orgKws), delta: null, deltaColor: "#6e7681" },
                    { label: "Keyword Gaps", value: String(gapCount), delta: null, deltaColor: "#6e7681" },
                    { label: "Realistic Targets", value: String(realisticTargets), delta: null, deltaColor: "#6e7681" },
                  ].map(stat => (
                    <div key={stat.label} className="rounded-lg border border-[#21262d] bg-[#161b22] p-3">
                      <p className="text-[10px] text-[#6e7681] mb-1">{stat.label}</p>
                      <div className="flex items-baseline gap-1.5">
                        <p className="text-[18px] font-black tabular-nums text-[#e6edf3]">{stat.value}</p>
                        {stat.delta && (
                          <span className="text-[10px] font-semibold" style={{ color: stat.deltaColor }}>{stat.delta}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {topGaps.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] mb-2">Where They Beat You</h3>
                  <p className="text-[10px] text-[#6e7681] mb-2">Top keyword gaps (their SERP positions)</p>
                  <div className="space-y-1">
                    {topGaps.map(kw => (
                      <div key={kw.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[#161b22] text-[11px]">
                        <span className="truncate font-medium text-[#c9d1d9] flex-1 mr-2">{kw.keyword}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[#8b949e]">#{kw.position}</span>
                          <span className="text-[#388bfd] tabular-nums">{fmt(kw.searchVolume)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {comp.keywords.length > 8 && (
                    <button
                      onClick={() => setTab("gaps")}
                      className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[#388bfd] hover:text-[#58a6ff] transition-colors"
                    >
                      View all {comp.keywords.length} keyword gaps <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {(realisticTargets > 0 || analysisNote) && (
                <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-[#d29922]" />
                    <h3 className="text-[12px] font-semibold text-[#e6edf3]">AI Recommendation</h3>
                  </div>
                  {realisticTargets > 0 && (
                    <p className="text-[11px] text-[#8b949e] mb-2">
                      {realisticTargets} keywords are realistic targets.
                    </p>
                  )}
                  {estBestAction && (
                    <>
                      <p className="text-[11px] text-[#8b949e] mb-1">Best first action:</p>
                      <p className="text-[11px] text-[#c9d1d9] font-medium mb-2">
                        {estBestAction.position <= 10
                          ? `Improve your existing page targeting "${estBestAction.keyword}"`
                          : `Create content targeting "${estBestAction.keyword}"`
                        }
                      </p>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-[#6e7681]">Estimated opportunity</p>
                          <p className="text-[14px] font-bold text-[#2ea043]">
                            +{Math.round(estBestAction.searchVolume * 0.05)} clicks/mo
                          </p>
                        </div>
                        <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#388bfd] text-white hover:bg-[#58a6ff] transition-colors">
                          Run page audit <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                  {analysisNote && (
                    <p className="text-[10px] text-[#6e7681] mt-3 italic">{analysisNote}</p>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-[#161b22]">
                <h3 className="text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] mb-2">Quick Actions</h3>
                <div className="space-y-1">
                  {[
                    { icon: ExternalLink, label: "View competitor website", href: `https://${comp.domain}`, external: true },
                    { icon: TrendingUp, label: "Track keyword movements", action: () => setTab("trend") },
                    { icon: Link2, label: "Analyze backlinks", action: () => handleTabChange("backlinks") },
                  ].map((item, i) => (
                    item.external ? (
                      <a
                        key={i}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22] transition-colors"
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        {item.label}
                        <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-40" />
                      </a>
                    ) : (
                      <button
                        key={i}
                        onClick={item.action}
                        className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-[11px] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22] transition-colors text-left"
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        {item.label}
                        <ArrowRight className="w-2.5 h-2.5 ml-auto opacity-40" />
                      </button>
                    )
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleRefresh}
                  disabled={pending || !isPaid}
                  className={`w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    pending
                      ? "text-[#8b949e] bg-[#161b22] cursor-wait"
                      : isPaid
                        ? "text-[#e6edf3] bg-[#21262d] hover:bg-[#30363d]"
                        : "text-[#6e7681] bg-[#161b22] cursor-not-allowed"
                  }`}
                >
                  {pending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Refreshing…</> : <><RefreshCw className="w-3.5 h-3.5" />Refresh competitor data</>}
                </button>
              </div>
            </div>
          )}

          {tab === "gaps" && (
            <div className="flex-1 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-semibold text-[#e6edf3]">Keyword Gaps</h3>
                <span className="text-[10px] text-[#6e7681]">{comp.keywords.length} loaded (of {gapCount} total)</span>
              </div>
              {comp.keywords.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-[11px] text-[#6e7681] mb-2">No keyword gap data yet.</p>
                  <button
                    onClick={handleRefresh}
                    disabled={pending || !isPaid}
                    className="flex items-center gap-1 mx-auto px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#388bfd] border border-[#388bfd]/20 hover:bg-[#388bfd]/10 transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${pending ? "animate-spin" : ""}`} />
                    Fetch keyword gaps
                  </button>
                </div>
              ) : (
                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                  {comp.keywords.map(kw => (
                    <div key={kw.id} className="flex items-center justify-between px-2.5 py-2 bg-[#161b22] rounded-md text-[11px] gap-2">
                      <span className="truncate font-medium text-[#c9d1d9] flex-1">{kw.keyword}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[#8b949e] w-7 text-right">#{kw.position}</span>
                        <span className="text-[#388bfd] w-9 text-right tabular-nums">{fmt(kw.searchVolume)}</span>
                        <KdBadge score={kw.difficulty} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "backlinks" && (
            <div className="flex-1 px-5 py-4">
              {gapLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-[#6e7681] text-[11px]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />Fetching backlink data…
                </div>
              )}
              {gapError && !gapLoading && (
                <div className="text-[11px] text-[#f85149] py-4 text-center">{gapError}</div>
              )}
              {!gapLoading && !gapError && !gapReport && !isPaid && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Lock className="w-6 h-6 text-[#6e7681]" />
                  <p className="text-[11px] text-[#6e7681]">Backlink gap analysis is a paid feature.</p>
                  <a href="/dashboard/billing" className="text-[11px] px-3 py-1.5 bg-[#388bfd] text-white rounded-lg font-semibold hover:bg-[#58a6ff] transition-colors">
                    Upgrade to unlock
                  </a>
                </div>
              )}
              {gapReport && !gapLoading && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Domain Rating", yours: gapReport.you.domainRating, theirs: gapReport.competitor.domainRating },
                      { label: "Referring Domains", yours: gapReport.you.referringDomains, theirs: gapReport.competitor.referringDomains },
                      { label: "Total Backlinks", yours: 0, theirs: gapReport.gap.totalBacklinks },
                    ].map(({ label, yours, theirs }) => (
                      <div key={label} className="rounded-lg border border-[#21262d] bg-[#161b22] p-3">
                        <p className="text-[10px] text-[#6e7681] mb-1.5">{label}</p>
                        <div className="flex items-end justify-between gap-1">
                          <div>
                            <p className="text-[9px] text-[#6e7681]">You</p>
                            <p className="text-[13px] font-bold text-[#e6edf3] tabular-nums">{fmt(yours)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-[#6e7681]">Them</p>
                            <p className="text-[13px] font-bold text-[#e6edf3] tabular-nums">{fmt(theirs)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#d29922]" />
                      <span className="text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">
                        {gapReport.gap.opportunityDomains.length} link-building opportunities
                      </span>
                    </div>
                    {gapReport.gap.opportunityDomains.length === 0 ? (
                      <p className="text-[11px] text-[#6e7681] py-2">No gap domains found.</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {gapReport.gap.opportunityDomains.map((domain, i) => (
                          <div key={domain} className="flex items-center gap-2 px-2.5 py-1.5 bg-[#161b22] rounded-md text-[11px]">
                            <span className="text-[#6e7681] w-4 shrink-0">{i + 1}.</span>
                            <span className="font-medium text-[#c9d1d9] flex-1 truncate">{domain}</span>
                            <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="text-[#388bfd] hover:text-[#58a6ff] shrink-0">
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

          {tab === "trend" && (
            <div className="flex-1 px-5 py-4 space-y-5">
              <div>
                <h3 className="text-[13px] font-semibold text-[#e6edf3] mb-2">Traffic Trend</h3>
                <TrendChart snapshots={comp.snapshots} dataKey="traffic" />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-[#e6edf3] mb-2">Keyword Count Trend</h3>
                <TrendChart snapshots={comp.snapshots} dataKey="organicKeywords" />
              </div>
              {comp.snapshots.length > 0 && (
                <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-3">
                  <h4 className="text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] mb-2">Snapshot History</h4>
                  <div className="space-y-1">
                    {[...comp.snapshots]
                      .sort((a, b) => new Date(b.month).getTime() - new Date(a.month).getTime())
                      .map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="text-[#6e7681]">{s.month.slice(0, 7)}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[#c9d1d9] tabular-nums">{fmt(s.traffic)} traffic</span>
                            {s.organicKeywords != null && (
                              <span className="text-[#8b949e] tabular-nums">{fmt(s.organicKeywords)} kw</span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
