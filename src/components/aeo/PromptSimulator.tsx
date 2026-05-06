"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Share2 } from "lucide-react";
import { testAeoQuery } from "@/app/actions/aeo";

const storageKey = (siteId: string) => `prompt-simulator:${siteId}`;

interface PersistedState {
  query: string;
  result: { cited: boolean; responseText: string; shareUrl?: string };
}

export function PromptSimulator({ siteId, domain }: { siteId: string; domain: string }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ cited: boolean; responseText: string; shareUrl?: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(siteId));
      if (raw) {
        const saved: PersistedState = JSON.parse(raw);
        setQuery(saved.query);
        setResult(saved.result);
      }
    } catch {}
  }, [siteId]);

  const handleTest = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    const res = await testAeoQuery(siteId, query.trim());
    setLoading(false);
    if (res.success) {
      const newResult = { cited: res.cited, responseText: res.responseText, shareUrl: res.shareUrl };
      setResult(newResult);
      try {
        const toSave: PersistedState = { query: query.trim(), result: newResult };
        localStorage.setItem(storageKey(siteId), JSON.stringify(toSave));
      } catch {}
    } else {
      setError(res.error ?? "Failed");
    }
  };

  const handleClear = () => {
    setQuery("");
    setResult(null);
    setError("");
    setCopied(false);
    try { localStorage.removeItem(storageKey(siteId)); } catch {}
  };

  const handleCopyShareLink = async () => {
    if (!result?.shareUrl) return;
    await navigator.clipboard.writeText(result.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 rounded-xl border border-border bg-muted/10 space-y-3 mt-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Test a query — does Gemini cite {domain}?
        </p>
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

      <div className="flex gap-2">
        <input
          className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground/40 transition-colors"
          placeholder="e.g. best SEO tools for startups"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleTest()}
          aria-label="Query to test"
        />
        <button
          onClick={handleTest}
          disabled={loading || !query.trim()}
          aria-label={loading ? "Testing query" : "Run query test"}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-foreground text-background disabled:opacity-50 hover:opacity-90 transition-all"
        >
          {loading ? "Testing…" : "Test"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div className={`p-3 rounded-xl border text-xs space-y-2 ${
          result.cited ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`font-bold ${result.cited ? "text-emerald-400" : "text-red-400"}`}>
              {result.cited ? `✓ ${domain} was cited` : `✗ ${domain} was not cited`}
            </p>
            {result.shareUrl && (
              <button
                onClick={handleCopyShareLink}
                aria-label="Copy share link for this proof"
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" /> : <Share2 className="w-3 h-3" aria-hidden="true" />}
                <span className="text-[10px]">{copied ? "Copied" : "Share proof"}</span>
              </button>
            )}
          </div>
          <p className="text-muted-foreground leading-relaxed line-clamp-4">{result.responseText}</p>
        </div>
      )}
    </div>
  );
}
