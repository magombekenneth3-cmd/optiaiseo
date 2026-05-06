// src/app/dashboard/planner/BacklinksPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { upsertBacklinkTarget, removeBacklinkTarget } from "@/app/actions/planner";
import type { BacklinkTarget } from "@/types/planner";
import type { PlannerItem } from "@/app/actions/planner";

interface Props {
    siteId: string;
    item: PlannerItem;
    onUpdate: (updatedItem: PlannerItem) => void;
}

const TIER_COLORS: Record<number, string> = {
    1: "bg-emerald-500/10 text-emerald-400",
    2: "bg-amber-500/10 text-amber-400",
    3: "bg-red-500/10 text-red-400",
};
const STATUS_COLORS: Record<string, string> = {
    "Idea":           "bg-zinc-500/10 text-muted-foreground",
    "Outreach Sent":  "bg-blue-500/10 text-blue-400",
    "Following Up":   "bg-amber-500/10 text-amber-400",
    "Won":            "bg-emerald-500/10 text-emerald-400",
    "Rejected":       "bg-red-500/10 text-red-400",
};

const TYPES = ["guest_post", "resource_page", "broken_link", "quora", "medium", "podcast", "haro", "other"] as const;

export function BacklinksPanel({ siteId, item, onUpdate }: Props) {
    const [isPending, startTransition] = useTransition();
    const backlinks: BacklinkTarget[] = (item.backlinks as unknown as BacklinkTarget[]) ?? [];

    const [newTarget, setNewTarget] = useState<Partial<BacklinkTarget>>({
        tier: 1,
        type: "quora",
        status: "Idea",
        contactedAt: undefined,
    });

    // ── Add target ────────────────────────────────────────────────────────────
    const addTarget = () => {
        if (!newTarget.domain) return;
        const target: BacklinkTarget = {
            id:          `bl-${Date.now()}`,
            domain:      newTarget.domain,
            type:        newTarget.type as BacklinkTarget["type"],
            tier:        (newTarget.tier ?? 1) as 1 | 2 | 3,
            status:      newTarget.status as BacklinkTarget["status"],
            note:        newTarget.note,
            contactedAt: newTarget.contactedAt || undefined,
        };
        startTransition(async () => {
            await upsertBacklinkTarget(siteId, item.id, target);
            onUpdate({ ...item, backlinks: [target, ...backlinks] as unknown as typeof item.backlinks });
            setNewTarget({ tier: 1, type: "quora", status: "Idea", contactedAt: undefined });

            // Lazily fetch DR for the new target — failure is silent (decorative only)
            fetch(`/api/backlinks?siteId=${siteId}&mode=summary&domain=${target.domain}`)
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (!data?.summary?.domainRating) return;
                    const withDR = { ...target, dr: data.summary.domainRating as number };
                    onUpdate({
                        ...item,
                        backlinks: [withDR, ...backlinks] as unknown as typeof item.backlinks,
                    });
                })
                .catch(() => {});
        });
    };

    // ── Update status ─────────────────────────────────────────────────────────
    const updateStatus = (targetId: string, status: BacklinkTarget["status"]) => {
        const updated = backlinks.map(b => b.id === targetId ? { ...b, status } : b);
        const target  = updated.find(b => b.id === targetId)!;
        startTransition(async () => {
            await upsertBacklinkTarget(siteId, item.id, target);
            onUpdate({ ...item, backlinks: updated as unknown as typeof item.backlinks });
        });
    };

    // ── Remove target ─────────────────────────────────────────────────────────
    const removeTarget = (targetId: string) => {
        const updated = backlinks.filter(b => b.id !== targetId);
        startTransition(async () => {
            await removeBacklinkTarget(siteId, item.id, targetId);
            onUpdate({ ...item, backlinks: updated as unknown as typeof item.backlinks });
        });
    };

    const wonCount  = backlinks.filter(b => b.status === "Won").length;
    const sentCount = backlinks.filter(b => b.status === "Outreach Sent" || b.status === "Following Up").length;

    return (
        <div className="space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: "Total targets",   value: backlinks.length },
                    { label: "Outreach active", value: sentCount },
                    { label: "Links won",       value: wonCount },
                ].map(stat => (
                    <div key={stat.label} className="p-3 rounded-xl border border-border bg-muted/30 text-center">
                        <p className="text-2xl font-bold">{stat.value}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
                    </div>
                ))}
            </div>

            {/* Add new target */}
            <div>
                <h4 className="text-xs uppercase font-bold tracking-wider text-muted-foreground mb-2">Add target</h4>
                <div className="grid grid-cols-2 gap-2">
                    <input
                        value={newTarget.domain ?? ""}
                        onChange={e => setNewTarget(p => ({ ...p, domain: e.target.value }))}
                        placeholder="domain.com"
                        className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                    />
                    <select
                        value={newTarget.type}
                        onChange={e => setNewTarget(p => ({ ...p, type: e.target.value as BacklinkTarget["type"] }))}
                        className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none"
                    >
                        {TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                    </select>
                    <select
                        value={newTarget.tier}
                        onChange={e => setNewTarget(p => ({ ...p, tier: Number(e.target.value) as 1 | 2 | 3 }))}
                        className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none"
                    >
                        <option value={1}>Tier 1 — Easy</option>
                        <option value={2}>Tier 2 — Medium</option>
                        <option value={3}>Tier 3 — Hard</option>
                    </select>
                    <input
                        value={newTarget.note ?? ""}
                        onChange={e => setNewTarget(p => ({ ...p, note: e.target.value }))}
                        placeholder="Note (optional)"
                        className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                    />
                    {/* Editable contactedAt — not auto-set */}
                    <input
                        type="date"
                        value={newTarget.contactedAt ?? ""}
                        onChange={e => setNewTarget(p => ({ ...p, contactedAt: e.target.value || undefined }))}
                        className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-500 col-span-2"
                        title="Contacted date (optional)"
                    />
                    <button
                        onClick={addTarget}
                        disabled={isPending || !newTarget.domain}
                        className="col-span-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm font-bold hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                        Add target
                    </button>
                </div>
            </div>

            {/* Targets list */}
            <div className="space-y-2">
                {backlinks.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">
                        No backlink targets yet. Start with Tier 1 (Quora, Medium, Pinterest) — lowest effort.
                    </p>
                )}
                {backlinks.map(b => {
                    const bWithDR = b as BacklinkTarget & { dr?: number };
                    return (
                        <div
                            key={b.id}
                            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/20 text-sm"
                        >
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TIER_COLORS[b.tier]}`}>
                                T{b.tier}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <p className="font-medium truncate">{b.domain}</p>
                                    {/* DR badge — shown when available after lazy fetch */}
                                    {bWithDR.dr != null && (
                                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                            DR {bWithDR.dr}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {b.type.replace("_", " ")}
                                    {b.note ? ` · ${b.note}` : ""}
                                    {b.contactedAt ? ` · ${b.contactedAt}` : ""}
                                </p>
                            </div>
                            <select
                                value={b.status}
                                onChange={e => updateStatus(b.id, e.target.value as BacklinkTarget["status"])}
                                disabled={isPending}
                                className={`text-xs font-semibold px-2 py-1 rounded-md outline-none bg-transparent ${STATUS_COLORS[b.status]} hover:brightness-110 cursor-pointer`}
                            >
                                {Object.keys(STATUS_COLORS).map(s => (
                                    <option key={s} value={s} className="text-foreground bg-popover">{s}</option>
                                ))}
                            </select>
                            {/* Delete button */}
                            <button
                                onClick={() => removeTarget(b.id)}
                                disabled={isPending}
                                className="text-muted-foreground hover:text-destructive transition-colors ml-1 shrink-0"
                                aria-label={`Remove ${b.domain}`}
                                title="Remove target"
                            >
                                ✕
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
