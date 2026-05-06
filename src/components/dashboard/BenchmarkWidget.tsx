"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Users } from "lucide-react";

interface BenchmarkStat {
  metric: string;
  p25:    number;
  p50:    number;
  p75:    number;
  p90:    number;
  sampleSize: number;
}

interface Props {
  siteId:   string;
  aeoScore: number | null;
  niche:    string | null;
}

const METRIC_LABELS: Record<string, string> = {
  aeoScore:     "AI Visibility Score",
  overallScore: "SEO Score",
  lcp:          "LCP",
  cls:          "CLS",
};

function getPercentileLabel(score: number, stat: BenchmarkStat): {
  label: string;
  pct: number;
  color: string;
  Icon: typeof TrendingUp;
} {
  if (score >= stat.p90) return { label: "Top 10%", pct: 90, color: "text-emerald-400", Icon: TrendingUp };
  if (score >= stat.p75) return { label: "Top 25%", pct: 75, color: "text-blue-400",   Icon: TrendingUp };
  if (score >= stat.p50) return { label: "Above average", pct: 50, color: "text-sky-400", Icon: TrendingUp };
  if (score >= stat.p25) return { label: "Below average", pct: 25, color: "text-amber-400", Icon: Minus };
  return { label: "Bottom 25%", pct: 0, color: "text-rose-400", Icon: TrendingDown };
}

export function BenchmarkWidget({ siteId, aeoScore, niche }: Props) {
  const [stats, setStats]   = useState<BenchmarkStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!siteId) return;
    fetch(`/api/benchmarks?siteId=${siteId}`)
      .then((r) => r.json())
      .then((d) => setStats(d.stats ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [siteId]);

  const aeoStat = stats.find((s) => s.metric === "aeoScore");

  if (loading) {
    return (
      <div className="card-surface p-5 flex flex-col gap-3 animate-pulse">
        <div className="h-4 bg-muted/40 rounded w-40" />
        <div className="h-20 bg-muted/30 rounded" />
      </div>
    );
  }

  if (!aeoStat || aeoScore === null) return null;

  const { label, color, Icon } = getPercentileLabel(aeoScore, aeoStat);
  const industryLabel = niche ? niche.charAt(0).toUpperCase() + niche.slice(1) : "your industry";

  // Sparkline bar positions
  const markers = [
    { pct: aeoStat.p25, label: "25th" },
    { pct: aeoStat.p50, label: "50th" },
    { pct: aeoStat.p75, label: "75th" },
    { pct: aeoStat.p90, label: "90th" },
  ];

  return (
    <div className="card-surface p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
            Industry Benchmark
          </p>
          <h3 className="text-sm font-semibold leading-tight">
            How you compare to {industryLabel} sites
          </h3>
        </div>
        <div className={`flex items-center gap-1 text-sm font-bold ${color}`}>
          <Icon className="w-4 h-4" />
          {label}
        </div>
      </div>

      {/* Visual percentile bar */}
      <div className="relative">
        <div className="h-2.5 bg-muted/40 rounded-full overflow-hidden">
          {/* gradient fill up to the user's score */}
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400"
            style={{ width: `${Math.min(100, aeoScore)}%` }}
          />
        </div>
        {/* percentile tick marks */}
        {markers.map((m) => (
          <div
            key={m.label}
            className="absolute top-0 bottom-0 w-px bg-muted-foreground/30"
            style={{ left: `${m.pct}%` }}
          />
        ))}
        {/* user score dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-primary shadow-sm"
          style={{ left: `calc(${Math.min(100, aeoScore)}% - 8px)` }}
          title={`Your AI Visibility Score: ${aeoScore}`}
        />
      </div>

      {/* Percentile labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground -mt-1">
        <span>0</span>
        {markers.map((m) => (
          <span key={m.label} style={{ left: `${m.pct}%` }}>{m.pct}</span>
        ))}
        <span>100</span>
      </div>

      {/* Insight line */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        Sites in <strong>{industryLabel}</strong> get an average AI Visibility Score of{" "}
        <strong>{aeoStat.p50}</strong> (median). You&apos;re at{" "}
        <strong className={color}>{aeoScore}</strong>
        {aeoScore >= aeoStat.p50
          ? " — above average. Keep it up."
          : " — there's room to improve. See your top gaps below."}
      </p>

      {/* Sample size */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 border-t border-border pt-2">
        <Users className="w-3 h-3" />
        Based on {aeoStat.sampleSize.toLocaleString()} sites in the last 90 days
      </div>
    </div>
  );
}
