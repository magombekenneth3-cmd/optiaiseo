"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    Database,
    ExternalLink,
    Globe,
    Loader2,
    BarChart2,
    Shield,
    Star,
    TrendingUp,
    User,
    X,
    ChevronDown,
    ChevronRight,
    Search,
    AlertCircle,
} from "lucide-react";

type SourceType =
    | "EXTERNAL_SOURCE"
    | "FIRST_PARTY_EXPERIENCE"
    | "FIRST_PARTY_DATA"
    | "GSC_DATA"
    | "SERP_OBSERVATION"
    | "INFERENCE"
    | "LLM_GENERATED";

interface EvidenceItem {
    id: string;
    sourceType: SourceType;
    content: string;
    excerpt: string | null;
    confidence: number;
    capturedAt: string | null;
    retrievalMethod: string | null;
    sourceUrl: string | null;
    sourceTitle: string | null;
    sourcePublisher: string | null;
    category: string | null;
}

interface EvidenceLedger {
    id: string;
    collectedAt: string;
    topic: string | null;
    searchIntent: string | null;
    serpObservations: number;
    competitorObservations: number;
    gscObservations: number;
    firstPartyContext: {
        authorName: string;
        realExperience: string | null;
        realNumbers: string | null;
        brandFacts: Array<{ factType: string; value: string }>;
    } | null;
    evidenceItems: EvidenceItem[];
    bySourceType: Record<string, number>;
    summary: {
        totalItems: number;
        hasFirstPartyExperience: boolean;
        hasFirstPartyData: boolean;
        hasGscData: boolean;
        hasSerpObservations: boolean;
        hasExternalSources: boolean;
    };
}

interface EvidenceData {
    blogId: string;
    title: string | null;
    evidenceCoverage: number | null;
    hasLedger: boolean;
    ledger: EvidenceLedger | null;
    claims: Array<{
        id: string;
        text: string;
        type: string;
        status: string;
        sectionId: string | null;
        position: number | null;
    }>;
}

const SOURCE_TYPE_CONFIG: Record<
    SourceType,
    { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
    EXTERNAL_SOURCE: {
        label: "External Source",
        icon: <Globe className="h-3.5 w-3.5" />,
        color: "text-blue-400",
        bg: "bg-blue-500/10",
        border: "border-blue-500/20",
    },
    FIRST_PARTY_EXPERIENCE: {
        label: "First-Party Experience",
        icon: <User className="h-3.5 w-3.5" />,
        color: "text-violet-400",
        bg: "bg-violet-500/10",
        border: "border-violet-500/20",
    },
    FIRST_PARTY_DATA: {
        label: "First-Party Data",
        icon: <Database className="h-3.5 w-3.5" />,
        color: "text-emerald-400",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/20",
    },
    GSC_DATA: {
        label: "GSC Data",
        icon: <BarChart2 className="h-3.5 w-3.5" />,
        color: "text-amber-400",
        bg: "bg-amber-500/10",
        border: "border-amber-500/20",
    },
    SERP_OBSERVATION: {
        label: "SERP Observation",
        icon: <Search className="h-3.5 w-3.5" />,
        color: "text-sky-400",
        bg: "bg-sky-500/10",
        border: "border-sky-500/20",
    },
    INFERENCE: {
        label: "Inference",
        icon: <TrendingUp className="h-3.5 w-3.5" />,
        color: "text-orange-400",
        bg: "bg-orange-500/10",
        border: "border-orange-500/20",
    },
    LLM_GENERATED: {
        label: "LLM Generated",
        icon: <AlertCircle className="h-3.5 w-3.5" />,
        color: "text-red-400",
        bg: "bg-red-500/10",
        border: "border-red-500/20",
    },
};

