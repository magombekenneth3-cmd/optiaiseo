"use client";

import { useState, useTransition } from "react";
import { submitManualIndexing } from "@/app/actions/indexing";
import { toast } from "sonner";
import { Zap, Clock, CheckCircle2, XCircle, AlertCircle, RotateCcw, ExternalLink, FileText } from "lucide-react";

interface Site {
    id: string;
    domain: string;
}

interface LogEntry {
    id: string;
    url: string;
    status: string;
    trigger: string;
    engine: string;
    errorMsg: string | null;
    createdAt: string | Date;
    site: { domain: string };
}

interface Props {
    sites: Site[];
    logs: LogEntry[];
    todayCount: number;
    dailyQuota: number;
}

const TRIGGER_LABELS: Record<string, string> = {
    BLOG_PUBLISHED: "Blog Published",
    AUDIT_FIX: "Audit Fix",
    MANUAL: "Manual",
    CRON: "Scheduled",
};

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    SUCCESS: { label: "Success", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: <CheckCircle2 className="w-3 h-3" /> },
    PENDING: { label: "Pending", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",     icon: <Clock className="w-3 h-3" /> },
    FAILED:  { label: "Failed",  cls: "bg-red-500/10 text-red-400 border-red-500/20",            icon: <XCircle className="w-3 h-3" /> },
    SKIPPED: { label: "Skipped", cls: "bg-muted/50 text-muted-foreground border-border",         icon: <AlertCircle className="w-3 h-3" /> },
};

const ENGINE_BADGE: Record<string, string> = {
    GOOGLE: "bg-blue-500/10 text-blue-400",
    BING:   "bg-green-500/10 text-green-400",
    YANDEX: "bg-red-500/10 text-red-400",
    NAVER:  "bg-purple-500/10 text-purple-400",
};

function QuotaBar({ used, total }: { used: number; total: number }) {
    const pct = Math.min(100, Math.round((used / total) * 100));
    const barColor = used >= 180 ? "bg-red-500" : used >= 150 ? "bg-amber-500" : "bg-emerald-500";
    const textColor = used >= 180 ? "text-red-400" : used >= 150 ? "text-amber-400" : "text-emerald-400";

    return (
        <div className="card-surface p-5">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-semibold">Daily Indexing Quota</span>
                </div>
                <span className={`text-sm font-bold ${textColor}`}>{used} / {total}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                    className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Resets at midnight UTC · {total - used} remaining today</p>
        </div>
    );
}

function parseUrlLines(raw: string): string[] {
    return raw
        .split(/[\n,]+/)
        .map(u => u.trim())
        .filter(u => u.startsWith("http://") || u.startsWith("https://"));
}

