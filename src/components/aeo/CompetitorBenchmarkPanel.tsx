"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, Users } from "lucide-react";

type CompetitorEntry = {
  name: string;
  count: number;
};

type KeywordRow = {
  keyword: string;
  mentionRate: number;
  totalQueries: number;
  topCompetitors: CompetitorEntry[];
};

interface Props {
  keywords: KeywordRow[];
  domain: string;
}

function MentionBar({ rate }: { rate: number }) {
  const color = rate >= 60 ? "#10b981" : rate >= 30 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-muted/40">
        <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${rate}%`, background: color }} />
      </div>
      <span className="text-xs font-bold shrink-0" style={{ color }}>{rate}%</span>
    </div>
  );
}

function TrendIndicator({ rate }: { rate: number }) {
  if (rate >= 50) return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />;
  if (rate >= 25) return <Minus className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />;
  return <TrendingDown className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />;
}

export function CompetitorBenchmarkPanel({ keywords, domain }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (keywords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <div className="w-10 h-10 rounded-xl bg-muted/40 border border-border flex items-center justify-center">
          <Users className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No keyword data yet</p>
        <p className="text-xs text-muted-foreground/60">Run an AEO share of voice check to see competitor benchmarks.</p>
      </div>
    );
  }

  const allCompetitors = keywords.flatMap((k) => k.topCompetitors);
  const competitorMap = new Map<string, number>();
  for (const c of allCompetitors) {
    competitorMap.set(c.name, (competitorMap.get(c.name) ?? 0) + c.count);
  }
  const topCompetitors = [...competitorMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const avgMentionRate = Math.round(keywords.reduce((s, k) => s + k.mentionRate, 0) / keywords.length);
  const dominated = keywords.filter((k) => k.mentionRate < 30).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Your avg citation</p>
          <p className="text-2xl font-black" style={{ color: avgMentionRate >= 50 ? "#10b981" : avgMentionRate >= 25 ? "#f59e0b" : "#ef4444" }}>
            {avgMentionRate}%
          </p>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Keywords tracked</p>
          <p className="text-2xl font-black">{keywords.length}</p>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Dominated by rivals</p>
          <p className="text-2xl font-black text-red-400">{dominated}</p>
        </div>
      </div>

      {topCompetitors.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Top competitors stealing your citations</p>
          <div className="space-y-2">
            {topCompetitors.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground truncate">{name}</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                  {count} mentions
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Keyword-level citation rates for {domain}</p>
        {keywords.map((kw) => (
          <div key={kw.keyword}>
            <button
              onClick={() => setExpanded(expanded === kw.keyword ? null : kw.keyword)}
              aria-expanded={expanded === kw.keyword}
              aria-label={`Toggle details for keyword: ${kw.keyword}`}
              className="w-full flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-accent transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <TrendIndicator rate={kw.mentionRate} />
                <span className="text-sm font-medium text-foreground truncate">{kw.keyword}</span>
              </div>
              <div className="w-36 shrink-0">
                <MentionBar rate={kw.mentionRate} />
              </div>
            </button>

            {expanded === kw.keyword && (
              <div className="ml-6 mr-2 mb-2 p-3 rounded-xl border border-border bg-card/50 space-y-2">
                <p className="text-xs text-muted-foreground">{kw.totalQueries} total queries</p>
                {kw.topCompetitors.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Also cited:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {kw.topCompetitors.map((c) => (
                        <span key={c.name} className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                          {c.name} ({c.count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
