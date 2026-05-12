import { getAuditById } from "@/app/actions/auditDetail";
import { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { IssueRow } from "./IssueRow";
import { RequestIndexingButton } from "./RequestIndexingButton";
import { ExportAuditButton } from "./ExportAuditButton";
import { ShareAuditButton } from "./ShareAuditButton";
import { type CategoryScoreDelta } from "@/app/actions/auditDetail";
import PageAuditSection from "./PageAuditSection";
import KeywordInsightsSection from "./KeywordInsightsSection";
import { parseAuditResult, toNormalisedIssues, type NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";
import AuditDiffSection from "./AuditDiffSection";
import { computeAuditDiff } from "@/lib/audit/diff";
import { AuditPageNav } from "@/components/dashboard/AuditPageNav";

const CATEGORY_ORDER = [
    "basics", "on-page", "onpage", "technical", "off-page", "offpage",
    "schema", "accessibility", "keywords", "social", "local",
] as const;

const CATEGORY_ICONS: Record<string, string> = {
    basics: "◈", "on-page": "◎", onpage: "◎", technical: "⌬",
    "off-page": "◇", offpage: "◇", schema: "⬡", accessibility: "⊙",
    keywords: "◈", social: "◯", local: "◈",
};

const getAudit = cache(getAuditById);

export async function generateMetadata(
    { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
    const { id } = await params;
    const result = await getAudit(id);
    if (!result.success) return { title: "Audit Report | OptiAISEO" };
    const audit = (result.audit as unknown) as AuditRecord;
    const domain = audit.site?.domain ?? "Unknown";
    const date = new Date(audit.runTimestamp ?? audit.createdAt ?? Date.now())
        .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return {
        title: `${domain} — SEO Audit ${date} | OptiAISEO`,
        description: `Full SEO audit for ${domain} run on ${date}. Review issues, scores, and AI-powered fix recommendations.`,
    };
}

interface PrioritisedIssue extends NormalisedIssue { priorityScore: number }
interface AuditSite { id: string; domain: string; githubRepoUrl?: string | null }
interface AuditRecord {
    id: string;
    runTimestamp?: Date | string | null;
    createdAt?: Date | string;
    fixStatus?: string;
    categoryScores?: Record<string, number>;
    issueList?: unknown;
    site?: AuditSite;
    lcp?: number | null;
    cls?: number | null;
    inp?: number | null;
}

function scoreColor(s: number) {
    if (s >= 75) return { text: "text-emerald-400", hex: "#34d978", bar: "bg-emerald-500", ring: "#34d978" };
    if (s >= 50) return { text: "text-amber-400", hex: "#f5a623", bar: "bg-amber-400", ring: "#f5a623" };
    return { text: "text-red-400", hex: "#ff5757", bar: "bg-red-500", ring: "#ff5757" };
}

function vitalStatus(metric: "lcp" | "cls" | "inp", value: number) {
    if (metric === "lcp") {
        if (value <= 2.5) return { label: "Good", cls: "text-emerald-400" };
        if (value <= 4.0) return { label: "Needs work", cls: "text-amber-400" };
        return { label: "Poor", cls: "text-red-400" };
    }
    if (metric === "cls") {
        if (value <= 0.1) return { label: "Good", cls: "text-emerald-400" };
        if (value <= 0.25) return { label: "Needs work", cls: "text-amber-400" };
        return { label: "Poor", cls: "text-red-400" };
    }
    if (value <= 200) return { label: "Good", cls: "text-emerald-400" };
    if (value <= 500) return { label: "Needs work", cls: "text-amber-400" };
    return { label: "Poor", cls: "text-red-400" };
}

function difficultyLabel(d: number) {
    if (d <= 3) return { label: "Easy fix", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
    if (d <= 6) return { label: "Medium effort", cls: "bg-amber-500/10  text-amber-400   border-amber-500/20" };
    return { label: "Complex", cls: "bg-red-500/10    text-red-400     border-red-500/20" };
}

function aeoImpactLabel(roi: number, ai: number) {
    const c = roi * 0.6 + ai * 0.4;
    if (c >= 75) return { text: "High revenue impact", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
    if (c >= 50) return { text: "Moderate traffic impact", cls: "bg-amber-500/10   text-amber-400   border-amber-500/20" };
    return { text: "Quick win", cls: "bg-blue-500/10    text-blue-400    border-blue-500/20" };
}

const DIFFICULTY_BY_CATEGORY: Record<string, number> = {
    basics: 2, "on-page": 3, onpage: 3, schema: 4,
    technical: 6, accessibility: 5, performance: 7,
    "off-page": 8, offpage: 8,
};

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getAudit(id);

    if (!result.success) {
        if (result.error === "Audit not found") notFound();
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <div className="p-5 bg-red-500/10 text-red-400 rounded-2xl border border-red-500/20">
                    <p className="font-semibold mb-1">Unable to load audit</p>
                    <p className="text-sm opacity-70">{result.error ?? "An unexpected error occurred."}</p>
                </div>
                <Link href="/dashboard/audits" className="text-emerald-400 hover:underline text-sm">
                    ← Back to Audits
                </Link>
            </div>
        );
    }

    const { audit, isPaidUser, scoreDeltas, previousAuditTimestamp } = result;
    const typedAudit = (audit as unknown) as AuditRecord;
    const scores = typedAudit.categoryScores ?? {};
    const issues = toNormalisedIssues(parseAuditResult(typedAudit.issueList));
    const diffData = typedAudit.site?.id ? await computeAuditDiff(typedAudit.id, typedAudit.site.id) : null;

    const scoreValues = Object.values(scores);
    const overallScore = scoreValues.length
        ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) : 0;

    const oc = scoreColor(overallScore);
    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const runDate = new Date(typedAudit.runTimestamp ?? typedAudit.createdAt ?? Date.now());

    const R = 35;
    const CIRC = 2 * Math.PI * R;
    const dashOffset = CIRC - (overallScore / 100) * CIRC;

    const sortedScores = Object.entries(scores).sort(([a], [b]) => {
        const ia = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
        const ib = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const topFixes: PrioritisedIssue[] = issues
        .filter(i => i.severity === "critical" || i.severity === "high")
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, 5) as PrioritisedIssue[];

    const grouped = issues.reduce<Record<string, NormalisedIssue[]>>((acc, issue) => {
        const cat = (issue.category ?? "general").toLowerCase().replace(/\s+/g, "-");
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(issue);
        return acc;
    }, {});

    const sortedCats = Object.keys(grouped).sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
        const ib = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const hasVitals = typedAudit.lcp != null || typedAudit.cls != null || typedAudit.inp != null;

    return (
        <div className="flex gap-8 max-w-6xl mx-auto pb-20 px-1">

            <AuditPageNav />

            <div className="flex flex-col gap-0 flex-1 min-w-0">

            {/* Breadcrumb */}
            <div className="pt-2 pb-5">
                <Link
                    href="/dashboard/audits"
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors group"
                >
                    <svg className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                        <path d="M8 2L4 6l4 4" strokeWidth={1.5} strokeLinecap="round" />
                    </svg>
                    All audits
                </Link>
            </div>

            {/* ── Hero Header ── */}
            <header className="rounded-2xl border border-white/[0.08] bg-[#111116] overflow-hidden mb-5 shadow-xl shadow-black/30">
                <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, ${oc.hex}, transparent)` }} />
                <div className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                        <div className="flex items-start gap-5">
                            <div className="shrink-0">
                                <svg width="80" height="80" viewBox="0 0 80 80" aria-label={`Overall score: ${overallScore}`}>
                                    <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
                                    <circle
                                        cx="40" cy="40" r={R} fill="none"
                                        stroke={oc.hex} strokeWidth="5" strokeLinecap="round"
                                        strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                                        transform="rotate(-90 40 40)"
                                    />
                                    <text x="40" y="36" textAnchor="middle" fontSize="18" fontWeight="600" fill={oc.hex} fontFamily="monospace">
                                        {overallScore}
                                    </text>
                                    <text x="40" y="50" textAnchor="middle" fontSize="9" fill="rgba(160,160,180,0.6)" letterSpacing="0.08em">
                                        SCORE
                                    </text>
                                </svg>
                            </div>
                            <div>
                                <p className="font-mono text-[11px] text-zinc-500 mb-1 tracking-wider">{typedAudit.site?.domain}</p>
                                <h1 className="text-xl font-semibold tracking-tight mb-3">SEO Audit Report</h1>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                    <MetaTag dot="emerald">
                                        Scanned {runDate.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </MetaTag>
                                    {criticalCount > 0 && (
                                        <MetaTag dot="red">{criticalCount} critical {criticalCount === 1 ? "issue" : "issues"}</MetaTag>
                                    )}
                                    <MetaTag dot="zinc">{issues.length} total findings</MetaTag>
                                    {previousAuditTimestamp && (
                                        <span className="text-[11px] text-zinc-600">
                                            vs {new Date(previousAuditTimestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <RequestIndexingButton
                                url={(typedAudit.issueList as Record<string, string> | null)?.url ?? `https://${typedAudit.site?.domain}`}
                                siteId={typedAudit.site?.id}
                            />
                            <ExportAuditButton auditId={typedAudit.id} />
                            <ShareAuditButton auditId={typedAudit.id} />
                            <FixStatusBadge status={typedAudit.fixStatus ?? "PENDING"} />
                        </div>
                    </div>
                </div>

                {hasVitals && (
                    <div className="border-t border-white/[0.06] bg-[#0d0d14] px-6 py-3 flex flex-wrap items-center gap-6">
                        <p className="text-[9px] font-semibold text-zinc-600 uppercase tracking-[0.12em] self-center mr-1">
                            Core Web Vitals
                        </p>
                        {typedAudit.lcp != null && (() => {
                            const s = vitalStatus("lcp", typedAudit.lcp!);
                            return (
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[10px] font-mono text-zinc-600 uppercase">LCP</span>
                                    <span className={`font-semibold tabular-nums text-sm font-mono ${s.cls}`}>{typedAudit.lcp.toFixed(1)}s</span>
                                    <span className={`text-[10px] ${s.cls} opacity-60`}>{s.label}</span>
                                </div>
                            );
                        })()}
                        {typedAudit.cls != null && (() => {
                            const s = vitalStatus("cls", typedAudit.cls!);
                            return (
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[10px] font-mono text-zinc-600 uppercase">CLS</span>
                                    <span className={`font-semibold tabular-nums text-sm font-mono ${s.cls}`}>{typedAudit.cls.toFixed(3)}</span>
                                    <span className={`text-[10px] ${s.cls} opacity-60`}>{s.label}</span>
                                </div>
                            );
                        })()}
                        {typedAudit.inp != null && (() => {
                            const s = vitalStatus("inp", typedAudit.inp!);
                            return (
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[10px] font-mono text-zinc-600 uppercase">INP</span>
                                    <span className={`font-semibold tabular-nums text-sm font-mono ${s.cls}`}>{Math.round(typedAudit.inp!)}ms</span>
                                    <span className={`text-[10px] ${s.cls} opacity-60`}>{s.label}</span>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </header>

            {/* ── Category Score Grid ── */}
            <div id="section-scores">
            <SectionLabel>Category scores</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 mb-5">
                {sortedScores.map(([cat, score]) => {
                    const delta = scoreDeltas.find((d: CategoryScoreDelta) => d.category === cat);
                    const icon = CATEGORY_ICONS[cat.toLowerCase()] ?? "◈";
                    const sc = scoreColor(score);
                    return (
                        <div
                            key={cat}
                            className="rounded-xl border border-white/[0.07] bg-[#111116] p-4 flex flex-col gap-2.5 relative overflow-hidden group hover:border-white/[0.12] transition-colors"
                        >
                            <div
                                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                style={{ background: `radial-gradient(ellipse at top left, ${sc.hex}08, transparent 70%)` }}
                            />
                            <div className="flex items-start justify-between">
                                <span className="text-[13px] text-zinc-600">{icon}</span>
                                {delta && delta.delta !== 0 && <DeltaBadge delta={delta.delta} />}
                            </div>
                            <div>
                                <div className={`text-2xl font-semibold tabular-nums font-mono ${sc.text}`}>{score}</div>
                                <div className="mt-2 h-[2px] rounded-full bg-white/[0.06] overflow-hidden">
                                    <div className={`h-full rounded-full ${sc.bar}`} style={{ width: `${score}%` }} />
                                </div>
                            </div>
                            <p className="text-[10px] text-zinc-600 capitalize tracking-wide">{cat.replace(/-/g, " ")}</p>
                        </div>
                    );
                })}
            </div>
            {previousAuditTimestamp && (
                <p className="text-[11px] text-zinc-600 mb-5 -mt-2">
                    Deltas vs audit on{" "}
                    {new Date(previousAuditTimestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
            )}
            </div>

            {/* ── Audit Diff ── */}
            {diffData && <div className="mb-5"><AuditDiffSection diff={diffData} /></div>}

            {/* ── High Priority Fixes ── */}
            {topFixes.length > 0 && (
                <div id="section-fixes">
                    <SectionLabel>High priority fixes</SectionLabel>
                    <div className="mt-3 mb-5 rounded-2xl border border-white/[0.07] bg-[#111116] overflow-hidden shadow-xl shadow-black/20">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                            <div>
                                <h2 className="text-sm font-semibold">Ranked by revenue impact</h2>
                                <p className="text-[11px] text-zinc-500 mt-0.5">
                                    Top {topFixes.length} issues requiring immediate attention
                                </p>
                            </div>
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                                {topFixes.length} critical
                            </span>
                        </div>
                        <div className="divide-y divide-white/[0.04]">
                            {topFixes.map((issue, i) => {
                                const diffScore = DIFFICULTY_BY_CATEGORY[issue.category?.toLowerCase() ?? ""] ?? 5;
                                const diff = difficultyLabel(diffScore);
                                const aeo = aeoImpactLabel(issue.roiImpact ?? 50, issue.aiVisibilityImpact ?? 50);
                                const sc = scoreColor(issue.priorityScore);
                                return (
                                    <div key={issue.id} className="flex items-start gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors">
                                        <div className="flex flex-col items-center gap-1.5 shrink-0 w-8 pt-0.5">
                                            <span className="text-[9px] text-zinc-700 font-mono">#{i + 1}</span>
                                            <span
                                                className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md border tabular-nums font-mono ${sc.text}`}
                                                style={{ background: `${sc.hex}12`, borderColor: `${sc.hex}30` }}
                                            >
                                                {issue.priorityScore}
                                            </span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-[13px] leading-snug">{issue.title}</p>
                                            <p className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5">{issue.recommendation}</p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${aeo.cls}`}>
                                                    {aeo.text}
                                                </span>
                                                <span className="text-zinc-700 text-[10px]">·</span>
                                                <span className="text-[10px] text-zinc-600 capitalize">{issue.category}</span>
                                            </div>
                                        </div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 self-start mt-0.5 ${diff.cls}`}>
                                            {diff.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ── All Findings ── */}
            <div id="section-findings" className="flex flex-col gap-0">
            <div className="flex items-center gap-3 mb-3 mt-1">
                <SectionLabel>All findings</SectionLabel>
                <span className="text-[11px] text-zinc-600 shrink-0">{issues.length} total</span>
            </div>
            <div className="flex flex-col gap-2">
                {sortedCats.map((cat) => {
                    const catIssues = grouped[cat];
                    const criticals = catIssues.filter(i => i.severity === "critical").length;
                    const icon = CATEGORY_ICONS[cat] ?? "◈";
                    return (
                        <details
                            key={cat}
                            open={catIssues.some(i => i.severity === "critical")}
                            className="rounded-xl border border-white/[0.07] bg-[#111116] overflow-hidden group hover:border-white/[0.10] transition-colors"
                        >
                            <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none hover:bg-white/[0.02] transition-colors">
                                <div className="flex items-center gap-2.5">
                                    <span className="text-[12px] text-zinc-600">{icon}</span>
                                    <span className="font-medium text-[13px] capitalize">{cat.replace(/-/g, " ")}</span>
                                    {criticals > 0 && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 tracking-wide">
                                            {criticals} critical
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2.5">
                                    <span className="text-[11px] text-zinc-600">
                                        {catIssues.length} {catIssues.length === 1 ? "issue" : "issues"}
                                    </span>
                                    <svg
                                        className="w-3.5 h-3.5 text-zinc-600 transition-transform group-open:rotate-180"
                                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                    >
                                        <path d="M19 9l-7 7-7-7" strokeWidth={1.5} strokeLinecap="round" />
                                    </svg>
                                </div>
                            </summary>
                            <div className="border-t border-white/[0.05] divide-y divide-white/[0.03]">
                                {catIssues.map((issue, i) => (
                                    <IssueRow
                                        key={issue.id || i}
                                        issue={issue}
                                        siteId={typedAudit.site?.id ?? ""}
                                        domain={typedAudit.site?.domain ?? ""}
                                        hasGithub={!!typedAudit.site?.githubRepoUrl}
                                        fixStatus={typedAudit.fixStatus}
                                    />
                                ))}
                            </div>
                        </details>
                    );
                })}
            </div>
            </div>

            {/* ── Additional sections ── */}
            <div id="section-keywords" className="mt-6">
                <KeywordInsightsSection siteId={typedAudit.site?.id ?? ""} domain={typedAudit.site?.domain ?? ""} />
            </div>
            <div id="section-pages" className="mt-4">
                <PageAuditSection auditId={typedAudit.id} isPaidUser={isPaidUser} />
            </div>
            </div>
        </div>
    );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.1em] whitespace-nowrap">
                {children}
            </span>
            <div className="flex-1 h-px bg-white/[0.06]" />
        </div>
    );
}

function MetaTag({ dot, children }: { dot: "emerald" | "red" | "zinc"; children: ReactNode }) {
    const dotCls = { emerald: "bg-emerald-400", red: "bg-red-400", zinc: "bg-zinc-600" }[dot];
    return (
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
            {children}
        </span>
    );
}

function DeltaBadge({ delta }: { delta: number }) {
    if (delta === 0) return null;
    const pos = delta > 0;
    return (
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${pos ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-red-500/10    text-red-400     border-red-500/20"
            }`}>
            {pos ? "+" : ""}{delta}
        </span>
    );
}

function FixStatusBadge({ status }: { status: string }) {
    const map: Record<string, { cls: string; dot: string; label: string; pulse?: boolean }> = {
        COMPLETED: { cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400", label: "Completed" },
        IN_PROGRESS: { cls: "bg-amber-500/10   text-amber-400   border-amber-500/20", dot: "bg-amber-400", label: "In progress", pulse: true },
        PENDING: { cls: "bg-blue-500/10    text-blue-400    border-blue-500/20", dot: "bg-blue-400", label: "Pending", pulse: true },
        FAILED: { cls: "bg-red-500/10     text-red-400     border-red-500/20", dot: "bg-red-400", label: "Failed" },
    };
    const m = map[status] ?? { cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", dot: "bg-zinc-500", label: status };
    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium ${m.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${m.pulse ? "animate-pulse" : ""}`} />
            {m.label}
        </span>
    );
}