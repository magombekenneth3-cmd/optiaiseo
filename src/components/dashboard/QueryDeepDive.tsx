"use client";

import { useEffect, useState } from "react";
import { analyzeQueryRanking, type SerpResult, type QueryAnalysisData } from "@/app/actions/queryAnalysis";
import type { PageQualityResult } from "@/lib/audit/scrapePageQuality";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  keyword: string;
  userUrl: string;
  userPosition: number;
  userClicks: number;
  userImpressions: number;
  userCtr: number;
  siteId: string;
  domain: string;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function positionColor(pos: number) {
  if (pos <= 3) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (pos <= 10) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  if (pos <= 20) return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
  return "text-red-400 bg-red-500/10 border-red-500/20";
}

function effortColor(v: string) {
  if (v === "low") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (v === "medium") return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  return "text-red-400 bg-red-500/10 border-red-500/20";
}

type ExtendedCompetitorDetail = QueryAnalysisData["competitorDetails"][number] & {
  h2Count?: number | null;
  hasFAQSchema?: boolean | null;
  hasAuthorMention?: boolean | null;
  externalLinkCount?: number | null;
  schemaBreadth?: number | null;
  avgWordsPerParagraph?: number | null;
  imageCount?: number | null;
};

type ExtendedData = QueryAnalysisData & {
  userPageQuality?: PageQualityResult;
};

// ── Gap badge ─────────────────────────────────────────────────────────────────

