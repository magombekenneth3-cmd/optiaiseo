"use client";
import { useState } from "react";
import { getCannibalizationIssues } from "@/app/actions/keywords";
import { Copy, Check, Merge, Link2, FileCode2 } from "lucide-react";
import type { CannibalizationIssue } from "@/lib/gsc";

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-[#30363d] text-[#6e7681]
                       hover:text-[#e6edf3] hover:border-[#484f58] transition-colors"
        >
            {copied ? <Check className="w-3 h-3 inline" /> : <Copy className="w-3 h-3 inline" />}
            {copied ? " Copied" : " Copy"}
        </button>
    );
}

function FixActions({ issue }: { issue: CannibalizationIssue }) {
    const competing = issue.urls.filter(u => u.url !== issue.primaryUrl);

    if (issue.suggestedFix === "canonicalize") {
        const snippet = competing
            .map(u => `<!-- Add to <head> of ${u.url} -->\n<link rel="canonical" href="${issue.primaryUrl}" />`)
            .join("\n\n");
        return (
            <div className="mt-3">
                <div className="flex items-center gap-2 mb-1.5">
                    <FileCode2 className="w-3.5 h-3.5 text-blue-400" />
                    <p className="text-[11px] font-medium text-[#e6edf3]">Add canonical tag to competing pages:</p>
                </div>
                <div className="relative">
                    <pre className="text-[11px] bg-[#0d1117] border border-[#21262d] rounded-lg px-3 py-2 text-[#8b949e] overflow-x-auto whitespace-pre-wrap">
                        {snippet}
                    </pre>
                    <div className="absolute top-1.5 right-1.5">
                        <CopyButton text={snippet} />
                    </div>
                </div>
            </div>
        );
    }

    if (issue.suggestedFix === "internal-link") {
        const snippet = competing
            .map(u => `<!-- On ${u.url}, add a link to the primary page: -->\n<a href="${issue.primaryUrl}">${issue.keyword}</a>`)
            .join("\n\n");
        return (
            <div className="mt-3">
                <div className="flex items-center gap-2 mb-1.5">
                    <Link2 className="w-3.5 h-3.5 text-emerald-400" />
                    <p className="text-[11px] font-medium text-[#e6edf3]">Add internal links from competing pages:</p>
                </div>
                <div className="relative">
                    <pre className="text-[11px] bg-[#0d1117] border border-[#21262d] rounded-lg px-3 py-2 text-[#8b949e] overflow-x-auto whitespace-pre-wrap">
                        {snippet}
                    </pre>
                    <div className="absolute top-1.5 right-1.5">
                        <CopyButton text={snippet} />
                    </div>
                </div>
            </div>
        );
    }

    const redirectSnippet = competing
        .map(u => `# Redirect competing page to primary\n${u.url} → 301 → ${issue.primaryUrl}`)
        .join("\n\n");
    return (
        <div className="mt-3">
            <div className="flex items-center gap-2 mb-1.5">
                <Merge className="w-3.5 h-3.5 text-amber-400" />
                <p className="text-[11px] font-medium text-[#e6edf3]">Merge content and set up 301 redirects:</p>
            </div>
            <div className="relative">
                <pre className="text-[11px] bg-[#0d1117] border border-[#21262d] rounded-lg px-3 py-2 text-[#8b949e] overflow-x-auto whitespace-pre-wrap">
                    {redirectSnippet}
                </pre>
                <div className="absolute top-1.5 right-1.5">
                    <CopyButton text={redirectSnippet} />
                </div>
            </div>
            <p className="text-[10px] text-amber-400/70 mt-1.5">
                Merge the best content from all pages into {issue.primaryUrl} before redirecting.
            </p>
        </div>
    );
}

export function CannibalizationPanel({ siteId }: { siteId: string }) {
    const [issues,  setIssues]  = useState<CannibalizationIssue[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded,  setLoaded]  = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await getCannibalizationIssues(siteId);
            if (!res.success) { setError(res.error ?? "Failed"); return; }
            setIssues(res.issues ?? []);
            setLoaded(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="font-semibold text-[#e6edf3] text-sm">Keyword Cannibalization</h3>
                    <p className="text-xs text-[#6e7681] mt-1">
                        Pages competing for the same keyword split ranking signals.
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg bg-[#238636] text-white text-xs font-medium
                               hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
                >
                    {loading ? "Scanning…" : loaded ? "Rescan" : "Scan Now"}
                </button>
            </div>

            {error && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-4 py-2">{error}</p>
            )}

            {loaded && issues.length === 0 && (
                <p className="text-sm text-[#6e7681] text-center py-8">
                    🎉 No cannibalization detected across your top 90-day keywords.
                </p>
            )}

            {issues.length > 0 && (
                <div className="mt-2 space-y-3">
                    {issues.map((issue) => (
                        <div
                            key={issue.keyword}
                            className="rounded-lg border border-[#21262d] bg-[#161b22] px-4 py-3"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm text-[#e6edf3] truncate">
                                        &ldquo;{issue.keyword}&rdquo;
                                    </p>
                                    <p className="text-xs text-[#6e7681] mt-0.5">
                                        {issue.totalImpressions.toLocaleString()} impressions across{" "}
                                        {issue.urls.length} pages
                                    </p>
                                    <ul className="mt-2 space-y-1">
                                        {issue.urls.map((u) => (
                                            <li key={u.url} className="text-xs truncate">
                                                <a
                                                    href={u.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={`hover:underline ${u.url === issue.primaryUrl ? "text-emerald-400" : "text-blue-400"}`}
                                                >
                                                    {u.url === issue.primaryUrl ? "★ " : ""}{u.url}
                                                </a>
                                                <span className="text-[#484f58] ml-2">
                                                    #{u.position} · {u.clicks} clicks
                                                </span>
                                            </li>
                                        ))}
                                    </ul>

                                    <FixActions issue={issue} />
                                </div>
                                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                    issue.severity === "high"
                                        ? "bg-red-500/15 text-red-400"
                                        : issue.severity === "medium"
                                        ? "bg-amber-500/15 text-amber-400"
                                        : "bg-[#21262d] text-[#6e7681]"
                                }`}>
                                    {issue.severity}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
