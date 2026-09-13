"use client";

import { ArrowUpRight, TrendingUp } from "lucide-react";

type Snapshot = { month: string; traffic: number; organicKeywords: number | null };
type Competitor = {
  id: string;
  domain: string;
  addedAt: string | Date;
  metadata: Record<string, unknown> | null;
  keywords: { id: string; keyword: string; position: number; searchVolume: number; difficulty: number | null; clicks: number | null; dataSource: string | null }[];
  snapshots: Snapshot[];
};

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

function MiniSpark({ snapshots, color }: { snapshots: Snapshot[]; color: string }) {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const vals = sorted.map(s => s.traffic);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const r = hi - lo || 1;
  const w = 80, h = 28, px = 4, py = 4;

  const pts = vals.map((v, i) => ({
    x: px + (i / (vals.length - 1)) * (w - px * 2),
    y: py + ((hi - v) / r) * (h - py * 2),
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("");
  const area = `${line}L${pts.at(-1)!.x},${h}L${pts[0].x},${h}Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0">
      <defs>
        <linearGradient id={`mv-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#mv-${color.replace("#", "")})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CompetitorMovement({ competitors, onViewAll }: {
  competitors: Competitor[];
  onViewAll: () => void;
}) {
  const movers = competitors
    .filter(c => c.snapshots.length >= 2)
    .map(c => ({ comp: c, ...getTrafficDelta(c.snapshots) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const gaining = movers.filter(m => m.direction === "up").length;

  if (movers.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#161b22]">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-[#2ea043]" />
          <h2 className="text-[14px] font-semibold text-[#e6edf3]">Competitive Movement</h2>
        </div>
        {gaining > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#2ea043]/10 text-[#2ea043] border border-[#2ea043]/20">
            ↑ {gaining} gaining visibility
          </span>
        )}
      </div>

      <div className="divide-y divide-[#161b22]">
        {movers.map(({ comp, pct, direction }) => {
          const meta = comp.metadata as Record<string, unknown> | null;
          const traffic = meta?.estimatedMonthlyVisits as number | null;
          const orgKws = meta?.organicKeywords as number | null;
          const color = direction === "up" ? "#2ea043" : direction === "down" ? "#f85149" : "#6e7681";

          return (
            <div key={comp.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#0f1318] transition-colors">
              <Favicon domain={comp.domain} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-[#e6edf3] truncate">{comp.domain}</p>
              </div>
              <div className="hidden sm:flex items-center gap-4 text-right">
                <div>
                  <p className="text-[12px] font-bold text-[#c9d1d9] tabular-nums">{fmt(traffic)}</p>
                  <p className="text-[9px] text-[#6e7681]">Traffic</p>
                </div>
                <div>
                  <p className="text-[12px] font-bold text-[#c9d1d9] tabular-nums">{fmt(orgKws)}</p>
                  <p className="text-[9px] text-[#6e7681]">Keywords</p>
                </div>
              </div>
              <MiniSpark snapshots={comp.snapshots} color={color} />
              <span
                className="text-[11px] font-semibold tabular-nums w-12 text-right"
                style={{ color }}
              >
                {pct > 0 ? "+" : ""}{pct}%
              </span>
            </div>
          );
        })}
      </div>

      <button
        onClick={onViewAll}
        className="flex items-center justify-center gap-1 w-full px-5 py-2 border-t border-[#161b22] text-[11px] font-semibold text-[#388bfd] hover:bg-[#0f1318] transition-colors"
      >
        View market movement <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );
}
