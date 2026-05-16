"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    LayoutDashboard,
    Globe,
    Lightbulb,
    TrendingUp,
    TrendingDown,
    MonitorSmartphone,
    ClipboardList,
    FileText,
    CreditCard,
    Settings,
    Mic,
    ChevronDown,
    Calendar,
    Zap,
    Shield,
    Users,
    Link2,
    ChevronRight,
    Crosshair,
    PanelLeftOpen,
    BarChart3,
    Gift,
} from "lucide-react";
import { useState } from "react";

function extractSiteId(pathname: string): string | null {
    const match = pathname.match(/\/dashboard\/sites\/([^/]+)/);
    const id = match?.[1];
    if (!id || id === "new") return null;
    return id;
}

function buildHref(base: string, siteId: string | null): string {
    if (siteId) return `${base}?siteId=${siteId}`;
    return base;
}

const NAV_ITEMS = [
    { name: "Dashboard",      href: "/dashboard",                 icon: LayoutDashboard,  exact: true,  contextSiteId: false },
    { name: "My Sites",       href: "/dashboard/sites",           icon: Globe,            exact: false, contextSiteId: false },
    { name: "SEO Audits",     href: "/dashboard/audits",          icon: ClipboardList,    exact: false, contextSiteId: true  },
    { name: "Keywords",       href: "/dashboard/keywords",        icon: TrendingUp,       exact: false, contextSiteId: true  },
    { name: "Competitors",    href: "/dashboard/competitors",     icon: Crosshair,        exact: false, contextSiteId: true  },
    { name: "AI Visibility",  href: "/dashboard/aeo",             icon: MonitorSmartphone,exact: true,  contextSiteId: true  },
    { name: "AI Content",     href: "/dashboard/blogs",           icon: FileText,         exact: false, contextSiteId: false },
];

const ACCOUNT_ITEMS = [
    { name: "Billing",       href: "/dashboard/billing",  icon: CreditCard, exact: false, contextSiteId: false },
    { name: "Refer & Earn",  href: "/dashboard/referral", icon: Gift,       exact: false, contextSiteId: false },
    { name: "Settings",      href: "/dashboard/settings", icon: Settings,   exact: false, contextSiteId: false },
    { name: "Talk to Aria",  href: "/dashboard/voice",    icon: Mic,        exact: false, contextSiteId: false },
];

const SECONDARY_ITEMS = [
    { name: "Recommendations", href: "/dashboard/recommendations", icon: Lightbulb,    contextSiteId: false, group: "strategy" },
    { name: "SERP Gap Analysis",href: "/dashboard/serp-gap",       icon: BarChart3,    contextSiteId: true,  group: "strategy" },
    { name: "Content Planner", href: "/dashboard/planner",         icon: Calendar,     contextSiteId: true,  group: "content" },
    { name: "Re-Optimize",     href: "/dashboard/refresh",         icon: ClipboardList,contextSiteId: true,  group: "content" },
    { name: "Content Decay",   href: "/dashboard/content-decay",   icon: TrendingDown, contextSiteId: true,  group: "content" },
    { name: "Backlinks",       href: "/dashboard/backlinks",       icon: Link2,        contextSiteId: true,  group: "technical" },
    { name: "Auto Indexer",    href: "/dashboard/indexing",        icon: Zap,          contextSiteId: false, group: "technical" },
    { name: "Auto-Heal Log",   href: "/dashboard/healing",         icon: Zap,          contextSiteId: true,  group: "technical" },
    { name: "Team",            href: "/dashboard/team",            icon: Users,        contextSiteId: false, group: "strategy" },
];

interface Site { id: string; domain: string; grade?: string | null; }

function getGradeColor(grade?: string | null): string {
    if (grade === "A" || grade === "B") return "bg-emerald-500";
    if (grade === "C") return "bg-amber-500";
    if (grade === "D" || grade === "F") return "bg-rose-500";
    return "bg-muted-foreground/30";
}

function getDomainInitial(domain: string): string {
    return domain.replace(/^www\./, "").charAt(0).toUpperCase();
}

