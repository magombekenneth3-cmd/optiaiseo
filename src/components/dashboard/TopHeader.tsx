"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useState, useRef, useEffect, useCallback } from "react";
import {
    Bell, Zap, ClipboardList, CheckCircle, AlertCircle, Info,
    X, ExternalLink, Search, Sparkles, Loader2, ChevronRight,
} from "lucide-react";

interface AppNotification {
    id: string;
    type: string;
    title: string;
    body: string;
    href?: string;
    read?: boolean;
    createdAt: string;
}



function useNotifications() {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);

    const fetch_ = useCallback(async () => {
        try {
            const res = await fetch("/api/notifications", { credentials: "include" });
            if (!res.ok) return;
            const data = await res.json();
            setNotifications(data.notifications ?? []);
            setUnreadCount(data.unreadCount ?? 0);
        } catch {
        } finally {
            setLoading(false);
        }
    }, []);

    const markAllRead = useCallback(async () => {
        try {
            await fetch("/api/notifications", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ action: "read-all" }),
            });
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch { /* silent */ }
    }, []);

    const markRead = useCallback(async (id: string) => {
        try {
            await fetch("/api/notifications", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ action: "read", id }),
            });
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        fetch_();
        const interval = setInterval(fetch_, 60_000);
        return () => clearInterval(interval);
    }, [fetch_]);

    return { notifications, unreadCount, loading, refetch: fetch_, markAllRead, markRead };
}

function useCredits() {
    const [credits, setCredits] = useState<number | null>(null);
    const fetch_ = useCallback(async () => {
        try {
            const res = await fetch("/api/credits/balance", { credentials: "include" });
            if (!res.ok) return;
            const data = await res.json();
            setCredits(data.credits ?? null);
        } catch { /* silent */ }
    }, []);
    useEffect(() => {
        fetch_();
        const id = setInterval(fetch_, 120_000);
        return () => clearInterval(id);
    }, [fetch_]);
    return credits;
}

function CreditPill({ credits }: { credits: number | null }) {
    if (credits === null) return null;
    const color =
        credits <= 5  ? "text-rose-400 border-rose-500/30 bg-rose-500/10" :
        credits <= 20 ? "text-amber-400 border-amber-500/30 bg-amber-500/10" :
                        "text-muted-foreground border-border bg-muted/30";
    return (
        <span className={`hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border ${color}`}>
            <Zap className="w-3 h-3" />
            {credits} credits
        </span>
    );
}

