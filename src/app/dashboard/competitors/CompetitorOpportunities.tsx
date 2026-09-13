"use client";

import { ArrowRight, Sparkles } from "lucide-react";

type KW = { id: string; keyword: string; position: number; searchVolume: number; difficulty: number | null; clicks: number | null; dataSource: string | null };
type Snapshot = { month: string; traffic: number; organicKeywords: number | null };
type Competitor = {
  id: string;
  domain: string;
  addedAt: string | Date;
  metadata: Record<string, unknown> | null;
  keywords: KW[];
  snapshots: Snapshot[];
};

const CTR_BENCH: Record<number, number> = {
  1: 0.276, 2: 0.158, 3: 0.110, 4: 0.084, 5: 0.063,
  6: 0.049, 7: 0.039, 8: 0.033, 9: 0.027, 10: 0.024,
};

function estClicks(kw: KW): number {
  const ctr = CTR_BENCH[Math.min(kw.position, 10)] ?? 0.01;
  return Math.max(0, Math.round(kw.searchVolume * ctr));
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function impactLabel(est: number): { text: string; color: string; bg: string } {
  if (est >= 50) return { text: "High Impact", color: "#f85149", bg: "rgba(248,81,73,0.12)" };
  if (est >= 20) return { text: "High Impact", color: "#d29922", bg: "rgba(210,153,34,0.12)" };
  return { text: "Medium", color: "#388bfd", bg: "rgba(56,139,253,0.12)" };
}

interface OpportunityItem {
  kw: KW;
  comp: Competitor;
  est: number;
  action: string;
}

function buildOpportunities(competitors: Competitor[]): OpportunityItem[] {
  const items: OpportunityItem[] = [];

  for (const comp of competitors) {
    for (const kw of comp.keywords) {
      const est = estClicks(kw);
      if (est <= 0) continue;
      const action = kw.position <= 10
        ? "Improve existing page"
        : kw.position <= 20
          ? "Optimize and push to page 1"
          : "Create supporting content";
      items.push({ kw, comp, est, action });
    }
  }

  return items.sort((a, b) => b.est - a.est).slice(0, 5);
}

function Favicon({ domain }: { domain: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      className="w-4 h-4 rounded-sm"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

export function CompetitorOpportunities({ competitors, totalGapCount, onReview }: {
  competitors: Competitor[];
  totalGapCount: number;
  onReview: (comp: Competitor) => void;
}) {
  const opportunities = buildOpportunities(competitors);

  if (opportunities.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#161b22]">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-[#e6edf3]">Opportunities to Overtake</h2>
          <span className="text-[10px] font-medium text-[#6e7681] flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#d29922]" />
            AI-ranked
          </span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#388bfd]/10 text-[#388bfd] border border-[#388bfd]/20 tabular-nums">
          {totalGapCount} opportunities
        </span>
      </div>

      <div className="divide-y divide-[#161b22]">
        {opportunities.map((item, i) => {
          const impact = impactLabel(item.est);
          return (
            <div key={`${item.comp.id}-${item.kw.id}-${i}`} className="px-5 py-4 hover:bg-[#0f1318] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ color: impact.color, background: impact.bg }}
                    >
                      {impact.text}
                    </span>
                    <span className="text-[13px] font-semibold text-[#e6edf3] truncate">{item.kw.keyword}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[#6e7681] mb-2">
                    <Favicon domain={item.comp.domain} />
                    <span>{item.comp.domain} ranks #{item.kw.position}</span>
                    <span className="text-[#30363d]">·</span>
                    <span>{fmt(item.kw.searchVolume)} searches/mo</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[#8b949e]">{item.action}</span>
                    <span className="text-[11px] font-semibold text-[#2ea043]">
                      Est. +{item.est} clicks/mo
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onReview(item.comp)}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#388bfd] border border-[#388bfd]/20 bg-[#388bfd]/8 hover:bg-[#388bfd]/15 transition-colors"
                >
                  Review <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
