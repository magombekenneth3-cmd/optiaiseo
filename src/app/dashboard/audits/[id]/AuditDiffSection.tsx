"use client";

import { useState } from "react";
import type { AuditDiffData, DiffItem } from "@/lib/audit/diff";

interface Props {
    diff: AuditDiffData | null;
}

export default function AuditDiffSection({ diff }: Props) {
    const [expanded, setExpanded] = useState(false);

    if (!diff || (diff.fixed.length === 0 && diff.newIssues.length === 0 && diff.degraded.length === 0)) {
        return null;
    }

    const totalChanges = diff.fixed.length + diff.newIssues.length + diff.degraded.length;

    return (
        <section className="card-surface p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="font-semibold text-base">📊 Progress Since Last Audit</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Compared to audit on {new Date(diff.previousDate).toLocaleDateString("en-GB", {
                            day: "numeric", month: "short", year: "numeric",
                        })}
                    </p>
                </div>
                <ScoreDelta delta={diff.scoreDelta} previous={diff.previousScore} current={diff.currentScore} />
            </div>

            <div className="grid grid-cols-3 gap-3">
                <SummaryChip count={diff.fixed.length}      label="Fixed"      icon="✅" cls="bg-emerald-500/10 border-emerald-500/20 text-emerald-400" />
                <SummaryChip count={diff.newIssues.length}  label="New Issues"  icon="🆕" cls="bg-red-500/10 border-red-500/20 text-red-400" />
                <SummaryChip count={diff.degraded.length}   label="Degraded"   icon="⚠️" cls="bg-amber-500/10 border-amber-500/20 text-amber-400" />
            </div>

            {totalChanges > 0 && (
                <>
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                        id="audit-diff-expand-btn"
                    >
                        {expanded ? "Hide details" : `Show all ${totalChanges} changes`}
                    </button>

                    {expanded && (
                        <div className="space-y-3 pt-1">
                            {diff.fixed.length > 0 && (
                                <DiffGroup title="✅ Resolved Issues" items={diff.fixed} rowCls="text-emerald-400" badgeCls="bg-emerald-500/10 text-emerald-400 border-emerald-500/20" badgeLabel="Fixed" />
                            )}
                            {diff.newIssues.length > 0 && (
                                <DiffGroup title="🆕 New Issues Found" items={diff.newIssues} rowCls="text-red-400" badgeCls="bg-red-500/10 text-red-400 border-red-500/20" badgeLabel="New" />
                            )}
                            {diff.degraded.length > 0 && (
                                <DiffGroup title="⚠️ Degraded Checks" items={diff.degraded} rowCls="text-amber-400" badgeCls="bg-amber-500/10 text-amber-400 border-amber-500/20" badgeLabel="Degraded" />
                            )}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

function ScoreDelta({ delta, previous, current }: { delta: number; previous: number; current: number }) {
    if (delta === 0) return (
        <span className="text-xs px-2 py-1 rounded-lg border bg-zinc-500/10 text-muted-foreground border-zinc-500/20">
            No change ({current})
        </span>
    );
    const positive = delta > 0;
    return (
        <div className="flex flex-col items-end gap-0.5">
            <span className={`text-sm font-bold px-2.5 py-1 rounded-lg border ${positive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                {positive ? "+" : ""}{delta} pts
            </span>
            <span className="text-[10px] text-muted-foreground">{previous} → {current}</span>
        </div>
    );
}

function SummaryChip({ count, label, icon, cls }: { count: number; label: string; icon: string; cls: string }) {
    return (
        <div className={`rounded-xl border p-3 flex flex-col items-center gap-1 ${cls}`}>
            <span className="text-xl font-black">{count}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{icon} {label}</span>
        </div>
    );
}

function DiffGroup({ title, items, rowCls, badgeCls, badgeLabel }: {
    title: string; items: DiffItem[]; rowCls: string; badgeCls: string; badgeLabel: string;
}) {
    return (
        <div>
            <p className={`text-xs font-semibold mb-1.5 ${rowCls}`}>{title}</p>
            <div className="space-y-1">
                {items.slice(0, 8).map(item => (
                    <div key={item.id} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-card/30 border border-border">
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeCls}`}>{badgeLabel}</span>
                        <span className="font-medium truncate">{item.title || item.id}</span>
                        <span className="shrink-0 text-muted-foreground capitalize">{item.category}</span>
                    </div>
                ))}
                {items.length > 8 && (
                    <p className="text-[10px] text-muted-foreground pl-1">+{items.length - 8} more</p>
                )}
            </div>
        </div>
    );
}