function SitePickerDropdown({ sites, activeSiteId }: { sites: Site[]; activeSiteId: string | null }) {
    const router = useRouter();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const activeSite = sites.find(s => s.id === activeSiteId) ?? sites[0];

    if (sites.length === 0) return null;

    const switchSite = (siteId: string) => {
        setOpen(false);
        const base = pathname.startsWith("/dashboard/sites/") ? "/dashboard" : pathname;
        const contextPages = ["/dashboard/keywords", "/dashboard/audits", "/dashboard/aeo", "/dashboard/refresh", "/dashboard/backlinks", "/dashboard/competitors", "/dashboard/serp-gap"];
        const isContextPage = contextPages.some(p => base.startsWith(p));
        router.push(isContextPage ? `${base}?siteId=${siteId}` : `/dashboard/keywords?siteId=${siteId}`);
    };

    return (
        <div className="relative px-2 pb-3">
            <button
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={`Site selector — ${activeSite?.domain ?? "none selected"}`}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-border bg-muted/40 text-sm text-left transition-all hover:bg-muted hover:border-border/60"
            >
                {/* Domain initial avatar */}
                <div className="w-6 h-6 rounded-md bg-brand/15 border border-brand/20 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-black text-brand leading-none">
                        {activeSite ? getDomainInitial(activeSite.domain) : "—"}
                    </span>
                </div>

                <span className="flex-1 min-w-0 truncate text-xs font-semibold text-foreground">
                    {activeSite?.domain ?? "Select site"}
                </span>

                {/* Grade indicator */}
                {activeSite?.grade && (
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${
                        activeSite.grade === "A" || activeSite.grade === "B"
                            ? "text-emerald-400 bg-emerald-500/10"
                            : activeSite.grade === "C"
                                ? "text-amber-400 bg-amber-500/10"
                                : "text-rose-400 bg-rose-500/10"
                    }`}>
                        {activeSite.grade}
                    </span>
                )}

                <ChevronDown
                    className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    aria-hidden="true"
                />
            </button>

            {open && (
                <>
                    <button
                        aria-label="Close site selector"
                        tabIndex={-1}
                        className="fixed inset-0 z-10 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <div
                        role="listbox"
                        aria-label="Select a site"
                        className="absolute left-0 right-0 mt-1 z-20 bg-popover border border-border rounded-xl shadow-2xl shadow-black/20 overflow-hidden"
                    >
                        {sites.map(site => (
                            <button
                                key={site.id}
                                role="option"
                                aria-selected={site.id === activeSiteId}
                                onClick={() => switchSite(site.id)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors hover:bg-accent ${
                                    site.id === activeSiteId ? "bg-accent/60" : ""
                                }`}
                            >
                                <div className="w-5 h-5 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                                    <span className="text-[9px] font-black text-muted-foreground leading-none">
                                        {getDomainInitial(site.domain)}
                                    </span>
                                </div>
                                <span className="truncate min-w-0 flex-1 text-xs font-medium">{site.domain}</span>
                                {site.id === activeSiteId && (
                                    <span className="ml-auto text-xs font-bold text-brand shrink-0">✓</span>
                                )}
                            </button>
                        ))}
                        <div className="border-t border-border px-3 py-2">
                            <Link
                                href="/dashboard/sites/new"
                                onClick={() => setOpen(false)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
                            >
                                + Add new site
                            </Link>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function NavLink({
    item,
    href,
    isActive,
    missingContext,
    indent = false,
    isCollapsed = false,
}: {
    item: { name: string; icon: React.ElementType; contextSiteId: boolean; isBeta?: boolean };
    href: string;
    isActive: boolean;
    missingContext: boolean;
    indent?: boolean;
    isCollapsed?: boolean;
}) {
    const Icon = item.icon;
    const linkEl = (
        <Link
            href={href}
            aria-disabled={missingContext ? true : undefined}
            tabIndex={missingContext ? -1 : undefined}
            aria-label={isCollapsed ? item.name : undefined}
            className={`
                group flex items-center gap-3 rounded-lg text-sm transition-all relative
                ${isCollapsed ? "justify-center p-2 mx-auto w-10 h-10" : `px-3 py-2 ${indent ? "pl-4" : ""}`}
                ${isActive
                    ? "text-foreground font-semibold"
                    : missingContext
                        ? "text-muted-foreground/35 pointer-events-none select-none cursor-not-allowed"
                        : "text-muted-foreground font-medium hover:bg-sidebar-accent hover:text-foreground"
                }
            `}
            style={isActive ? { background: "rgba(16,185,129,0.09)" } : {}}
        >
            {/* Left active bar */}
            {isActive && !isCollapsed && (
                <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-brand"
                    aria-hidden="true"
                />
            )}
            {isActive && isCollapsed && (
                <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-brand"
                    aria-hidden="true"
                />
            )}

            {/* Icon */}
            <Icon
                className={`shrink-0 transition-colors ${
                    isCollapsed ? "w-5 h-5" : "w-4 h-4"
                } ${isActive ? "text-brand" : "text-muted-foreground/70 group-hover:text-foreground"}`}
                aria-hidden="true"
            />

            {/* Label — hidden when collapsed */}
            {!isCollapsed && (
                <span className="flex-1 min-w-0 truncate">{item.name}</span>
            )}

            {/* Missing context hint */}
            {missingContext && !isCollapsed && (
                <span className="ml-auto text-xs font-medium text-muted-foreground/40 shrink-0" aria-hidden="true">
                    <ChevronRight className="w-3 h-3 opacity-40" />
                </span>
            )}
            {missingContext && (
                <span className="sr-only">(requires site selection)</span>
            )}
        </Link>
    );

    if (isCollapsed) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger render={linkEl} />
                    <TooltipContent side="right" className="text-xs">
                        {missingContext ? `${item.name} — select a site first` : item.name}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    return missingContext ? (
        <TooltipProvider delay={200}>
            <Tooltip>
                <TooltipTrigger>{linkEl}</TooltipTrigger>
                <TooltipContent side="right" className="text-xs">Select a site first</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ) : linkEl;
}

function NavSectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-3 pt-4 pb-1 text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest select-none">
            {children}
        </p>
    );
}

