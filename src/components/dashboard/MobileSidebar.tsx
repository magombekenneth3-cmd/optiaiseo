"use client";

import { useState, useEffect } from "react";
import { SidebarNav } from "./SidebarNav";
import { Menu, X } from "lucide-react";

export function MobileSidebar({ userName, userTier, defaultSiteId, sites = [], isSuperAdmin = false }: {
    userName: string;
    userTier: string;
    defaultSiteId?: string | null;
    sites?: { id: string; domain: string; grade?: string | null }[];
    isSuperAdmin?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsOpen(false); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [isOpen]);

    // Lock body scroll while open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => { document.body.style.overflow = ""; };
    }, [isOpen]);

    return (
        <>
            {/*
             * Hamburger trigger — hidden on mobile (≤md) because the
             * MobileBottomNav "More" sheet already renders the full SidebarNav.
             * Keeping both visible creates a dual-nav conflict.
             * We keep the component mounted for programmatic use and keyboard shortcuts.
             */}
            <button
                onClick={() => setIsOpen(true)}
                aria-label="Open navigation menu"
                className="hidden items-center justify-center p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
                <Menu className="w-5 h-5" />
            </button>

            {/* Only mount drawer + backdrop when open — avoids any DOM bleed on desktop */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                        onClick={() => setIsOpen(false)}
                        aria-hidden="true"
                        style={{ animation: "sidebar-fade-in 200ms ease-out" }}
                    />

                    {/* Slide-in drawer */}
                    <aside
                        className="fixed top-0 left-0 h-full w-72 z-50 flex flex-col glass border-r border-border"
                        style={{ animation: "sidebar-slide-in-left 250ms ease-out" }}
                    >
                        {/* Drawer header */}
                        <div className="h-20 flex items-center justify-between px-6 border-b border-border shrink-0">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
                                    <span className="font-black text-white text-xs tracking-tight">O</span>
                                </div>
                                <div className="flex flex-col leading-none">
                                    <span className="font-bold text-sm text-foreground tracking-tight">OptiAISEO</span>
                                    <span className="text-[10px] font-semibold text-emerald-400 tracking-wider uppercase">SEO</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                aria-label="Close navigation menu"
                                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Nav — close drawer on link click */}
                        <div className="flex-1 overflow-y-auto" onClick={() => setIsOpen(false)}>
                            <SidebarNav defaultSiteId={defaultSiteId} sites={sites} isSuperAdmin={isSuperAdmin} />
                        </div>

                        {/* User info footer — pb-20 clears the fixed 64px bottom nav on mobile */}
                        <div className="p-4 border-t border-border shrink-0 pb-20" style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-card/40 border border-border">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-300 flex items-center justify-center font-bold text-white text-xs shrink-0">
                                    {(userName || "U").charAt(0).toUpperCase()}
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-sm font-medium truncate">{userName}</span>
                                    <span className="text-xs text-muted-foreground truncate">{userTier}</span>
                                </div>
                            </div>
                        </div>
                    </aside>
                </>
            )}


        </>
    );
}
