/**
 * 4.3 Mobile-first: Mobile bottom tab navigation.
 * Replaces the hidden sidebar with a bottom tab bar ≤768px.
 * Shows 5 most-used tabs: Home, Aria, AEO, Audits, More.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Mic, MonitorSmartphone, ClipboardList, MoreHorizontal, X, LogOut } from "lucide-react";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { SidebarNav } from "./SidebarNav";


const BOTTOM_TABS = [
    { name: "Home",   href: "/dashboard",       icon: LayoutDashboard, exact: true  },
    { name: "Audits", href: "/dashboard/audits", icon: ClipboardList,   exact: false },
    { name: "Aria",   href: "/dashboard/voice",  icon: Mic,             exact: true, isAria: true },
    { name: "AEO",    href: "/dashboard/aeo",    icon: MonitorSmartphone,exact: true },
];

interface MobileBottomNavProps {
    userName: string;
    userTier: string;
    defaultSiteId: string | null;
    sites: { id: string; domain: string; grade?: string | null }[];
    isSuperAdmin: boolean;
}

export function MobileBottomNav({
    userName, userTier, defaultSiteId, sites, isSuperAdmin,
}: MobileBottomNavProps) {
    const pathname = usePathname();
    const [moreOpen, setMoreOpen] = useState(false);

    return (
        <>
            {/* Bottom tab bar — mobile only */}
            <nav
                className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar/90 backdrop-blur-xl border-t border-border flex flex-col items-stretch"
                aria-label="Mobile bottom navigation"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
                <div className="h-16 flex items-stretch">
                {BOTTOM_TABS.map(tab => {
                    const Icon = tab.icon;
                    const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
                    const isAria = !!tab.isAria;
                    return (
                        <Link
                            key={tab.name}
                            href={tab.href}
                            id={`mobile-tab-${tab.name.toLowerCase()}`}
                            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${
                                isAria
                                    ? "text-brand"
                                    : isActive
                                        ? "text-foreground"
                                        : "text-muted-foreground"
                            }`}
                        >
                            <div className={`relative flex items-center justify-center rounded-xl w-9 h-7 ${
                                isAria ? "bg-brand/15" : isActive ? "bg-foreground/8" : ""
                            }`}>
                                <Icon className={`w-[18px] h-[18px] ${isActive || isAria ? "text-brand" : ""}`} />
                                {isActive && !isAria && (
                                    <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand" />
                                )}
                            </div>
                            <span>{tab.name}</span>
                        </Link>
                    );
                })}

                {/* More button opening full sidebar */}
                <button
                    id="mobile-tab-more"
                    onClick={() => setMoreOpen(true)}
                    className="flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-semibold text-muted-foreground transition-colors"
                >
                    <div className="flex items-center justify-center rounded-xl w-9 h-7">
                        <MoreHorizontal className="w-[18px] h-[18px]" />
                    </div>
                    <span>More</span>
                </button>
                </div>
            </nav>

            {/* Full mobile sidebar sheet (existing) */}
            {moreOpen && (
                <div className="fixed inset-0 z-50 md:hidden">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMoreOpen(false)} />
                    <div className="absolute bottom-0 inset-x-0 bg-sidebar rounded-t-2xl border-t border-border max-h-[90vh] flex flex-col"
                        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                    >
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                            <span className="font-bold text-sm">Navigation</span>
                            <button
                                onClick={() => setMoreOpen(false)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                aria-label="Close menu"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div
                            className="flex-1 overflow-y-auto"
                            onClick={(e) => {
                                const link = (e.target as HTMLElement).closest("a");
                                if (link && link.href && !link.getAttribute("href")?.startsWith("#")) {
                                    setMoreOpen(false);
                                }
                            }}
                        >
                            <SidebarNav
                                defaultSiteId={defaultSiteId}
                                sites={sites}
                                isSuperAdmin={isSuperAdmin}
                            />
                        </div>

                        <div className="p-4 border-t border-border shrink-0">
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-card/40 border border-border">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-300 flex items-center justify-center font-bold text-white text-xs shrink-0">
                                    {(userName || "U").charAt(0).toUpperCase()}
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-sm font-medium truncate">{userName}</span>
                                    <span className="text-xs text-muted-foreground truncate">{userTier}</span>
                                </div>
                                <button
                                    onClick={() => signOut({ callbackUrl: "/login" })}
                                    className="ml-auto shrink-0 flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground border border-border hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/20 transition-colors"
                                    aria-label="Sign out"
                                >
                                    <LogOut className="w-3 h-3" />
                                    Sign out
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