function SourceTypeBadge({ type }: { type: SourceType }) {
    const cfg = SOURCE_TYPE_CONFIG[type] ?? SOURCE_TYPE_CONFIG.EXTERNAL_SOURCE;
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.bg} ${cfg.border} ${cfg.color}`}
        >
            {cfg.icon}
            {cfg.label}
        </span>
    );
}

function ConfidenceBar({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const color =
        pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
    return (
        <div className="flex items-center gap-1.5">
            <div className="h-1 w-14 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground">{pct}%</span>
        </div>
    );
}

function EvidenceItemRow({ item }: { item: EvidenceItem }) {
    const [open, setOpen] = useState(false);
    const isFactual =
        item.sourceType !== "LLM_GENERATED" && item.sourceType !== "INFERENCE";

    return (
        <div className={`rounded-xl border transition-colors ${isFactual ? "border-border" : "border-red-500/20 bg-red-500/5"}`}>
            <button
                type="button"
                id={`evidence-item-${item.id}`}
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
            >
                <div className="mt-0.5 shrink-0">
                    {open ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <SourceTypeBadge type={item.sourceType} />
                        {item.sourcePublisher && (
                            <span className="text-[10px] text-muted-foreground">
                                {item.sourcePublisher}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-foreground line-clamp-2 leading-4">
                        {item.excerpt ?? item.content}
                    </p>
                </div>
                <div className="ml-2 shrink-0">
                    <ConfidenceBar value={item.confidence} />
                </div>
            </button>

            {open && (
                <div className="border-t border-border px-3 py-3 space-y-2">
                    <p className="text-xs text-muted-foreground leading-5">{item.content}</p>
                    <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                        {item.capturedAt && (
                            <span>
                                Captured:{" "}
                                {new Date(item.capturedAt).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                })}
                            </span>
                        )}
                        {item.retrievalMethod && <span>Via: {item.retrievalMethod}</span>}
                        {item.category && <span>Category: {item.category}</span>}
                    </div>
                    {item.sourceUrl && (
                        <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
                        >
                            <ExternalLink className="h-3 w-3" />
                            {item.sourceTitle ?? item.sourceUrl}
                        </a>
                    )}
                    {!isFactual && (
                        <p className="text-[10px] text-red-400 font-semibold">
                            ⚠ Non-factual source — not used for claim verification
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function SummaryGrid({ ledger }: { ledger: EvidenceLedger }) {
    const tiles = [
        {
            label: "Total Evidence",
            value: ledger.summary.totalItems,
            icon: <Shield className="h-4 w-4" />,
            color: "text-foreground",
        },
        {
            label: "SERP Signals",
            value: ledger.serpObservations,
            icon: <Search className="h-4 w-4" />,
            color: "text-sky-400",
            active: ledger.summary.hasSerpObservations,
        },
        {
            label: "GSC Data Points",
            value: ledger.gscObservations,
            icon: <BarChart2 className="h-4 w-4" />,
            color: "text-amber-400",
            active: ledger.summary.hasGscData,
        },
        {
            label: "Competitor Scans",
            value: ledger.competitorObservations,
            icon: <TrendingUp className="h-4 w-4" />,
            color: "text-violet-400",
            active: ledger.competitorObservations > 0,
        },
        {
            label: "First-Party",
            value: (ledger.bySourceType["FIRST_PARTY_EXPERIENCE"] ?? 0) + (ledger.bySourceType["FIRST_PARTY_DATA"] ?? 0),
            icon: <User className="h-4 w-4" />,
            color: "text-emerald-400",
            active: ledger.summary.hasFirstPartyExperience || ledger.summary.hasFirstPartyData,
        },
        {
            label: "External Sources",
            value: ledger.bySourceType["EXTERNAL_SOURCE"] ?? 0,
            icon: <Globe className="h-4 w-4" />,
            color: "text-blue-400",
            active: ledger.summary.hasExternalSources,
        },
    ];

    return (
        <div className="grid grid-cols-3 gap-2">
            {tiles.map((t) => (
                <div
                    key={t.label}
                    className={`rounded-xl border px-3 py-2.5 ${
                        t.active === false
                            ? "border-border/50 bg-muted/20 opacity-50"
                            : "border-border bg-muted/30"
                    }`}
                >
                    <div className={`mb-1 ${t.color}`}>{t.icon}</div>
                    <div className="text-lg font-bold text-foreground leading-none">{t.value}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{t.label}</div>
                </div>
            ))}
        </div>
    );
}

export function EvidenceDrawer({
    blogId,
    blogTitle,
    trigger,
}: {
    blogId: string;
    blogTitle?: string;
    trigger: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<EvidenceData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<SourceType | "ALL">("ALL");
    const drawerRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        if (data) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/blogs/${blogId}/evidence`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setData(await res.json());
        } catch (e: unknown) {
            setError((e as Error).message ?? "Failed to load evidence");
        } finally {
            setLoading(false);
        }
    }, [blogId, data]);

    const handleOpen = useCallback(() => {
        setOpen(true);
        load();
    }, [load]);

    const handleClose = useCallback(() => setOpen(false), []);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open, handleClose]);

    const ledger = data?.ledger ?? null;
    const allItems = ledger?.evidenceItems ?? [];
    const filteredItems =
        filter === "ALL" ? allItems : allItems.filter((i) => i.sourceType === filter);

    const activeTypes = [...new Set(allItems.map((i) => i.sourceType))] as SourceType[];

    return (
        <>
            <button
                type="button"
                id={`evidence-drawer-trigger-${blogId}`}
                onClick={handleOpen}
                className="flex items-center"
            >
                {trigger}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-[300] flex"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Evidence Ledger"
                >
                    <div
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        onClick={handleClose}
                    />

                    <div
                        ref={drawerRef}
                        className="relative ml-auto flex h-full w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl"
                    >
                        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                                        <Shield className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-bold text-foreground">Evidence Ledger</h2>
                                        {blogTitle && (
                                            <p className="mt-0.5 max-w-[280px] truncate text-[11px] text-muted-foreground">
                                                {blogTitle}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                id={`evidence-drawer-close-${blogId}`}
                                onClick={handleClose}
                                aria-label="Close evidence drawer"
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {loading && (
                                <div className="flex h-40 items-center justify-center">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            )}

                            {error && (
                                <div className="m-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                                    {error}
                                </div>
                            )}

                            {data && !loading && (
                                <>
                                    {!data.hasLedger && (
                                        <div className="m-5 rounded-xl border border-border bg-muted/30 px-4 py-6 text-center">
                                            <Shield className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                                            <p className="text-sm font-medium text-foreground">No evidence ledger yet</p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Evidence is captured automatically on next generation.
                                            </p>
                                        </div>
                                    )}

                                    {ledger && (
                                        <div className="space-y-5 p-5">
                                            <div className="space-y-1.5">
                                                {ledger.topic && (
                                                    <p className="text-xs font-semibold text-foreground">
                                                        Topic: <span className="font-normal text-muted-foreground">{ledger.topic}</span>
                                                    </p>
                                                )}
                                                {ledger.searchIntent && (
                                                    <p className="text-xs font-semibold text-foreground">
                                                        Intent: <span className="font-normal text-muted-foreground">{ledger.searchIntent}</span>
                                                    </p>
                                                )}
                                                <p className="text-[11px] text-muted-foreground">
                                                    Collected{" "}
                                                    {new Date(ledger.collectedAt).toLocaleDateString(undefined, {
                                                        month: "short",
                                                        day: "numeric",
                                                        year: "numeric",
                                                    })}
                                                </p>
                                            </div>

                                            <SummaryGrid ledger={ledger} />

                                            {ledger.firstPartyContext?.brandFacts && ledger.firstPartyContext.brandFacts.length > 0 && (
                                                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
                                                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                                                        Verified Brand Facts
                                                    </p>
                                                    <ul className="space-y-1">
                                                        {ledger.firstPartyContext.brandFacts.slice(0, 6).map((f, i) => (
                                                            <li key={i} className="flex gap-2 text-xs">
                                                                <Star className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                                                                <span className="text-muted-foreground">
                                                                    <span className="font-medium text-foreground">{f.factType}:</span> {f.value}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {allItems.length > 0 && (
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-xs font-bold text-foreground">
                                                            Evidence Items ({filteredItems.length})
                                                        </p>
                                                    </div>

                                                    <div className="flex flex-wrap gap-1.5">
                                                        <button
                                                            type="button"
                                                            id={`evidence-filter-all-${blogId}`}
                                                            onClick={() => setFilter("ALL")}
                                                            className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                                                                filter === "ALL"
                                                                    ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                                                                    : "border-border bg-muted/30 text-muted-foreground hover:border-border/80"
                                                            }`}
                                                        >
                                                            All ({allItems.length})
                                                        </button>
                                                        {activeTypes.map((t) => {
                                                            const cfg = SOURCE_TYPE_CONFIG[t];
                                                            const count = ledger.bySourceType[t] ?? 0;
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    key={t}
                                                                    id={`evidence-filter-${t.toLowerCase()}-${blogId}`}
                                                                    onClick={() => setFilter(t)}
                                                                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                                                                        filter === t
                                                                            ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                                                                            : "border-border bg-muted/30 text-muted-foreground hover:border-border/80"
                                                                    }`}
                                                                >
                                                                    {cfg.icon}
                                                                    {count}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    <div className="space-y-2">
                                                        {filteredItems.map((item) => (
                                                            <EvidenceItemRow key={item.id} item={item} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
