"use client";

import { useState, useEffect } from "react";
import { Key, Copy, RefreshCw, Trash2, ExternalLink, CheckCircle } from "lucide-react";

export function ApiAccessCard() {
    const [apiKey,    setApiKey]    = useState<string | null>(null);
    const [masked,    setMasked]    = useState<string | null>(null);
    const [loading,   setLoading]   = useState(true);
    const [copying,   setCopying]   = useState(false);
    const [generating,setGenerating]= useState(false);
    const [revoking,  setRevoking]  = useState(false);
    const [revealed,  setRevealed]  = useState(false);

    useEffect(() => {
        fetch("/api/user/api-key")
            .then(r => r.json())
            .then(d => {
                setMasked(d.maskedKey ?? null);
                setApiKey(null);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const generate = async () => {
        setGenerating(true);
        try {
            const r = await fetch("/api/user/api-key", { method: "POST" });
            const d = await r.json();
            if (d.wpApiKey) { setApiKey(d.wpApiKey); setMasked(d.maskedKey ?? null); setRevealed(true); }
        } finally { setGenerating(false); }
    };

    const revoke = async () => {
        if (!confirm("Revoke this API key? Any integrations using it will stop working.")) return;
        setRevoking(true);
        try {
            await fetch("/api/user/api-key", { method: "DELETE" });
            setApiKey(null); setMasked(null); setRevealed(false);
        } finally { setRevoking(false); }
    };

    const copy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopying(true);
        setTimeout(() => setCopying(false), 1500);
    };

    const isConfigured = !!masked || !!apiKey;
    const displayKey   = revealed && apiKey ? apiKey : masked;

    return (
        <div className="card-surface p-6">
            <div className="flex items-start gap-4 mb-5">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <Key className="w-5 h-5 text-violet-400" />
                </div>
                <div className="flex-1">
                    <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
                        API Access
                        {isConfigured && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                ✓ Active
                            </span>
                        )}
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                        Use your personal API key to call the OptiAISEO REST API from your own tools, scripts, or integrations.{" "}
                        <a
                            href="/api-docs"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-violet-400 hover:underline inline-flex items-center gap-1"
                        >
                            Browse API reference <ExternalLink className="w-3 h-3" />
                        </a>
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="h-10 skeleton rounded-lg" />
            ) : isConfigured ? (
                <div className="space-y-3">
                    <div className="flex gap-2 items-center">
                        <code className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-xs font-mono text-muted-foreground truncate">
                            {revealed && apiKey ? apiKey : (masked ?? "••••••••••••••••••••••••")}
                        </code>
                        {revealed && apiKey && (
                            <button
                                onClick={() => copy(apiKey)}
                                className="p-2 rounded-lg border border-border hover:bg-accent transition-colors"
                                title="Copy API key"
                            >
                                {copying
                                    ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                                    : <Copy className="w-4 h-4 text-muted-foreground" />}
                            </button>
                        )}
                        {!revealed && (
                            <button
                                onClick={generate}
                                disabled={generating}
                                className="p-2 rounded-lg border border-border hover:bg-accent transition-colors"
                                title="Regenerate key"
                            >
                                <RefreshCw className={`w-4 h-4 text-muted-foreground ${generating ? "animate-spin" : ""}`} />
                            </button>
                        )}
                        <button
                            onClick={revoke}
                            disabled={revoking}
                            className="p-2 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Revoke key"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                    {revealed && apiKey && (
                        <p className="text-xs text-amber-400">
                            ⚠ Copy this key now — it won&apos;t be shown again after you leave this page.
                        </p>
                    )}
                    {!revealed && (
                        <p className="text-xs text-muted-foreground">
                            Key is active. Click <RefreshCw className="inline w-3 h-3" /> to regenerate a new one (invalidates the old key).
                        </p>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">No API key yet. Generate one to start building integrations.</p>
                    <button
                        onClick={generate}
                        disabled={generating}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/25 rounded-lg hover:bg-violet-500/20 transition-colors disabled:opacity-50"
                    >
                        <Key className="w-4 h-4" />
                        {generating ? "Generating…" : "Generate API Key"}
                    </button>
                </div>
            )}
        </div>
    );
}
