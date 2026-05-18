// src/app/dashboard/planner/BacklinksPanel.tsx
"use client";

import { useState, useTransition, useCallback } from "react";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    type DragStartEvent,
    type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { upsertBacklinkTarget, removeBacklinkTarget } from "@/app/actions/planner";
import type { BacklinkTarget } from "@/types/planner";
import type { PlannerItem } from "@/app/actions/planner";

interface Props {
    siteId: string;
    item: PlannerItem;
    onUpdate: (updatedItem: PlannerItem) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: BacklinkTarget["status"][] = [
    "Idea",
    "Outreach Sent",
    "Following Up",
    "Won",
    "Rejected",
];

const COLUMN_META: Record<BacklinkTarget["status"], { color: string; bg: string; border: string; dot: string }> = {
    "Idea":          { color: "#9ca3af", bg: "rgba(156,163,175,.06)", border: "rgba(156,163,175,.15)", dot: "#6b7280" },
    "Outreach Sent": { color: "#60a5fa", bg: "rgba(59,130,246,.06)",  border: "rgba(59,130,246,.2)",   dot: "#3b82f6" },
    "Following Up":  { color: "#fbbf24", bg: "rgba(251,191,36,.06)",  border: "rgba(251,191,36,.2)",   dot: "#f59e0b" },
    "Won":           { color: "#34d399", bg: "rgba(16,185,129,.06)",  border: "rgba(16,185,129,.2)",   dot: "#10b981" },
    "Rejected":      { color: "#f87171", bg: "rgba(239,68,68,.06)",   border: "rgba(239,68,68,.2)",    dot: "#ef4444" },
};

const TIER_META: Record<number, { label: string; color: string; bg: string }> = {
    1: { label: "T1", color: "#34d399", bg: "rgba(16,185,129,.12)" },
    2: { label: "T2", color: "#fbbf24", bg: "rgba(251,191,36,.12)" },
    3: { label: "T3", color: "#f87171", bg: "rgba(239,68,68,.12)" },
};

const TYPE_ICONS: Record<BacklinkTarget["type"], string> = {
    guest_post:    "✍",
    resource_page: "📄",
    broken_link:   "🔗",
    quora:         "Q",
    medium:        "M",
    podcast:       "🎙",
    haro:          "📰",
    other:         "•",
};

const TYPES: BacklinkTarget["type"][] = [
    "guest_post", "resource_page", "broken_link", "quora", "medium", "podcast", "haro", "other",
];

function drColor(dr: number) {
    if (dr >= 60) return "#34d399";
    if (dr >= 30) return "#fbbf24";
    return "#f87171";
}

function daysSince(iso?: string): number | null {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ─── Column stats (all client-side, no extra fetch) ──────────────────────────

function colStats(backlinks: BacklinkTarget[], col: BacklinkTarget["status"]) {
    const cards  = backlinks.filter(b => b.status === col);
    const avgDr  = cards.filter(b => b.dr != null).reduce((s, b) => s + b.dr!, 0) / (cards.filter(b => b.dr != null).length || 1);
    const oldest = cards
        .filter(b => b.contactedAt)
        .sort((a, b) => a.contactedAt!.localeCompare(b.contactedAt!))
        .at(0);
    return {
        count:  cards.length,
        avgDr:  cards.some(b => b.dr != null) ? Math.round(avgDr) : null,
        oldestDays: oldest ? daysSince(oldest.contactedAt) : null,
    };
}

// ─── Win-rate analytics ───────────────────────────────────────────────────────

function winRateStats(backlinks: BacklinkTarget[]) {
    const won  = backlinks.filter(b => b.status === "Won");
    const sent = backlinks.filter(b =>
        b.status === "Outreach Sent" || b.status === "Following Up" || b.status === "Won" || b.status === "Rejected"
    );
    const closeRate = sent.length > 0 ? ((won.length / sent.length) * 100).toFixed(1) : null;
    const avgDrWon  = won.filter(b => b.dr != null).length > 0
        ? Math.round(won.reduce((s, b) => s + (b.dr ?? 0), 0) / won.filter(b => b.dr != null).length)
        : null;
    // Days to close: wonAt – contactedAt
    const closeDurations = won
        .filter(b => b.wonAt && b.contactedAt)
        .map(b => Math.floor((new Date(b.wonAt!).getTime() - new Date(b.contactedAt!).getTime()) / 86_400_000));
    const avgDaysToClose = closeDurations.length > 0
        ? Math.round(closeDurations.reduce((s, d) => s + d, 0) / closeDurations.length)
        : null;
    return { won: won.length, sent: sent.length, closeRate, avgDrWon, avgDaysToClose };
}

// ─── Draggable card ───────────────────────────────────────────────────────────

function KanbanCard({
    target,
    onRemove,
    onEditNote,
    isDragging = false,
}: {
    target: BacklinkTarget;
    onRemove: () => void;
    onEditNote: (note: string) => void;
    isDragging?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: target.id });
    const [editingNote, setEditingNote] = useState(false);
    const [noteVal, setNoteVal]         = useState(target.note ?? "");

    const isOverdue = target.followUpAt && new Date(target.followUpAt) < new Date();
    const days      = daysSince(target.contactedAt);

    const style: React.CSSProperties = {
        transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        opacity:     isDragging ? 0.35 : 1,
        padding:     "11px 13px",
        borderRadius: 11,
        background:  isDragging ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.03)",
        border:      isDragging
            ? "1px solid rgba(255,255,255,.18)"
            : "1px solid rgba(255,255,255,.08)",
        cursor:      "grab",
        userSelect:  "none",
        display:     "flex",
        flexDirection: "column",
        gap:         7,
        transition:  "box-shadow .15s ease, border-color .15s ease, background .15s ease, transform .1s ease",
        boxShadow:   isDragging
            ? "0 16px 40px rgba(0,0,0,.55), 0 4px 12px rgba(0,0,0,.3)"
            : "0 1px 3px rgba(0,0,0,.2)",
        willChange:  "transform",
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            {/* Row 1: tier + type icon + domain */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                    background: TIER_META[target.tier].bg,
                    color:      TIER_META[target.tier].color,
                    flexShrink: 0,
                }}>
                    {TIER_META[target.tier].label}
                </span>
                <span style={{ fontSize: 11, flexShrink: 0, opacity: .6 }}>
                    {TYPE_ICONS[target.type]}
                </span>
                <span style={{
                    fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.85)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                }}>
                    {target.domain}
                </span>
            </div>

            {/* Row 2: DR + contactedAt + overdue badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {target.dr != null && (
                    <span style={{
                        fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                        color: drColor(target.dr),
                        background: `${drColor(target.dr)}18`,
                        border: `1px solid ${drColor(target.dr)}30`,
                    }}>
                        DR {target.dr}
                    </span>
                )}
                {days != null && (
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,.3)" }}>
                        {days}d ago
                    </span>
                )}
                {isOverdue && (
                    <span style={{
                        fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                        background: "rgba(239,68,68,.18)", color: "#f87171",
                        border: "1px solid rgba(239,68,68,.35)",
                        animation: "pulseOverdue 2s ease infinite",
                    }}>
                        Follow-up overdue
                    </span>
                )}
            </div>

            {/* Row 3: note */}
            {editingNote ? (
                <div style={{ display: "flex", gap: 5 }} onPointerDown={e => e.stopPropagation()}>
                    <input
                        autoFocus
                        value={noteVal}
                        onChange={e => setNoteVal(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter") { onEditNote(noteVal); setEditingNote(false); }
                            if (e.key === "Escape") { setNoteVal(target.note ?? ""); setEditingNote(false); }
                        }}
                        style={{
                            flex: 1, fontSize: 11, background: "rgba(255,255,255,.06)",
                            border: "1px solid rgba(255,255,255,.15)", borderRadius: 6,
                            padding: "3px 7px", color: "rgba(255,255,255,.8)", outline: "none",
                        }}
                    />
                    <button
                        onClick={() => { onEditNote(noteVal); setEditingNote(false); }}
                        style={{ fontSize: 10, color: "#34d399", background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}
                    >✓</button>
                </div>
            ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    <span
                        style={{ fontSize: 10, color: "rgba(255,255,255,.3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={target.note}
                    >
                        {target.note || <span style={{ fontStyle: "italic", opacity: .4 }}>No note</span>}
                    </span>
                    <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={() => setEditingNote(true)}
                        style={{ fontSize: 10, color: "rgba(255,255,255,.25)", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "0 2px" }}
                        title="Edit note"
                    >✎</button>
                    <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={onRemove}
                        style={{ fontSize: 10, color: "rgba(239,68,68,.5)", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "0 2px" }}
                        title="Remove"
                    >✕</button>
                </div>
            )}
        </div>
    );
}

// ─── Droppable column ─────────────────────────────────────────────────────────

function KanbanColumn({
    status,
    cards,
    allBacklinks,
    onRemove,
    onEditNote,
    activeId,
}: {
    status: BacklinkTarget["status"];
    cards: BacklinkTarget[];
    allBacklinks: BacklinkTarget[];
    onRemove: (id: string) => void;
    onEditNote: (id: string, note: string) => void;
    activeId: string | null;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: status });
    const meta  = COLUMN_META[status];
    const stats = colStats(allBacklinks, status);

    return (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* Column header */}
            <div style={{
                padding: "10px 12px",
                borderRadius: "10px 10px 0 0",
                background: meta.bg,
                border: `1px solid ${meta.border}`,
                borderBottom: "none",
                marginBottom: 0,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: ".04em" }}>
                        {status}
                    </span>
                    <span style={{
                        marginLeft: "auto", fontSize: 10, fontWeight: 700,
                        background: meta.bg, color: meta.color,
                        padding: "1px 6px", borderRadius: 4,
                        border: `1px solid ${meta.border}`,
                    }}>
                        {stats.count}
                    </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {stats.avgDr != null && (
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,.3)" }}>avg DR {stats.avgDr}</span>
                    )}
                    {stats.oldestDays != null && (
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,.3)" }}>oldest {stats.oldestDays}d</span>
                    )}
                </div>
            </div>

            {/* Drop zone */}
            <div
                ref={setNodeRef}
                style={{
                    flex: 1,
                    minHeight: 120,
                    padding: "8px 6px",
                    borderRadius: "0 0 10px 10px",
                    border: `1px solid ${isOver ? meta.dot : meta.border}`,
                    borderTop: "none",
                    background: isOver
                        ? `${meta.bg.replace(".06", ".12")}`
                        : "rgba(255,255,255,.01)",
                    boxShadow: isOver ? `inset 0 0 0 1px ${meta.dot}30, 0 0 20px ${meta.dot}12` : "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    transition: "background .15s ease, border-color .15s ease, box-shadow .15s ease",
                }}
            >
                {cards.map(target => (
                    <KanbanCard
                        key={target.id}
                        target={target}
                        onRemove={() => onRemove(target.id)}
                        onEditNote={note => onEditNote(target.id, note)}
                        isDragging={activeId === target.id}
                    />
                ))}
                {cards.length === 0 && (
                    <div style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, color: "rgba(255,255,255,.12)", pointerEvents: "none",
                        padding: "12px 0",
                    }}>
                        Drop here
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Add-target form ──────────────────────────────────────────────────────────

