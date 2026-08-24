"use client";

import { useState, useTransition } from "react";
import { CheckCircle, Loader2, ExternalLink, Key, X } from "lucide-react";

interface Props {
    initialToken?: string;
}

export function MozApiTokenCard({ initialToken = "" }: Props) {
    const [token,    setToken]    = useState(initialToken);
    const [saved,    setSaved]    = useState(false);
    const [testing,  setTesting]  = useState(false);
    const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
    const [error,    setError]    = useState("");
    const [isPending, startTransition] = useTransition();

    const isConfigured = !!initialToken;

    const save = async (tokenToSave: string) => {
        setError(""); setSaved(false); setTestResult(null);
        startTransition(async () => {
            try {
                const res = await fetch("/api/settings/moz-token", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mozApiToken: tokenToSave }),
                });
                if (!res.ok) throw new Error(await res.text());
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
            } catch (e: unknown) {
                setError((e as Error)?.message ?? "Failed to save.");
            }
        });
    };

    const testToken = async () => {
        if (!token.trim()) return;
        setTesting(true); setTestResult(null); setError("");
        try {
            const res = await fetch("https://api.moz.com/jsonrpc", {
                method: "POST",
                headers: { "x-moz-token": token.trim(), "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0", id: "test",
                    method: "data.site.metrics.fetch.multiple",
                    params: { data: { site_queries: [{ query: "moz.com", scope: "root_domain" }], site_metrics: ["domain_authority"] } },
                }),
            });
            setTestResult(res.ok ? "ok" : "fail");
        } catch {
            setTestResult("fail");
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="card-surface p-6">
            <div className="flex items-start gap-4 mb-5">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <Key className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                    <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
                        Moz API Token
                        {isConfigured && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                ✓ Configured
                            </span>
                        )}
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                        Enables live <strong>Domain Authority</strong> scores on backlink audits and the SEO report.
                        Free tier gives 10k rows/month — more than enough for audits.{" "}
                        <a
                            href="https://moz.com/api/dashboard"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline inline-flex items-center gap-1"
                        >
                            Get a free token <ExternalLink className="w-3 h-3" />
                        </a>
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex gap-2">
                    <input
                        id="moz-api-token"
                        type="password"
                        value={token}
                        onChange={e => { setToken(e.target.value); setTestResult(null); }}
                        placeholder="mozscape-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-muted-foreground placeholder:font-sans"
                    />
                    {token.trim() && token !== initialToken && (
                        <button
                            onClick={testToken}
                            disabled={testing || isPending}
                            className="px-3 py-2 text-sm font-semibold border border-border rounded-lg hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test"}
                        </button>
                    )}
                    <button
                        onClick={() => save(token.trim())}
                        disabled={isPending || !token.trim()}
                        className="px-4 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                    >
                        Save
                    </button>
                    {isConfigured && (
                        <button
                            onClick={() => { setToken(""); save(""); }}
                            disabled={isPending}
                            className="px-3 py-2 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                            title="Remove token"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {testResult === "ok" && (
                    <p className="flex items-center gap-2 text-xs text-emerald-400">
                        <CheckCircle className="w-3.5 h-3.5" /> Token valid — Moz API reachable.
                    </p>
                )}
                {testResult === "fail" && (
                    <p className="text-xs text-red-400">Token invalid or Moz API unreachable. Check your token at moz.com/api/dashboard.</p>
                )}
                {isPending && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                    </p>
                )}
                {saved && !isPending && (
                    <p className="flex items-center gap-2 text-xs text-emerald-400">
                        <CheckCircle className="w-3 h-3" /> Saved — Domain Authority will appear on your next audit.
                    </p>
                )}
                {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
        </div>
    );
}
