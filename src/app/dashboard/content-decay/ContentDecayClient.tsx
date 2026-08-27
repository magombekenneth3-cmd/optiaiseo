"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  TrendingDown,
  RefreshCcw,
  ExternalLink,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Loader2,
  Info,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Signal,
} from "lucide-react";
import Link from "next/link";
import { getDecayingContent, refreshDecayingContent } from "@/app/actions/contentDecay";
import type { DecayRiskRow } from "@/app/actions/contentDecay";

// ── GSC-based shape (traffic decay) ──────────────────────────────────────────

interface DecayRow {
  url: string;
  currentClicks: number;
  previousClicks: number;
  dropPercentage: number;
}

type SortKey = "dropPercentage" | "currentClicks" | "previousClicks";

// ── Shared helpers ───────────────────────────────────────────────────────────

function severity(drop: number): "critical" | "warning" | "mild" {
  if (drop >= 50) return "critical";
  if (drop >= 30) return "warning";
  return "mild";
}

function SeverityBadge({ drop }: { drop: number }) {
  const s = severity(drop);
  const map = {
    critical: { cls: "bg-rose-500/10 text-rose-400 border-rose-500/20", icon: <Flame className="w-3 h-3" />, label: "Critical" },
    warning: { cls: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: <AlertTriangle className="w-3 h-3" />, label: "Warning" },
    mild: { cls: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: <TrendingDown className="w-3 h-3" />, label: "Mild" },
  };
  const { cls, icon, label } = map[s];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${cls}`}>
      {icon} {label}
    </span>
  );
}

function DropBar({ pct }: { pct: number }) {
  const color = pct >= 50 ? "bg-rose-500" : pct >= 30 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden min-w-[60px]">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums ${pct >= 50 ? "text-rose-400" : pct >= 30 ? "text-amber-400" : "text-blue-400"}`}>
        −{pct}%
      </span>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: "HIGH" | "SIGNAL" }) {
  if (confidence === "HIGH") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border bg-rose-500/10 text-rose-400 border-rose-500/20">
        <ShieldAlert className="w-3 h-3" /> High Confidence
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/20">
      <Signal className="w-3 h-3" /> Signal
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ContentDecayClient({
  siteId,
  userTier,
}: {
  siteId: string;
  userTier: "FREE" | "STARTER" | "PRO" | "AGENCY";
}) {
  // GSC data
  const [gscRows, setGscRows] = useState<DecayRow[]>([]);
  // Fallback data
  const [riskRows, setRiskRows] = useState<DecayRiskRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"gsc" | "audit">("gsc");
  const [sortKey, setSortKey] = useState<SortKey>("dropPercentage");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isPro = userTier === "STARTER" || userTier === "PRO" || userTier === "AGENCY";
  const isAuditSource = dataSource === "audit";

  useEffect(() => {
    setLoading(true);
    setError(null);
    getDecayingContent(siteId).then((res: any) => {
      if (res.success && res.data) {
        const source = res.source ?? "gsc";
        setDataSource(source);
        if (source === "gsc") {
          setGscRows(res.data as DecayRow[]);
        } else {
          setRiskRows(res.data as DecayRiskRow[]);
        }
      } else {
        setError(res.error ?? "Failed to load decay data.");
      }
      setLoading(false);
    });
  }, [siteId]);

  const sortedGsc = [...gscRows].sort((a, b) => {
    const mult = sortDir === "desc" ? -1 : 1;
    return (a[sortKey] - b[sortKey]) * mult;
  });

  // Risk rows sort by confidence first, then drop
  const sortedRisk = [...riskRows].sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "HIGH" ? -1 : 1;
    return b.dropPercentage - a.dropPercentage;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === "desc" ? <ChevronDown className="w-3 h-3 text-primary" /> : <ChevronUp className="w-3 h-3 text-primary" />;
  }

  async function handleRefresh(url: string) {
    if (!isPro) {
      toast.error("Upgrade to Pro to use AI Content Refresh.");
      return;
    }
    if (isPending) return; // prevent double-click / concurrent refreshes
    setRefreshingUrl(url);
    setIsPending(true);
    try {
      const res = await refreshDecayingContent(siteId, url);
      if (res.success) {
        toast.success("AI draft created! Check your Blogs section to review and publish.", { duration: 6000 });
      } else {
        toast.error(res.error ?? "AI refresh failed.");
      }
    } catch {
      toast.error("Refresh failed — please try again.");
    } finally {
      setRefreshingUrl(null);
      setIsPending(false);
    }
  }

  // Stats summary
  const hasData = isAuditSource ? riskRows.length > 0 : gscRows.length > 0;
  const totalAffected = isAuditSource ? riskRows.length : gscRows.length;
  const criticalCount = isAuditSource
    ? riskRows.filter(r => r.confidence === "HIGH" && r.dropPercentage >= 50).length
    : gscRows.filter(r => r.dropPercentage >= 50).length;
  const warningCount = isAuditSource
    ? riskRows.filter(r => r.dropPercentage >= 30 && r.dropPercentage < 50).length
    : gscRows.filter(r => r.dropPercentage >= 30 && r.dropPercentage < 50).length;
  const highConfCount = isAuditSource ? riskRows.filter(r => r.confidence === "HIGH").length : 0;
  const totalLostClicks = isAuditSource ? 0 : gscRows.reduce((s, r) => s + (r.previousClicks - r.currentClicks), 0);

  function renderPageSlug(url: string) {
    try { return new URL(url).pathname || url; } catch { return url; }
  }

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto pb-12 fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1 flex items-center gap-2.5">
            <TrendingDown className="w-6 h-6 text-rose-400" />
            {isAuditSource ? "Decay Risk" : "Content Decay"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isAuditSource
              ? "Pages showing declining health — estimated from audit and rank history."
              : "Pages losing traffic vs. the prior 90-day period — ranked by severity."}
          </p>
        </div>
        {!loading && !error && hasData && (
          <Link
            href="/dashboard/blogs"
            className="shrink-0 inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-all shadow"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            View AI Drafts
          </Link>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="card-surface p-16 flex flex-col items-center gap-4 text-center">
          <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
          <p className="text-muted-foreground text-sm">Analysing content performance…</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="card-surface p-10 border-rose-500/20 bg-rose-500/5 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-10 h-10 text-rose-400" />
          <p className="text-sm font-medium text-rose-300">{error}</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Connect Google Search Console under{" "}
            <Link href="/dashboard/settings" className="underline hover:text-foreground">
              Settings
            </Link>
            , or run at least 2 site audits for estimated decay risk.
          </p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && !hasData && (
        <div className="card-surface p-16 flex flex-col items-center gap-3 text-center border-dashed">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          </div>
          <p className="text-lg font-semibold text-foreground">No decay detected</p>
          <p className="text-sm text-muted-foreground max-w-md">
            None of your pages have lost more than 15% of their traffic compared to the same period. Keep up the great work!
          </p>
        </div>
      )}

      {/* Data */}
      {!loading && !error && hasData && (
        <>
          {/* Audit-based fallback banner */}
          {isAuditSource && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-300 mb-0.5">Estimated from audit &amp; rank history</p>
                <p className="text-xs text-blue-300/70 leading-relaxed">
                  Google Search Console is not connected. Decay risk is estimated by comparing
                  rank positions and audit scores across your recent data.{" "}
                  <Link href="/dashboard/settings" className="underline hover:text-blue-200">Connect GSC</Link>{" "}
                  for precise click-level analysis.
                </p>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className={`grid grid-cols-2 ${isAuditSource ? "sm:grid-cols-4" : "sm:grid-cols-4"} gap-4`}>
            {isAuditSource ? (
              <>
                <div className="card-surface p-5 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground font-medium">Total Flagged</span>
                  <span className="text-2xl font-bold tabular-nums text-foreground">{totalAffected}</span>
                  <span className="text-[11px] text-muted-foreground">pages</span>
                </div>
                <div className="card-surface p-5 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground font-medium">High Confidence</span>
                  <span className="text-2xl font-bold tabular-nums text-rose-400">{highConfCount}</span>
                  <span className="text-[11px] text-muted-foreground">rank drop ≥15%</span>
                </div>
                <div className="card-surface p-5 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground font-medium">Signal</span>
                  <span className="text-2xl font-bold tabular-nums text-amber-400">{totalAffected - highConfCount}</span>
                  <span className="text-[11px] text-muted-foreground">audit score decline</span>
                </div>
                <div className="card-surface p-5 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground font-medium">Avg Drop</span>
                  <span className="text-2xl font-bold tabular-nums text-rose-300">
                    {totalAffected > 0 ? Math.round(riskRows.reduce((s, r) => s + r.dropPercentage, 0) / totalAffected) : 0}%
                  </span>
                  <span className="text-[11px] text-muted-foreground">across all signals</span>
                </div>
              </>
            ) : (
              <>
                {[
                  { label: "Total Affected", value: totalAffected, sub: "pages", color: "text-foreground" },
                  { label: "Critical (≥50%)", value: criticalCount, sub: "pages", color: "text-rose-400" },
                  { label: "Warning (30–49%)", value: warningCount, sub: "pages", color: "text-amber-400" },
                  { label: "Lost Clicks", value: totalLostClicks.toLocaleString(), sub: "last 90 days", color: "text-rose-300" },
                ].map((c) => (
                  <div key={c.label} className="card-surface p-5 flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground font-medium">{c.label}</span>
                    <span className={`text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</span>
                    <span className="text-[11px] text-muted-foreground">{c.sub}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Pro upsell */}
          {!isPro && (
            <div className="card-surface p-4 border-amber-500/20 bg-amber-500/5 flex items-center gap-3">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">
                <span className="font-semibold">AI Refresh</span> is a Pro feature.{" "}
                <Link href="/dashboard/billing" className="underline font-bold hover:text-amber-200">
                  Upgrade to Pro
                </Link>{" "}
                to automatically rewrite decaying pages and recover lost traffic.
              </p>
            </div>
          )}

          {/* ── GSC Table ─────────────────────────────────────────────────── */}
          {!isAuditSource && (
            <div className="card-surface overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap min-w-[700px]">
                  <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
                    <tr>
                      <th className="px-5 py-4">Page URL</th>
                      <th className="px-5 py-4">Severity</th>
                      <th
                        className="px-5 py-4 cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={() => toggleSort("dropPercentage")}
                      >
                        <span className="inline-flex items-center gap-1">
                          Drop <SortIcon col="dropPercentage" />
                        </span>
                      </th>
                      <th
                        className="px-5 py-4 cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={() => toggleSort("previousClicks")}
                      >
                        <span className="inline-flex items-center gap-1">
                          Prev Clicks <SortIcon col="previousClicks" />
                        </span>
                      </th>
                      <th
                        className="px-5 py-4 cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={() => toggleSort("currentClicks")}
                      >
                        <span className="inline-flex items-center gap-1">
                          Now Clicks <SortIcon col="currentClicks" />
                        </span>
                      </th>
                      <th className="px-5 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedGsc.map((row) => {
                      const isRefreshing = refreshingUrl === row.url && isPending;
                      const slug = renderPageSlug(row.url);
                      return (
                        <tr key={row.url} className="hover:bg-card/40 transition-colors group">
                          <td className="px-5 py-3.5 max-w-xs">
                            <div className="flex items-center gap-2">
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-foreground hover:text-primary transition-colors truncate max-w-[260px] flex items-center gap-1"
                                title={row.url}
                              >
                                <span className="truncate">{slug}</span>
                                <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                              </a>
                            </div>
                          </td>
                          <td className="px-5 py-3.5"><SeverityBadge drop={row.dropPercentage} /></td>
                          <td className="px-5 py-3.5 w-40"><DropBar pct={row.dropPercentage} /></td>
                          <td className="px-5 py-3.5 text-muted-foreground tabular-nums">{row.previousClicks.toLocaleString()}</td>
                          <td className="px-5 py-3.5 tabular-nums">
                            <span className={row.currentClicks < row.previousClicks ? "text-rose-400 font-semibold" : "text-foreground"}>
                              {row.currentClicks.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => handleRefresh(row.url)}
                              disabled={isRefreshing || !!refreshingUrl}
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                                isPro
                                  ? "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                  : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 cursor-not-allowed"
                              }`}
                              title={isPro ? "Generate AI Refresh Draft" : "Upgrade to Pro to use AI Refresh"}
                            >
                              {isRefreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                              {isRefreshing ? "Refreshing…" : isPro ? "AI Refresh" : "Upgrade"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-border bg-card/30 flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  Comparing last 90 days vs. previous 90-day period · Pages with &gt;15% traffic drop shown
                </p>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Critical ≥50%
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Warning 30–49%
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Mild &lt;30%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Fallback Risk Table ───────────────────────────────────────── */}
          {isAuditSource && (
            <div className="card-surface overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap min-w-[700px]">
                  <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
                    <tr>
                      <th className="px-5 py-4">Page URL</th>
                      <th className="px-5 py-4">Confidence</th>
                      <th className="px-5 py-4">Signal</th>
                      <th className="px-5 py-4">Drop</th>
                      <th className="px-5 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedRisk.map((row) => {
                      const isRefreshing = refreshingUrl === row.url && isPending;
                      const slug = renderPageSlug(row.url);
                      return (
                        <tr key={`${row.url}-${row.metric}`} className="hover:bg-card/40 transition-colors group">
                          <td className="px-5 py-3.5 max-w-xs">
                            <div className="flex items-center gap-2">
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-foreground hover:text-primary transition-colors truncate max-w-[260px] flex items-center gap-1"
                                title={row.url}
                              >
                                <span className="truncate">{slug}</span>
                                <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                              </a>
                            </div>
                          </td>
                          <td className="px-5 py-3.5"><ConfidenceBadge confidence={row.confidence} /></td>
                          <td className="px-5 py-3.5">
                            <span className="text-xs text-muted-foreground font-mono">{row.signal}</span>
                          </td>
                          <td className="px-5 py-3.5 w-40"><DropBar pct={row.dropPercentage} /></td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => handleRefresh(row.url)}
                              disabled={isRefreshing || !!refreshingUrl}
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                                isPro
                                  ? "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                  : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 cursor-not-allowed"
                              }`}
                              title={isPro ? "Generate AI Refresh Draft" : "Upgrade to Pro to use AI Refresh"}
                            >
                              {isRefreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                              {isRefreshing ? "Refreshing…" : isPro ? "AI Refresh" : "Upgrade"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-border bg-card/30 flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  Estimated from audit &amp; rank history · All materially declining pages shown
                </p>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> High Confidence
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Signal
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Tip */}
          <div className="card-surface p-5 border-blue-500/20 bg-blue-500/5 flex items-start gap-3">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-300 mb-1">How AI Refresh works</p>
              <p className="text-xs text-blue-300/70 leading-relaxed">
                Click <strong className="text-blue-200">AI Refresh</strong> on any decaying page. The AI scrapes the current content, modernizes it for 2026, adds a featured-snippet answer block, expands thin sections, and appends FAQ schema — then saves it as a draft in your{" "}
                <Link href="/dashboard/blogs" className="underline hover:text-blue-200">
                  Blogs section
                </Link>{" "}
                for review before you push it live.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