export function IndexingDashboard({ sites, logs, todayCount, dailyQuota }: Props) {
    const [selectedSiteId, setSelectedSiteId] = useState(sites[0]?.id ?? "");
    const [urlText, setUrlText] = useState("");
    const [isPending, startTransition] = useTransition();
    const [localLogs, setLocalLogs] = useState<LogEntry[]>(logs);

    const [sitemapUrl, setSitemapUrl] = useState("");
    const [isFetchingSitemap, setFetchingSitemap] = useState(false);
    const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

    const parsedUrls = parseUrlLines(urlText);
    const isMulti = parsedUrls.length > 1;

    async function handleSitemapImport() {
        if (!sitemapUrl.trim()) return;
        setFetchingSitemap(true);
        try {
            const res = await fetch("/api/indexing/sitemap", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sitemapUrl: sitemapUrl.trim() }),
            });
            const data = await res.json();
            if (data.urls?.length) {
                setUrlText(data.urls.join("\n"));
                toast.success(`Imported ${data.count} URLs from sitemap — review and click Submit`);
            } else {
                toast.error(data.error ?? "No URLs found in sitemap");
            }
        } catch {
            toast.error("Failed to fetch sitemap. Check the URL and try again.");
        } finally {
            setFetchingSitemap(false);
        }
    }

    const handleSubmit = () => {
        if (parsedUrls.length === 0 || !selectedSiteId) return;

        startTransition(async () => {
            if (parsedUrls.length === 1) {
                const result = await submitManualIndexing(selectedSiteId, parsedUrls[0]);
                if (result.success) {
                    toast.success(result.message ?? "Submitted to Google");
                    setLocalLogs(prev => [makeOptimisticEntry(parsedUrls[0]), ...prev]);
                    setUrlText("");
                } else {
                    toast.error(result.error ?? "Submission failed");
                }
                return;
            }

            let succeeded = 0;
            let failed = 0;
            let quota = false;
            const newEntries: LogEntry[] = [];

            setBatchProgress({ done: 0, total: parsedUrls.length });

            for (let i = 0; i < parsedUrls.length; i++) {
                const u = parsedUrls[i];
                const result = await submitManualIndexing(selectedSiteId, u);

                if (!result.success && result.code === "QUOTA_EXCEEDED") {
                    quota = true;
                    break;
                }

                if (result.success || result.code === "RATE_LIMITED") {
                    succeeded++;
                    newEntries.push(makeOptimisticEntry(u));
                } else {
                    failed++;
                }

                setBatchProgress({ done: i + 1, total: parsedUrls.length });
                await new Promise(r => setTimeout(r, 150));
            }

            setBatchProgress(null);
            setLocalLogs(prev => [...newEntries, ...prev]);
            setUrlText("");

            if (quota) {
                toast.warning(`Quota reached after ${succeeded} URLs — remaining URLs were skipped.`);
            } else if (failed === 0) {
                toast.success(`${succeeded} URL${succeeded !== 1 ? "s" : ""} submitted to Google`);
            } else {
                toast.warning(`${succeeded} submitted, ${failed} failed`);
            }
        });
    };

    function makeOptimisticEntry(u: string): LogEntry {
        return {
            id: Math.random().toString(36),
            url: u,
            status: "PENDING",
            trigger: "MANUAL",
            engine: "GOOGLE",
            errorMsg: null,
            createdAt: new Date(),
            site: { domain: sites.find(s => s.id === selectedSiteId)?.domain ?? "" },
        };
    }

    const handleRetry = (entry: LogEntry) => {
        setUrlText(entry.url);
        const matchingSite = sites.find(s => entry.site.domain.includes(s.domain) || s.domain.includes(entry.site.domain));
        if (matchingSite) setSelectedSiteId(matchingSite.id);
        toast.info("URL pre-filled — click Submit to retry");
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <Zap className="w-6 h-6 text-emerald-500" />
                    Auto Indexer
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Submit URLs directly to Google&apos;s Indexing API. Paste one URL per line or bulk-import from a sitemap.
                </p>
            </div>

            <QuotaBar used={todayCount} total={dailyQuota} />

            <div className="card-surface p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Submit URLs</h2>
                    {isMulti && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {parsedUrls.length} URLs ready
                        </span>
                    )}
                </div>

                {sites.length > 1 && (
                    <select
                        value={selectedSiteId}
                        onChange={e => setSelectedSiteId(e.target.value)}
                        className="w-full sm:w-auto px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                        {sites.map(s => (
                            <option key={s.id} value={s.id}>{s.domain}</option>
                        ))}
                    </select>
                )}

                <textarea
                    value={urlText}
                    onChange={e => setUrlText(e.target.value)}
                    placeholder={"https://yourdomain.com/page\nhttps://yourdomain.com/another-page\n\nPaste one URL per line, or import from sitemap below"}
                    rows={isMulti ? Math.min(parsedUrls.length + 1, 10) : 3}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40 font-mono resize-y"
                    spellCheck={false}
                />

                {batchProgress && (
                    <div className="flex items-center gap-3">
                        <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                            <div
                                className="h-1.5 bg-emerald-500 rounded-full transition-all duration-300"
                                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {batchProgress.done} / {batchProgress.total}
                        </span>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={handleSubmit}
                        disabled={isPending || parsedUrls.length === 0 || !selectedSiteId}
                        className="flex-1 sm:flex-none px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                        {isPending ? (
                            <>
                                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                {isMulti ? "Submitting batch…" : "Submitting…"}
                            </>
                        ) : (
                            <>
                                <Zap className="w-3.5 h-3.5" />
                                {isMulti ? `Submit ${parsedUrls.length} URLs` : "Submit to Google"}
                            </>
                        )}
                    </button>
                </div>

                <div className="border-t border-border pt-4">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        Sitemap Bulk Import
                    </h3>
                    <div className="flex gap-3 flex-col sm:flex-row">
                        <input
                            type="url"
                            value={sitemapUrl}
                            onChange={e => setSitemapUrl(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleSitemapImport()}
                            placeholder="https://yourdomain.com/sitemap.xml"
                            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        />
                        <button
                            onClick={handleSitemapImport}
                            disabled={isFetchingSitemap || !sitemapUrl.trim()}
                            className="px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed border border-border transition-colors flex items-center justify-center gap-2 shrink-0"
                        >
                            {isFetchingSitemap ? (
                                <>
                                    <span className="w-3.5 h-3.5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                                    Fetching…
                                </>
                            ) : "Import URLs"}
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                        Fetches all &lt;loc&gt; tags from your sitemap and loads them into the URL field above. Review before submitting.
                    </p>
                </div>

                {sites.length === 0 && (
                    <p className="text-xs text-amber-400">Add a site first to submit URLs for indexing.</p>
                )}
            </div>

            <div className="card-surface overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                    <h2 className="text-sm font-semibold">Submission History</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Last 50 submissions across all sites</p>
                </div>

                {localLogs.length === 0 ? (
                    <div className="p-10 flex flex-col items-center text-center gap-3">
                        <Zap className="w-8 h-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No submissions yet. Publish a blog post or submit a URL above to get started.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border bg-muted/30">
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">URL</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Site</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Engine</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Trigger</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Status</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Date</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {localLogs.map(entry => {
                                    const status = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG["SKIPPED"];
                                    const date = new Date(entry.createdAt);
                                    return (
                                        <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                                            <td className="px-4 py-3 max-w-[260px]">
                                                <a
                                                    href={entry.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-foreground hover:text-emerald-400 transition-colors flex items-center gap-1.5 truncate"
                                                    title={entry.url}
                                                >
                                                    <span className="truncate">{entry.url}</span>
                                                    <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                                                </a>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[120px]">
                                                {entry.site.domain}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${ENGINE_BADGE[entry.engine] ?? ""}`}>
                                                    {entry.engine}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground">
                                                {TRIGGER_LABELS[entry.trigger] ?? entry.trigger}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${status.cls}`}>
                                                    {status.icon}
                                                    {status.label}
                                                </span>
                                                {entry.status === "SKIPPED" && entry.errorMsg && (
                                                    <p className="text-xs text-muted-foreground mt-0.5">Quota was full</p>
                                                )}
                                                {entry.status === "FAILED" && entry.errorMsg && (
                                                    <p className="text-xs text-red-400/70 mt-0.5 truncate max-w-[180px]" title={entry.errorMsg}>
                                                        {entry.errorMsg.slice(0, 60)}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                                {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            </td>
                                            <td className="px-4 py-3">
                                                {entry.status === "FAILED" && (
                                                    <button
                                                        onClick={() => handleRetry(entry)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        <RotateCcw className="w-3 h-3" />
                                                        Retry
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
