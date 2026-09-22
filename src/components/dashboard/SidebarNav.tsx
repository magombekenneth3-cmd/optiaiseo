"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { LayoutDashboard, Globe, Lightbulb, TrendingUp, TrendingDown, MonitorSmartphone, ClipboardList, FileText, CreditCard, Settings, Mic, ChevronDown, Calendar, Zap, Shield, Users, Link2, ChevronRight, Crosshair, PanelLeftOpen, BarChart3, Gift, History, Target, FlaskConical, Code, Activity, Bot, Highlighter } from "lucide-react";

function extractSiteId(pathname: string): string | null {
  const match = pathname.match(/\/dashboard\/sites\/([^/]+)/);
  const id = match?.[1];
  return id && id !== "new" ? id : null;
}

function buildHref(base: string, siteId: string | null) {
  return siteId ? `${base}?siteId=${siteId}` : base;
}

const DISCOVER_ITEMS = [
  { name: "Opportunities", href: "/dashboard/recommendations", icon: Lightbulb, context: false },
  { name: "SEO Audits", href: "/dashboard/audits", icon: ClipboardList, context: true },
  { name: "AI Visibility", href: "/dashboard/aeo", icon: MonitorSmartphone, context: true },
];

const IMPROVE_ITEMS = [
  { name: "Content", href: "/dashboard/blogs", icon: FileText, context: false },
  { name: "Autopilot", href: "/dashboard/autopilot", icon: Bot, context: true },
];

const MONITOR_ITEMS = [
  { name: "Operations", href: "/dashboard/operations", icon: Activity, context: true },
];

const MORE_ITEMS = [
  { name: "My Sites", href: "/dashboard/sites", icon: Globe, context: false },
  { name: "Keywords", href: "/dashboard/keywords", icon: TrendingUp, context: true },
  { name: "Competitors", href: "/dashboard/competitors", icon: Crosshair, context: true },
  { name: "SERP Gap Analysis", href: "/dashboard/serp-gap", icon: BarChart3, context: true },
  { name: "Content Editor", href: "/dashboard/editor", icon: Highlighter, context: false },
  { name: "Content Planner", href: "/dashboard/planner", icon: Calendar, context: true },
  { name: "Programmatic SEO", href: "/dashboard/pseo", icon: Zap, context: false },
  { name: "Re-Optimize", href: "/dashboard/refresh", icon: ClipboardList, context: true },
  { name: "Content Decay", href: "/dashboard/content-decay", icon: TrendingDown, context: true },
  { name: "Backlinks", href: "/dashboard/backlinks", icon: Link2, context: true },
  { name: "Auto Indexer", href: "/dashboard/indexing", icon: Zap, context: false },
  { name: "Auto-Heal Log", href: "/dashboard/healing", icon: Shield, context: true },
  { name: "Citation History", href: "/dashboard/aeo/proofs", icon: History, context: true },
  { name: "Experiments", href: "/dashboard/experiments", icon: FlaskConical, context: true },
  { name: "Campaigns", href: "/dashboard/campaign", icon: Target, context: true },
  { name: "Team", href: "/dashboard/team", icon: Users, context: false },
  { name: "Talk to Aria", href: "/dashboard/voice", icon: Mic, context: false },
];

const ACCOUNT_ITEMS = [
  { name: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { name: "Refer & Earn", href: "/dashboard/referral", icon: Gift },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
  { name: "API & Docs", href: "/api-docs", icon: Code },
];

interface Site { id: string; domain: string; grade?: string | null; }

function domainInitial(domain: string) {
  return domain.replace(/^www\./, "").charAt(0).toUpperCase();
}

function NavLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="h-3" />;
  return <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/45">{children}</p>;
}

function NavItem({ item, siteId, pathname, collapsed }: { item: { name: string; href: string; icon: React.ElementType; context: boolean }; siteId: string | null; pathname: string; collapsed: boolean }) {
  const Icon = item.icon;
  const href = item.context ? buildHref(item.href, siteId) : item.href;
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const disabled = item.context && !siteId;
  return (
    <Link href={disabled ? "#" : href} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} title={collapsed ? item.name : disabled ? `${item.name} — select a site first` : undefined} className={`group relative flex items-center gap-3 rounded-xl text-sm transition-all duration-150 ${collapsed ? "mx-auto h-10 w-10 justify-center" : "px-3 py-2.5"} ${active ? "bg-brand/10 font-semibold text-foreground" : disabled ? "cursor-not-allowed text-muted-foreground/30" : "font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"}`} onClick={(event) => disabled && event.preventDefault()}>
      {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-brand" aria-hidden="true" />}
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-muted-foreground/70 group-hover:text-foreground"}`} aria-hidden="true" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.name}</span>}
      {disabled && !collapsed && <ChevronRight className="h-3 w-3 opacity-30" aria-hidden="true" />}
    </Link>
  );
}