function NotificationsPanel({ notifications, loading, unreadCount, onClose, onMarkAllRead, onMarkRead }: {
    notifications: AppNotification[];
    loading: boolean;
    unreadCount: number;
    onClose: () => void;
    onMarkAllRead: () => void;
    onMarkRead: (id: string) => void;
}) {
    const formatTime = (iso: string) => {
        const diff = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diff / 60_000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };

    const typeIcon = (type: string) => {
        if (type === "success") return <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />;
        if (type === "warning") return <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />;
        if (type === "backlink_change") return <Zap className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />;
        return <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />;
    };

    return (
        <div className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] card-elevated z-50 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold">Notifications</span>
                <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                        <button
                            onClick={onMarkAllRead}
                            className="text-[10px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors uppercase tracking-wide"
                        >
                            Mark all read
                        </button>
                    )}
                    <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" aria-label="Close notifications">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
                {loading ? (
                    <div className="flex flex-col gap-2 p-3">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="flex gap-2 p-2">
                                <div className="w-4 h-4 rounded-full bg-muted shimmer shrink-0 mt-0.5" />
                                <div className="flex-1 flex flex-col gap-1.5">
                                    <div className="h-3 w-32 rounded bg-muted shimmer" />
                                    <div className="h-3 w-48 rounded bg-muted shimmer" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                        <p className="text-sm font-medium text-foreground">All caught up</p>
                        <p className="text-xs text-muted-foreground mt-0.5">No new notifications</p>
                    </div>
                ) : (
                    notifications.map(n => (
                        <div key={n.id} className={`group border-b border-border last:border-0 ${!n.read ? "bg-accent/30" : ""}`}>
                            {n.href ? (
                                <Link
                                    href={n.href}
                                    onClick={() => { if (!n.read) onMarkRead(n.id); onClose(); }}
                                    className="flex items-start gap-3 px-4 py-3 hover:bg-accent transition-colors"
                                >
                                    {typeIcon(n.type)}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className={`text-xs leading-snug ${!n.read ? "font-bold" : "font-semibold text-muted-foreground"}`}>{n.title}</p>
                                            <ExternalLink className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0 mt-0.5" />
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                                        <p className="text-[10px] text-muted-foreground/50 mt-1">{formatTime(n.createdAt)}</p>
                                    </div>
                                </Link>
                            ) : (
                                <div className="flex items-start gap-3 px-4 py-3">
                                    {typeIcon(n.type)}
                                    <div className="min-w-0">
                                        <p className={`text-xs ${!n.read ? "font-bold" : "font-semibold"}`}>{n.title}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                                        <p className="text-[10px] text-muted-foreground/50 mt-1">{formatTime(n.createdAt)}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

const EXAMPLE_PROMPTS = [
    "Which keywords dropped more than 3 positions last week?",
    "Show pages with no schema markup",
    "What blogs are still in draft status?",
    "Show my top 10 competitor domains",
    "Which audits failed in the last 30 days?",
];

type QueryResult = {
    summary: string;
    entity: string;
    data: Record<string, unknown>[];
};

function QueryPanel({ siteId, onClose }: { siteId: string | null; onClose: () => void }) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    async function handleSubmit(q = query) {
        if (!q.trim() || !siteId) return;
        setLoading(true); setError(""); setResult(null);
        try {
            const res = await fetch("/api/dashboard-query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ query: q, siteId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "Query failed");
            setResult(json);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    }

    const columns = result?.data?.[0] ? Object.keys(result.data[0]).slice(0, 6) : [];

    return (
        <div
            className="fixed inset-0 z-[99] bg-background/80 backdrop-blur-sm flex items-start justify-center pt-[10vh]"
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-2xl mx-4 card-elevated animate-in fade-in slide-in-from-top-4 duration-200 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    <Sparkles className="w-4 h-4 text-brand shrink-0" />
                    <input
                        ref={inputRef}
                        id="dashboard-query-input"
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSubmit()}
                        placeholder="Ask your data… e.g. keywords dropping this week"
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {loading
                        ? <Loader2 className="w-4 h-4 text-brand animate-spin shrink-0" />
                        : <button
                            id="dashboard-query-submit"
                            onClick={() => handleSubmit()}
                            disabled={!query.trim() || !siteId}
                            className="flex items-center gap-1 text-xs font-medium text-brand disabled:opacity-40 hover:opacity-70 transition-opacity"
                        >
                            Ask <ChevronRight className="w-3 h-3" />
                        </button>
                    }
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close query panel">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {!result && !loading && !error && (
                    <div className="p-4 flex flex-col gap-1.5">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Try asking…</p>
                        {EXAMPLE_PROMPTS.map(p => (
                            <button key={p} onClick={() => { setQuery(p); handleSubmit(p); }}
                                className="text-left text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-accent transition-colors">
                                {p}
                            </button>
                        ))}
                        {!siteId && <p className="text-[11px] text-amber-400 mt-2">⚠ Navigate into a site first to query its data.</p>}
                    </div>
                )}

                {error && (
                    <div className="px-4 py-3 text-sm text-red-400 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />{error}
                    </div>
                )}

                {result && (
                    <div className="max-h-[55vh] overflow-auto">
                        <div className="px-4 py-2.5 border-b border-border bg-accent/30">
                            <p className="text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{result.summary}</span>
                                {" — "}{result.data.length} result{result.data.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                        {result.data.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No results found.</div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border">
                                        {columns.map(col => (
                                            <th key={col} className="px-4 py-2 text-left font-semibold text-muted-foreground capitalize">
                                                {col.replace(/([A-Z])/g, " $1").trim()}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.data.map((row, i) => (
                                        <tr key={i} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                                            {columns.map(col => {
                                                const val = row[col];
                                                const display = val == null ? "—"
                                                    : typeof val === "object" ? JSON.stringify(val).substring(0, 60)
                                                    : String(val).substring(0, 80);
                                                return <td key={col} className="px-4 py-2.5 text-muted-foreground font-mono">{display}</td>;
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

const PAGE_TITLE_EXACT: Record<string, string> = {
    "/dashboard": "Dashboard Overview",
    "/dashboard/sites": "My Sites",
};

const PAGE_TITLE_PREFIX: Array<[string, string]> = [
    ["/dashboard/sites/", "Site Management"],
    ["/dashboard/audits", "Audit Reports"],
    ["/dashboard/keywords", "Keyword Rankings"],
    ["/dashboard/blogs", "Content Generation"],
    ["/dashboard/billing", "Billing & Plans"],
    ["/dashboard/settings", "Account Settings"],
    ["/dashboard/aeo", "AEO Rank Tracking"],
    ["/dashboard/voice", "AI Voice Agent"],
    ["/dashboard/indexing", "Auto Indexer"],
    ["/dashboard/planner", "Content Planner"],
    ["/dashboard/refresh", "Content Refresh"],
    ["/dashboard/content-decay", "Content Decay"],
];

function getTitle(path: string): string {
    if (PAGE_TITLE_EXACT[path]) return PAGE_TITLE_EXACT[path];
    if (/\/dashboard\/sites\/.+\/aeo/.test(path)) return "AEO Rank Tracking";
    const match = PAGE_TITLE_PREFIX.find(([prefix]) => path.startsWith(prefix));
    return match ? match[1] : "Dashboard";
}

function getSiteIdFromPath(path: string): string | null {
    const m = path.match(/\/dashboard\/sites\/([^/]+)/);
    return m ? m[1] : null;
}

export function TopHeader({ mobileSidebar }: { mobileSidebar?: ReactNode }) {
    const pathname = usePathname();
    const [notifOpen, setNotifOpen] = useState(false);
    const [queryOpen, setQueryOpen] = useState(false);
    const notifRef = useRef<HTMLDivElement>(null);
    const { notifications, unreadCount, loading, markAllRead, markRead } = useNotifications();
    const credits = useCredits();
    const siteId = getSiteIdFromPath(pathname);

    useEffect(() => {
        if (!notifOpen) return;
        const handler = (e: MouseEvent) => {
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [notifOpen]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); setQueryOpen(o => !o); }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, []);

    const hasUnread = !loading && unreadCount > 0;

    const contextCta = (() => {
        if (pathname.startsWith("/dashboard/audits")) {
            return (
                <Link href="/dashboard/audits" className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors">
                    <ClipboardList className="w-3.5 h-3.5" /> Run Audit
                </Link>
            );
        }
        if (pathname === "/dashboard" || pathname.startsWith("/dashboard/sites") || pathname.startsWith("/dashboard/keywords") ||
            pathname.startsWith("/dashboard/aeo") || pathname.startsWith("/dashboard/blogs") ||
            pathname.startsWith("/dashboard/content-decay") || pathname.startsWith("/dashboard/recommendations") ||
            pathname.startsWith("/dashboard/planner") || pathname.startsWith("/dashboard/indexing")) {
            return (
                <Link href="/dashboard/audits" className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors">
                    <Zap className="w-3.5 h-3.5" /> New Audit
                </Link>
            );
        }
        return null;
    })();

    return (
        <>
            <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-sidebar sticky top-0 z-50">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {mobileSidebar}
                    <h2 className="text-sm font-semibold text-foreground truncate">{getTitle(pathname)}</h2>
                </div>

                <div className="flex items-center gap-2">
                    {/* Win 6: Ask your data trigger */}
                    <button
                        id="dashboard-query-trigger"
                        onClick={() => setQueryOpen(true)}
                        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs font-medium"
                        aria-label="Ask your data (⌘/)"
                    >
                        <Sparkles className="w-3 h-3 text-brand" />
                        <span className="hidden lg:inline">Ask data</span>
                        <kbd className="text-[10px] font-mono opacity-50">⌘/</kbd>
                    </button>

                    {/* Credit balance pill */}
                    <CreditPill credits={credits} />

                    {/* ⌘K quick-launch hint */}
                    <button
                        onClick={() => {
                            const e = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
                            document.dispatchEvent(e);
                        }}
                        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs font-medium"
                        aria-label="Open command palette (⌘K)"
                    >
                        <Search className="w-3 h-3" />
                        <span className="hidden lg:inline">Search</span>
                        <kbd className="text-[10px] font-mono opacity-50">⌘K</kbd>
                    </button>

                    <div className="relative" ref={notifRef}>
                        <button
                            onClick={() => setNotifOpen(o => !o)}
                            className="relative min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-accent"
                            aria-label={`Notifications${hasUnread ? ` — ${unreadCount} new` : ""}`}
                            aria-expanded={notifOpen}
                            aria-haspopup="true"
                        >
                            <Bell className="w-4 h-4" />
                            {hasUnread && (
                                <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-black px-1" aria-hidden="true">
                                    {unreadCount > 9 ? "9+" : unreadCount}
                                </span>
                            )}
                        </button>
                        {notifOpen && (
                            <NotificationsPanel
                                notifications={notifications}
                                loading={loading}
                                unreadCount={unreadCount}
                                onClose={() => setNotifOpen(false)}
                                onMarkAllRead={markAllRead}
                                onMarkRead={markRead}
                            />
                        )}
                    </div>

                    {contextCta}
                </div>
            </header>

            {queryOpen && <QueryPanel siteId={siteId} onClose={() => setQueryOpen(false)} />}
        </>
    );
}