function SidebarNavInner({
    defaultSiteId,
    sites = [],
    isSuperAdmin = false,
    isCollapsed = false,
    onToggleCollapse,
}: {
    defaultSiteId?: string | null;
    sites?: Site[];
    isSuperAdmin?: boolean;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}) {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const siteId =
        extractSiteId(pathname) ||
        searchParams.get("siteId") ||
        defaultSiteId ||
        null;

    const isSecondaryActive = SECONDARY_ITEMS.some(item =>
        pathname === item.href || pathname.startsWith(item.href + "/")
    );
    const [moreOpen, setMoreOpen] = useState(isSecondaryActive);

    return (
        <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-0.5" aria-label="Dashboard navigation">

            {/* Expand button — only in collapsed mode */}
            {isCollapsed && onToggleCollapse && (
                <div className="flex justify-center pb-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger
                                    onClick={onToggleCollapse}
                                    aria-label="Expand sidebar"
                                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
                                >
                                    <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
                                </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">Expand sidebar</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            )}

            {/* Site picker — hide entirely when collapsed */}
            {!isCollapsed && sites.length > 0 && (
                <SitePickerDropdown sites={sites} activeSiteId={siteId} />
            )}

            {/* Primary nav */}
            <div className={`space-y-0.5 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
                {NAV_ITEMS.map((item) => {
                    const href = item.contextSiteId ? buildHref(item.href, siteId) : item.href;
                    const isActive = item.href === "/dashboard/aeo"
                        ? (pathname === "/dashboard/aeo" || /\/dashboard\/sites\/[^/]+\/aeo/.test(pathname))
                        : item.exact
                            ? pathname === item.href
                            : pathname === item.href || pathname.startsWith(item.href + "/");
                    const missingContext = item.contextSiteId && !siteId;

                    return (
                        <NavLink
                            key={item.name}
                            item={item}
                            href={href}
                            isActive={isActive}
                            missingContext={!!missingContext}
                            isCollapsed={isCollapsed}
                        />
                    );
                })}
            </div>

            {/* More tools — collapsible; icon-only in collapsed sidebar */}
            {isCollapsed ? (
                /* In collapsed sidebar: show each tool icon individually with tooltip */
                <div className="pt-1 flex flex-col items-center space-y-0.5">
                    {moreOpen && SECONDARY_ITEMS.map((item) => {
                        const href = item.contextSiteId ? buildHref(item.href, siteId) : item.href;
                        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                        const missingContext = item.contextSiteId && !siteId;
                        return (
                            <NavLink
                                key={item.name}
                                item={item}
                                href={href}
                                isActive={isActive}
                                missingContext={!!missingContext}
                                isCollapsed
                            />
                        );
                    })}
                    {/* Collapsed more-tools toggle */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger
                                    onClick={() => setMoreOpen(o => !o)}
                                    aria-expanded={moreOpen}
                                    className="p-2 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
                                >
                                    <ChevronDown
                                        className={`w-4 h-4 transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`}
                                        aria-hidden="true"
                                    />
                                </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">{moreOpen ? "Hide tools" : "More tools"}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            ) : (
                /* Expanded: full collapsible group */
                <div className="pt-1">
                    <button
                        onClick={() => setMoreOpen(o => !o)}
                        aria-expanded={moreOpen}
                        aria-controls="more-tools-list"
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground/60 hover:bg-sidebar-accent hover:text-foreground transition-all"
                    >
                        <ChevronDown
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`}
                            aria-hidden="true"
                        />
                        <span className="text-xs font-semibold tracking-wide uppercase">More tools</span>
                        {isSecondaryActive && (
                            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
                        )}
                    </button>

                    {moreOpen && (
                        <div id="more-tools-list" className="space-y-0.5 mt-0.5 pl-2">
                            {(["strategy", "content", "technical"] as const).map(group => {
                                const groupItems = SECONDARY_ITEMS.filter(i => i.group === group);
                                const groupLabel = group === "strategy" ? "Strategy" : group === "content" ? "Content" : "Technical";
                                return (
                                    <div key={group}>
                                        <p className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest select-none">{groupLabel}</p>
                                        {groupItems.map((item) => {
                                            const href = item.contextSiteId ? buildHref(item.href, siteId) : item.href;
                                            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                                            const missingContext = item.contextSiteId && !siteId;
                                            return (
                                                <NavLink
                                                    key={item.name}
                                                    item={item}
                                                    href={href}
                                                    isActive={isActive}
                                                    missingContext={!!missingContext}
                                                />
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Account section */}
            {!isCollapsed && (
                <div className="pt-1">
                    <NavSectionLabel>Account</NavSectionLabel>
                    <div className="space-y-0.5">
                        {ACCOUNT_ITEMS.map((item) => {
                            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                            return (
                                <NavLink
                                    key={item.name}
                                    item={item}
                                    href={item.href}
                                    isActive={isActive}
                                    missingContext={false}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
            {isCollapsed && (
                <div className="pt-1 flex flex-col items-center space-y-0.5">
                    {ACCOUNT_ITEMS.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                        return (
                            <NavLink
                                key={item.name}
                                item={item}
                                href={item.href}
                                isActive={isActive}
                                missingContext={false}
                                isCollapsed
                            />
                        );
                    })}
                </div>
            )}

            {/* Super-admin section */}
            {isSuperAdmin && !isCollapsed && (
                <div className="pt-1">
                    <NavSectionLabel>Admin</NavSectionLabel>
                    <Link
                        href="/admin"
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all relative ${
                            pathname.startsWith("/admin")
                                ? "bg-violet-500/10 text-violet-300"
                                : "text-violet-400/60 hover:bg-violet-500/10 hover:text-violet-300"
                        }`}
                    >
                        {pathname.startsWith("/admin") && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-violet-500" />
                        )}
                        <Shield className="w-4 h-4 shrink-0 text-violet-400" aria-hidden="true" />
                        <span>Admin Dashboard</span>
                    </Link>
                </div>
            )}
        </nav>
    );
}

export function SidebarNav({
    defaultSiteId,
    sites = [],
    isSuperAdmin = false,
    isCollapsed = false,
    onToggleCollapse,
}: {
    defaultSiteId?: string | null;
    sites?: Site[];
    isSuperAdmin?: boolean;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}) {
    return (
        <Suspense fallback={<nav className="flex-1 px-2 py-4 space-y-1">
            {[...Array(6)].map((_, i) => (
                <div key={i} className="h-9 rounded-lg skeleton" />
            ))}
        </nav>}>
            <SidebarNavInner
                defaultSiteId={defaultSiteId}
                sites={sites}
                isSuperAdmin={isSuperAdmin}
                isCollapsed={isCollapsed}
                onToggleCollapse={onToggleCollapse}
            />
        </Suspense>
    );
}