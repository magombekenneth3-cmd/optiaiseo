"use client";

export type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

export interface AuditSidebarGroup {
    label: string;
    severity: SeverityFilter;
    items: { name: string; count: number }[];
}

interface Props {
    domain: string;
    totalIssues: number;
    groups: AuditSidebarGroup[];
    runDate: string;
    activeFilter: SeverityFilter;
    onFilterChange: (f: SeverityFilter) => void;
}

const SEV: Record<SeverityFilter, { dot: string; badge: string }> = {
    all:      { dot: "bg-emerald-500",  badge: "bg-amber-500/15  text-amber-400  border-amber-500/20"  },
    critical: { dot: "bg-red-500",      badge: "bg-red-500/15    text-red-400    border-red-500/20"    },
    high:     { dot: "bg-amber-500",    badge: "bg-amber-500/15  text-amber-400  border-amber-500/20"  },
    medium:   { dot: "bg-blue-500",     badge: "bg-blue-500/15   text-blue-400   border-blue-500/20"   },
    low:      { dot: "bg-zinc-500",     badge: "bg-zinc-800      text-zinc-400   border-zinc-700"      },
};

export function AuditSidebar({
    domain, totalIssues, groups, runDate, activeFilter, onFilterChange,
}: Props) {
    return (
        <aside className="w-[220px] shrink-0 flex flex-col border-r border-border bg-sidebar overflow-y-auto">

            <div className="px-4 py-3 border-b border-border">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.1em] mb-2">
                    Site
                </p>
                <button
                    onClick={() => onFilterChange("all")}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors border-l-2 ${
                        activeFilter === "all"
                            ? "border-blue-500 bg-sidebar-accent text-foreground"
                            : "border-transparent hover:bg-sidebar-accent/60 text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="w-[7px] h-[7px] rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-[12px] font-medium truncate">{domain}</span>
                    </div>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ml-1.5 bg-amber-500/15 text-amber-400 border-amber-500/20">
                        {totalIssues}
                    </span>
                </button>
            </div>

            <div className="flex-1 py-2 overflow-y-auto">
                {groups.map((group) => {
                    const s = SEV[group.severity];
                    const isActive = activeFilter === group.severity;
                    return (
                        <div key={group.severity} className="mb-1">
                            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-[0.1em] px-4 pt-3 pb-1.5">
                                {group.label}
                            </p>
                            {group.items.map((item) => (
                                <button
                                    key={item.name}
                                    onClick={() => onFilterChange(group.severity)}
                                    className={`w-full flex items-center justify-between px-4 py-[7px] text-left text-[12px] transition-all border-l-2 ${
                                        isActive
                                            ? "border-blue-500 bg-sidebar-accent text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${s.dot}`} />
                                        <span className="truncate">{item.name}</span>
                                    </div>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ml-1.5 ${s.badge}`}>
                                        {item.count}
                                    </span>
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>

            <div className="px-4 py-3 border-t border-border">
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                    {runDate}
                </p>
            </div>
        </aside>
    );
}
