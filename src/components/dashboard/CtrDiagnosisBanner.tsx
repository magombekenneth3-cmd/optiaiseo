"use client";

import { AlertTriangle, TrendingUp, ArrowRight } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// CTR benchmarks (Backlinko / AWR 2024 industry averages)
// ---------------------------------------------------------------------------
const CTR_BENCHMARKS: Array<{ maxPos: number; expectedPct: number }> = [
  { maxPos: 1,  expectedPct: 27.6 },
  { maxPos: 2,  expectedPct: 15.8 },
  { maxPos: 3,  expectedPct: 11.0 },
  { maxPos: 5,  expectedPct: 6.3  },
  { maxPos: 7,  expectedPct: 4.2  },
  { maxPos: 10, expectedPct: 2.8  },
];

function benchmarkCtrPct(position: number): number {
  const bucket = CTR_BENCHMARKS.find((b) => position <= b.maxPos);
  return bucket?.expectedPct ?? 1.0;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface GscKeyword {
  keyword: string;
  position: number;
  ctr: number;
  impressions: number;
  clicks: number;
  url?: string;
}

interface CtrOffender {
  keyword: string;
  position: number;
  actualCtr: number;
  expectedCtr: number;
  impressions: number;
  missedClicks: number;
  url: string | undefined;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------
function findCtrOffenders(keywords: GscKeyword[]): CtrOffender[] {
  return keywords
    .filter((kw) => kw.position <= 10 && kw.impressions >= 10)
    .map((kw) => {
      const expected     = benchmarkCtrPct(Math.round(kw.position));
      const gap          = Math.max(0, expected - kw.ctr);
      const missedClicks = Math.round((gap / 100) * kw.impressions);
      return { keyword: kw.keyword, position: kw.position, actualCtr: kw.ctr, expectedCtr: expected, impressions: kw.impressions, missedClicks, url: kw.url };
    })
    .filter((o) => o.missedClicks >= 3)
    .sort((a, b) => b.missedClicks - a.missedClicks)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function CtrDiagnosisBanner({
  keywords,
  domain,
}: {
  keywords: GscKeyword[];
  domain: string;
}) {
  const offenders     = findCtrOffenders(keywords);
  const totalMissed   = offenders.reduce((s, o) => s + o.missedClicks, 0);
  const worstOffender = offenders[0];

  if (offenders.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-start gap-4 px-6 pt-5 pb-4 border-b border-amber-500/15">
        <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-amber-300 mb-0.5">
            Ranking without earning clicks
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {offenders.length} page-1 keyword{offenders.length > 1 ? "s rank" : " ranks"} in the top 10 but underperform industry CTR benchmarks.
            That&apos;s an estimated{" "}
            <span className="text-amber-300 font-semibold">{totalMissed} clicks/month</span>{" "}
            currently lost to competitors with better titles and meta descriptions.
          </p>
        </div>
        {/* PATCH: pill badge — was a plain number, now has label for instant context */}
        <div className="shrink-0 hidden sm:flex flex-col items-end gap-0.5">
          <span className="text-2xl font-bold text-amber-300">{totalMissed}</span>
          <span className="text-xs text-muted-foreground">missed clicks/mo</span>
        </div>
      </div>

      {/* ── Offenders table ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-amber-500/10">
              <th className="px-6 py-2.5 text-muted-foreground font-medium">Keyword</th>
              <th className="px-4 py-2.5 text-muted-foreground font-medium text-center">Pos</th>
              <th className="px-4 py-2.5 text-muted-foreground font-medium text-right">Your CTR</th>
              <th className="px-4 py-2.5 text-muted-foreground font-medium text-right">Expected</th>
              <th className="px-4 py-2.5 text-muted-foreground font-medium text-right">Missed clicks</th>
              <th className="px-4 py-2.5 text-muted-foreground font-medium text-right pr-6">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-500/10">
            {offenders.map((o) => (
              <tr key={o.keyword} className="hover:bg-amber-500/5 transition-colors">
                <td className="px-6 py-3 font-medium max-w-[200px] truncate">
                  {o.keyword}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                    #{Math.round(o.position)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-rose-400 font-semibold">
                  {o.actualCtr.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {o.expectedCtr.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right font-semibold text-amber-300">
                  ~{o.missedClicks}/mo
                </td>
                <td className="px-4 py-3 text-right pr-6">
                  {/* PATCH: was a plain text link — now a visible pill button matching the amber theme */}
                  <Link
                    href={`/dashboard/audits?url=${encodeURIComponent(`https://${domain}${o.url ?? ""}`)}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-colors"
                  >
                    Fix title <ArrowRight className="w-3 h-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Call to action footer ── */}
      {/* PATCH: was a 60-word paragraph — now a scannable 3-step list */}
      {worstOffender && (
        <div className="px-6 py-4 flex items-start justify-between gap-6 border-t border-amber-500/10">
          <div className="text-xs text-muted-foreground space-y-1 max-w-lg">
            <p className="font-medium text-foreground mb-1.5">
              Quick fix for &ldquo;{worstOffender.keyword}&rdquo;:
            </p>
            <p>
              1. Rewrite{" "}
              <code className="text-xs bg-card px-1 py-0.5 rounded border border-border">&lt;title&gt;</code>
              {" "}— add a number, year, or benefit. Keep under 60 chars.
            </p>
            <p>2. Update meta description with a clear hook + micro-CTA.</p>
            <p>
              3. A 1% CTR lift on {worstOffender.impressions} impressions ={" "}
              <span className="text-amber-300 font-semibold">
                ~{Math.round(worstOffender.impressions * 0.01)} extra free clicks/month.
              </span>
            </p>
          </div>
          <Link
            href="/dashboard/audits/new"
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Run audit on this page
          </Link>
        </div>
      )}
    </div>
  );
}
