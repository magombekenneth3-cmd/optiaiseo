"use client";

import { useState, useEffect } from "react";
import { Check, Share2 } from "lucide-react";
import { testAeoQuery } from "@/app/actions/aeo";

const HISTORY_KEY = (siteId: string) => `prompt-simulator-history:${siteId}`;
const MAX_HISTORY = 5;

interface HistoryEntry {
  query: string;
  cited: boolean;
  timestamp: number;
}

function loadHistory(siteId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY(siteId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToHistory(siteId: string, query: string, cited: boolean) {
  try {
    const history = loadHistory(siteId);
    const entry: HistoryEntry = { query, cited, timestamp: Date.now() };
    const updated = [entry, ...history.filter(h => h.query !== query)].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY(siteId), JSON.stringify(updated));
  } catch {}
}

export function PromptSimulator({
  siteId,
  domain,
  suggestedQueries,
}: {
  siteId: string;
  domain: string;
  suggestedQueries?: string[];
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    cited: boolean;
    responseText: string;
    shareUrl?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory(siteId));
  }, [siteId]);

  const handleTest = async (q?: string) => {
    const activeQuery = (q ?? query).trim();
    if (!activeQuery) return;
    if (q) setQuery(q);
    setLoading(true);
    setError("");
    const res = await testAeoQuery(siteId, activeQuery);
    setLoading(false);
    if (res.success) {
      const newResult = {
        cited: res.cited,
        responseText: res.responseText,
        shareUrl: res.shareUrl,
      };
      setResult(newResult);
      saveToHistory(siteId, activeQuery, res.cited);
      setHistory(loadHistory(siteId));
    } else {
      setError(res.error ?? "Failed");
    }
  };

  const handleClear = () => {
    setQuery("");
    setResult(null);
    setError("");
    setCopied(false);
  };

  const handleCopyShareLink = async () => {
    if (!result?.shareUrl) return;
    await navigator.clipboard.writeText(result.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Deduplicated chips: history first, then suggested, max 5
  const chips = [...new Set([...history.map(h => h.query), ...(suggestedQueries ?? [])])].slice(0, 5);

  return (
    <div className="p-4 rounded-xl border border-border bg-muted/10 space-y-3 mt-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Test a query against Gemini
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            ⚠ Only checks Gemini — results may differ on Perplexity or ChatGPT.
          </p>
        </div>
        {result && (
          <button
            onClick={handleClear}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear prompt simulator result"
          >
            Clear
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(chip => (
            <button
              key={chip}
              onClick={() => handleTest(chip)}
              disabled={loading}
              title={chip}
              className="text-[10px] px-2 py-1 rounded-full border border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors truncate max-w-[180px]"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground/40 transition-colors"
          placeholder="e.g. best SEO tools for startups"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleTest()}
          aria-label="Query to test"
        />
        <button
          onClick={() => handleTest()}
          disabled={loading || !query.trim()}
          aria-label={loading ? "Testing query" : "Run query test"}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-foreground text-background disabled:opacity-50 hover:opacity-90 transition-all"
        >
          {loading ? "Testing…" : "Test"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <ResultBlock
          result={result}
          domain={domain}
          copied={copied}
          onCopyShare={handleCopyShareLink}
        />
      )}
    </div>
  );
}

function ResultBlock({
  result,
  domain,
  copied,
  onCopyShare,
}: {
  result: { cited: boolean; responseText: string; shareUrl?: string };
  domain: string;
  copied: boolean;
  onCopyShare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = result.responseText.trim().split(/\s+/).length > 60;

  return (
    <div
      className={`p-3 rounded-xl border text-xs space-y-2 ${
        result.cited
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-red-500/30 bg-red-500/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className={`font-bold ${result.cited ? "text-emerald-400" : "text-red-400"}`}>
          {result.cited ? `✓ ${domain} was cited` : `✗ ${domain} was not cited`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400 font-semibold">
            Gemini 2.0 Flash
          </span>
          {result.shareUrl && (
            <button
              onClick={onCopyShare}
              aria-label="Copy share link for this proof"
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" />
              ) : (
                <Share2 className="w-3 h-3" aria-hidden="true" />
              )}
              <span className="text-[10px]">{copied ? "Copied" : "Share proof"}</span>
            </button>
          )}
        </div>
      </div>

      <p className={`text-muted-foreground leading-relaxed ${expanded ? "" : "line-clamp-4"}`}>
        {result.responseText}
      </p>

      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
        >
          {expanded ? "Show less" : "Show full response"}
        </button>
      )}
    </div>
  );
}
