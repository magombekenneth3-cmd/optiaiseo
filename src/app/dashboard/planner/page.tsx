/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef, useState, useTransition, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getPlannerState, updatePlannerItemStatus, batchGenerateBriefs } from "@/app/actions/planner";
import {
    Loader2, CalendarDays, Sparkles, GripVertical,
    ChevronDown, ExternalLink, Hash, Link2, FileText,
    LayoutGrid, ArrowUpRight,
} from "lucide-react";

// ─── Lazy-load detail panels ───────────────────────────────────────────────────
const RedditPanel = dynamic(() => import("./RedditPanel").then(m => ({ default: m.RedditPanel })));
const BacklinksPanel = dynamic(() => import("./BacklinksPanel").then(m => ({ default: m.BacklinksPanel })));
const PageScorePanel = dynamic(() => import("./PageScorePanel").then(m => ({ default: m.PageScorePanel })));
const GscSuggestionsPanel = dynamic(() => import("./GscSuggestionsPanel").then(m => ({ default: m.GscSuggestionsPanel })));

// ─── Constants ────────────────────────────────────────────────────────────────
const BUCKETS = ["Week 1", "Month 1", "Month 2-3"] as const;
type Bucket = (typeof BUCKETS)[number];

const BUCKET_CONFIG: Record<Bucket, {
    accent: string; accentAlpha: string; label: string;
    dot: string; index: number;
}> = {
    "Week 1": { accent: "#10b981", accentAlpha: "rgba(16,185,129,.12)", label: "Week 1", dot: "#10b981", index: 0 },
    "Month 1": { accent: "#3b82f6", accentAlpha: "rgba(59,130,246,.12)", label: "Month 1", dot: "#3b82f6", index: 1 },
    "Month 2-3": { accent: "#a78bfa", accentAlpha: "rgba(167,139,250,.12)", label: "Month 2–3", dot: "#a78bfa", index: 2 },
};

type StatusKey = "Todo" | "In Progress" | "Writing..." | "Done";

const STATUS_CONFIG: Record<StatusKey, {
    bg: string; text: string; dot: string; ring: string; label: string;
}> = {
    "Todo": { bg: "rgba(255,255,255,.04)", text: "rgba(255,255,255,.35)", dot: "rgba(255,255,255,.2)", ring: "rgba(255,255,255,.08)", label: "To do" },
    "In Progress": { bg: "rgba(251,191,36,.08)", text: "#fbbf24", dot: "#f59e0b", ring: "rgba(251,191,36,.15)", label: "In progress" },
    "Writing...": { bg: "rgba(139,92,246,.10)", text: "#a78bfa", dot: "#8b5cf6", ring: "rgba(139,92,246,.20)", label: "Writing…" },
    "Done": { bg: "rgba(16,185,129,.08)", text: "#34d399", dot: "#10b981", ring: "rgba(16,185,129,.18)", label: "Done" },
};

