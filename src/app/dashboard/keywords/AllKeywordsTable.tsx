"use client";

import { useState } from "react";
import { TrendingUp, Search, ArrowUpDown, Zap, Microscope } from "lucide-react";
import { KeywordSparkline } from "@/components/dashboard/KeywordSparkline";
import { DifficultyBadge } from "@/components/dashboard/DifficultyBadge";
import { IntentBadge } from "@/components/dashboard/IntentBadge";
import { KeywordSerpPanel } from "@/components/dashboard/KeywordSerpPanel";

function PositionBadge({ position }: { position: number }) {
  if (position <= 3)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">#{position}</span>;
  if (position <= 10)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-xs font-bold border border-blue-500/20">#{position}</span>;
  if (position <= 20)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-xs font-bold border border-amber-500/20">#{position}</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 text-xs font-bold border border-red-500/20">#{position}</span>;
}

interface GscKeyword {
  keyword: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
  url: string;
  intent?: string | null;
  difficulty?: number | null;
  positionHistory?: { date: string; position: number }[];
}

// Estimated extra clicks/mo if keyword reached position 1 (28% CTR)
function opportunityClicks(kw: GscKeyword): number {
  if (kw.position <= 3) return 0;
  const p1Clicks = Math.round(kw.impressions * 0.278);
  return Math.max(0, p1Clicks - kw.clicks);
}

type FilterTab = "all" | "page1" | "page2" | "quickwins";
type SortKey = "impressions" | "position" | "clicks" | "opportunity";
type SortDir = "asc" | "desc";

interface Props {
  keywords: GscKeyword[];
  siteId: string;
}

const PAGE_SIZE = 100;

