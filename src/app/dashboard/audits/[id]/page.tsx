import { getAuditById } from "@/app/actions/auditDetail";
import { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

import { RequestIndexingButton } from "./RequestIndexingButton";
import { ExportAuditButton } from "./ExportAuditButton";
import { ShareAuditButton } from "./ShareAuditButton";
import { type CategoryScoreDelta } from "@/app/actions/auditDetail";
import PageAuditSection from "./PageAuditSection";
import KeywordInsightsSection from "./KeywordInsightsSection";
import { parseAuditResult, toNormalisedIssues, type NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";
import AuditDiffSection from "./AuditDiffSection";
import { computeAuditDiff } from "@/lib/audit/diff";
import { FilteredFindings } from "@/components/dashboard/FilteredFindings";
import { AuditScoreBar } from "./AuditScoreBar";
import { AuditCategoryRadar } from "./AuditCategoryRadar";

const CATEGORY_ORDER = [
    "basics", "on-page", "onpage", "technical", "off-page", "offpage",
    "schema", "accessibility", "keywords", "social", "local",
] as const;

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
    if (s >= 75) return { text: "text-emerald-400", hex: "#34d978", bar: "bg-emerald-500" };
    if (s >= 50) return { text: "text-amber-400", hex: "#f5a623", bar: "bg-amber-400" };
    return { text: "text-red-400", hex: "#ff5757", bar: "bg-red-500" };
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

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const runDate = new Date(typedAudit.runTimestamp ?? typedAudit.createdAt ?? Date.now());

    const sortedScores = Object.entries(scores).sort(([a], [b]) => {
        const ia = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
        const ib = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const topFixes: PrioritisedIssue[] = issues
        .filter(i => i.severity === "critical" || i.severity === "high")
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, 5) as PrioritisedIssue[];

    const categoryCount = Object.keys(scores).length;

    return (
        <div className="flex flex-col gap-0 max-w-6xl mx-auto pb-20">

            {/* ── Page Header ── */}
            <div className="mb-6">
                <div className="text-[12px] text-[#6e7681] mb-2 flex items-center gap-[6px]">
                    <Link href="/dashboard" className="hover:text-[#8b949e] transition-colors">Sites</Link>
                    <span>/</span>
                    <Link href="/dashboard/audits" className="hover:text-[#8b949e] transition-colors">{typedAudit.site?.domain}</Link>
                    <span>/</span>
                    <span className="text-[#8b949e]">Audit Report</span>
                </div>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-[22px] font-bold tracking-[-0.5px] text-[#e6edf3]">
                            {typedAudit.site?.domain}
                            <span className="text-[#6e7681] font-normal ml-2 text-[18px]">— SEO Audit</span>
                        </h1>
                        <p className="text-[13px] text-[#8b949e] mt-1 flex flex-wrap items-center gap-1.5">
                            <span>{issues.length} findings</span>
                            {criticalCount > 0 && (
                                <>
                                    <span className="text-[#30363d]">·</span>
                                    <span className="text-[#f85149] font-semibold">{criticalCount} critical</span>
                                </>
                            )}
                            <span className="text-[#30363d]">·</span>
                            <span>Scanned {runDate.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            {previousAuditTimestamp && (
                                <>
                                    <span className="text-[#30363d]">·</span>
                                    <span>vs {new Date(previousAuditTimestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                                </>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
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

            {/* ── Score Overview ── */}
            <AuditScoreBar
                overallScore={overallScore}
                issues={issues}
                categoryCount={categoryCount}
                lcp={typedAudit.lcp}
                cls={typedAudit.cls}
                inp={typedAudit.inp}
            />

            {/* ── Category Radar + Score Grid (side-by-side on desktop) ── */}
            <div id="section-scores" className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-4 mb-6">

                {/* Radar chart */}
                {Object.keys(scores).length >= 3 && (
                    <AuditCategoryRadar scores={scores} />
                )}

                {/* Category score cards */}
                <div className="flex flex-col gap-3 xl:w-[260px]">
                    <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#21262d]">
                            <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.08em]">Category scores</p>
                            {previousAuditTimestamp && (
                                <p className="text-[10px] text-[#6e7681] mt-0.5">
                                    vs {new Date(previousAuditTimestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                </p>
                            )}
                        </div>
                        <div className="p-3 space-y-2">
                            {sortedScores.map(([cat, score]) => {
                                const delta = scoreDeltas.find((d: CategoryScoreDelta) => d.category === cat);
                                const sc = scoreColor(score);
                                return (
                                    <div key={cat} className="flex items-center gap-2.5">
                                        <span className="text-[11px] text-[#8b949e] capitalize w-[90px] shrink-0 truncate">
                                            {cat.replace(/-/g, " ")}
                                        </span>
                                        <div className="flex-1 h-[5px] bg-[#21262d] rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${sc.bar} transition-all duration-700`}
                                                style={{ width: `${score}%` }}
                                            />
                                        </div>
                                        <span className={`text-[12px] font-bold w-7 text-right tabular-nums font-mono ${sc.text}`}>
                                            {score}
                                        </span>
                                        {delta && delta.delta !== 0 && <DeltaBadge delta={delta.delta} />}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Audit Diff ── */}
            {diffData && <div className="mb-5"><AuditDiffSection diff={diffData} /></div>}

            {/* ── High Priority Fixes ── */}
            {topFixes.length > 0 && (
                <div id="section-fixes" className="mb-6">
                    <SectionLabel>High priority fixes</SectionLabel>
                    <div className="mt-3 rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden shadow-xl shadow-black/20">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262d]">
                            <div>
                                <h2 className="text-sm font-semibold text-[#e6edf3]">Ranked by revenue impact</h2>
                                <p className="text-[11px] text-[#6e7681] mt-0.5">
                                    Top {topFixes.length} issues requiring immediate attention
                                </p>
                            </div>
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                                {topFixes.length} critical
                            </span>
                        </div>
                        <div className="divide-y divide-[#161b22]">
                            {topFixes.map((issue, i) => {
                                const diffScore = DIFFICULTY_BY_CATEGORY[issue.category?.toLowerCase() ?? ""] ?? 5;
                                const diff = difficultyLabel(diffScore);
                                const aeo = aeoImpactLabel(issue.roiImpact ?? 50, issue.aiVisibilityImpact ?? 50);
                                const sc = scoreColor(issue.priorityScore);
                                return (
                                    <div key={issue.id} className="flex items-start gap-4 px-5 py-4 hover:bg-[#161b22] transition-colors">
                                        <div className="flex flex-col items-center gap-1.5 shrink-0 w-8 pt-0.5">
                                            <span className="text-[9px] text-[#6e7681] font-mono">#{i + 1}</span>
                                            <span
                                                className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md border tabular-nums font-mono ${sc.text}`}
                                                style={{ background: `${sc.hex}12`, borderColor: `${sc.hex}30` }}
                                            >
                                                {issue.priorityScore}
                                            </span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-[13px] text-[#e6edf3] leading-snug">{issue.title}</p>
                                            <p className="text-[11px] text-[#6e7681] line-clamp-1 mt-0.5">{issue.recommendation}</p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${aeo.cls}`}>
                                                    {aeo.text}
                                                </span>
                                                <span className="text-[#30363d] text-[10px]">·</span>
                                                <span className="text-[10px] text-[#6e7681] capitalize">{issue.category}</span>
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
            <FilteredFindings
                issues={issues}
                siteId={typedAudit.site?.id ?? ""}
                domain={typedAudit.site?.domain ?? ""}
                hasGithub={!!typedAudit.site?.githubRepoUrl}
                fixStatus={typedAudit.fixStatus}
            />

            {/* ── Additional sections ── */}
            <div id="section-keywords" className="mt-8">
                <KeywordInsightsSection siteId={typedAudit.site?.id ?? ""} domain={typedAudit.site?.domain ?? ""} />
            </div>
            <div id="section-pages" className="mt-6">
                <PageAuditSection auditId={typedAudit.id} isPaidUser={isPaidUser} />
            </div>
        </div>
    );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.1em] whitespace-nowrap">
                {children}
            </span>
            <div className="flex-1 h-px bg-[#21262d]" />
        </div>
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
        COMPLETED:   { cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400", label: "Completed" },
        IN_PROGRESS: { cls: "bg-amber-500/10   text-amber-400   border-amber-500/20",   dot: "bg-amber-400",  label: "In progress", pulse: true },
        PENDING:     { cls: "bg-blue-500/10    text-blue-400    border-blue-500/20",     dot: "bg-blue-400",   label: "Pending",     pulse: true },
        FAILED:      { cls: "bg-red-500/10     text-red-400     border-red-500/20",      dot: "bg-red-400",    label: "Failed" },
    };
    const m = map[status] ?? { cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", dot: "bg-zinc-500", label: status };
    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium ${m.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${m.pulse ? "animate-pulse" : ""}`} />
            {m.label}
        </span>
    );
}