function AddTargetForm({ onAdd }: { onAdd: (t: BacklinkTarget) => void }) {
    const [v, setV] = useState<Partial<BacklinkTarget>>({ tier: 1, type: "resource_page", status: "Idea" });

    const submit = () => {
        if (!v.domain?.trim()) return;
        onAdd({
            id:          `bl-${Date.now()}`,
            domain:      v.domain.trim(),
            type:        v.type as BacklinkTarget["type"],
            tier:        (v.tier ?? 1) as 1 | 2 | 3,
            status:      v.status as BacklinkTarget["status"],
            note:        v.note || undefined,
            contactedAt: v.contactedAt || undefined,
            followUpAt:  v.followUpAt  || undefined,
        });
        setV({ tier: 1, type: "resource_page", status: "Idea" });
    };

    const inp = (style?: React.CSSProperties): React.CSSProperties => ({
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.1)",
        borderRadius: 8,
        padding: "6px 10px",
        color: "rgba(255,255,255,.8)",
        fontSize: 12,
        outline: "none",
        ...style,
    });

    return (
        <div style={{ padding: "12px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "rgba(255,255,255,.3)" }}>
                Add Target
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <input
                    value={v.domain ?? ""}
                    onChange={e => setV(p => ({ ...p, domain: e.target.value }))}
                    placeholder="domain.com"
                    style={{ ...inp(), gridColumn: "1 / -1" }}
                />
                <select
                    value={v.type}
                    onChange={e => setV(p => ({ ...p, type: e.target.value as BacklinkTarget["type"] }))}
                    style={inp()}
                >
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t.replace("_", " ")}</option>)}
                </select>
                <select
                    value={v.tier}
                    onChange={e => setV(p => ({ ...p, tier: Number(e.target.value) as 1 | 2 | 3 }))}
                    style={inp()}
                >
                    <option value={1}>T1 — Easy</option>
                    <option value={2}>T2 — Medium</option>
                    <option value={3}>T3 — Hard</option>
                </select>
                <input
                    value={v.note ?? ""}
                    onChange={e => setV(p => ({ ...p, note: e.target.value }))}
                    placeholder="Note (optional)"
                    style={{ ...inp(), gridColumn: "1 / -1" }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <label style={{ fontSize: 9, color: "rgba(255,255,255,.3)", textTransform: "uppercase", letterSpacing: ".05em" }}>Contacted</label>
                    <input type="date" value={v.contactedAt ?? ""} onChange={e => setV(p => ({ ...p, contactedAt: e.target.value || undefined }))} style={inp()} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <label style={{ fontSize: 9, color: "rgba(255,255,255,.3)", textTransform: "uppercase", letterSpacing: ".05em" }}>Follow-up</label>
                    <input type="date" value={v.followUpAt ?? ""} onChange={e => setV(p => ({ ...p, followUpAt: e.target.value || undefined }))} style={inp()} />
                </div>
                <button
                    onClick={submit}
                    disabled={!v.domain?.trim()}
                    style={{
                        gridColumn: "1 / -1",
                        padding: "7px",
                        borderRadius: 8,
                        background: v.domain?.trim() ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.04)",
                        border: `1px solid ${v.domain?.trim() ? "rgba(16,185,129,.3)" : "rgba(255,255,255,.1)"}`,
                        color: v.domain?.trim() ? "#34d399" : "rgba(255,255,255,.25)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: v.domain?.trim() ? "pointer" : "not-allowed",
                        transition: "all .15s",
                    }}
                >
                    + Add Target
                </button>
            </div>
        </div>
    );
}

