"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { UserDropdown } from "./UserDropdown";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const STORAGE_KEY = "sidebar-collapsed";

interface Site { id: string; domain: string; grade?: string | null; }

interface Props {
    defaultSiteId?: string | null;
    sites?: Site[];
    isSuperAdmin?: boolean;
    user: { name: string; email: string; tier: string };
}

function getDomainInitial(domain: string): string {
    return domain.replace(/^www\./, "").charAt(0).toUpperCase();
}

export function CollapsibleSidebar({ defaultSiteId, sites = [], isSuperAdmin = false, user }: Props) {
    const [collapsed, setCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false);

    const activeSite = sites.find(s => s.id === defaultSiteId) ?? sites[0] ?? null;

    useEffect(() => {
        setMounted(true);
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "1") setCollapsed(true);
    }, []);

    const toggle = () => {
        setCollapsed(prev => {
            const next = !prev;
            localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
            return next;
        });
    };

    // Prevent flash of wrong width before mount
    if (!mounted) {
        return (
            <aside className="w-[240px] hidden md:flex flex-col sticky top-0 h-screen overflow-y-auto bg-sidebar border-r border-sidebar-border shrink-0" />
        );
    }

    return (
        <aside
            className={`hidden md:flex flex-col sticky top-0 h-screen bg-sidebar border-r border-sidebar-border shrink-0 overflow-hidden isolate transition-[width] duration-200 ease-in-out ${
                collapsed ? "w-16" : "w-[240px]"
            }`}
        >
            {/* Logo + collapse toggle ─────────────────────────── */}
            <div className={`h-14 flex border-b border-sidebar-border shrink-0 relative ${collapsed ? "flex-col items-center justify-center gap-1 py-1" : "items-center px-4"}`}>
                {/* Logo — hidden when collapsed */}
                {!collapsed && (
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-2.5 group flex-1 min-w-0"
                        aria-label="OptiAISEO — AI SEO audit and automation platform"
                    >
                        <div
                            className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shrink-0 shadow-sm shadow-brand/20"
                            title="OptiAISEO"
                        >
                            <span className="font-black text-white text-xs tracking-tighter leading-none" aria-hidden="true">O</span>
                        </div>
                        <div className="flex flex-col leading-none gap-0.5 min-w-0">
                            <span className="font-bold text-sm tracking-tight truncate" style={{ fontFamily: "var(--font-display)" }}>
                                OptiAISEO
                            </span>
                            <span className="text-xs font-medium text-muted-foreground/50 tracking-wide">
                                SEO Platform
                            </span>
                        </div>
                    </Link>
                )}

                {/* Collapsed: logo mark + active site avatar stacked */}
                {collapsed && (
                    <>
                        <Link
                            href="/dashboard"
                            aria-label="OptiAISEO — AI SEO audit and automation platform"
                        >
                            <div className="w-7 h-7 rounded-xl bg-brand flex items-center justify-center shadow-sm shadow-brand/20" title="OptiAISEO">
                                <span className="font-black text-white text-[10px] tracking-tighter leading-none" aria-hidden="true">O</span>
                            </div>
                        </Link>
                        {activeSite && (
                            <div
                                className="w-5 h-5 rounded-md bg-brand/15 border border-brand/20 flex items-center justify-center"
                                title={activeSite.domain}
                                aria-label={`Active site: ${activeSite.domain}`}
                            >
                                <span className="text-[8px] font-black text-brand leading-none">
                                    {getDomainInitial(activeSite.domain)}
                                </span>
                            </div>
                        )}
                    </>
                )}

                {/* Toggle button — pinned right when expanded */}
                {!collapsed && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger
                                onClick={toggle}
                                aria-label="Collapse sidebar"
                                className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors shrink-0"
                            >
                                <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">Collapse sidebar</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>

            {/* ── Nav ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                <SidebarNav
                    defaultSiteId={defaultSiteId}
                    sites={sites}
                    isSuperAdmin={isSuperAdmin}
                    isCollapsed={collapsed}
                    onToggleCollapse={toggle}
                />
            </div>

            {/* ── User dropdown ─────────────────────────────────── */}
            <div className={`border-t border-sidebar-border mt-auto ${collapsed ? "p-2" : "p-3"}`}>
                <UserDropdown
                    user={user}
                    collapsed={collapsed}
                />
            </div>
        </aside>
    );
}
