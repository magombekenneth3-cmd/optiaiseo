"use client";

import { useState, useEffect, useCallback } from "react";
import type { QueryWeeklySummary, QueryIntent } from "@/lib/aeo/query-library";

const INTENT_CONFIG: Record<
  QueryIntent,
  { label: string; bg: string; text: string; border: string }
> = {
  informational: { label: "Info",       bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20"    },
  commercial:    { label: "Commercial", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  comparison:    { label: "Comparison", bg: "bg-purple-500/10",  text: "text-purple-400",  border: "border-purple-500/20"  },
  problem:       { label: "Problem",    bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/20"   },
  navigational:  { label: "Nav",        bg: "bg-gray-500/10",    text: "text-gray-400",    border: "border-gray-500/20"    },
};

const MODEL_COLORS: Record<string, string> = {
  perplexity: "bg-blue-400",
  chatgpt:    "bg-emerald-400",
  claude:     "bg-amber-400",
  gemini:     "bg-purple-400",
};

function SummaryCards({
  citationRate,
  trend,
  topCompetitor,
  totalQueries,
}: {
  citationRate:  number;
  trend:         number | null;
  topCompetitor: string | null;
  totalQueries:  number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="bg-muted/40 rounded-xl p-4 border border-border">
        <div className="text-2xl font-black text-foreground">{totalQueries}</div>
        <div className="text-xs text-muted-foreground mt-1 font-medium">Tracked queries</div>
      </div>
      <div className="bg-muted/40 rounded-xl p-4 border border-border">
        <div className="text-2xl font-black text-foreground">{citationRate}%</div>
        <div className="text-xs text-muted-foreground mt-1 font-medium">Overall citation rate</div>
      </div>
      <div className="bg-muted/40 rounded-xl p-4 border border-border">
        <div className={`text-2xl font-black ${
          trend === null ? "text-muted-foreground"
          : trend > 0   ? "text-emerald-400"
          : trend < 0   ? "text-red-400"
          : "text-muted-foreground"
        }`}>
          {trend === null ? "—" : trend > 0 ? `+${trend}%` : `${trend}%`}
        </div>
        <div className="text-xs text-muted-foreground mt-1 font-medium">vs last week</div>
      </div>
      <div className="bg-muted/40 rounded-xl p-4 border border-border">
        <div className="text-sm font-bold truncate text-foreground">{topCompetitor ?? "—"}</div>
        <div className="text-xs text-muted-foreground mt-1 font-medium">Top competing domain</div>
      </div>
    </div>
  );
}

function QueryRow({ q }: { q: QueryWeeklySummary }) {
  const [expanded, setExpanded] = useState(false);
  const intentCfg      = INTENT_CONFIG[q.intent];
  const mentionedModels = q.modelResults.filter((r) => r.mentioned);
  const totalModels     = q.modelResults.length;
  const rateLabel       = totalModels > 0
    ? `${mentionedModels.length}/${totalModels} models`
    : "no data yet";

  return (
    <div className="border border-border rounded-xl overflow-hidden transition-all hover:border-border/80">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full text-left flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex flex-col items-center gap-1 shrink-0 w-12">
          <span className={`text-sm font-black ${
            q.overallMentionRate >= 60 ? "text-emerald-400"
            : q.overallMentionRate >= 30 ? "text-amber-400"
            : "text-red-400"
          }`}>
            {q.overallMentionRate}%
          </span>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                q.overallMentionRate >= 60 ? "bg-emerald-500"
                : q.overallMentionRate >= 30 ? "bg-amber-500"
                : "bg-red-400"
              }`}
              style={{ width: `${q.overallMentionRate}%` }}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-left pr-2 leading-snug">
            &ldquo;{q.query}&rdquo;
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${intentCfg.bg} ${intentCfg.text} ${intentCfg.border}`}>
              {intentCfg.label}
            </span>
            <span className="text-[10px] text-muted-foreground">{rateLabel}</span>
            {q.weekOverWeek !== null && (
              <span className={`text-[10px] font-bold ${
                q.weekOverWeek > 0 ? "text-emerald-400"
                : q.weekOverWeek < 0 ? "text-red-400"
                : "text-muted-foreground"
              }`}>
                {q.weekOverWeek > 0
                  ? `↑ +${q.weekOverWeek}%`
                  : q.weekOverWeek < 0
                  ? `↓ ${q.weekOverWeek}%`
                  : "→ no change"}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1 items-center shrink-0">
          {q.modelResults.map((r) => (
            <div
              key={r.model}
              title={`${r.model}: ${r.mentioned ? "cited" : "not cited"}`}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                r.mentioned
                  ? MODEL_COLORS[r.model] ?? "bg-emerald-400"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>

        <span className="text-muted-foreground text-xs shrink-0 mt-0.5 w-3">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-3 bg-muted/10">
          {q.modelResults.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No results yet — this query runs every Monday. Check back after the next weekly run.
            </p>
          ) : (
            q.modelResults.map((r) => (
              <div key={r.model} className="flex items-start gap-3">
                <div className="flex items-center gap-1.5 w-24 shrink-0">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      r.mentioned
                        ? MODEL_COLORS[r.model] ?? "bg-emerald-400"
                        : "bg-muted"
                    }`}
                  />
                  <span className="text-xs font-semibold capitalize">{r.model}</span>
                </div>
                <div className="flex-1 text-xs text-muted-foreground">
                  {r.mentioned ? (
                    <span>
                      {r.isAuthoritative ? "Cited authoritatively" : "Mentioned"} — position score{" "}
                      {r.mentionPosition}
                      {r.citationUrl && (
                        <a
                          href={r.citationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 text-blue-400 hover:underline"
                        >
                          view cited page →
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-red-400">Not cited</span>
                  )}
                  {r.responseSnippet && (
                    <p className="mt-1 text-muted-foreground/70 italic">
                      &ldquo;{r.responseSnippet.slice(0, 120)}&hellip;&rdquo;
                    </p>
                  )}
                  {r.competitorsCited.length > 0 && (
                    <p className="mt-1">
                      Competitors cited instead:{" "}
                      {r.competitorsCited.slice(0, 3).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}

          {q.topCompetitor && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Top competitor for this query:{" "}
                <span className="font-semibold text-foreground">{q.topCompetitor}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddQueryForm({
  siteId,
  onAdded,
}: {
  siteId:  string;
  onAdded: () => void;
}) {
  const [open,   setOpen]   = useState(false);
  const [query,  setQuery]  = useState("");
  const [intent, setIntent] = useState<QueryIntent>("informational");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const handleAdd = async () => {
    if (!query.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/aeo/query-library", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ siteId, query: query.trim(), intent, source: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQuery("");
      setOpen(false);
      onAdded();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border hover:border-primary/50 hover:text-primary text-sm text-muted-foreground transition-all"
      >
        + Add a query manually
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Add a tracked query</p>
        <button
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground text-sm w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors"
        >
          ✕
        </button>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder='e.g. What is the best AI SEO tool in 2026?'
        className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
      />
      <select
        value={intent}
        onChange={(e) => setIntent(e.target.value as QueryIntent)}
        className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="informational">Informational — &quot;How does X work?&quot;</option>
        <option value="commercial">Commercial — &quot;Best tool for X&quot;</option>
        <option value="comparison">Comparison — &quot;X vs Y&quot;</option>
        <option value="problem">Problem — &quot;Why is my X not working?&quot;</option>
        <option value="navigational">Navigational — &quot;How to use Brand for X&quot;</option>
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleAdd}
          disabled={saving || !query.trim()}
          className="flex-1 text-sm py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
        >
          {saving ? "Adding…" : "Add query"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

type FilterIntent = QueryIntent | "all";
type FilterCited  = "all" | "cited" | "not_cited";

interface QueryLibraryPanelProps {
  siteId: string;
}

export default function QueryLibraryPanel({ siteId }: QueryLibraryPanelProps) {
  const [data, setData] = useState<{
    queries:             QueryWeeklySummary[];
    overallCitationRate: number;
    trendVsLastWeek:     number | null;
    topCompetitor:       string | null;
  } | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [filterIntent, setFilterIntent] = useState<FilterIntent>("all");
  const [filterCited,  setFilterCited]  = useState<FilterCited>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/aeo/query-library?siteId=${siteId}`);
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await fetch("/api/aeo/query-library/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ siteId }),
      });
      setTimeout(load, 2000);
    } finally {
      setGenerating(false);
    }
  };

  const filtered = data?.queries.filter((q) => {
    if (filterIntent !== "all" && q.intent !== filterIntent) return false;
    if (filterCited === "cited"     && q.overallMentionRate === 0) return false;
    if (filterCited === "not_cited" && q.overallMentionRate > 0)   return false;
    return true;
  }) ?? [];

  const sorted = [...filtered].sort((a, b) => {
    if (a.overallMentionRate === 0 && b.overallMentionRate > 0) return -1;
    if (b.overallMentionRate === 0 && a.overallMentionRate > 0) return 1;
    return b.overallMentionRate - a.overallMentionRate;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-base">Query library</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Queries real users ask AI engines. Tracked weekly across Perplexity, ChatGPT, and Claude.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="shrink-0 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
        >
          {generating
            ? "Generating…"
            : data?.queries.length
            ? "Refresh library"
            : "Generate library"}
        </button>
      </div>

      {generating && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-blue-500/20 bg-blue-500/5 text-sm text-blue-400">
          <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Queued — generating 40 queries via Gemini. Results appear after the job finishes.
        </div>
      )}

      {data && data.queries.length > 0 && (
        <SummaryCards
          citationRate={data.overallCitationRate}
          trend={data.trendVsLastWeek}
          topCompetitor={data.topCompetitor}
          totalQueries={data.queries.length}
        />
      )}

      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && (!data || data.queries.length === 0) && (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-muted/50 border border-border flex items-center justify-center mx-auto mb-4">
            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </div>
          <p className="font-semibold mb-2">No queries tracked yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
            Click &ldquo;Generate library&rdquo; to create 40 intent-matched queries based on your site&apos;s content.
            They&apos;ll run weekly against AI engines automatically.
          </p>
          <p className="text-xs text-muted-foreground">Takes about 30 seconds to generate.</p>
        </div>
      )}

      {!loading && data && data.queries.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterIntent}
            onChange={(e) => setFilterIntent(e.target.value as FilterIntent)}
            className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All intents</option>
            <option value="informational">Informational</option>
            <option value="commercial">Commercial</option>
            <option value="comparison">Comparison</option>
            <option value="problem">Problem</option>
            <option value="navigational">Navigational</option>
          </select>
          {(["all", "cited", "not_cited"] as FilterCited[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilterCited(f)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                filterCited === f
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted text-muted-foreground"
              }`}
            >
              {f === "all"
                ? `All (${data.queries.length})`
                : f === "cited"
                ? `Cited (${data.queries.filter((q) => q.overallMentionRate > 0).length})`
                : `Not cited (${data.queries.filter((q) => q.overallMentionRate === 0).length})`}
            </button>
          ))}
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((q) => (
            <QueryRow key={q.query} q={q} />
          ))}
        </div>
      )}

      {!loading && (
        <AddQueryForm siteId={siteId} onAdded={load} />
      )}

      {!loading && data && data.queries.length > 0 && (
        <div className="flex gap-4 text-xs text-muted-foreground flex-wrap pt-1">
          <span className="font-semibold">Model dots:</span>
          {Object.entries(MODEL_COLORS).map(([model, color]) => (
            <span key={model} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${color}`} />
              {model}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-muted border border-border" />
            not cited
          </span>
        </div>
      )}
    </div>
  );
}