// ─── Win-rate bar ─────────────────────────────────────────────────────────────

function WinRateBar({ backlinks }: { backlinks: BacklinkTarget[] }) {
    const stats = winRateStats(backlinks);
    if (stats.sent === 0) return null;

    return (
        <div style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(16,185,129,.04)",
            border: "1px solid rgba(16,185,129,.12)",
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
        }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#34d399" }}>
                Won {stats.won} / Sent {stats.sent}
                {stats.closeRate != null && (
                    <span style={{ marginLeft: 6, fontSize: 12 }}>→ {stats.closeRate}% close rate</span>
                )}
            </span>
            {stats.avgDaysToClose != null && (
                <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>
                    Avg {stats.avgDaysToClose}d to close
                </span>
            )}
            {stats.avgDrWon != null && (
                <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>
                    Avg DR won: <span style={{ color: drColor(stats.avgDrWon), fontWeight: 700 }}>{stats.avgDrWon}</span>
                </span>
            )}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BacklinksPanel({ siteId, item, onUpdate }: Props) {
    const [isPending, startTransition] = useTransition();
    const [activeId, setActiveId]      = useState<string | null>(null);

    const backlinks: BacklinkTarget[] = (item.backlinks as unknown as BacklinkTarget[]) ?? [];

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
    );

    // ── Mutate helpers ──────────────────────────────────────────────────────

    const persist = useCallback((updated: BacklinkTarget[], target: BacklinkTarget) => {
        startTransition(async () => {
            await upsertBacklinkTarget(siteId, item.id, target);
            onUpdate({ ...item, backlinks: updated as unknown as typeof item.backlinks });
        });
    }, [siteId, item, onUpdate]);

    const addTarget = (target: BacklinkTarget) => {
        const updated = [target, ...backlinks];
        persist(updated, target);

        // Lazily fetch DR for the new target
        fetch(`/api/backlinks?siteId=${siteId}&mode=summary&domain=${target.domain}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data?.summary?.domainRating) return;
                const withDR = { ...target, dr: data.summary.domainRating as number };
                const next   = [withDR, ...backlinks];
                startTransition(async () => {
                    await upsertBacklinkTarget(siteId, item.id, withDR);
                    onUpdate({ ...item, backlinks: next as unknown as typeof item.backlinks });
                });
            })
            .catch(() => {});
    };

    const moveCard = (targetId: string, newStatus: BacklinkTarget["status"]) => {
        const updated = backlinks.map(b =>
            b.id === targetId
                ? { ...b, status: newStatus, movedAt: new Date().toISOString(), ...(newStatus === "Won" ? { wonAt: new Date().toISOString() } : {}) }
                : b
        );
        const target = updated.find(b => b.id === targetId)!;
        persist(updated, target);
    };

    const editNote = (targetId: string, note: string) => {
        const updated = backlinks.map(b => b.id === targetId ? { ...b, note } : b);
        const target  = updated.find(b => b.id === targetId)!;
        persist(updated, target);
    };

    const removeTarget = (targetId: string) => {
        const updated = backlinks.filter(b => b.id !== targetId);
        startTransition(async () => {
            await removeBacklinkTarget(siteId, item.id, targetId);
            onUpdate({ ...item, backlinks: updated as unknown as typeof item.backlinks });
        });
    };

    // ── Drag handlers ───────────────────────────────────────────────────────

    const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

    const onDragEnd = ({ active, over }: DragEndEvent) => {
        setActiveId(null);
        if (!over) return;
        const newStatus = over.id as BacklinkTarget["status"];
        if (!COLUMNS.includes(newStatus)) return;
        const card = backlinks.find(b => b.id === active.id);
        if (!card || card.status === newStatus) return;
        moveCard(String(active.id), newStatus);
    };

    const activeCard = activeId ? backlinks.find(b => b.id === activeId) : null;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Win-rate bar */}
            <WinRateBar backlinks={backlinks} />

            {/* Kanban board */}
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))`,
                    gap: 8,
                    alignItems: "start",
                    opacity: isPending ? .75 : 1,
                    transition: "opacity .15s",
                }}>
                    {COLUMNS.map(col => (
                        <KanbanColumn
                            key={col}
                            status={col}
                            cards={backlinks.filter(b => b.status === col)}
                            allBacklinks={backlinks}
                            onRemove={removeTarget}
                            onEditNote={editNote}
                            activeId={activeId}
                        />
                    ))}
                </div>

                {/* Ghost card rendered at cursor while dragging */}
                <DragOverlay dropAnimation={null}>
                    {activeCard ? (
                        <div style={{
                            padding: "11px 13px", borderRadius: 11,
                            background: "rgba(18,18,32,.98)",
                            border: "1px solid rgba(255,255,255,.2)",
                            boxShadow: "0 24px 64px rgba(0,0,0,.65), 0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06) inset",
                            opacity: 0.95, minWidth: 170, maxWidth: 230,
                            backdropFilter: "blur(12px)",
                        }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.92)" }}>
                                {activeCard.domain}
                            </span>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Add-target form */}
            <AddTargetForm onAdd={addTarget} />

            {/* Keyframes for Kanban animations */}
            <style>{`
                @keyframes pulseOverdue {
                    0%, 100% { opacity: 1; }
                    50%       { opacity: .6; }
                }
                @keyframes cardIn {
                    from { opacity: 0; transform: translateY(6px) scale(.97); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </div>
    );
}