function GapBadge({ user, best, type }: {
  user: number | boolean | null | undefined;
  best: number | boolean | null | undefined;
  type: "numeric" | "boolean";
}) {
  if (user == null || best == null) return <span className="text-muted-foreground text-xs">—</span>;

  if (type === "boolean") {
    const u = !!user, b = !!best;
    if (u && b) return <span className="text-emerald-400 text-xs font-semibold">✓ Equal</span>;
    if (u && !b) return <span className="text-emerald-400 text-xs font-semibold">✓ You lead</span>;
    return <span className="text-red-400 text-xs font-semibold">✗ Missing</span>;
  }

  const u = user as number, b = best as number;
  if (u >= b) return <span className="text-emerald-400 text-xs font-semibold">✓ Equal or better</span>;
  if (b > u * 2) return <span className="text-red-400 text-xs font-semibold">✗ {Math.round(b / Math.max(u, 1))}× behind</span>;
  return <span className="text-amber-400 text-xs font-semibold">⚠ {Math.round(((b - u) / Math.max(b, 1)) * 100)}% gap</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QueryDeepDive({
  keyword,
  userUrl,
  userPosition,
  userClicks,
  userImpressions,
  userCtr,
  siteId,
  domain,
  onClose,
}: Props) {
  const [status, setStatus] = useState<"loading" | "done" | "error" | "rate_limited">("loading");
  const [data, setData] = useState<ExtendedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetsAt, setResetsAt] = useState<Date | null>(null);

  const run = async () => {
    setStatus("loading");
    setError(null);
    try {
      const result = await analyzeQueryRanking({
        keyword,
        userUrl,
        userPosition,
        userClicks,
        userImpressions,
        userCtr,
        siteId,
        domain,
      });

      if (!result.success) {
        if (result.rateLimited) {
          setResetsAt(result.resetsAt ?? null);
          setStatus("rate_limited");
        } else {
          setError(result.error ?? "Unknown error");
          setStatus("error");
        }
        return;
      }

      setData(result.data as ExtendedData);
      setStatus("done");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Unexpected error");
      setStatus("error");
    }
  };

  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derive best competitor for comparison table ──────────────────────────
  const bestCompetitor: ExtendedCompetitorDetail | null = (() => {
    if (!data) return null;
    const ranked = (data.competitorDetails as ExtendedCompetitorDetail[])
      .filter((c) => c.wordCount != null)
      .sort((a, b) => {
        const scoreA = (a.schemaBreadth ?? 0) * 3 + (a.wordCount ?? 0) / 500 - (a.avgWordsPerParagraph ?? 999) / 100;
        const scoreB = (b.schemaBreadth ?? 0) * 3 + (b.wordCount ?? 0) / 500 - (b.avgWordsPerParagraph ?? 999) / 100;
        return scoreB - scoreA;
      });
    return ranked[0] ?? null;
  })();

  const uq = data?.userPageQuality;

  return (
    <div className="card-surface border-t border-border">
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold border ${positionColor(userPosition)}`}>
            #{userPosition}
          </span>
          <span className="font-semibold text-sm truncate">{keyword}</span>
          {status === "loading" && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              Analysing — fetching SERP, scraping pages, running AI…
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground transition-colors text-sm"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* ── RATE LIMITED ────────────────────────────────────────────────────── */}
      {status === "rate_limited" && (
        <div className="px-4 py-6 text-sm text-muted-foreground text-center">
          <p className="font-semibold text-foreground mb-1">Daily limit reached</p>
          <p>
            You&apos;ve used your 20 daily query analyses.
            {resetsAt && (
              <> Resets at {resetsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</>
            )}
          </p>
        </div>
      )}

      {/* ── ERROR ───────────────────────────────────────────────────────────── */}
      {status === "error" && (
        <div className="px-4 py-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-red-400">Analysis failed — {error}</span>
          <button
            onClick={run}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded border border-border hover:bg-card transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── DONE ────────────────────────────────────────────────────────────── */}
      {status === "done" && data && (
        <div className="divide-y divide-border">

          {/* 1. SERP SNAPSHOT */}
          <section className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              SERP Snapshot — top 10 results
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-1.5 text-left w-8">#</th>
                    <th className="pb-1.5 text-left">Domain</th>
                    <th className="pb-1.5 text-left hidden sm:table-cell">Title</th>
                    <th className="pb-1.5 text-left hidden md:table-cell">Snippet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.serpResults.map((r: SerpResult) => (
                    <tr
                      key={r.position}
                      className={`transition-colors ${
                        r.isUserUrl
                          ? "border-l-2 border-l-emerald-500 bg-emerald-500/5"
                          : r.position < userPosition
                          ? "border-l-2 border-l-red-500/40 bg-red-500/3"
                          : ""
                      }`}
                    >
                      <td className="py-1.5 pr-2 font-bold tabular-nums text-muted-foreground">
                        {r.position}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium">{r.domain}</span>
                          {r.isUserUrl && (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              YOU
                            </span>
                          )}
                          {!r.isUserUrl && r.position < userPosition && (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                              rival
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 hidden sm:table-cell max-w-[200px] truncate text-foreground">
                        {r.title}
                      </td>
                      <td className="py-1.5 hidden md:table-cell max-w-[260px] text-muted-foreground">
                        {r.snippet.slice(0, 80)}{r.snippet.length > 80 ? "…" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 2. CONTENT QUALITY COMPARISON TABLE */}
          {bestCompetitor && (
            <section className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Content Quality Comparison
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="pb-1.5 text-left">Signal</th>
                      <th className="pb-1.5 text-right">You</th>
                      <th className="pb-1.5 text-right">Best Competitor ({bestCompetitor.domain})</th>
                      <th className="pb-1.5 text-right">Gap</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 text-xs">
                    {[
                      {
                        label: "Word count",
                        user: uq?.wordCount,
                        best: bestCompetitor.wordCount,
                        type: "numeric" as const,
                      },
                      {
                        label: "H2 sections",
                        user: uq?.h2s.length,
                        best: bestCompetitor.h2Count,
                        type: "numeric" as const,
                      },
                      {
                        label: "FAQ schema",
                        user: uq?.hasFAQSchema,
                        best: bestCompetitor.hasFAQSchema,
                        type: "boolean" as const,
                      },
                      {
                        label: "Author mentioned",
                        user: uq?.hasAuthorMention,
                        best: bestCompetitor.hasAuthorMention,
                        type: "boolean" as const,
                      },
                      {
                        label: "External citations",
                        user: uq?.externalLinkCount,
                        best: bestCompetitor.externalLinkCount,
                        type: "numeric" as const,
                      },
                      {
                        label: "Schema types",
                        user: uq?.schemaBreadth,
                        best: bestCompetitor.schemaBreadth,
                        type: "numeric" as const,
                      },
                      {
                        label: "Avg words/paragraph",
                        user: uq?.avgWordsPerParagraph,
                        best: bestCompetitor.avgWordsPerParagraph,
                        // lower is better — invert for display
                        type: "numeric" as const,
                      },
                      {
                        label: "Images",
                        user: uq?.imageCount,
                        best: bestCompetitor.imageCount,
                        type: "numeric" as const,
                      },
                    ].map(({ label, user, best, type }) => (
                      <tr key={label} className="py-1">
                        <td className="py-1.5 text-muted-foreground">{label}</td>
                        <td className="py-1.5 text-right font-medium tabular-nums">
                          {user != null ? (typeof user === "boolean" ? (user ? "Yes" : "No") : user) : "—"}
                        </td>
                        <td className="py-1.5 text-right font-medium tabular-nums">
                          {best != null ? (typeof best === "boolean" ? (best ? "Yes" : "No") : best) : "—"}
                        </td>
                        <td className="py-1.5 text-right">
                          <GapBadge user={user} best={best} type={type} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 3. COMPETITOR ADVANTAGE CARDS */}
          {data.analysis.competitorAdvantages.length > 0 && (
            <section className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Why They Rank Higher
              </p>
              <div className="space-y-2">
                {data.analysis.competitorAdvantages.map((c, i) => {
                  const detail = (data.competitorDetails as ExtendedCompetitorDetail[])
                    .find((d) => d.domain === c.domain);
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-card/30 p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${positionColor(c.position)}`}>
                          #{c.position}
                        </span>
                        <span className="font-semibold">{c.domain}</span>
                        {detail?.wordCount != null && uq?.wordCount != null && (
                          <span className="text-muted-foreground ml-auto">
                            Their page: ~{detail.wordCount.toLocaleString()} words | Yours: ~{uq.wordCount.toLocaleString()} words
                          </span>
                        )}
                      </div>
                      <p className="text-foreground leading-relaxed">{c.whyTheyRankHigher}</p>
                      {c.contentQualityEdge && (
                        <p className="text-muted-foreground leading-relaxed">{c.contentQualityEdge}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 4. AI ANALYSIS SECTIONS */}
          <section className="p-4 space-y-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                Why You&apos;re Here
              </p>
              <p className="text-sm leading-relaxed">{data.analysis.positionDiagnosis}</p>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                Content Gap
              </p>
              <p className="text-sm leading-relaxed">{data.analysis.contentGap}</p>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                CTR Assessment
              </p>
              <p className={`text-sm leading-relaxed ${
                userCtr < 3 && userPosition <= 10 ? "text-amber-400" : ""
              }`}>
                {data.analysis.ctrAssessment}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                Honest Verdict
              </p>
              <p className="text-sm leading-relaxed text-base">{data.analysis.honestVerdict}</p>
            </div>
          </section>

          {/* 5. ACTION ITEMS */}
          <section className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Action Items
              </p>
              <span className="text-[10px] text-muted-foreground">
                Specific to: <span className="font-semibold text-foreground">{keyword}</span>
              </span>
            </div>
            <ol className="space-y-3">
              {[...data.analysis.actions]
                .sort((a, b) => a.priority - b.priority)
                .map((action, i) => (
                  <li key={i} className="flex gap-3 text-xs">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground mt-0.5">
                      {action.priority}
                    </span>
                    <div className="flex-1 space-y-1">
                      <p className="font-semibold leading-snug text-foreground">{action.action}</p>
                      <p className="text-muted-foreground leading-relaxed">{action.why}</p>
                      <div className="flex gap-2 pt-0.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${effortColor(action.effort)}`}>
                          Effort: {action.effort}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${effortColor(action.impact)}`}>
                          Impact: {action.impact}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
