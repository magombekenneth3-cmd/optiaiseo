"use client";

import { useState, useCallback, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
    Target,
    Sparkles,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Globe,
    Check,
    Loader2,
    TrendingUp,
    ArrowUpRight,
    AlertTriangle,
    CheckCircle2,
    Clock,
    BarChart3,
    Zap,
} from "lucide-react";
import Link from "next/link";
import { generateCampaignFixPlan, updateCampaignStatus } from "@/app/actions/campaigns";
import type { CampaignKeyword, CampaignRow } from "@/app/actions/campaigns";
import { toast } from "sonner";

interface Site {
    id: string;
    domain: string;
}

interface Props {
    sites: Site[];
    activeSiteId: string | null;
    campaigns: CampaignRow[];
    userTier: string;
}

const PRIORITY_CONFIG = {
    high: {
        label: "High",
        cls: "bg-red-500/10 text-red-400 border-red-500/20",
    },
    medium: {
        label: "Medium",
        cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    low: {
        label: "Low",
        cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    },
} as const;

const STATUS_CONFIG: Record<string, { label: string; cls: string; dot: string; pulse?: boolean }> = {
    PENDING: {
        label: "Queued",
        cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
        dot: "#71717a",
    },
    ACTIVE: {
        label: "Fix plan ready",
        cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        dot: "#60a5fa",
        pulse: true,
    },
    COMPLETED: {
        label: "Completed",
        cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        dot: "#34d399",
    },
};

function positionColor(pos: number): string {
    if (pos <= 14) return "#fbbf24";
    if (pos <= 20) return "#f97316";
    return "#f87171";
}

function fmt(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function relativeDate(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return new Date(iso).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
    const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${cfg.cls}`}
        >
            <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.pulse ? "animate-pulse" : ""}`}
                style={{ background: cfg.dot }}
            />
            {cfg.label}
        </span>
    );
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
    const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.low;
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cfg.cls}`}
        >
            {cfg.label}
        </span>
    );
}

function PositionChip({ pos }: { pos: number }) {
    const color = positionColor(pos);
    return (
        <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-bold shrink-0 border"
            style={{
                background: `${color}18`,
                borderColor: `${color}30`,
                color,
            }}
        >
            {pos}
        </span>
    );
}

function SiteSwitcher({
    sites,
    activeSiteId,
}: {
    sites: Site[];
    activeSiteId: string | null;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const active = sites.find((s) => s.id === activeSiteId) ?? sites[0];

    if (sites.length <= 1) return null;

    return (
        <div className="relative">
            <button
                onClick={() => setOpen((v: boolean) => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] transition-colors text-sm font-medium text-[#c9d1d9]"
            >
                <Globe className="w-3.5 h-3.5 text-[#6e7681]" />
                <span className="max-w-[160px] truncate">{active?.domain ?? "Select site"}</span>
                <span className="text-[10px] font-bold text-[#6e7681] bg-[#21262d] px-1.5 py-0.5 rounded-full">
                    {sites.length}
                </span>
                <ChevronDown
                    className={`w-3 h-3 text-[#6e7681] transition-transform ${open ? "rotate-180" : ""}`}
                />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-40 min-w-[200px] bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden">
                        {sites.map((site) => (
                            <button
                                key={site.id}
                                onClick={() => {
                                    setOpen(false);
                                    router.push(`/dashboard/campaigns?siteId=${site.id}`);
                                }}
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
                            >
                                <span className="flex-1 truncate">{site.domain}</span>
                                {site.id === activeSiteId && (
                                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                )}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function KeywordRow({
    kw,
    expanded,
    onToggle,
}: {
    kw: CampaignKeyword;
    expanded: boolean;
    onToggle: () => void;
}) {
    const plan = kw.fixPlan;

    return (
        <div className="border-b border-[#21262d] last:border-0">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#161b22]/60 transition-colors text-left"
            >
                <PositionChip pos={kw.position} />

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-[#c9d1d9] truncate max-w-[200px] sm:max-w-none">
                            {kw.keyword}
                        </span>
                        {plan && <PriorityBadge priority={plan.priority} />}
                    </div>
                    {kw.url && (
                        <p className="text-[11px] text-[#6e7681] truncate mt-0.5 max-w-[260px]">
                            {kw.url}
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    {kw.searchVolume != null && kw.searchVolume > 0 && (
                        <div className="text-right hidden sm:block">
                            <p className="text-[12px] font-semibold text-[#c9d1d9]">
                                {fmt(kw.searchVolume)}
                            </p>
                            <p className="text-[10px] text-[#6e7681]">searches/mo</p>
                        </div>
                    )}
                    {plan && (
                        <span className="text-[11px] text-emerald-400 font-medium shrink-0 hidden sm:block">
                            {plan.estimatedLift}
                        </span>
                    )}
                    {expanded ? (
                        <ChevronUp className="w-4 h-4 text-[#6e7681] shrink-0" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-[#6e7681] shrink-0" />
                    )}
                </div>
            </button>

            {expanded && plan && (
                <div className="px-4 pb-4 border-t border-[#21262d]/60">
                    <div className="mt-3 rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#21262d] flex items-start gap-2.5">
                            <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-wider mb-1">
                                    Quick win
                                </p>
                                <p className="text-[13px] text-[#c9d1d9] leading-snug">{plan.quickWin}</p>
                            </div>
                        </div>

                        <div className="px-4 py-3">
                            <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-wider mb-2.5">
                                Action tasks
                            </p>
                            <div className="flex flex-col gap-2">
                                {plan.tasks.map((task, i) => (
                                    <div key={i} className="flex items-start gap-2.5">
                                        <span className="w-5 h-5 rounded-md bg-[#161b22] border border-[#30363d] text-[10px] font-bold text-[#6e7681] flex items-center justify-center shrink-0 mt-0.5">
                                            {i + 1}
                                        </span>
                                        <p className="text-[13px] text-[#8b949e] leading-snug">{task}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="px-4 py-2.5 border-t border-[#21262d] bg-[#161b22]/40 flex items-center gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-[12px] text-emerald-400 font-medium">
                                Estimated lift: {plan.estimatedLift}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {expanded && !plan && (
                <div className="px-4 pb-4 border-t border-[#21262d]/60 pt-3">
                    <p className="text-[13px] text-[#6e7681]">
                        Fix plan not yet generated for this keyword.
                    </p>
                </div>
            )}
        </div>
    );
}

function CampaignCard({
    campaign,
    onUpdate,
}: {
    campaign: CampaignRow;
    onUpdate: (id: string, updated: Partial<CampaignRow>) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [expandedKw, setExpandedKw] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [completing, setCompleting] = useState(false);

    const keywords: CampaignKeyword[] = campaign.keywords ?? [];
    const hasPlan = keywords.some((k) => k.fixPlan);
    const highCount = keywords.filter((k) => k.fixPlan?.priority === "high").length;

    const handleGenerate = useCallback(async () => {
        setGenerating(true);
        try {
            const result = await generateCampaignFixPlan(campaign.id);
            if (result.success && result.keywords) {
                onUpdate(campaign.id, { keywords: result.keywords, status: "ACTIVE" });
                setExpanded(true);
                toast.success("Fix plan generated");
            } else {
                toast.error(result.error ?? "Failed to generate fix plan");
            }
        } finally {
            setGenerating(false);
        }
    }, [campaign.id, onUpdate]);

    const handleComplete = useCallback(async () => {
        setCompleting(true);
        try {
            await updateCampaignStatus(campaign.id, "COMPLETED");
            onUpdate(campaign.id, {
                status: "COMPLETED",
                completedAt: new Date().toISOString(),
            });
            toast.success("Campaign marked as complete");
        } finally {
            setCompleting(false);
        }
    }, [campaign.id, onUpdate]);

    const borderStyle =
        campaign.status === "ACTIVE"
            ? { borderColor: "rgba(96,165,250,0.3)" }
            : campaign.status === "COMPLETED"
                ? { borderColor: "rgba(52,211,153,0.2)" }
                : {};

    return (
        <div
            className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden"
            style={borderStyle}
        >
            <div
                className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-[#161b22]/40 transition-colors"
                onClick={() => setExpanded((v: boolean) => !v)}
            >
                <div className="w-9 h-9 rounded-xl bg-[#161b22] border border-[#21262d] flex items-center justify-center shrink-0">
                    <Target className="w-4 h-4 text-[#6e7681]" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-[#e6edf3] truncate max-w-[240px]">
                            {campaign.name}
                        </span>
                        <StatusBadge status={campaign.status} />
                        {highCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                {highCount} high priority
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-[12px] text-[#6e7681]">
                            {campaign.keywordCount ?? keywords.length} keywords
                        </span>
                        {campaign.urlCount != null && campaign.urlCount > 0 && (
                            <>
                                <span className="text-[#30363d]">·</span>
                                <span className="text-[12px] text-[#6e7681]">
                                    {campaign.urlCount} URLs
                                </span>
                            </>
                        )}
                        <span className="text-[#30363d]">·</span>
                        <span className="text-[12px] text-[#6e7681]">
                            {relativeDate(campaign.createdAt)}
                        </span>
                        {campaign.clientUrl && (
                            <>
                                <span className="text-[#30363d]">·</span>
                                <a
                                    href={campaign.clientUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
                                    className="text-[12px] text-[#6e7681] hover:text-[#c9d1d9] transition-colors flex items-center gap-0.5 truncate max-w-[180px]"
                                >
                                    {campaign.clientUrl.replace(/^https?:\/\//, "")}
                                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                </a>
                            </>
                        )}
                    </div>
                </div>

                <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
                >
                    {campaign.status === "PENDING" && (
                        <button
                            onClick={handleGenerate}
                            disabled={generating}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-[12px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {generating ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                                <Sparkles className="w-3 h-3" />
                            )}
                            {generating ? "Generating…" : "Generate plan"}
                        </button>
                    )}

                    {campaign.status === "ACTIVE" && (
                        <button
                            onClick={handleComplete}
                            disabled={completing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-[12px] font-medium transition-colors disabled:opacity-50"
                        >
                            {completing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                                <CheckCircle2 className="w-3 h-3" />
                            )}
                            {completing ? "Saving…" : "Mark done"}
                        </button>
                    )}

                    <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center border border-[#21262d] transition-colors ${expanded ? "bg-[#21262d]" : ""}`}
                    >
                        {expanded ? (
                            <ChevronUp className="w-4 h-4 text-[#6e7681]" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-[#6e7681]" />
                        )}
                    </div>
                </div>
            </div>

            {expanded && keywords.length > 0 && (
                <div className="border-t border-[#21262d]">
                    <div className="flex items-center justify-between px-5 py-2.5 bg-[#161b22]/50">
                        <span className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-wider">
                            Keywords — click to expand fix plan
                        </span>
                        {hasPlan && (
                            <span className="text-[11px] text-emerald-400 font-medium">
                                {keywords.filter((k) => k.fixPlan).length} plans ready
                            </span>
                        )}
                    </div>
                    <div>
                        {keywords.map((kw) => (
                            <KeywordRow
                                key={kw.keyword}
                                kw={kw}
                                expanded={expandedKw === kw.keyword}
                                onToggle={(): void => {
                                    setExpandedKw((v: string | null) => (v === kw.keyword ? null : kw.keyword));
                                }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {expanded && keywords.length === 0 && (
                <div className="border-t border-[#21262d] px-5 py-8 text-center">
                    <p className="text-[13px] text-[#6e7681]">No keyword data yet.</p>
                </div>
            )}
        </div>
    );
}

export function CampaignsDashboard({
    sites,
    activeSiteId,
    campaigns: initialCampaigns,
    userTier,
}: Props) {
    const [campaigns, setCampaigns] = useState<CampaignRow[]>(initialCampaigns);

    const handleUpdate = useCallback((id: string, updated: Partial<CampaignRow>) => {
        setCampaigns((prev: CampaignRow[]) =>
            prev.map((c: CampaignRow) => (c.id === id ? { ...c, ...updated } : c))
        );
    }, []);

    const isPaid = userTier !== "FREE";
    const activeCampaigns = campaigns.filter((c: CampaignRow) => c.status === "ACTIVE");
    const totalKeywords = campaigns.reduce((s: number, c: CampaignRow) => s + (c.keywordCount ?? 0), 0);
    const completedCount = campaigns.filter((c: CampaignRow) => c.status === "COMPLETED").length;
    const avgPosition =
        campaigns.length > 0
            ? Math.round(
                campaigns.reduce((s: number, c: CampaignRow) => s + c.initialPosition, 0) / campaigns.length
            )
            : 0;

    const stats = [
        {
            label: "Total campaigns",
            value: String(campaigns.length),
            sub: `${completedCount} completed`,
            color: "#e6edf3",
        },
        {
            label: "Page-2 keywords",
            value: totalKeywords > 0 ? String(totalKeywords) : "—",
            sub: "waiting for page 1",
            color: "#f87171",
        },
        {
            label: "Fix plans ready",
            value: String(activeCampaigns.length),
            sub: activeCampaigns.length > 0 ? "action needed" : "generate below",
            color: activeCampaigns.length > 0 ? "#60a5fa" : "#6e7681",
        },
        {
            label: "Avg stuck position",
            value: avgPosition > 0 ? String(avgPosition) : "—",
            sub: "target: top 10",
            color: avgPosition > 0 ? positionColor(avgPosition) : "#6e7681",
        },
    ];

    const sortedCampaigns = [...campaigns].sort((a: CampaignRow, b: CampaignRow) => {
        const order: Record<string, number> = { ACTIVE: 0, PENDING: 1, COMPLETED: 2 };
        return (order[a.status] ?? 1) - (order[b.status] ?? 1);
    });

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#e6edf3] mb-1">
                        Page-2 Campaigns
                    </h1>
                    <p className="text-[13px] text-[#6e7681]">
                        Keywords stuck on page 2 — detected daily, fixed with AI
                    </p>
                </div>
                <SiteSwitcher sites={sites} activeSiteId={activeSiteId} />
            </div>

            {campaigns.length > 0 && (
                <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#21262d]">
                        {stats.map((s) => (
                            <div key={s.label} className="px-5 py-4 flex flex-col gap-0.5">
                                <span
                                    className="text-[26px] font-black tabular-nums leading-none"
                                    style={{ color: s.color }}
                                >
                                    {s.value}
                                </span>
                                <span className="text-[12px] font-medium text-[#c9d1d9] mt-1">
                                    {s.label}
                                </span>
                                <span className="text-[11px] text-[#6e7681]">{s.sub}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isPaid && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-[13px] font-semibold text-amber-400 mb-0.5">
                                Starter or Pro required
                            </p>
                            <p className="text-[12px] text-[#6e7681]">
                                Page-2 campaigns run daily for paid sites. Upgrade to unlock keyword
                                opportunity detection.
                            </p>
                        </div>
                    </div>
                    <Link
                        href="/dashboard/billing"
                        className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-[12px] transition-colors whitespace-nowrap"
                    >
                        Upgrade
                    </Link>
                </div>
            )}

            {campaigns.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#30363d] bg-[#0d1117]/50 px-6 py-16 flex flex-col items-center text-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-[#161b22] border border-[#30363d] flex items-center justify-center">
                        <BarChart3 className="w-7 h-7 text-[#6e7681]" />
                    </div>
                    <div>
                        <p className="text-[16px] font-semibold text-[#c9d1d9] mb-1">
                            No campaigns yet
                        </p>
                        <p className="text-[13px] text-[#6e7681] max-w-sm mx-auto">
                            The AI scans your keywords daily at 5am UTC. Campaigns appear here
                            automatically when keywords ranked 11–25 are found.
                        </p>
                    </div>
                    {isPaid ? (
                        <div className="flex items-center gap-1.5 text-[12px] text-[#6e7681]">
                            <Clock className="w-3.5 h-3.5" />
                            Runs daily — check back tomorrow
                        </div>
                    ) : (
                        <Link
                            href="/dashboard/billing"
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-[13px] font-medium transition-colors"
                        >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            Upgrade to unlock
                        </Link>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {activeCampaigns.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-wider whitespace-nowrap">
                                Active — fix plans ready
                            </span>
                            <div className="flex-1 h-px bg-[#21262d]" />
                        </div>
                    )}
                    {sortedCampaigns.map((c) => (
                        <CampaignCard key={c.id} campaign={c} onUpdate={handleUpdate} />
                    ))}
                </div>
            )}
        </div>
    );
}