export function AllKeywordsTable({ keywords, siteId }: Props) {
  const [query, setQuery]       = useState("");
  const [tab, setTab]           = useState<FilterTab>("all");
  const [sortKey, setSortKey]   = useState<SortKey>("impressions");
  const [sortDir, setSortDir]   = useState<SortDir>("desc");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const byTab = keywords.filter(kw => {
    if (tab === "page1")     return kw.position <= 10;
    if (tab === "page2")     return kw.position >= 11 && kw.position <= 20;
    if (tab === "quickwins") return kw.position >= 11 && kw.position <= 20 && opportunityClicks(kw) > 100;
    return true;
  });

  const filtered = query.trim()
    ? byTab.filter(kw => kw.keyword.toLowerCase().includes(query.toLowerCase()))
    : byTab;

  const sorted = [...filtered].sort((a, b) => {
    const mult = sortDir === "desc" ? -1 : 1;
    if (sortKey === "opportunity") return (opportunityClicks(a) - opportunityClicks(b)) * mult;
    if (sortKey === "position")    return (a.position - b.position) * mult;
    if (sortKey === "clicks")      return (a.clicks - b.clicks) * mult;
    return (a.impressions - b.impressions) * mult;
  });

  const visible = sorted.slice(0, PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const quickWinCount = keywords.filter(kw => kw.position >= 11 && kw.position <= 20 && opportunityClicks(kw) > 100).length;

  return (
    <div className="card-surface overflow-hidden">
      <div className="p-6 border-b border-border flex flex-col gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold mb-1">All Keywords</h2>
            <p className="text-sm text-muted-foreground">
              {query.trim()
                ? `${filtered.length} of ${keywords.length} keywords`
                : `${keywords.length} unique keywords — deduplicated, sorted by impressions`}
            </p>
          </div>
          <div className="ml-auto relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter keywords…"
              className="w-52 pl-8 pr-3 py-1.5 text-sm rounded-lg bg-card border border-border focus:outline-none focus:border-ring placeholder:text-muted-foreground transition-colors"
            />
          </div>
        </div>
        {/* Filter tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          {([
            { id: "all" as FilterTab,        label: `All (${keywords.length})` },
            { id: "page1" as FilterTab,      label: `Page 1 (${keywords.filter(k => k.position <= 10).length})` },
            { id: "page2" as FilterTab,      label: `Page 2 (${keywords.filter(k => k.position >= 11 && k.position <= 20).length})` },
            { id: "quickwins" as FilterTab,  label: `⚡ Quick Wins (${quickWinCount})`, highlight: true },
          ]).map(({ id, label, highlight }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors border ${
                tab === id
                  ? highlight ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-primary/10 border-primary/20 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="md:hidden divide-y divide-border">
        {visible.map((kw, i) => {
          const isTrendingUp   = kw.position <= 10 && kw.ctr > 2;
          const isTrendingDown = kw.position > 20 && kw.ctr < 1;
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3 min-w-0">
              <div className="shrink-0"><PositionBadge position={kw.position} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{kw.keyword}</p>
                  {isTrendingUp   && <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />}
                  {isTrendingDown && <TrendingUp className="w-3 h-3 text-rose-400 rotate-180 shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {kw.clicks} clicks · {kw.impressions.toLocaleString()} impr. · {kw.ctr}% CTR
                </p>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {query.trim() ? `No keywords matching "${query}"` : "No keyword data yet."}
          </div>
        )}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
            <tr>
              <th className="px-6 py-3">Keyword</th>
              <th className="px-6 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("position")}>
                <span className="inline-flex items-center gap-1">Position <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th className="px-6 py-3">Trend</th>
              <th className="px-6 py-3">Intent</th>
              <th className="px-6 py-3">Difficulty</th>
              <th className="px-6 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("clicks")}>
                <span className="inline-flex items-center gap-1">Clicks <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th className="px-6 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("impressions")}>
                <span className="inline-flex items-center gap-1">Impressions <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th className="px-6 py-3">CTR</th>
              <th className="px-6 py-3 cursor-pointer select-none hover:text-foreground text-amber-400/80" onClick={() => toggleSort("opportunity")}>
                <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3" /> Opportunity <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th className="px-6 py-3">Best Landing Page</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((kw, i) => {
              const isTrendingUp   = kw.position <= 10 && kw.ctr > 2;
              const isTrendingDown = kw.position > 20 && kw.ctr < 1;
              const opp = opportunityClicks(kw);
              return (
                <>
                  <tr key={i} className="hover:bg-card transition-colors relative group">
                  <td className="px-6 py-3.5 font-medium max-w-[220px] truncate flex items-center gap-2" title={kw.keyword}>
                    {kw.keyword}
                    {isTrendingUp   && <span title="Trending Up"><TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" /></span>}
                    {isTrendingDown && <span title="Trending Down"><TrendingUp className="w-3.5 h-3.5 text-rose-400 shrink-0 rotate-180" /></span>}
                  </td>
                  <td className="px-6 py-3.5"><PositionBadge position={kw.position} /></td>
                  <td className="px-6 py-3.5">
                    <KeywordSparkline
                      data={kw.positionHistory && kw.positionHistory.length >= 2 ? kw.positionHistory : [{ date: "now", position: kw.position }]}
                      trend={isTrendingUp ? "up" : isTrendingDown ? "down" : "flat"}
                      width={72}
                      height={24}
                    />
                  </td>
                  <td className="px-6 py-3.5"><IntentBadge intent={kw.intent ?? null} /></td>
                  <td className="px-6 py-3.5"><DifficultyBadge score={kw.difficulty ?? null} /></td>
                  <td className="px-6 py-3.5 text-muted-foreground">{kw.clicks}</td>
                  <td className="px-6 py-3.5 text-muted-foreground">{kw.impressions.toLocaleString()}</td>
                  <td className="px-6 py-3.5 text-muted-foreground">{kw.ctr}%</td>
                  <td className="px-6 py-3.5">
                    {opp > 50 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold">
                        <Zap className="w-2.5 h-2.5" />+{opp.toLocaleString()}/mo
                      </span>
                    ) : opp > 0 ? (
                      <span className="text-xs text-muted-foreground">+{opp}/mo</span>
                    ) : (
                      <span className="text-xs text-emerald-400/60">✓ Top 3</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-muted-foreground text-xs max-w-[200px] truncate" title={kw.url}>
                    {kw.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </td>
                  <td className="px-6 py-3.5">
                    <button
                      onClick={() => setExpandedRow(expandedRow === kw.keyword ? null : kw.keyword)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                        expandedRow === kw.keyword
                          ? "bg-primary/15 border-primary/25 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                      }`}
                    >
                      <Microscope className="w-3 h-3" />
                      {expandedRow === kw.keyword ? "Close" : "Analyse"}
                    </button>
                  </td>
                  </tr>
                  {expandedRow === kw.keyword && (
                    <tr>
                      <td colSpan={11} className="p-0">
                        <KeywordSerpPanel
                          keyword={kw.keyword}
                          position={kw.position}
                          impressions={kw.impressions}
                          clicks={kw.clicks}
                          landingUrl={kw.url}
                          siteId={siteId}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="px-6 py-12 text-center text-muted-foreground">
                  {query.trim() ? `No keywords matching "${query}"` : tab === "quickwins" ? "No quick-win keywords found. Come back once you have page-2 rankings." : "No keyword data yet. Make sure your site has traffic and is verified in Search Console."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > PAGE_SIZE && (
          <div className="px-6 py-3 border-t border-border text-xs text-muted-foreground">
            Showing top {PAGE_SIZE} of {filtered.length} keywords{query.trim() && ` matching "${query}"`}
          </div>
        )}
      </div>
    </div>
  );
}
