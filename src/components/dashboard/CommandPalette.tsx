"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, Globe, ClipboardList, TrendingUp,
  MonitorSmartphone, Zap, Mic, FileText, Calendar, TrendingDown,
  CreditCard, Settings, ArrowRight, X
} from "lucide-react";

interface Command {
  id: string;
  label: string;
  description?: string;
  href: string;
  icon: React.ElementType;
  keywords?: string[];
}

const COMMANDS: Command[] = [
  { id: "dashboard",      label: "Dashboard",         description: "Overview & metrics",      href: "/dashboard",                    icon: LayoutDashboard, keywords: ["home", "overview"] },
  { id: "sites",          label: "My Domains",         description: "Manage connected sites",  href: "/dashboard/sites",              icon: Globe,           keywords: ["domain", "website", "site"] },
  { id: "add-site",       label: "Add New Site",       description: "Connect a new domain",    href: "/dashboard/sites/new",          icon: Globe,           keywords: ["add", "new", "domain"] },
  { id: "audits",         label: "SEO Audits",         description: "Run & view audits",       href: "/dashboard/audits",             icon: ClipboardList,   keywords: ["audit", "scan", "check"] },
  { id: "keywords",       label: "Keyword Research",   description: "Track rankings",          href: "/dashboard/keywords",           icon: TrendingUp,      keywords: ["keyword", "rank", "seo"] },
  { id: "aeo",            label: "AI Visibility",      description: "AEO diagnostics",         href: "/dashboard/aeo",                icon: MonitorSmartphone, keywords: ["aeo", "ai", "chatgpt", "gsov"] },
  { id: "aeo-track",      label: "AEO Tracking",       description: "Monitor AI citations",    href: "/dashboard/aeo/track",          icon: TrendingUp,      keywords: ["aeo", "track", "citations"] },
  { id: "indexing",       label: "Auto Indexer",       description: "Submit pages to Google",  href: "/dashboard/indexing",           icon: Zap,             keywords: ["index", "submit", "google"] },
  { id: "voice",          label: "AI Voice Agent",     description: "SEO copilot via voice",   href: "/dashboard/voice",              icon: Mic,             keywords: ["voice", "agent", "ai", "chat"] },
  { id: "blogs",          label: "AI Content",         description: "Generate blog posts",     href: "/dashboard/blogs",              icon: FileText,        keywords: ["blog", "content", "post", "write"] },
  { id: "planner",        label: "Content Planner",    description: "Plan your content",       href: "/dashboard/planner",            icon: Calendar,        keywords: ["plan", "schedule", "content"] },
  { id: "refresh",        label: "Content Refresh",    description: "Update stale content",    href: "/dashboard/refresh",            icon: ClipboardList,   keywords: ["refresh", "update", "stale"] },
  { id: "decay",          label: "Content Decay",      description: "Find declining pages",    href: "/dashboard/content-decay",      icon: TrendingDown,    keywords: ["decay", "decline", "traffic"] },
  { id: "billing",        label: "Plans & Billing",    description: "Manage subscription",     href: "/dashboard/billing",            icon: CreditCard,      keywords: ["billing", "plan", "upgrade", "pay"] },
  { id: "settings",       label: "Settings",           description: "Account settings",        href: "/dashboard/settings",           icon: Settings,        keywords: ["settings", "account", "profile"] },
];

function scoreMatch(cmd: Command, query: string): number {
  const q = query.toLowerCase();
  const label = cmd.label.toLowerCase();
  const desc = (cmd.description ?? "").toLowerCase();
  const kw = (cmd.keywords ?? []).join(" ").toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 90;
  if (label.includes(q)) return 70;
  if (kw.includes(q)) return 50;
  if (desc.includes(q)) return 30;
  return 0;
}

export function CommandPalette() {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);
  const router    = useRouter();

  const filtered = query.trim()
    ? COMMANDS
        .map(c => ({ cmd: c, score: scoreMatch(c, query) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(r => r.cmd)
    : COMMANDS;

  const close = useCallback(() => { setOpen(false); setQuery(""); setSelected(0); }, []);

  const navigate = useCallback((cmd: Command) => {
    router.push(cmd.href);
    close();
  }, [router, close]);

  // Global shortcut: ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
        if (!open) { setQuery(""); setSelected(0); }
      }
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Focus input on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Keyboard navigation within palette
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selected]) navigate(filtered[selected]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      {/* Palette */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed left-1/2 top-[20vh] -translate-x-1/2 z-50 w-full max-w-lg card-elevated overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-autocomplete="list"
            aria-controls="cmd-list"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60 font-mono border border-border rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          id="cmd-list"
          role="listbox"
          ref={listRef}
          className="max-h-72 overflow-y-auto py-1"
          aria-label="Navigation commands"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            filtered.map((cmd, i) => {
              const Icon = cmd.icon;
              const isSelected = i === selected;
              return (
                <button
                  key={cmd.id}
                  role="option"
                  aria-selected={isSelected}
                  data-idx={i}
                  onClick={() => navigate(cmd)}
                  onMouseEnter={() => setSelected(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? "bg-accent" : ""}`}
                >
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                    isSelected ? "bg-foreground/8 border-border" : "bg-card border-border/50"
                  }`}>
                    <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-foreground" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-foreground/80"}`}>{cmd.label}</p>
                    {cmd.description && (
                      <p className="text-xs text-muted-foreground truncate">{cmd.description}</p>
                    )}
                  </div>
                  {isSelected && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[11px] text-muted-foreground/50">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">⌘K</kbd> toggle</span>
        </div>
      </div>
    </>
  );
}
