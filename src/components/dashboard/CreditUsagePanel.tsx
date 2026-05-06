"use client";

/**
 * CreditUsagePanel — shows live credit balance, monthly allowance,
 * usage progress bar, and a breakdown by action type.
 *
 * Data source: /api/credits/balance (existing route).
 * No new DB schema needed — the balance is on the User model.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap, RefreshCw } from "lucide-react";
import { CREDIT_COSTS, monthlyCreditsForTier } from "@/lib/credits/constants";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  full_site_audit:    { label: "Full Site Audit",       color: "bg-blue-500" },
  aeo_check:          { label: "AEO Check",             color: "bg-purple-500" },
  blog_generation:    { label: "Blog Generation",       color: "bg-emerald-500" },
  competitor_analysis:{ label: "Competitor Analysis",   color: "bg-amber-500" },
  github_pr_fix:      { label: "GitHub Auto-fix",       color: "bg-sky-500" },
  voice_session:      { label: "Voice Session",         color: "bg-pink-500" },
  citation_gap_check: { label: "Citation Gap Check",    color: "bg-violet-500" },
  repurpose_format:   { label: "Content Repurpose",     color: "bg-orange-500" },
};

interface BalanceData {
  credits: number;
  subscriptionTier: string;
}

export function CreditUsagePanel() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/credits/balance");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <div className="card-surface p-6 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-4" />
        <div className="h-2 w-full bg-muted rounded" />
      </div>
    );
  }

  if (!data) return null;

  const monthly = monthlyCreditsForTier(data.subscriptionTier);
  const used = Math.max(0, monthly - data.credits);
  const pct = monthly > 0 ? Math.min(100, (used / monthly) * 100) : 0;
  const barColor = pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="card-surface p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Credit Usage</h3>
            <p className="text-[11px] text-muted-foreground">Resets monthly with your plan</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh balance"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Balance + bar */}
      <div>
        <div className="flex items-end justify-between mb-2">
          <div>
            <span className="text-3xl font-black text-foreground">{data.credits}</span>
            <span className="text-sm text-muted-foreground ml-1 font-medium">/ {monthly} remaining</span>
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
            pct >= 90
              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
              : pct >= 70
              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          }`}>
            {used} used
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {pct >= 80 && (
          <p className="text-[11px] text-amber-400 mt-1.5">
            Running low.{" "}
            <Link href="/dashboard/billing" className="underline font-semibold hover:text-amber-300">
              Buy a credit pack →
            </Link>
          </p>
        )}
      </div>

      {/* Cost reference table */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Credit costs per action
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(CREDIT_COSTS)
            .filter(([, cost]) => cost > 0)
            .map(([action, cost]) => {
              const meta = ACTION_LABELS[action];
              if (!meta) return null;
              return (
                <div
                  key={action}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.color}`} />
                    <span className="text-[11px] text-muted-foreground truncate">{meta.label}</span>
                  </div>
                  <span className="text-[11px] font-bold text-foreground shrink-0">{cost}cr</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
