"use client";

import { useState, useCallback } from "react";
import { Microscope, RefreshCw, X, AlertTriangle, CheckCircle, XCircle, TrendingUp, TrendingDown, Link, FileText, Target, Layers } from "lucide-react";
import { analyseKeywordVsSerp, forceRefreshSerpAnalysis, type SerpAnalysisResult, type SerpFix } from "@/app/actions/serp-analysis";

type TabId = "serp" | "fixes" | "headings" | "authority";

interface Props {
  keyword: string;
  position: number;
  impressions: number;
  clicks: number;
  landingUrl: string;
  siteId: string;
}

function positionColor(p: number) {
  if (p <= 3)  return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (p <= 10) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  if (p <= 20) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  return "text-red-400 bg-red-500/10 border-red-500/20";
}

function gapColor(gap: number | null, threshold: number) {
  if (gap === null) return "text-muted-foreground";
  return gap > threshold ? "text-red-400" : gap > threshold * 0.5 ? "text-amber-400" : "text-emerald-400";
}

function PriorityBadge({ priority }: { priority: SerpFix["priority"] }) {
  const map = {
    high:   "bg-red-500/15 text-red-400 border border-red-500/25",
    medium: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
    low:    "bg-zinc-500/15 text-zinc-400 border border-zinc-500/25",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${map[priority]}`}>{priority}</span>;
}

function CategoryIcon({ cat }: { cat: SerpFix["category"] }) {
  const icons: Record<string, JSX.Element> = {
    content:   <FileText className="w-4 h-4 text-blue-400" />,
    structure: <Layers className="w-4 h-4 text-purple-400" />,
    intent:    <Target className="w-4 h-4 text-orange-400" />,
    links:     <Link className="w-4 h-4 text-cyan-400" />,
    authority: <TrendingUp className="w-4 h-4 text-red-400" />,
    schema:    <FileText className="w-4 h-4 text-zinc-400" />,
  };
  return icons[cat] ?? <FileText className="w-4 h-4 text-zinc-400" />;
}

function MetricCard({ label, value, sub, colorClass }: { label: string; value: string; sub?: string; colorClass?: string }) {
  return (
    <div className="bg-card/60 border border-border rounded-xl p-4 flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${colorClass ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 p-4 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => <div key={i} className="h-20 rounded-xl bg-muted/30" />)}
      </div>
      {[0,1,2].map(i => <div key={i} className="h-16 rounded-xl bg-muted/20" />)}
    </div>
  );
}

export function KeywordSerpPanel({ keyword, position, impressions, clicks, landingUrl, siteId }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("serp");
  const [data, setData] = useState<SerpAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggered, setTriggered] = useState(false);

  const run = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    setTriggered(true);
    const fn = force ? forceRefreshSerpAnalysis : analyseKeywordVsSerp;
    const res = await fn(siteId, keyword, landingUrl);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setData(res.data);
  }, [siteId, keyword, landingUrl]);

  const ctrPotential = impressions > 0
    ? Math.round(((impressions * 0.278 - clicks) / impressions) * 100)
    : 0;

  const wordDelta = data ? data.wordCountYourPage - data.wordCountAvgTop10 : 0;
  const wordDeltaColor = !data ? "" : wordDelta >= 0 ? "text-emerald-400" : Math.abs(wordDelta) / data.wordCountAvgTop10 > 0.4 ? "text-red-400" : "text-amber-400";

  const tabs: { id: TabId; label: string }[] = [
    { id: "serp",      label: "SERP Comparison" },
    { id: "fixes",     label: `Fix Suggestions${data ? ` (${data.fixes.length})` : ""}` },
    { id: "headings",  label: "Heading Gaps" },
    { id: "authority", label: "Link Authority" },
  ];

  if (!triggered) {
    return (
      <div className="border-t border-border bg-card/30 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => run()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors"
        >
          <Microscope className="w-4 h-4" />
          Analyse vs SERP
        </button>
        <p className="text-xs text-muted-foreground">Fetches live SERP data + backlink authority comparison</p>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-[#0d1117]/60 backdrop-blur-sm">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50">
        <div className="flex items-center gap-2 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                activeTab === t.id
                  ? "bg-primary/15 border border-primary/25 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >{t.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data && (
            <span className="text-xs text-muted-foreground">
              Cached · {new Date(data.cachedAt).toLocaleDateString()}
            </span>
          )}
          <button onClick={() => run(true)} disabled={loading}
            className="p-1.5 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && <Skeleton />}

      {!loading && error && (
        <div className="px-6 py-8 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={() => run(true)} className="text-xs text-primary hover:underline">Retry</button>
        </div>
      )}

      {!loading && data && (
        <div className="p-4 md:p-6">
          {activeTab === "serp" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <MetricCard
                  label="Your Position"
                  value={`#${position}`}
                  sub={`Page ${Math.ceil(position / 10)}`}
                  colorClass={position <= 3 ? "text-emerald-400" : position <= 10 ? "text-blue-400" : position <= 20 ? "text-amber-400" : "text-red-400"}
                />
                <MetricCard
                  label="Content Gap"
                  value={`${wordDelta >= 0 ? "+" : ""}${wordDelta.toLocaleString()} words`}
                  sub={`Avg top-10: ${data.wordCountAvgTop10.toLocaleString()} · Yours: ${data.wordCountYourPage.toLocaleString()}`}
                  colorClass={wordDeltaColor}
                />
                <MetricCard
                  label="DR vs Top 3"
                  value={data.clientDR ? `DR ${data.clientDR}` : "—"}
                  sub={data.drGap !== null ? `Gap: ${data.drGap > 0 ? "-" : "+"}${Math.abs(data.drGap)}` : "No data"}
                  colorClass={gapColor(data.drGap, 20)}
                />
                <MetricCard
                  label="Page RDs"
                  value={`${data.pageRDs} RDs`}
                  sub="Referring domains to this page"
                  colorClass={data.pageRDs < 5 ? "text-red-400" : data.pageRDs < 20 ? "text-amber-400" : "text-emerald-400"}
                />
                <MetricCard
                  label="CTR Potential"
                  value={`+${ctrPotential}%`}
                  sub="If top 3"
                  colorClass={ctrPotential > 20 ? "text-emerald-400" : "text-muted-foreground"}
                />
              </div>

              {data.intentMismatch && data.intentNote && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-300">{data.intentNote}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top SERP Results</p>
                {data.serpResults.map(r => (
                  <div key={r.position}
                    className={`rounded-xl border p-4 ${r.url === landingUrl ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card/40"}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs font-bold border ${positionColor(r.position)}`}>
                        #{r.position}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">{r.domain}</span>
                          {r.url === landingUrl && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">Your page</span>}
                        </div>
                        <p className="text-sm font-medium mt-0.5 truncate">{r.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.snippet}</p>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {r.wordCount > 0 && <span className="text-xs text-muted-foreground">{r.wordCount.toLocaleString()} words</span>}
                          {r.h2Count > 0  && <span className="text-xs text-muted-foreground">{r.h2Count} H2s</span>}
                          {r.contentType  && <span className="text-xs px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">{r.contentType}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "fixes" && (
            <div className="space-y-3">
              {data.disclaimerNeeded && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/8 px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-300">Ranking timeline note</p>
                    <p className="text-xs text-blue-300/80 mt-1">
                      The authority gap for this keyword is significant. Content improvements help quality signals, but closing a 100+ RD gap typically takes 3–6 months of consistent outreach. Set realistic expectations before starting.
                    </p>
                  </div>
                </div>
              )}
              {data.fixes.map((fix, i) => (
                <div key={i} className="rounded-xl border border-border bg-card/40 p-4">
                  <div className="flex items-start gap-3">
                    <CategoryIcon cat={fix.category} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <PriorityBadge priority={fix.priority} />
                        <p className="text-sm font-semibold">{fix.title}</p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{fix.description}</p>
                      {fix.linkToTab && (
                        <button
                          onClick={() => setActiveTab(fix.linkToTab === "heading-gaps" ? "headings" : "authority")}
                          className="mt-2 text-xs text-primary hover:underline"
                        >
                          {fix.linkToTab === "heading-gaps" ? "Go to Heading Gaps →" : "Go to Link Authority →"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {data.fixes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No fix suggestions generated.</p>
              )}
            </div>
          )}

          {activeTab === "headings" && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Topic / H2 Heading</th>
                    <th className="px-4 py-3 text-center">Freq in Top 10</th>
                    <th className="px-4 py-3 text-center">Your Page</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.headingGaps.sort((a, b) => b.freqInTop10 - a.freqInTop10).map((gap, i) => (
                    <tr key={i} className="hover:bg-card/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{gap.topic}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-semibold ${gap.freqInTop10 >= 7 ? "text-red-400" : gap.freqInTop10 >= 4 ? "text-amber-400" : "text-muted-foreground"}`}>
                          {gap.freqInTop10}/10
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {gap.coveredOnYourPage
                          ? <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto" />
                          : <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                        }
                      </td>
                    </tr>
                  ))}
                  {data.headingGaps.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">No heading gap data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "authority" && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Authority Comparison</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <MetricCard
                    label="Your Domain Rating"
                    value={data.clientDR ? `DR ${data.clientDR}` : "—"}
                    sub={data.drGap !== null ? `Gap vs top competitor: −${Math.abs(data.drGap)}` : "No competitor data"}
                    colorClass={gapColor(data.drGap, 20)}
                  />
                  <MetricCard
                    label="Referring Domains (Root)"
                    value={data.clientRDs.toLocaleString()}
                    sub={data.rdGapRoot !== null ? `Gap: −${data.rdGapRoot.toLocaleString()}` : ""}
                    colorClass={data.rdGapRoot !== null && data.rdGapRoot > 500 ? "text-red-400" : "text-foreground"}
                  />
                  <MetricCard
                    label="Page RDs"
                    value={`${data.pageRDs}`}
                    sub="Referring domains to this page"
                    colorClass={data.pageRDs < 5 ? "text-red-400" : data.pageRDs < 20 ? "text-amber-400" : "text-emerald-400"}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Backlink Profile Health</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <MetricCard
                    label="Toxic Backlinks"
                    value={`${data.toxicCount} toxic`}
                    colorClass={data.toxicCount > 20 ? "text-red-400" : data.toxicCount > 5 ? "text-amber-400" : "text-emerald-400"}
                  />
                  <MetricCard
                    label="New vs Lost (7d)"
                    value={`+${data.newLastWeek} · −${data.lostLastWeek}`}
                    colorClass={data.newLastWeek >= data.lostLastWeek ? "text-emerald-400" : "text-red-400"}
                  />
                  <MetricCard
                    label="Dofollow Ratio"
                    value={data.dofollowRatio ? `${data.dofollowRatio}%` : "—"}
                  />
                </div>
              </div>

              {data.topAnchors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top Anchor Text</p>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                        <tr>
                          <th className="px-4 py-3">Anchor</th>
                          <th className="px-4 py-3 text-right">Count</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.topAnchors.slice(0, 8).map((a, i) => (
                          <tr key={i} className="hover:bg-card/30 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-xs">{a.anchor || "(empty)"}</td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{a.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {data.opportunityDoms.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Outreach Opportunities</p>
                  <p className="text-xs text-muted-foreground mb-3">Domains linking to your top competitor but not to you — sorted by authority</p>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                        <tr>
                          <th className="px-4 py-3">Domain</th>
                          <th className="px-4 py-3 text-right">DR</th>
                          <th className="px-4 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.opportunityDoms.slice(0, 20).map((d, i) => (
                          <tr key={i} className="hover:bg-card/30 transition-colors">
                            <td className="px-4 py-2.5 font-medium">{d.domain}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`text-xs font-semibold ${d.dr >= 70 ? "text-emerald-400" : d.dr >= 40 ? "text-amber-400" : "text-muted-foreground"}`}>
                                DR {d.dr}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">Opportunity</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 bg-card/20 px-4 py-6 text-center text-xs text-muted-foreground">
                  Add your top SERP competitor as a tracked competitor to unlock outreach opportunity data.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
