"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, ChevronDown, Check } from "lucide-react";
import Link from "next/link";

interface Site {
    id: string;
    domain: string;
    grade?: string | null;
}

function gradeColour(grade?: string | null) {
    if (grade === "A" || grade === "B") return "bg-emerald-500";
    if (grade === "C") return "bg-amber-500";
    if (grade === "D" || grade === "F") return "bg-rose-500";
    return "bg-muted-foreground/40";
}

export function KeywordSiteSwitcher({
    sites,
    activeSiteId,
}: {
    sites: Site[];
    activeSiteId: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

    if (sites.length === 0) return null;

    const switchSite = (siteId: string) => {
        setOpen(false);
        router.push(`/dashboard/keywords?siteId=${siteId}`);
    };

    return (
        <div className="relative">
            <button
                id="keyword-site-switcher"
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card hover:bg-accent/60 transition-colors text-sm font-medium shadow-sm"
                aria-label="Switch site"
                aria-expanded={open}
            >
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className={`w-2 h-2 rounded-full shrink-0 ${gradeColour(activeSite?.grade)}`} />
                <span className="max-w-[180px] truncate">{activeSite?.domain ?? "Select site"}</span>
                {sites.length > 1 && (
                    <span className="ml-1 text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                        {sites.length}
                    </span>
                )}
                <ChevronDown
                    className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
            </button>

            {open && (
                <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />

                    {/* Dropdown */}
                    <div className="absolute left-0 top-full mt-2 z-40 min-w-[220px] bg-popover border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                        <div className="px-3 pt-2.5 pb-1.5 border-b border-border">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                Switch site
                            </p>
                        </div>

                        <div className="py-1">
                            {sites.map((site) => (
                                <button
                                    key={site.id}
                                    onClick={() => switchSite(site.id)}
                                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-accent transition-colors"
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${gradeColour(site.grade)}`} />
                                    <span className="truncate flex-1 min-w-0">{site.domain}</span>
                                    {site.id === activeSiteId && (
                                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="border-t border-border px-4 py-2">
                            <Link
                                href="/dashboard/sites/new"
                                onClick={() => setOpen(false)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
