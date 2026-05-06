"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Check, Eye, EyeOff, RefreshCw, Download } from "lucide-react";

interface Props {
  siteId: string;
}

export function WordPressPluginPanel({ siteId }: Props) {
  const [hasKey,    setHasKey]    = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [showKey,   setShowKey]   = useState(false);
  const [fullKey,   setFullKey]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied,    setCopied]    = useState<"key" | "siteId" | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/user/api-key");
      const data = await res.json();
      setHasKey(data.hasKey);
      setMaskedKey(data.maskedKey);
      setFullKey(null);
      setShowKey(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res  = await fetch("/api/user/api-key", { method: "POST" });
      const data = await res.json();
      if (data.wpApiKey) {
        setHasKey(true);
        setFullKey(data.wpApiKey);
        setMaskedKey(null);
        setShowKey(true);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async () => {
    if (!confirm("Revoke this API key? Your WordPress plugin will stop working immediately.")) return;
    await fetch("/api/user/api-key", { method: "DELETE" });
    setHasKey(false);
    setMaskedKey(null);
    setFullKey(null);
    setShowKey(false);
  };

  const copy = async (text: string, which: "key" | "siteId") => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const displayKey = showKey && fullKey ? fullKey : (maskedKey ?? "");

  return (
    <div className="card-surface p-6 flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-lg">
          🔌
        </div>
        <div>
          <h2 className="text-base font-semibold mb-1">WordPress plugin</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Install the OptiAISEO plugin on your WordPress site to see AI Visibility scores per post and inject schema markup without leaving wp-admin.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="h-20 rounded-xl bg-muted/30 animate-pulse" />
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">API Key</label>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={hasKey ? displayKey : "No key — click Generate below"}
                readOnly
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-muted/30 font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
              {hasKey && (
                <>
                  <button
                    onClick={() => setShowKey((p) => !p)}
                    className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title={showKey ? "Hide" : "Show"}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => copy(fullKey ?? maskedKey ?? "", "key")}
                    disabled={!fullKey && !maskedKey}
                    className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
                    title="Copy API key"
                  >
                    {copied === "key" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </>
              )}
            </div>
            {showKey && fullKey && (
              <p className="text-xs text-amber-400 mt-1.5">
                ⚠ This is the only time the full key is shown. Copy it now.
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Site ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={siteId}
                readOnly
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-muted/30 font-mono text-foreground focus:outline-none"
              />
              <button
                onClick={() => copy(siteId, "siteId")}
                className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Copy Site ID"
              >
                {copied === "siteId" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Generating…" : hasKey ? "Regenerate key" : "Generate key"}
        </button>
        <a
          href="/optiaiseo.zip"
          download
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Download plugin (.zip)
        </a>
        {hasKey && (
          <button
            onClick={handleRevoke}
            className="px-4 py-2 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-sm font-medium transition-colors"
          >
            Revoke key
          </button>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Setup</p>
        <ol className="space-y-2 text-sm text-muted-foreground">
          {[
            "Download the plugin .zip and install it via WordPress Admin → Plugins → Add New → Upload Plugin.",
            "Go to Settings → OptiAISEO, paste your API Key and Site ID, and click Save.",
            "Open any post — the OptiAISEO sidebar shows your AI score, failing checks, and a one-click schema injection button.",
            "Scores refresh every Monday automatically. Click Refresh score in the sidebar for an instant update.",
          ].map((step, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-bold flex items-center justify-center border border-blue-500/20 mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
