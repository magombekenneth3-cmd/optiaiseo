"use client";

import React, { useEffect, useState, useCallback } from "react";
import { getPageAudits } from "@/app/actions/audit";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategoryScore {
  [categoryId: string]: number;
}

interface PageAuditRow {
  id: string;
  pageUrl: string;
  overallScore: number;
  categoryScores: CategoryScore;
  runTimestamp: string;
}

type SortKey = "pageUrl" | "overallScore" | string;

interface Props {
  auditId: string;
  isPaidUser: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-500 dark:text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40";
  if (score >= 50) return "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40";
  return "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40";
}

function scoreRing(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return path || u.hostname;
  } catch {
    return url;
  }
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: "Technical",
  content: "Content",
  performance: "Performance",
  schema: "Schema",
  onpage: "On-Page",
  accessibility: "Accessibility",
  basics: "Basics",
  social: "Social",
  local: "Local",
  offpage: "Off-Page",
  keywords: "Keywords",
};

// Radial score ring SVG
function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreRing(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={3}
        className="text-gray-100 dark:text-gray-800" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s cubic-bezier(.4,0,.2,1)" }} />
    </svg>
  );
}

// Mini bar for category scores
function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-xs font-medium tabular-nums ${scoreColor(score)}`}>{score}</span>
    </div>
  );
}

// ── Upsell card ───────────────────────────────────────────────────────────────

function UpsellCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-violet-200 dark:border-violet-800/40 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/20 p-8">
      {/* Background decoration */}
      <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 translate-x-8 -translate-y-8 rounded-full bg-violet-200/40 dark:bg-violet-800/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 -translate-x-4 translate-y-4 rounded-full bg-indigo-200/30 dark:bg-indigo-800/10 blur-2xl" />

      <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-6">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white dark:bg-gray-900 shadow-sm border border-violet-100 dark:border-violet-800/30">
          <svg className="h-7 w-7 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12A2.25 2.25 0 0020.25 14.25V3M3.75 3h16.5M3.75 3H2.25m18 0h1.5M12 12.75v4.5m-4.5 0h9" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            Per-Page Audit Reports
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-md">
            See how every page performs — not just the homepage. Identify your lowest-scoring pages and act on exactly where to fix first.
          </p>
        </div>
        <a
          href="/dashboard/billing"
          className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 active:scale-[0.98] px-5 py-2.5 text-sm font-semibold text-white transition-all"
        >
          Upgrade to Pro
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </a>
      </div>
    </div>
  );
}

// ── Expanded issues drawer ────────────────────────────────────────────────────

function ExpandedIssues({ page, categoryIds }: { page: PageAuditRow; categoryIds: string[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issueList: any[] = (page as any).issueList ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const failedItems = issueList.flatMap((cat: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cat.items ?? []).filter((item: any) => item.status === "Fail" || item.status === "Warning")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => ({ ...item, catLabel: cat.label }))
  );
  void categoryIds;

  const [showAll, setShowAll] = useState(false);

  if (failedItems.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        No issues found on this page — looking great!
      </div>
    );
  }

  const fails = failedItems.filter(i => i.status === "Fail");
  const warns = failedItems.filter(i => i.status === "Warning");
  const visible = showAll ? failedItems : failedItems.slice(0, 20);
  const hiddenCount = failedItems.length - 20;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Issues found</span>
        {fails.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
            {fails.length} failures
          </span>
        )}
        {warns.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
            {warns.length} warnings
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {visible.map((item: any, idx: number) => (
          <div
            key={item.id ?? idx}
            className={`rounded-xl p-3 border text-sm ${item.status === "Fail"
                ? "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30"
                : "bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30"
              }`}
          >
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${item.status === "Fail" ? "bg-red-500" : "bg-amber-400"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{item.catLabel}</span>
                </div>
                <p className="font-medium text-gray-800 dark:text-gray-200 leading-snug">{item.title ?? item.label}</p>
                {item.finding && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{item.finding}</p>
                )}
                {item.recommendation?.text && (
                  <p className="text-xs text-violet-600 dark:text-violet-400 mt-1.5 leading-relaxed">
                    → {item.recommendation.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline underline-offset-2 transition-colors"
        >
          Show {hiddenCount} more
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PageAuditSection({ auditId, isPaidUser }: Props) {
  const [pages, setPages] = useState<PageAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("overallScore");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"table" | "cards">("table");

  const toggleExpanded = (id: string) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    return next;
  });

  const load = useCallback(async () => {
    if (!isPaidUser) return;
    setLoading(true);
    try {
      const res = await getPageAudits(auditId);
      if (res.success) {
        setPages(res.pages as PageAuditRow[]);
      } else {
        setError(res.error ?? "Failed to load page audits");
      }
    } catch {
      setError("Failed to load page audits");
    } finally {
      setLoading(false);
    }
  }, [auditId, isPaidUser]);

  useEffect(() => { load(); }, [load]);

  if (!isPaidUser) return <UpsellCard />;

  const categoryIds =
    pages.length > 0
      ? Object.keys(pages[0].categoryScores).filter((k) => pages[0].categoryScores[k] != null)
      : [];

  const sorted = [...pages]
    .filter((p) => p.pageUrl.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortKey === "pageUrl") { av = a.pageUrl; bv = b.pageUrl; }
      else if (sortKey === "overallScore") { av = a.overallScore; bv = b.overallScore; }
      else { av = a.categoryScores[sortKey] ?? 0; bv = b.categoryScores[sortKey] ?? 0; }
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "pageUrl"); }
  };

  const SortChevron = ({ k }: { k: SortKey }) => (
    <span className={`inline-block transition-opacity ${sortKey === k ? "opacity-70" : "opacity-20"}`}>
      {sortKey === k ? (sortAsc ? " ↑" : " ↓") : " ↕"}
    </span>
  );

  const expanded = (id: string) => expandedIds.has(id) ? pages.find(p => p.id === id) ?? null : null;

  // Aggregate stats
  const avgScore = pages.length ? Math.round(pages.reduce((s, p) => s + p.overallScore, 0) / pages.length) : 0;
  const goodCount = pages.filter(p => p.overallScore >= 80).length;
  const poorCount = pages.filter(p => p.overallScore < 50).length;

  return (
    <section className="mt-8 space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
            Per-Page Audit
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {loading ? "Loading…"
              : pages.length === 0 ? "No page audits yet — check back shortly."
                : `${pages.length} pages audited`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          {pages.length > 0 && (
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
              <button
                onClick={() => setView("table")}
                className={`px-3 py-1.5 font-medium transition-colors ${view === "table" ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
              >
                Table
              </button>
              <button
                onClick={() => setView("cards")}
                className={`px-3 py-1.5 font-medium transition-colors ${view === "cards" ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
              >
                Cards
              </button>
            </div>
          )}
          {/* Filter */}
          {pages.length > 0 && (
            <div className="relative">
              <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="search"
                placeholder="Filter pages…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 w-52"
              />
            </div>
          )}
          {/* Refresh */}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Stats strip ────────────────────────────────────────────────────── */}
      {pages.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Avg. score", value: avgScore, sub: scoreLabel(avgScore), color: scoreColor(avgScore) },
            { label: "Good pages", value: goodCount, sub: "Score ≥ 80", color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Need work", value: poorCount, sub: "Score < 50", color: "text-red-500 dark:text-red-400" },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 px-4 py-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
              <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Loading skeleton ───────────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {!loading && pages.length === 0 && !error && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
            <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Page audits are processing</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            They run in the background after the main audit and appear here when ready.
          </p>
        </div>
      )}

      {/* ── Table view ─────────────────────────────────────────────────────── */}
      {!loading && sorted.length > 0 && view === "table" && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                  onClick={() => toggleSort("pageUrl")}
                >
                  Page <SortChevron k="pageUrl" />
                </th>
                <th
                  className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 whitespace-nowrap transition-colors"
                  onClick={() => toggleSort("overallScore")}
                >
                  Score <SortChevron k="overallScore" />
                </th>
                {categoryIds.map((catId) => (
                  <th
                    key={catId}
                    className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 whitespace-nowrap transition-colors"
                    onClick={() => toggleSort(catId)}
                  >
                    {CATEGORY_LABELS[catId] ?? catId} <SortChevron k={catId} />
                  </th>
                ))}
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sorted.map((page) => (
                <React.Fragment key={page.id}>
                  <tr
                    className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40 ${expandedIds.has(page.id) ? "bg-violet-50/50 dark:bg-violet-900/10" : ""}`}
                  >
                    <td className="px-4 py-3 max-w-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${page.overallScore >= 80 ? "bg-emerald-400" : page.overallScore >= 50 ? "bg-amber-400" : "bg-red-400"}`} />
                        <a
                          href={page.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-700 dark:text-gray-300 hover:text-violet-600 dark:hover:text-violet-400 truncate block text-sm transition-colors"
                          title={page.pageUrl}
                        >
                          {shortUrl(page.pageUrl)}
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-xs font-semibold tabular-nums min-w-[2.5rem] ${scoreBg(page.overallScore)} ${scoreColor(page.overallScore)}`}>
                        {page.overallScore}
                      </span>
                    </td>
                    {categoryIds.map((catId) => {
                      const s = page.categoryScores[catId] ?? null;
                      return (
                        <td key={catId} className="px-3 py-3 text-center">
                          {s == null ? (
                            <span className="text-gray-200 dark:text-gray-700 text-xs">—</span>
                          ) : (
                            <ScoreBar score={s} />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleExpanded(page.id)}
                        className={`rounded-lg p-1.5 transition-colors ${expandedIds.has(page.id) ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400" : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                        title={expandedIds.has(page.id) ? "Collapse" : "View issues"}
                        aria-expanded={expandedIds.has(page.id)}
                      >
                        <svg
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${expandedIds.has(page.id) ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2.5}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                    </td>
                  </tr>

                  {expandedIds.has(page.id) && expanded(page.id) && (
                    <tr className="bg-gray-50/80 dark:bg-gray-800/20">
                      <td colSpan={2 + categoryIds.length + 1} className="px-6 py-5 border-t border-gray-100 dark:border-gray-800">
                        <ExpandedIssues page={expanded(page.id)!} categoryIds={categoryIds} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {sorted.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2 text-xs text-gray-400 dark:text-gray-500">
              {sorted.length} of {pages.length} page{pages.length !== 1 ? "s" : ""}{filter ? " (filtered)" : ""}
            </div>
          )}
        </div>
      )}

      {/* ── Card view ──────────────────────────────────────────────────────── */}
      {!loading && sorted.length > 0 && view === "cards" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map((page) => (
            <div
              key={page.id}
              className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <a
                  href={page.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-violet-600 dark:hover:text-violet-400 truncate block transition-colors min-w-0"
                  title={page.pageUrl}
                >
                  {shortUrl(page.pageUrl)}
                </a>
                <div className="relative flex-shrink-0">
                  <ScoreRing score={page.overallScore} size={44} />
                  <span className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums ${scoreColor(page.overallScore)}`}>
                    {page.overallScore}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {categoryIds.map((catId) => {
                  const s = page.categoryScores[catId] ?? null;
                  if (s == null) return null;
                  return (
                    <div key={catId} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400 dark:text-gray-500 min-w-0 truncate">
                        {CATEGORY_LABELS[catId] ?? catId}
                      </span>
                      <ScoreBar score={s} />
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => toggleExpanded(page.id)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {expandedIds.has(page.id) ? "Hide issues" : "View issues"}
                <svg className={`h-3 w-3 transition-transform ${expandedIds.has(page.id) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {expandedIds.has(page.id) && expanded(page.id) && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <ExpandedIssues page={expanded(page.id)!} categoryIds={categoryIds} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}