function SitePicker({ sites, siteId }: { sites: Site[]; siteId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = sites.find((site) => site.id === siteId) ?? sites[0];
  if (!active) return null;
  const switchSite = (nextSiteId: string) => {
    setOpen(false);
    const contextRoutes = ["/dashboard/recommendations", "/dashboard/audits", "/dashboard/aeo", "/dashboard/autopilot", "/dashboard/operations", ...MORE_ITEMS.filter((item) => item.context).map((item) => item.href)];
    const isContextRoute = contextRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
    router.push(isContextRoute ? `${pathname}?siteId=${nextSiteId}` : `/dashboard?siteId=${nextSiteId}`);
  };
  return (
    <div className="relative px-2 pb-2">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="listbox" className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-2.5 py-2.5 text-left transition-colors hover:bg-muted/60">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand/20 bg-brand/10 text-xs font-bold text-brand">{domainInitial(active.domain)}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{active.domain}</span>
        {active.grade && <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">{active.grade}</span>}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <><button type="button" aria-label="Close site selector" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} /><div role="listbox" aria-label="Select site" className="absolute left-2 right-2 top-full z-20 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        {sites.map((site) => <button key={site.id} type="button" role="option" aria-selected={site.id === siteId} onClick={() => switchSite(site.id)} className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors hover:bg-accent ${site.id === siteId ? "bg-accent/60" : ""}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-bold text-muted-foreground">{domainInitial(site.domain)}</span><span className="min-w-0 flex-1 truncate font-medium">{site.domain}</span>{site.id === siteId && <span className="font-bold text-brand">✓</span>}</button>)}
        <div className="border-t border-border px-3 py-2"><Link href="/dashboard/sites/new" onClick={() => setOpen(false)} className="text-xs font-medium text-muted-foreground hover:text-foreground">+ Add new site</Link></div>
      </div></>}
    </div>
  );
}

function SidebarNavInner({ defaultSiteId, sites, isSuperAdmin, isCollapsed, onToggleCollapse }: { defaultSiteId?: string | null; sites: Site[]; isSuperAdmin: boolean; isCollapsed: boolean; onToggleCollapse?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const siteId = extractSiteId(pathname) || searchParams.get("siteId") || defaultSiteId || null;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ITEMS.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Dashboard navigation">
      {isCollapsed && onToggleCollapse && <button type="button" onClick={onToggleCollapse} aria-label="Expand sidebar" title="Expand sidebar" className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"><PanelLeftOpen className="h-4 w-4" /></button>}
      {!isCollapsed && sites.length > 0 && <SitePicker sites={sites} siteId={siteId} />}
      <NavLabel collapsed={isCollapsed}>Overview</NavLabel>
      <NavItem item={{ name: "Mission Control", href: "/dashboard", icon: LayoutDashboard, context: false }} siteId={siteId} pathname={pathname} collapsed={isCollapsed} />
      <NavLabel collapsed={isCollapsed}>Discover</NavLabel>
      {DISCOVER_ITEMS.map((item) => <NavItem key={item.name} item={item} siteId={siteId} pathname={pathname} collapsed={isCollapsed} />)}
      <NavLabel collapsed={isCollapsed}>Improve</NavLabel>
      {IMPROVE_ITEMS.map((item) => <NavItem key={item.name} item={item} siteId={siteId} pathname={pathname} collapsed={isCollapsed} />)}
      <NavLabel collapsed={isCollapsed}>Monitor</NavLabel>
      {MONITOR_ITEMS.map((item) => <NavItem key={item.name} item={item} siteId={siteId} pathname={pathname} collapsed={isCollapsed} />)}
      <div className={isCollapsed ? "mt-2" : "mt-3"}>
        <button type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} className={`relative flex w-full items-center gap-3 rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground ${isCollapsed ? "mx-auto h-10 w-10 justify-center" : "px-3 py-2.5"}`} title={isCollapsed ? "More tools" : undefined}>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          {!isCollapsed && <span className="text-[10px] font-bold uppercase tracking-[0.16em]">More tools</span>}
          {moreActive && <span className={`${isCollapsed ? "absolute right-1 top-1" : "ml-auto"} h-1.5 w-1.5 rounded-full bg-brand`} />}
        </button>
        {moreOpen && <div className="mt-1 space-y-0.5">{MORE_ITEMS.map((item) => <NavItem key={item.name} item={item} siteId={siteId} pathname={pathname} collapsed={isCollapsed} />)}</div>}
      </div>
      <NavLabel collapsed={isCollapsed}>Account</NavLabel>
      {ACCOUNT_ITEMS.map((item) => { const Icon = item.icon; const active = pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link key={item.name} href={item.href} title={isCollapsed ? item.name : undefined} className={`group relative flex items-center gap-3 rounded-xl text-sm transition-colors ${isCollapsed ? "mx-auto h-10 w-10 justify-center" : "px-3 py-2.5"} ${active ? "bg-brand/10 font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"}`}>{active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-brand" />}<Icon className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-muted-foreground/70 group-hover:text-foreground"}`} />{!isCollapsed && <span className="truncate">{item.name}</span>}</Link>; })}
      {isSuperAdmin && !isCollapsed && <div className="mt-3 border-t border-border pt-3"><NavLabel collapsed={false}>Admin</NavLabel><Link href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-violet-400 hover:bg-violet-500/10"><Shield className="h-4 w-4" /><span>Admin Dashboard</span></Link></div>}
    </nav>
  );
}

export function SidebarNav({ defaultSiteId, sites = [], isSuperAdmin = false, isCollapsed = false, onToggleCollapse }: { defaultSiteId?: string | null; sites?: Site[]; isSuperAdmin?: boolean; isCollapsed?: boolean; onToggleCollapse?: () => void }) {
  return <Suspense fallback={<nav className="flex-1 space-y-2 px-2 py-4">{Array.from({ length: 7 }).map((_, index) => <div key={index} className="h-10 rounded-xl skeleton" />)}</nav>}><SidebarNavInner defaultSiteId={defaultSiteId} sites={sites} isSuperAdmin={isSuperAdmin} isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse} /></Suspense>;
}
