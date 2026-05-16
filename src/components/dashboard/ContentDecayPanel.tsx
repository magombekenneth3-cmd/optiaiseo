"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  TrendingDown,
  RefreshCcw,
  Loader2,
  ExternalLink,
  Flame,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { getDecayingContent, refreshDecayingContent } from "@/app/actions/contentDecay";

interface DecayRow {
  url: string;
  currentClicks: number;
  previousClicks: number;
  dropPercentage: number;
}

function severity(drop: number): "critical" | "warning" | "mild" {
  if (drop >= 50) return "critical";
  if (drop >= 30) return "warning";
  return "mild";
}

const SEV_MAP = {
  critical: { cls: "bg-rose-500/10 text-rose-400 border-rose-500/20", icon: Flame, label: "Critical" },
  warning: { cls: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: AlertTriangle, label: "Warning" },
  mild: { cls: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: TrendingDown, label: "Mild" },
} as const;

export function ContentDecayPanel({ siteId }: { siteId: string }) {
  const [rows, setRows] = useState<DecayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId) return;
    setLoading(true);
    getDecayingContent(siteId)
      .then((res) => {
        if (res.success && res.data) setRows((res.data as DecayRow[]).slice(0, 5));
        else setError(res.error ?? "Failed to load");
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [siteId]);

  async function handleRefresh(url: string) {
    if (refreshingUrl) return;
    setRefreshingUrl(url);
    try {
      const res = await refreshDecayingContent(siteId, url);
      if (res.success) {
        toast.success("AI draft created — check your Blogs section.", { duration: 5000 });
      } else {
        toast.error(res.error ?? "Refresh failed.");
      }
    } catch {
      toast.error("Refresh failed — please try again.");
    } finally {
      setRefreshingUrl(null);
    }
  }

  if (loading) {
    return (
      <div className="card-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingDown className="w-4 h-4 text-rose-400" />
          <h3 className="text-sm font-semibold">Content Decay</h3>
        </div>
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-surface p-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-4 h-4 text-rose-400" />
          <h3 className="text-sm font-semibold">Content Decay</h3>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="card-surface p-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">Content Decay</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          No significant traffic drops detected
        </div>
      </div>
    );
  }

  const criticalCount = rows.filter((r) => r.dropPercentage >= 50).length;
  const totalLost = rows.reduce((s, r) => s + (r.previousClicks - r.currentClicks), 0);

  return (
    <div className="card-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-rose-400" />
          <h3 className="text-sm font-semibold">Content Decay</h3>
          {criticalCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
              {criticalCount} critical
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          −{totalLost.toLocaleString()} clicks
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const sev = severity(row.dropPercentage);
          const cfg = SEV_MAP[sev];
          const Icon = cfg.icon;
          const isRefreshing = refreshingUrl === row.url;
          let slug: string;
          try {
            slug = new URL(row.url).pathname || row.url;
          } catch {
            slug = row.url;
          }

          return (
            <div key={row.url} className="rounded-lg border border-border bg-card/50 p-3 group">
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg.cls}`}>
                  <Icon className="w-2.5 h-2.5" /> {cfg.label}
                </span>
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-foreground hover:text-primary truncate max-w-[180px] flex items-center gap-1 transition-colors"
                  title={row.url}
                >
                  {slug}
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                </a>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{row.previousClicks} → {row.currentClicks}</span>
                  <span className={`font-bold tabular-nums ${sev === "critical" ? "text-rose-400" : sev === "warning" ? "text-amber-400" : "text-blue-400"}`}>
                    −{row.dropPercentage}%
                  </span>
                </div>
                <button
                  onClick={() => handleRefresh(row.url)}
                  disabled={!!refreshingUrl}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRefreshing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCcw className="w-3 h-3" />
                  )}
                  {isRefreshing ? "Refreshing…" : "Re-optimise"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Link
        href={`/dashboard/content-decay?siteId=${siteId}`}
        className="flex items-center justify-center gap-1.5 mt-4 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        View all decaying pages <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
