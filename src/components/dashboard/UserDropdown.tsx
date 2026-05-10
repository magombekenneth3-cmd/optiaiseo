"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ChevronDown } from "lucide-react";

export function UserDropdown({ user, collapsed = false }: { user: { name: string, email: string, tier: string }; collapsed?: boolean }) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const firstChar = (user.name || "U").charAt(0).toUpperCase();

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="true"
                aria-label={collapsed ? `User menu for ${user.name}` : undefined}
                className={
                    collapsed
                        ? "flex items-center justify-center w-10 h-10 rounded-xl bg-card/40 border border-border hover:bg-muted transition-all duration-200 mx-auto group"
                        : "flex items-center justify-between p-3 rounded-xl bg-card/40 backdrop-blur-md border border-border hover:border-border hover:bg-muted transition-all duration-300 cursor-pointer w-full text-left group"
                }
            >
                <div className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-300 flex items-center justify-center font-bold text-white text-xs shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)] group-hover:shadow-[0_0_25px_-5px_rgba(16,185,129,0.6)] transition-all duration-300 shrink-0">
                        {firstChar}
                    </div>
                    {!collapsed && (
                        <div className="flex flex-col min-w-0">
                            <span className="text-sm font-medium truncate">{user.name}</span>
                            <span className="text-xs text-muted-foreground truncate">{user.tier}</span>
                        </div>
                    )}
                </div>
                {!collapsed && (
                    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${isOpen ? "rotate-180" : ""}`} />
                )}
            </button>

            {isOpen && (
                <div className={`absolute bottom-full mb-2 bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200 z-50 ${collapsed ? "left-0 w-52" : "left-0 w-full"}`}>
                    <div className="p-3 border-b border-border">
                        <p className="text-sm font-medium truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <div className="p-1">
                        <Link
                            href="/dashboard/settings"
                            onClick={() => setIsOpen(false)}
                            className="flex items-center w-full px-3 py-2 text-sm text-foreground hover:bg-muted rounded-lg transition-colors"
                        >
                            Settings &amp; Billing
                        </Link>
                        <button
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            className="flex items-center w-full px-3 py-2 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors text-left"
                        >
                            Log out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