// ─── Score ring SVG ───────────────────────────────────────────────────────────
function ScoreRing({ value, color, size = 28 }: { value: number; color: string; size?: number }) {
    const r = (size - 4) / 2;
    const circ = 2 * Math.PI * r;
    const fill = (value / 100) * circ;
    return (
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={2} />
            <circle
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={color} strokeWidth={2.5}
                strokeDasharray={`${fill} ${circ - fill}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray .6s cubic-bezier(.4,0,.2,1)" }}
            />
        </svg>
    );
}

// ─── Pill badge ───────────────────────────────────────────────────────────────
function Pill({ children, color = "rgba(255,255,255,.07)", textColor = "rgba(255,255,255,.4)" }: {
    children: React.ReactNode; color?: string; textColor?: string;
}) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center",
            padding: "2px 8px", borderRadius: 6,
            fontSize: 10, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase",
            background: color, color: textColor,
            border: `1px solid ${textColor}22`,
        }}>
            {children}
        </span>
    );
}

// ─── Status badge (clickable) ─────────────────────────────────────────────────
function StatusBadge({ status, onChange }: { status: string; onChange: (s: string) => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const cfg = STATUS_CONFIG[(status as StatusKey)] ?? STATUS_CONFIG["Todo"];

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        if (open) document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    return (
        <div ref={ref} style={{ position: "relative" }}>
            <button
                onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
                style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "4px 10px 4px 8px", borderRadius: 8,
                    background: cfg.bg, border: `1px solid ${cfg.ring}`,
                    color: cfg.text, fontSize: 11, fontWeight: 600,
                    cursor: "pointer", transition: "all .15s ease",
                }}
            >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
                {cfg.label}
                <ChevronDown size={10} style={{ marginLeft: 1, opacity: .6 }} />
            </button>

            {open && (
                <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
                    background: "#18181b", border: "1px solid rgba(255,255,255,.08)",
                    borderRadius: 10, padding: "4px", minWidth: 130,
                    boxShadow: "0 20px 40px rgba(0,0,0,.5)",
                }}>
                    {(Object.keys(STATUS_CONFIG) as StatusKey[]).map(key => {
                        const s = STATUS_CONFIG[key];
                        return (
                            <button key={key}
                                onClick={e => { e.stopPropagation(); onChange(key); setOpen(false); }}
                                style={{
                                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                                    padding: "7px 10px", borderRadius: 7, background: "transparent",
                                    border: "none", color: s.text, fontSize: 12, fontWeight: 500,
                                    cursor: "pointer", transition: "background .12s",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,.05)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                            >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                                {s.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Panel drawer ─────────────────────────────────────────────────────────────
function PanelDrawer({ siteId, item, tab, onTabChange, onUpdate }: {
    siteId: string; item: any; tab: string;
    onTabChange: (t: string) => void;
    onUpdate: (updated: any) => void;
}) {
    const tabs = [
        { key: "reddit", label: "Reddit", icon: Hash },
        { key: "backlinks", label: "Backlinks", icon: Link2 },
        { key: "page", label: "Page score", icon: FileText },
    ];

    return (
        <div style={{
            marginTop: 14, paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,.05)",
        }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                {tabs.map(t => {
                    const Icon = t.icon;
                    const active = tab === t.key;
                    return (
                        <button key={t.key} onClick={() => onTabChange(t.key)}
                            style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                padding: "5px 10px", borderRadius: 8, border: "none",
                                background: active ? "rgba(16,185,129,.12)" : "transparent",
                                color: active ? "#34d399" : "rgba(255,255,255,.35)",
                                fontSize: 11, fontWeight: 600, cursor: "pointer",
                                outline: active ? "1px solid rgba(16,185,129,.2)" : "none",
                                transition: "all .15s ease",
                            }}>
                            <Icon size={11} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === "reddit" && <RedditPanel siteId={siteId} item={item} onUpdate={onUpdate} />}
            {tab === "backlinks" && <BacklinksPanel siteId={siteId} item={item} onUpdate={onUpdate} />}
            {tab === "page" && <PageScorePanel siteId={siteId} item={item} onUpdate={onUpdate} />}
        </div>
    );
}

// ─── Individual card ──────────────────────────────────────────────────────────
function PlannerCard({
    item, siteId, selected, onToggleSelect, onStatusChange, onUpdate,
    isDragging, dragHandleProps,
}: {
    item: any; siteId: string; selected: boolean;
    onToggleSelect: (id: string) => void;
    onStatusChange: (id: string, status: string) => void;
    onUpdate: (updated: any) => void;
    isDragging: boolean;
    dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
}) {
    const [expanded, setExpanded] = useState(false);
    const [tab, setTab] = useState("reddit");
    const [hovered, setHovered] = useState(false);
    const [isPending, startTransition] = useTransition();

    const linksWon = (item.backlinks ?? []).filter((b: any) => b.status === "Won").length;
    const pageScore = item.pageScore?.score ?? 0;

    const scoreColor = pageScore >= 80 ? "#34d399" : pageScore >= 50 ? "#fbbf24" : "#f87171";

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                position: "relative",
                background: selected
                    ? "rgba(16,185,129,.04)"
                    : hovered ? "rgba(255,255,255,.025)" : "rgba(255,255,255,.015)",
                border: selected
                    ? "1px solid rgba(16,185,129,.25)"
                    : hovered ? "1px solid rgba(255,255,255,.10)" : "1px solid rgba(255,255,255,.06)",
                borderRadius: 14,
                transform: isDragging ? "scale(.96) rotate(1.5deg)" : "scale(1)",
                opacity: isDragging ? 0.4 : 1,
                transition: "all .2s cubic-bezier(.4,0,.2,1)",
                backdropFilter: "blur(12px)",
                overflow: "visible",
            }}
        >
            {/* Selected glow strip */}
            {selected && (
                <div style={{
                    position: "absolute", left: 0, top: 12, bottom: 12, width: 2,
                    background: "linear-gradient(180deg, #10b981, transparent)",
                    borderRadius: "0 2px 2px 0",
                }} />
            )}

            {/* Drag handle */}
            <div {...dragHandleProps}
                style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, width: 22,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: hovered ? 0.4 : 0,
                    cursor: "grab",
                    transition: "opacity .15s",
                    borderRadius: "14px 0 0 14px",
                }}>
                <GripVertical size={12} style={{ color: "rgba(255,255,255,.5)" }} />
            </div>

            <div style={{ padding: "14px 14px 14px 16px" }}>

                {/* Top row: checkbox + badges */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                    {/* Checkbox */}
                    <div style={{ flexShrink: 0, paddingTop: 1 }}>
                        <button
                            onClick={e => { e.stopPropagation(); onToggleSelect(item.id); }}
                            style={{
                                width: 16, height: 16, borderRadius: 5, border: "none",
                                background: selected ? "#10b981" : "rgba(255,255,255,.06)",
                                outline: selected ? "none" : "1px solid rgba(255,255,255,.15)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                cursor: "pointer", transition: "all .15s",
                            }}
                        >
                            {selected && (
                                <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                                    <path d="M1 3l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* Title */}
                    <h3 style={{
                        flex: 1, margin: 0,
                        fontSize: 13, fontWeight: 600, lineHeight: 1.45,
                        color: "rgba(255,255,255,.9)",
                        letterSpacing: "-.01em",
                    }}>
                        {item.title}
                    </h3>

                    {/* Page score ring */}
                    {pageScore > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 }}>
                            <ScoreRing value={pageScore} color={scoreColor} />
                            <span style={{ fontSize: 9, fontWeight: 600, color: scoreColor, letterSpacing: ".02em" }}>
                                {pageScore}
                            </span>
                        </div>
                    )}
                </div>

                {/* Keywords */}
                {item.targetKeywords?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                        {item.targetKeywords.slice(0, 4).map((kw: string, j: number) => (
                            <span key={j} style={{
                                fontSize: 10, padding: "2px 7px", borderRadius: 5,
                                background: "rgba(255,255,255,.04)",
                                color: "rgba(255,255,255,.35)",
                                border: "1px solid rgba(255,255,255,.06)",
                            }}>
                                {kw}
                            </span>
                        ))}
                    </div>
                )}

                {/* Badges row */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                    {item.pillar && (
                        <Pill color="rgba(16,185,129,.1)" textColor="#34d399">Pillar</Pill>
                    )}
                    {item.priorityScore != null && (
                        <Pill
                            color={item.priorityScore >= 80 ? "rgba(239,68,68,.1)" : item.priorityScore >= 50 ? "rgba(251,191,36,.1)" : "rgba(59,130,246,.1)"}
                            textColor={item.priorityScore >= 80 ? "#f87171" : item.priorityScore >= 50 ? "#fbbf24" : "#60a5fa"}
                        >
                            ↑ {item.priorityScore}
                        </Pill>
                    )}
                    {linksWon > 0 && (
                        <Pill color="rgba(59,130,246,.08)" textColor="#60a5fa">
                            {linksWon} link{linksWon !== 1 ? "s" : ""} won
                        </Pill>
                    )}
                </div>

                {/* Footer: status + actions */}
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                    paddingTop: 10,
                    borderTop: "1px solid rgba(255,255,255,.05)",
                }}>
                    <StatusBadge
                        status={item.status || "Todo"}
                        onChange={s => { startTransition(() => onStatusChange(item.id, s)); }}
                    />

                    <div style={{ flex: 1 }} />

                    {item.draftLink && (
                        <a
                            href={item.draftLink}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                padding: "4px 10px", borderRadius: 8,
                                background: "rgba(59,130,246,.08)",
                                border: "1px solid rgba(59,130,246,.2)",
                                color: "#60a5fa", fontSize: 11, fontWeight: 600,
                                textDecoration: "none",
                                transition: "all .15s",
                            }}
                        >
                            <ExternalLink size={10} />
                            Brief
                            <ArrowUpRight size={9} style={{ opacity: .6 }} />
                        </a>
                    )}

                    <button
                        onClick={() => setExpanded(v => !v)}
                        style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "4px 10px", borderRadius: 8,
                            background: expanded ? "rgba(255,255,255,.06)" : "transparent",
                            border: "1px solid rgba(255,255,255,.07)",
                            color: "rgba(255,255,255,.3)", fontSize: 11, fontWeight: 500,
                            cursor: "pointer", transition: "all .15s",
                        }}
                    >
                        <ChevronDown size={10} style={{
                            transform: expanded ? "rotate(180deg)" : "none",
                            transition: "transform .2s",
                        }} />
                        {expanded ? "Close" : "Details"}
                    </button>
                </div>

                {expanded && (
                    <PanelDrawer
                        siteId={siteId} item={item} tab={tab}
                        onTabChange={setTab} onUpdate={onUpdate}
                    />
                )}
            </div>
        </div>
    );
}

// ─── DraggableCard wrapper ─────────────────────────────────────────────────────
function DraggableCard(props: Omit<React.ComponentProps<typeof PlannerCard>, "dragHandleProps">) {
    const ref = useRef<HTMLDivElement>(null);

    const dragHandleProps: React.HTMLAttributes<HTMLDivElement> = {
        onMouseDown: () => { if (ref.current) ref.current.setAttribute("draggable", "true"); },
        onMouseUp: () => { if (ref.current) ref.current.setAttribute("draggable", "false"); },
    };

    return (
        <div
            ref={ref}
            draggable={false}
            onDragStart={e => { e.dataTransfer.setData("itemId", props.item.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { if (ref.current) ref.current.setAttribute("draggable", "false"); }}
        >
            <PlannerCard {...props} dragHandleProps={dragHandleProps} />
        </div>
    );
}

// ─── Kanban column ─────────────────────────────────────────────────────────────
function KanbanColumn({
    bucket, items, siteId, selected, draggingId,
    onToggleSelect, onStatusChange, onUpdate, onDrop,
}: {
    bucket: Bucket; items: any[]; siteId: string;
    selected: Set<string>; draggingId: string | null;
    onToggleSelect: (id: string) => void;
    onStatusChange: (id: string, status: string) => void;
    onUpdate: (updated: any) => void;
    onDrop: (itemId: string, toBucket: Bucket) => void;
}) {
    const [isDragOver, setIsDragOver] = useState(false);
    const cfg = BUCKET_CONFIG[bucket];

    const doneCount = items.filter(i => i.status === "Done").length;
    const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

    return (
        <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Column header */}
            <div style={{
                marginBottom: 16,
                paddingBottom: 14,
                borderBottom: `1px solid rgba(255,255,255,.06)`,
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: cfg.accent,
                            boxShadow: `0 0 8px ${cfg.accent}80`,
                        }} />
                        <span style={{
                            fontSize: 12, fontWeight: 700, letterSpacing: ".04em",
                            textTransform: "uppercase", color: "rgba(255,255,255,.6)",
                        }}>
                            {cfg.label}
                        </span>
                    </div>
                    <span style={{
                        fontSize: 11, fontWeight: 500,
                        color: "rgba(255,255,255,.2)",
                        background: "rgba(255,255,255,.04)",
                        padding: "2px 8px", borderRadius: 6,
                        border: "1px solid rgba(255,255,255,.06)",
                    }}>
                        {items.length}
                    </span>
                </div>

                {/* Progress bar */}
                {items.length > 0 && (
                    <div style={{
                        height: 2, background: "rgba(255,255,255,.06)", borderRadius: 2, overflow: "hidden",
                    }}>
                        <div style={{
                            height: "100%", width: `${progress}%`,
                            background: `linear-gradient(90deg, ${cfg.accent}80, ${cfg.accent})`,
                            borderRadius: 2,
                            transition: "width .5s cubic-bezier(.4,0,.2,1)",
                        }} />
                    </div>
                )}
            </div>

            {/* Drop zone */}
            <div
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => { e.preventDefault(); setIsDragOver(false); const id = e.dataTransfer.getData("itemId"); if (id) onDrop(id, bucket); }}
                style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minHeight: 80,
                    padding: 6,
                    margin: -6,
                    borderRadius: 14,
                    background: isDragOver ? cfg.accentAlpha : "transparent",
                    border: isDragOver ? `1px dashed ${cfg.accent}50` : "1px solid transparent",
                    transition: "all .2s ease",
                }}
            >
                {items.length === 0 ? (
                    <div style={{
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        minHeight: 80, borderRadius: 12,
                        border: `1px dashed ${isDragOver ? cfg.accent + "50" : "rgba(255,255,255,.08)"}`,
                        color: isDragOver ? cfg.accent + "80" : "rgba(255,255,255,.15)",
                        fontSize: 11, fontWeight: 500, gap: 4,
                        transition: "all .2s ease",
                    }}>
                        <LayoutGrid size={14} style={{ opacity: .5 }} />
                        Drop here
                    </div>
                ) : (
                    items.map(item => (
                        <DraggableCard
                            key={item.id} item={item} siteId={siteId}
                            selected={selected.has(item.id)}
                            isDragging={draggingId === item.id}
                            onToggleSelect={onToggleSelect}
                            onStatusChange={onStatusChange}
                            onUpdate={onUpdate}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

// ─── Main planner page ─────────────────────────────────────────────────────────
export default function PlannerPage() {
    const searchParams = useSearchParams();
    const siteId = searchParams.get("siteId");

    const [planner, setPlanner] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [isPending, startTransition] = useTransition();
    const [draggingId, setDraggingId] = useState<string | null>(null);

    useEffect(() => {
        if (!siteId) { setLoading(false); return; }
        async function load() {
            setLoading(true);
            const res = await getPlannerState(siteId!);
            if (res.success && res.state) setPlanner(res.state);
            else if (res.error) setError(res.error);
            setLoading(false);
        }
        load();
    }, [siteId]);

    const handleStatusChange = useCallback((itemId: string, newStatus: string) => {
        startTransition(async () => {
            setPlanner((prev: any) => ({
                ...prev,
                items: prev.items.map((it: any) => it.id === itemId ? { ...it, status: newStatus } : it),
            }));
            await updatePlannerItemStatus(siteId!, itemId, newStatus);
        });
    }, [siteId]);

    const handleDrop = useCallback((itemId: string, toBucket: Bucket) => {
        setDraggingId(null);
        setPlanner((prev: any) => ({
            ...prev,
            items: prev.items.map((it: any) => it.id === itemId ? { ...it, week: toBucket } : it),
        }));
    }, []);

    const handleDropToUnscheduled = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("itemId");
        if (id) {
            setPlanner((prev: any) => ({
                ...prev,
                items: prev.items.map((it: any) => it.id === id ? { ...it, week: null } : it),
            }));
        }
    }, []);

    const toggleSelect = useCallback((id: string) => {
        setSelectedItems(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });
    }, []);

    const handleBatchGenerate = () => {
        if (!selectedItems.size) return;
        startTransition(async () => {
            const ids = [...selectedItems];
            setPlanner((prev: any) => ({
                ...prev,
                items: prev.items.map((it: any) => ids.includes(it.id) ? { ...it, status: "Writing..." } : it),
            }));
            setSelectedItems(new Set());
            await batchGenerateBriefs(siteId!, ids);
        });
    };

    const handleItemUpdate = useCallback((updated: any) => {
        setPlanner((prev: any) => ({
            ...prev,
            items: prev.items.map((i: any) => i.id === updated.id ? updated : i),
        }));
    }, []);

    const totalItems = planner?.items?.length ?? 0;
    const doneItems = planner?.items?.filter((i: any) => i.status === "Done").length ?? 0;
    const inProgItems = planner?.items?.filter((i: any) => i.status === "In Progress" || i.status === "Writing...").length ?? 0;

    if (!siteId) return (
        <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: "50vh", color: "rgba(255,255,255,.25)", fontSize: 13,
        }}>
            Select a site from the sidebar to get started.
        </div>
    );

    if (loading) return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "50vh", gap: 10, color: "rgba(255,255,255,.25)",
        }}>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 13 }}>Loading planner…</span>
        </div>
    );

    if (error || !planner?.items?.length) return (
        <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
            <div style={{
                padding: 40, borderRadius: 20,
                background: "rgba(255,255,255,.02)",
                border: "1px solid rgba(255,255,255,.06)",
            }}>
                <div style={{
                    width: 56, height: 56, borderRadius: 14, margin: "0 auto 20px",
                    background: "rgba(16,185,129,.08)",
                    border: "1px solid rgba(16,185,129,.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                    <CalendarDays size={24} style={{ color: "#34d399" }} />
                </div>
                <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,.85)" }}>
                    Planner is empty
                </h2>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,.35)" }}>
                    Run Keyword Research and save topics to your planner to get started.
                </p>
            </div>
        </div>
    );

    const unmapped = planner.items.filter((i: any) => !i.week);

    return (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 80px" }}>

            {/* ── Header ── */}
            <div style={{
                display: "flex", flexDirection: "column", gap: 20,
                padding: "28px 0 24px",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                marginBottom: 28,
            }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: 9,
                                background: "rgba(16,185,129,.1)",
                                border: "1px solid rgba(16,185,129,.2)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                                <CalendarDays size={15} style={{ color: "#34d399" }} />
                            </div>
                            <h1 style={{
                                margin: 0, fontSize: 20, fontWeight: 700,
                                color: "rgba(255,255,255,.9)",
                                letterSpacing: "-.02em",
                            }}>
                                Content Planner
                            </h1>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,.3)", letterSpacing: ".01em" }}>
                            Drag cards between columns · track execution over time
                        </p>
                    </div>

                    {selectedItems.size > 0 && (
                        <button onClick={handleBatchGenerate} disabled={isPending}
                            style={{
                                display: "inline-flex", alignItems: "center", gap: 8,
                                padding: "10px 18px", borderRadius: 11,
                                background: "linear-gradient(135deg, #10b981, #059669)",
                                border: "none", color: "#fff",
                                fontSize: 12, fontWeight: 700, letterSpacing: ".02em",
                                cursor: "pointer", transition: "all .15s",
                                boxShadow: "0 4px 20px rgba(16,185,129,.25), inset 0 1px 0 rgba(255,255,255,.1)",
                                opacity: isPending ? .6 : 1,
                            }}>
                            <Sparkles size={13} />
                            Generate Briefs
                            <span style={{
                                background: "rgba(0,0,0,.2)",
                                padding: "1px 6px", borderRadius: 5,
                                fontSize: 11,
                            }}>
                                {selectedItems.size}
                            </span>
                        </button>
                    )}
                </div>

                {/* Stats strip */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[
                        { label: "Total", value: totalItems, color: "rgba(255,255,255,.3)" },
                        { label: "In progress", value: inProgItems, color: "#fbbf24" },
                        { label: "Completed", value: doneItems, color: "#34d399" },
                    ].map(s => (
                        <div key={s.label} style={{
                            display: "inline-flex", alignItems: "center", gap: 8,
                            padding: "6px 12px", borderRadius: 9,
                            background: "rgba(255,255,255,.03)",
                            border: "1px solid rgba(255,255,255,.06)",
                        }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>
                                {s.value}
                            </span>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)", fontWeight: 500 }}>
                                {s.label}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── GSC Opportunity suggestions ── */}
            <GscSuggestionsPanel
                siteId={siteId!}
                onAdded={() => {
                    // Reload planner items so newly added keywords appear in the board
                    getPlannerState(siteId!).then(res => {
                        if (res.success && res.state) setPlanner(res.state);
                    });
                }}
            />

            {/* ── Kanban grid ── */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 20,
            }}>
                {BUCKETS.map(bucket => {
                    const bucketItems = planner.items.filter((i: any) => i.week === bucket);
                    return (
                        <KanbanColumn
                            key={bucket}
                            bucket={bucket}
                            items={bucketItems}
                            siteId={siteId!}
                            selected={selectedItems}
                            draggingId={draggingId}
                            onToggleSelect={toggleSelect}
                            onStatusChange={handleStatusChange}
                            onUpdate={handleItemUpdate}
                            onDrop={handleDrop}
                        />
                    );
                })}
            </div>

            {/* ── Unscheduled section ── */}
            {unmapped.length > 0 && (
                <div
                    style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid rgba(255,255,255,.05)" }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDropToUnscheduled}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                                fontSize: 11, fontWeight: 700, letterSpacing: ".06em",
                                textTransform: "uppercase", color: "rgba(255,255,255,.25)",
                            }}>
                                Unscheduled
                            </span>
                            <span style={{
                                fontSize: 10, fontWeight: 600,
                                background: "rgba(255,255,255,.04)",
                                color: "rgba(255,255,255,.2)",
                                padding: "1px 7px", borderRadius: 5,
                                border: "1px solid rgba(255,255,255,.06)",
                            }}>
                                {unmapped.length}
                            </span>
                        </div>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,.18)" }}>
                            Drag to a column to schedule
                        </span>
                    </div>

                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 10,
                        opacity: .55,
                        transition: "opacity .2s",
                    }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = ".85")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = ".55")}
                    >
                        {unmapped.map((item: any) => (
                            <DraggableCard
                                key={item.id} item={item} siteId={siteId!}
                                selected={selectedItems.has(item.id)}
                                isDragging={draggingId === item.id}
                                onToggleSelect={toggleSelect}
                                onStatusChange={handleStatusChange}
                                onUpdate={handleItemUpdate}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}