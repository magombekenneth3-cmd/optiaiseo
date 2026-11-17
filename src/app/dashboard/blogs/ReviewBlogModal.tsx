"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
    CheckCircle2,
    ChevronRight,
    Clock3,
    Copy,
    ExternalLink,
    FileText,
    Globe,
    Info,
    Loader2,
    Maximize2,
    Minimize2,
    RefreshCw,
    Save,
    Search,
    ShieldCheck,
    Sparkles,
    X,
    Zap,
    PanelRight,
    AlertTriangle,
    Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeExternalLinks from "rehype-external-links";
import { toast } from "sonner";
import { ContentEditor } from "./ContentEditor";
import { ScoreRadarGauge } from "@/components/blog/ScoreRadarGauge";
import { AiDiffInspector } from "@/components/blog/AiDiffInspector";
import type { RefreshChangeSummary, StoredRefreshMetadata } from "@/lib/content/surgical-refresh";
import type { ContentScoreResult } from "@/lib/content-scoring";
import {
    normalizeCitationCriteria,
    type CitationCriterion,
} from "@/lib/blog/ai-citation-template";
import type { SerpCompetitiveBrief } from "@/lib/blog/contracts";
import {
    formatBriefBadgeLabel,
    formatOpportunityGuidanceForUi,
    formatPublishedDateLabel,
    formatSourceDomainLabel,
} from "@/lib/blog/brief-display";
import { formatKeywordDisplay, slugifyHeading } from "@/lib/blog/markdown";
import { logger } from "@/lib/logger";

interface Blog {
    id: string;
    title: string;
    slug?: string;
    content: string;
    status: string;
    pipelineType?: string | null;
    sourceUrl?: string | null;
    targetKeywords: string[];
    validationScore?: number | null;
    evidenceCoverage?: number | null;
    citationScore?: number | null;
    citationCriteria?: unknown;
    serpCompetitiveBrief?: SerpCompetitiveBrief | null;
    publicationGates?: Array<{ name: string; status: string; issues?: string[]; warnings?: string[] }> | null;
    validationErrors?: string[] | null;
    validationWarnings?: string[] | null;
    generationInput?: StoredRefreshMetadata | Record<string, unknown> | null;
}

function getRefreshMetadata(blog: Blog): StoredRefreshMetadata | null {
    const raw = blog.generationInput;
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<StoredRefreshMetadata>;
    if (candidate.mode !== "CONTENT_REFRESH" || !candidate.refreshSummary) return null;
    return candidate as StoredRefreshMetadata;
}

function RefreshSummaryPanel({ blog }: { blog: Blog }) {
    const meta = getRefreshMetadata(blog);
    const summary: RefreshChangeSummary | undefined = meta?.refreshSummary;
    if (!summary && blog.pipelineType !== "CONTENT_REFRESH" && !blog.sourceUrl) {
        return null;
    }

    const delta = summary?.wordCountDelta ?? 0;
    const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;

    return (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
            <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-amber-400" />
                <h3 className="text-xs font-semibold text-amber-300">Page refresh target</h3>
            </div>
            <div className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                <p className="truncate font-mono text-foreground/90" title={summary?.targetUrl || blog.sourceUrl || ""}>
                    {summary?.targetPath || blog.sourceUrl}
                </p>
                {summary && (
                    <>
                        <p>
                            Preserved slug: <span className="font-mono text-foreground">{summary.preservedSlug}</span>
                        </p>
                        <p>
                            Words: {summary.originalWordCount} &rarr; {summary.refreshedWordCount}{" "}
                            <span className={delta >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-amber-300"}>
                                ({deltaLabel})
                            </span>
                        </p>
                        <p>
                            Sections: {summary.retainedHeadings.length} kept &middot; {summary.addedHeadings.length} added
                        </p>
                        {summary.clusterQueriesAdded.length > 0 && (
                            <div className="pt-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/80">
                                    Uncovered queries integrated
                                </p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {summary.clusterQueriesAdded.slice(0, 5).map((q) => (
                                        <span
                                            key={q}
                                            className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200"
                                        >
                                            {q}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

type ReviewMode = "write" | "review" | "simulate";

interface ReviewBlogModalProps {
    blog: Blog;
    onClose: () => void;
    onPublish: (id: string) => Promise<{ success: boolean; mediumUrl?: string; hashnodeUrl?: string }>;
    onBlogUpdated?: (updated: Partial<Blog> & { id: string }) => void;
}

function getScoreState(score: number) {
    if (score >= 80) return { label: "Ready to publish", shortLabel: "Ready", tone: "success" as const };
    if (score >= 60) return { label: "Needs minor work", shortLabel: "Needs work", tone: "warning" as const };
    return { label: "Needs attention", shortLabel: "Needs attention", tone: "danger" as const };
}

function toneClasses(tone: "success" | "warning" | "danger") {
    switch (tone) {
        case "success": return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", bar: "bg-emerald-500" };
        case "warning": return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", bar: "bg-amber-500" };
        default: return { text: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", bar: "bg-rose-500" };
    }
}

function ReadinessCard({ score, criteria }: { score: number; criteria: CitationCriterion[] }) {
    const state = getScoreState(score);
    const tone = toneClasses(state.tone);

    const failed = useMemo(
        () => criteria.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight),
        [criteria]
    );
    const passed = useMemo(() => criteria.filter((c) => c.passed), [criteria]);

    return (
        <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <ShieldCheck className={`h-4 w-4 ${tone.text}`} />
                            <h3 className="text-sm font-semibold">Citation readiness</h3>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            How prepared this article is for AI citation.
                        </p>
                    </div>
                    <div className="text-right">
                        <div className={`text-2xl font-bold tabular-nums ${tone.text}`}>
                            {score}
                            <span className="text-sm font-medium text-muted-foreground">/100</span>
                        </div>
                        <div className={`text-[11px] font-medium ${tone.text}`}>{state.label}</div>
                    </div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                        style={{ width: `${score}%` }}
                    />
                </div>
            </div>

            <div className="px-4 py-3">
                {failed.length > 0 ? (
                    <>
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Needs attention
                            </span>
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {failed.length}
                            </span>
                        </div>
                        <div className="space-y-2">
                            {failed.map((criterion) => (
                                <div key={criterion.id} className="rounded-lg border border-border bg-background/50 p-3">
                                    <div className="flex items-start gap-2.5">
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-medium">{criterion.label}</span>
                                                <span className="shrink-0 tabular-nums text-[10px] font-semibold text-muted-foreground">
                                                    {criterion.score}/{criterion.weight}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                                {criterion.fix}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="flex items-center gap-2 py-2 text-xs text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        All citation criteria passed.
                    </div>
                )}

                {passed.length > 0 && failed.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            {passed.length} criteria already passing
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

function SerpResearchPanel({
    brief,
    publicationGates,
    validationErrors,
    validationWarnings,
    onRevalidate,
    isRevalidating,
    onFixIssues,
    isImproving,
}: {
    brief?: SerpCompetitiveBrief | null;
    publicationGates?: Array<{ name: string; status: string; issues?: string[]; warnings?: string[] }> | null;
    validationErrors?: string[] | null;
    validationWarnings?: string[] | null;
    onRevalidate?: () => void;
    isRevalidating?: boolean;
    onFixIssues?: () => void;
    isImproving?: boolean;
}) {
    const issues = [...new Set([
        ...(validationErrors ?? []),
        ...(publicationGates ?? []).flatMap((gate) =>
            gate.status !== "PASS"
                ? [
                    ...(gate.issues ?? []),
                    ...(gate.status === "REVIEW" ? (gate.warnings ?? []) : []),
                ]
                : [],
        ),
    ].map((item) => item.trim()).filter(Boolean))];

    const issueSet = new Set(issues);
    const warnings = [...new Set([
        ...(validationWarnings ?? []),
        ...(publicationGates ?? []).flatMap((gate) => gate.warnings ?? []),
    ].map((item) => item.trim()).filter((item) => item && !issueSet.has(item)))];

    if (!brief) {
        return (
            <section className="rounded-xl border border-amber-500/20 bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Info className="h-4 w-4 text-amber-400" />
                        <h3 className="text-xs font-semibold">SERP research</h3>
                    </div>
                    {onRevalidate && (
                        <button
                            type="button"
                            onClick={() => {
                                if (!isRevalidating) onRevalidate();
                            }}
                            aria-disabled={Boolean(isRevalidating)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                        >
                            {isRevalidating ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <RefreshCw className="h-3 w-3" />
                            )}
                            {isRevalidating ? "Checking…" : "Re-check quality gates"}
                        </button>
                    )}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    No competitive research snapshot is saved for this article. Verify search intent, ranking formats,
                    existing-page overlap, and source-backed differentiation manually before publishing.
                </p>
            </section>
        );
    }

    const intent = brief.intent;
    const analyzed = brief.pages.filter(page => page.scrapeStatus === "ANALYZED");
    const toolShare = brief.dominantFormats.find(format => format.format === "tool")?.share ?? 0;
    const statusTone = brief.retrieval.confidence === "high"
        ? "text-emerald-400"
        : brief.retrieval.confidence === "medium"
            ? "text-amber-400"
            : "text-rose-400";

    return (
        <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-primary" />
                    <h3 className="text-xs font-semibold">SERP competitive research</h3>
                    <span className={`ml-auto text-[10px] font-semibold ${statusTone}`}>
                        {brief.retrieval.confidence.toUpperCase()} CONFIDENCE
                    </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                    Query: <span className="font-medium text-foreground">{brief.keyword}</span>
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                    Researched {brief.researchedAt.slice(0, 10)} · {analyzed.length}/{brief.pages.length} readable result pages · {brief.retrieval.status.toLowerCase()}
                </p>
            </div>

            <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border bg-background/50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Intent</p>
                        <p className="mt-1 text-xs font-semibold capitalize">{intent.label}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{Math.round(intent.confidence * 100)}% confidence</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background/50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Preferred format</p>
                        <p className="mt-1 text-xs font-semibold capitalize">{brief.recommendedFormat.replace(/_/g, " ")}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                            {brief.dominantFormats[0] ? `${Math.round(brief.dominantFormats[0].share * 100)}% of sampled results` : "No dominant format"}
                        </p>
                    </div>
                </div>

                {brief.serpFeatures.length > 0 && (
                    <div>
                        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Observed SERP features</h4>
                        <div className="space-y-2">
                            {brief.serpFeatures.slice(0, 5).map((feature, index) => (
                                <div key={feature.type + index} className="rounded-lg border border-border bg-background/50 p-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="inline-flex items-center rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                                            {formatBriefBadgeLabel("feature", feature.type)}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {formatBriefBadgeLabel("verification", feature.classification)} · {Math.round(feature.confidence * 100)}%
                                        </span>
                                    </div>
                                    <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{feature.description}</p>
                                    {feature.evidence.slice(0, 3).map((item, itemIndex) => (
                                        <p key={itemIndex} className="mt-1 text-[10px] text-muted-foreground">· {item}</p>
                                    ))}
                                    {feature.sourceUrls.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {feature.sourceUrls.slice(0, 3).map(url => (
                                                <a
                                                    key={url}
                                                    href={url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    title={url}
                                                    className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                                                >
                                                    <span>{formatSourceDomainLabel(url)}</span>
                                                    <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden="true" />
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {toolShare >= 0.4 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-300">
                        Interactive tools dominate a material share of this SERP. A conventional article may not complete the main user task; review the appropriate format before publishing.
                    </div>
                )}

                <div>
                    <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Ranking pages analysed ({brief.pages.length})
                    </h4>
                    <div className="space-y-2">
                        {brief.pages.map(page => {
                            const formattedDate = formatPublishedDateLabel(page.publishedAt);
                            return (
                                <div key={page.url} className="rounded-lg border border-border p-2.5">
                                    <div className="flex items-start gap-2">
                                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-muted px-1 text-[10px] font-semibold tabular-nums">
                                            {page.rank}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <a href={page.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[11px] font-medium leading-relaxed text-foreground hover:text-primary hover:underline">
                                                {page.title}
                                            </a>
                                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                                <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium">
                                                    {formatBriefBadgeLabel("pageType", page.pageType)}
                                                </span>
                                                <span>{formatBriefBadgeLabel("scrapeStatus", page.scrapeStatus)}</span>
                                                {formattedDate && <span>· {formattedDate}</span>}
                                            </div>
                                            {page.headings.length > 0 && (
                                                <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                                                    Headings observed: {page.headings.slice(0, 4).join(" · ")}
                                                </p>
                                            )}
                                            {page.snippet && <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">{page.snippet}</p>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Coverage requirements</h4>
                    {brief.requiredCoverage.length > 0 ? (
                        <div className="space-y-2">
                            {brief.requiredCoverage.slice(0, 8).map(item => (
                                <div key={item.topic} className="border-l-2 border-primary/40 pl-2.5">
                                    <p className="text-[11px] font-medium">{item.topic}</p>
                                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        {item.classification.replace(/_/g, " ")} · observed on {item.supportCount}/{item.totalAnalyzed} analysed pages
                                    </p>
                                    {item.observedOn.length > 0 && (
                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                            {item.observedOn.slice(0, 3).map(url => {
                                                const page = brief.pages.find(candidate => candidate.url === url);
                                                return (
                                                    <a
                                                        key={url}
                                                        href={url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        title={page?.title ?? url}
                                                        className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                                                    >
                                                        <span>{formatSourceDomainLabel(url)}</span>
                                                        <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden="true" />
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[11px] text-muted-foreground">No recurring coverage requirement could be established from enough readable result pages.</p>
                    )}
                </div>

                <div>
                    <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reader needs and opportunities</h4>
                    <div className="space-y-2">
                        {brief.opportunities.slice(0, 6).map(opportunity => (
                            <div key={opportunity.id} className="rounded-lg border border-border p-2.5">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-[11px] font-medium leading-relaxed">{opportunity.description}</p>
                                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium ${opportunity.verificationStatus === "observed" ? "border-emerald-500/20 text-emerald-400" : "border-amber-500/20 text-amber-300"}`}>
                                        {formatBriefBadgeLabel("verification", opportunity.verificationStatus)}
                                    </span>
                                </div>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                    Confidence {Math.round(opportunity.confidence * 100)}% · {formatBriefBadgeLabel("opportunity", opportunity.type)}
                                </p>
                                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                                    {formatOpportunityGuidanceForUi(opportunity.additionalValue, opportunity.type, opportunity.sourceUrls.length)}
                                </p>
                                {opportunity.sourceUrls.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {opportunity.sourceUrls.slice(0, 3).map(url => (
                                            <a
                                                key={url}
                                                href={url}
                                                target="_blank"
                                                rel="noreferrer"
                                                title={url}
                                                className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                                            >
                                                <span>{formatSourceDomainLabel(url)}</span>
                                                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden="true" />
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Differentiation plan</h4>
                    <ul className="space-y-1.5">
                        {brief.differentiationPlan.slice(0, 6).map((item, index) => (
                            <li key={index} className="flex items-start gap-2 text-[11px] leading-relaxed">
                                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {brief.siteFit && (
                    <div className="rounded-lg border border-border bg-background/50 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Content action decision</p>
                        <p className="mt-1 text-xs font-semibold">{formatBriefBadgeLabel("action", brief.siteFit.recommendedAction)}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{brief.siteFit.rationale}</p>
                        {brief.siteFit.matchingPageUrl && <a href={brief.siteFit.matchingPageUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] text-primary hover:underline">Open matched site page</a>}
                    </div>
                )}

                {(brief.retrieval.notes.length > 0 || brief.retrieval.scrapeFailures.length > 0) && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">Research limitations</p>
                        <ul className="mt-1 space-y-1">
                            {[...brief.retrieval.notes, ...brief.retrieval.scrapeFailures.map(failure => failure.url + ": " + failure.reason)].slice(0, 8).map((item, index) => (
                                <li key={index} className="text-[10px] leading-relaxed text-muted-foreground">{item}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {(issues.length > 0 || warnings.length > 0) && (
                    <div className="rounded-lg border border-amber-500/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                <AlertTriangle className="h-3 w-3 text-amber-400" />
                                Unresolved quality issues
                            </p>
                            <div className="flex items-center gap-1.5">
                                {issues.length > 0 && onFixIssues && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!isImproving && !isRevalidating) onFixIssues();
                                        }}
                                        aria-disabled={Boolean(isImproving || isRevalidating)}
                                        className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                                    >
                                        {isImproving ? (
                                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                        ) : (
                                            <Zap className="h-2.5 w-2.5" />
                                        )}
                                        {isImproving ? "Fixing…" : "Fix with AI"}
                                    </button>
                                )}
                                {onRevalidate && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!isRevalidating) onRevalidate();
                                        }}
                                        aria-disabled={Boolean(isRevalidating)}
                                        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                                    >
                                        {isRevalidating ? (
                                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-2.5 w-2.5" />
                                        )}
                                        {isRevalidating ? "Checking…" : "Re-check quality gates"}
                                    </button>
                                )}
                            </div>
                        </div>
                        {issues.slice(0, 6).map((item, index) => <p key={"i" + index} className="mt-1 text-[10px] text-rose-300">{item}</p>)}
                        {warnings.slice(0, 6).map((item, index) => <p key={"w" + index} className="mt-1 text-[10px] text-amber-300">{item}</p>)}
                    </div>
                )}
            </div>
        </section>
    );
}

function MetricRow({ label, value, description }: { label: string; value: string; description?: string }) {
    return (
        <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
            <div>
                <div className="text-xs font-medium">{label}</div>
                {description && <div className="mt-0.5 text-[10px] text-muted-foreground">{description}</div>}
            </div>
            <div className="text-sm font-semibold tabular-nums">{value}</div>
        </div>
    );
}

function ChecklistItem({ label, complete }: { label: string; complete: boolean }) {
    return (
        <div className="flex items-center gap-2.5 text-xs">
            {complete ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className={complete ? "text-muted-foreground" : "font-medium text-foreground"}>
                {label}
            </span>
        </div>
    );
}

function SerpAiSimulator({
    blog,
    content,
    onCopy,
    copiedType,
}: {
    blog: Blog;
    content: string;
    onCopy: (type: "markdown" | "html" | "answer") => void;
    copiedType: string | null;
}) {
    const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

    // Clean snippet text
    const snippet = useMemo(() => {
        const text = content
            .replace(/<[^>]*>?/gm, " ")
            .replace(/^#+\s+.*/gm, " ")
            .replace(/\s+/g, " ")
            .trim();
        return text.slice(0, 158);
    }, [content]);

    // Key takeaway bullet points extracted from H2s
    const keyTakeaways = useMemo(() => {
        const h2Matches = content.match(/^##\s+(.+)$/gm) || [];
        return h2Matches.slice(0, 3).map((h) => h.replace(/^##\s+/, "").trim());
    }, [content]);

    const slug = (blog as { slug?: string }).slug ||
        blog.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "");

    return (
        <div className="mx-auto w-full max-w-4xl px-6 py-10 space-y-8">
            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card/60 p-4">
                <div>
                    <h2 className="text-sm font-bold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-400" />
                        Live SERP &amp; AI Citation Simulation
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Real-time visualization of how Google and generative engines represent this page.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onCopy("markdown")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                        {copiedType === "markdown" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                        {copiedType === "markdown" ? "Copied Markdown" : "Copy Markdown"}
                    </button>

                    <button
                        type="button"
                        onClick={() => onCopy("answer")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-500/20"
                    >
                        {copiedType === "answer" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Zap className="h-3.5 w-3.5 text-purple-400" />}
                        {copiedType === "answer" ? "Copied Capsule" : "Copy AI Answer"}
                    </button>
                </div>
            </div>

            {/* Google SERP Snippet Preview */}
            <div className="rounded-2xl border border-border bg-card p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-3">
                    <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-blue-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Google Search Result (Organic Snippet)
                        </h3>
                    </div>
                    <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-[11px]">
                        <button
                            type="button"
                            onClick={() => setDevice("desktop")}
                            className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${device === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            Desktop
                        </button>
                        <button
                            type="button"
                            onClick={() => setDevice("mobile")}
                            className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${device === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            Mobile
                        </button>
                    </div>
                </div>

                {/* Google Card */}
                <div className={`space-y-1.5 ${device === "mobile" ? "max-w-md rounded-xl border border-border/60 bg-background/50 p-4" : ""}`}>
                    {/* Breadcrumbs */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-sans">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400">
                            O
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[12px] font-medium text-foreground leading-tight">Your Site</span>
                            <span className="text-[11px] text-muted-foreground truncate">yoursite.com › blog › {slug}</span>
                        </div>
                    </div>

                    {/* Title */}
                    <h4 className="text-lg font-medium text-blue-400 hover:underline cursor-pointer leading-snug">
                        {blog.title} — OptiAISEO
                    </h4>

                    {/* Meta Description */}
                    <p className="text-xs leading-relaxed text-muted-foreground font-sans">
                        {snippet}...
                    </p>

                    {/* Schema / Rich Enhancements */}
                    <div className="pt-2 flex flex-wrap items-center gap-2 text-[10px]">
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-400">
                            <Check className="h-3 w-3" /> Speakable JSON-LD
                        </span>
                        <span className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 font-medium text-blue-400">
                            Article Schema
                        </span>
                    </div>
                </div>
            </div>

            {/* AI Overview / Perplexity Direct Answer Simulator */}
            <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-b from-purple-500/5 via-card to-card p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-3">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-400 animate-pulse" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300">
                            Google AI Overview &amp; Perplexity Citation Box
                        </h3>
                    </div>
                    <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-300">
                        AEO Synthesized
                    </span>
                </div>

                {/* AI Box Content */}
                <div className="space-y-3 font-sans">
                    <p className="text-xs leading-relaxed text-foreground">
                        <span className="font-bold text-white">Direct Answer: </span>
                        {snippet}.
                        <span className="ml-1 inline-flex items-center rounded-md border border-purple-500/40 bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-300">
                            [1]
                        </span>
                    </p>

                    {keyTakeaways.length > 0 && (
                        <div className="rounded-xl border border-border/80 bg-background/50 p-3.5 space-y-2">
                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                                Key Takeaways Cited by AI Engines:
                            </h5>
                            <ul className="space-y-1.5 text-xs text-muted-foreground">
                                {keyTakeaways.map((point, idx) => (
                                    <li key={idx} className="flex items-start gap-2">
                                        <span className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                                        <span>{point}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Sourced Citation Footnote Card */}
                    <div className="pt-2 flex items-center gap-3">
                        <div className="flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs">
                            <span className="font-bold text-purple-400">[1]</span>
                            <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-foreground truncate max-w-[240px]">{blog.title}</span>
                                <span className="text-[10px] text-muted-foreground font-mono truncate">yoursite.com</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function extractReactText(node: ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractReactText).join("");
    if (node && typeof node === "object" && "props" in node) {
        const props = (node as { props?: { children?: ReactNode } }).props;
        return props?.children ? extractReactText(props.children) : "";
    }
    return "";
}

export function ReviewBlogModal({ blog, onClose, onPublish, onBlogUpdated }: ReviewBlogModalProps) {
    const previewArticleRef = useRef<HTMLElement | null>(null);
    const [mode, setMode] = useState<ReviewMode>("write");
    const [isFullScreen, setIsFullScreen] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);
    const [copiedType, setCopiedType] = useState<string | null>(null);
    const [liveBlog, setLiveBlog] = useState<Blog>(blog);
    const [editedContent, setEditedContent] = useState(blog.content);
    // lastSavedContent tracks what is persisted server-side; hasUnsavedChanges derives from this
    const [lastSavedContent, setLastSavedContent] = useState(blog.content);
    const [scoreResult, setScoreResult] = useState<ContentScoreResult | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isRevalidating, setIsRevalidating] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isImproving, setIsImproving] = useState(false);
    const [improvingStep, setImprovingStep] = useState("");
    const [aiContent, setAiContent] = useState<string | null>(null);
    const [showAiReview, setShowAiReview] = useState(false);
    const [preAiContent, setPreAiContent] = useState<string | null>(null);

    const handlePreviewAnchorClick = useCallback((href: string | undefined, e: ReactMouseEvent<HTMLAnchorElement>) => {
        if (!href) return;
        let hashId = "";
        if (href.startsWith("#")) {
            hashId = href.slice(1);
        } else if (typeof window !== "undefined") {
            try {
                const parsed = new URL(href, window.location.href);
                if (parsed.origin === window.location.origin && parsed.pathname === window.location.pathname && parsed.hash) {
                    hashId = parsed.hash.slice(1);
                }
            } catch {
                // Ignore invalid URL strings
            }
        }
        if (!hashId) return;
        e.preventDefault();
        const container = previewArticleRef.current;
        if (!container) return;
        const decodedId = decodeURIComponent(hashId);
        const target =
            container.querySelector(`[id="${CSS.escape(decodedId)}"]`) ||
            Array.from(container.querySelectorAll("h2, h3")).find(
                (el) => slugifyHeading(el.textContent ?? "") === slugifyHeading(decodedId),
            );
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, []);

    useEffect(() => {
        setLiveBlog((prev) => (prev.id === blog.id ? { ...prev, ...blog } : blog));
    }, [blog]);

    useEffect(() => {
        setLiveBlog(blog);
        setEditedContent(blog.content);
        setLastSavedContent(blog.content);
        setAiContent(null);
        setShowAiReview(false);
        setPreAiContent(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blog.id]);

    const handleCopy = useCallback((type: "markdown" | "html" | "answer") => {
        let textToCopy = "";
        if (type === "markdown") {
            textToCopy = editedContent;
        } else if (type === "html") {
            textToCopy = editedContent;
        } else if (type === "answer") {
            const clean = editedContent.replace(/<[^>]*>?/gm, " ").replace(/^#+\s+.*/gm, " ").replace(/\s+/g, " ").trim();
            textToCopy = clean.slice(0, 300) + "...";
        }
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(textToCopy);
            setCopiedType(type);
            toast.success(`Copied ${type === "markdown" ? "Markdown" : type === "html" ? "Markdown" : "Answer Capsule"} to clipboard`);
            setTimeout(() => setCopiedType(null), 2000);
        }
    }, [editedContent]);

    const citationScore = liveBlog.citationScore ?? null;
    const evidenceCoverage = liveBlog.evidenceCoverage != null ? Math.round(Number(liveBlog.evidenceCoverage)) : 0;
    const validationScore = liveBlog.validationScore != null ? Math.round(Number(liveBlog.validationScore)) : null;
    const citationCriteria: CitationCriterion[] = useMemo(
        () => normalizeCitationCriteria(liveBlog.citationCriteria),
        [liveBlog.citationCriteria]
    );

    // Do not display raw structural citationScore as the overall Content Score.
    // Until live NLP scoring (scoreResult) completes, compute composite readiness
    // factoring in SEO validation (40%), evidence coverage (35%), and citation structure (25%).
    const compositeReadiness = useMemo(() => {
        if (validationScore == null && citationScore == null && liveBlog.evidenceCoverage == null) return null;
        const seoVal = validationScore ?? citationScore ?? 0;
        const ciVal = citationScore ?? validationScore ?? 0;
        return Math.round(0.4 * seoVal + 0.35 * evidenceCoverage + 0.25 * ciVal);
    }, [validationScore, citationScore, liveBlog.evidenceCoverage, evidenceCoverage]);

    const activeScore = scoreResult?.score ?? compositeReadiness;

    const hasUnsavedChanges = useMemo(
        () => editedContent !== lastSavedContent,
        [editedContent, lastSavedContent]
    );

    const unresolvedGateIssues = useMemo(() => {
        const deduped = new Set<string>();
        for (const err of liveBlog.validationErrors ?? []) {
            if (typeof err === "string" && err.trim().length > 0) {
                deduped.add(err.trim());
            }
        }
        for (const gate of liveBlog.publicationGates ?? []) {
            if (gate.status !== "PASS") {
                for (const issue of gate.issues ?? []) {
                    if (typeof issue === "string" && issue.trim().length > 0) {
                        deduped.add(issue.trim());
                    }
                }
            }
        }
        return Array.from(deduped);
    }, [liveBlog.validationErrors, liveBlog.publicationGates]);

    const hasBlockingErrors = useMemo(
        () =>
            unresolvedGateIssues.length > 0 ||
            liveBlog.status === "EVIDENCE_REVIEW" ||
            liveBlog.status === "REJECTED",
        [unresolvedGateIssues.length, liveBlog.status]
    );

    const failedCitationCriteria = useMemo(
        () => citationCriteria.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight),
        [citationCriteria]
    );

    const issueCount =
        unresolvedGateIssues.length +
        failedCitationCriteria.length +
        (scoreResult?.topOpportunities?.length ?? 0);

    const scoreState = activeScore !== null
        ? getScoreState(activeScore)
        : { label: "Not analyzed", shortLabel: "Not analyzed", tone: "warning" as const };

    const headerTone = toneClasses(scoreState.tone);

    useEffect(() => {
        if (!showAiReview) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setShowAiReview(false);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [showAiReview]);

    const handleContentChange = useCallback((c: string) => setEditedContent(c), []);
    const handleScoreChange = useCallback((s: ContentScoreResult | null) => setScoreResult(s), []);

    const applyUpdatedBlog = useCallback(
        (updatedData: Partial<Blog> | undefined, fallbackContent?: string) => {
            const nextBlog: Blog = updatedData
                ? {
                    ...liveBlog,
                    ...updatedData,
                    content: updatedData.content ?? fallbackContent ?? liveBlog.content,
                }
                : {
                    ...liveBlog,
                    content: fallbackContent ?? liveBlog.content,
                };
            setLiveBlog(nextBlog);
            onBlogUpdated?.(nextBlog);
        },
        [liveBlog, onBlogUpdated]
    );

    const handleSaveEdits = useCallback(async () => {
        if (!hasUnsavedChanges || isSaving || isRevalidating) return;
        setIsSaving(true);
        try {
            const res = await fetch(`/api/blogs/${liveBlog.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: editedContent }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Failed to save edits");
            setLastSavedContent(editedContent);
            applyUpdatedBlog(data.blog as Partial<Blog> | undefined, editedContent);
            toast.success("Draft saved & quality gates re-checked");
        } catch (error) {
            logger.error("Failed to save blog edits", { error: (error as Error)?.message || error });
            toast.error("Couldn't save the draft");
        } finally {
            setIsSaving(false);
        }
    }, [applyUpdatedBlog, editedContent, hasUnsavedChanges, isRevalidating, isSaving, liveBlog.id]);

    const handleRevalidate = useCallback(async () => {
        if (isRevalidating || isSaving || isPublishing) return;
        setIsRevalidating(true);
        try {
            const res = await fetch(
                hasUnsavedChanges
                    ? `/api/blogs/${liveBlog.id}`
                    : `/api/blogs/${liveBlog.id}/revalidate`,
                {
                    method: hasUnsavedChanges ? "PATCH" : "POST",
                    headers: hasUnsavedChanges ? { "Content-Type": "application/json" } : undefined,
                    body: hasUnsavedChanges ? JSON.stringify({ content: editedContent }) : undefined,
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Failed to re-check quality gates");
            if (hasUnsavedChanges) {
                setLastSavedContent(editedContent);
            }
            applyUpdatedBlog(data.blog as Partial<Blog> | undefined, hasUnsavedChanges ? editedContent : undefined);
            toast.success("Quality gates re-checked");
        } catch (error) {
            logger.error("Failed to re-check quality gates", { error: (error as Error)?.message || error });
            toast.error(error instanceof Error ? error.message : "Couldn't re-check quality gates");
        } finally {
            setIsRevalidating(false);
        }
    }, [applyUpdatedBlog, editedContent, hasUnsavedChanges, isPublishing, isRevalidating, isSaving, liveBlog.id]);

    const handleAIImprove = useCallback(async () => {
        if (isImproving || isPublishing) return;
        setIsImproving(true);
        setImprovingStep("Analyzing issues…");
        try {
            const issues: string[] = [];
            if (scoreResult) {
                if (scoreResult.topOpportunities?.length) issues.push(...scoreResult.topOpportunities);
                const missingTerms = scoreResult.subScores?.nlpTerms?.missing;
                if (missingTerms?.length) issues.push(`Add missing semantic terms: ${missingTerms.join(", ")}`);
                const missingHeadings = scoreResult.subScores?.headings?.missing;
                if (missingHeadings?.length) issues.push(`Add missing headings: ${missingHeadings.join(", ")}`);
            }

            setImprovingStep("Preparing citation fixes…");
            const citationIssues = failedCitationCriteria
                .map((c) => `[CITATION] ${c.fix}`);

            const combinedIssues = Array.from(
                new Set(
                    [...unresolvedGateIssues, ...issues, ...citationIssues]
                        .map((item) => item.trim().slice(0, 480))
                        .filter(Boolean)
                )
            ).slice(0, 20);

            setImprovingStep("Rewriting content…");
            const res = await fetch(`/api/blogs/${liveBlog.id}/improve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    issues: combinedIssues,
                    citationScore,
                    scoreData: scoreResult
                        ? {
                            wordCount: scoreResult.subScores?.wordCount,
                            keywords: scoreResult.subScores?.exactKeywords,
                            readabilityGrade: scoreResult.subScores?.readability?.gradeLevel,
                            missingTerms: scoreResult.subScores?.nlpTerms?.missing,
                            missingHeadings: scoreResult.subScores?.headings?.missing,
                        }
                        : null,
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "AI improvement failed");
            }

            setImprovingStep("Reviewing changes…");
            const data = await res.json();
            if (!data.content) throw new Error("AI returned no content");

            setAiContent(data.content);
            setShowAiReview(true);

            if (data.truncated) {
                toast.warning("Content was truncated for AI processing — review carefully for completeness.");
            }
            if (data.warnings?.length) {
                data.warnings.forEach((w: string) => toast.warning(w));
            }

            toast.success("AI improvement is ready to review");
        } catch (error) {
            const msg = error instanceof Error ? error.message : "AI improvement failed.";
            const userMsg = msg.includes("429") || msg.includes("rate")
                ? "AI is busy — please try again in a moment."
                : msg.includes("too long") || msg.includes("token")
                    ? "Article is too long for a single pass. Try improving one section at a time."
                    : msg;
            logger.error("AI improvement failed", { error: msg });
            toast.error(userMsg);
        } finally {
            setIsImproving(false);
            setImprovingStep("");
        }
    }, [citationScore, failedCitationCriteria, isImproving, isPublishing, liveBlog.id, scoreResult, unresolvedGateIssues]);

    const acceptAiChanges = useCallback(() => {
        if (!aiContent) return;
        setPreAiContent(editedContent);
        setEditedContent(aiContent);
        setAiContent(null);
        setShowAiReview(false);
        setMode("write");
        toast.success("AI changes applied to draft", {
            action: {
                label: "Undo",
                onClick: () => {
                    setEditedContent(preAiContent ?? liveBlog.content);
                    setPreAiContent(null);
                    toast.info("AI changes reverted");
                },
            },
            duration: 8000,
        });
    }, [aiContent, editedContent, preAiContent, liveBlog.content]);

    const rejectAiChanges = useCallback(() => {
        setAiContent(null);
        setShowAiReview(false);
        toast("AI suggestions discarded");
    }, []);

    const publishBlockReason = hasUnsavedChanges
        ? "Save your changes before publishing"
        : hasBlockingErrors
            ? "Resolve blocking quality gate issues before publishing"
            : activeScore !== null && activeScore < 60
                ? "Improve readiness score before publishing"
                : null;

    const isPublishDisabled =
        isPublishing ||
        isSaving ||
        isRevalidating ||
        publishBlockReason !== null;

    const handlePublish = useCallback(async () => {
        if (isPublishDisabled) return;
        setIsPublishing(true);
        try {
            const result = await onPublish(liveBlog.id);
            if (result.success) {
                onClose();
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Couldn't publish this article";
            logger.error("Publishing failed", { error: msg });
            toast.error(msg);
        } finally {
            setIsPublishing(false);
        }
    }, [isPublishDisabled, liveBlog.id, onClose, onPublish]);

    const statusLabel =
        liveBlog.status === "PUBLISHED"
            ? "Published"
            : liveBlog.status === "EVIDENCE_REVIEW"
                ? "Needs review"
                : liveBlog.status === "REJECTED"
                    ? "Rejected"
                    : "Draft";

    return (
        <div className={isFullScreen ? "fixed inset-0 z-50 bg-background" : "fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-6"}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="review-blog-modal-title"
                className={isFullScreen ? "flex h-full w-full flex-col" : "relative flex h-full max-h-[94vh] w-full max-w-7xl flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"}
            >
                {/* ── Top bar ── */}
                <header className="flex h-16 shrink-0 items-center border-b border-border bg-card">
                    <div className="flex min-w-0 flex-1 items-center gap-3 px-5">
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close review dialog"
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsFullScreen((s) => !s)}
                            aria-label={isFullScreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                            title={isFullScreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {isFullScreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
                        </button>

                        <div className="h-6 w-px bg-border" />

                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1 id="review-blog-modal-title" className="truncate text-sm font-semibold">{liveBlog.title}</h1>
                                <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {statusLabel}
                                </span>
                                {(liveBlog.pipelineType === "CONTENT_REFRESH" || liveBlog.sourceUrl) && (
                                    <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                                        Page Refresh
                                    </span>
                                )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>
                                    Target:{" "}
                                    <span className="font-medium text-foreground/80">
                                        {formatKeywordDisplay(liveBlog.targetKeywords?.[0]) || "No target keyword"}
                                    </span>
                                </span>
                                {liveBlog.sourceUrl && (
                                    <>
                                        <span>·</span>
                                        <span className="truncate font-mono text-[10px] text-amber-300/90" title={liveBlog.sourceUrl}>
                                            {liveBlog.sourceUrl}
                                        </span>
                                    </>
                                )}
                                <span>·</span>
                                <span className="flex items-center gap-1">
                                    <Clock3 className="h-3 w-3" aria-hidden="true" />
                                    {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Readiness & Evidence pills */}
                    <div className="mr-4 flex items-center gap-2">
                        <div className={`hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${evidenceCoverage >= 80
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : evidenceCoverage >= 50
                                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                            }`}>
                            {evidenceCoverage >= 80 ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="text-[11px] font-semibold">Evidence: {evidenceCoverage}%</span>
                        </div>
                        {activeScore !== null && (
                            <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${headerTone.bg} ${headerTone.border}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${headerTone.bar}`} aria-hidden="true" />
                                <span className={`text-xs font-semibold ${headerTone.text}`}>{activeScore}/100</span>
                                <span className="text-[11px] text-muted-foreground">{scoreState.shortLabel}</span>
                            </div>
                        )}
                    </div>

                    {/* Sidebar toggle for mobile/tablet */}
                    <button
                        type="button"
                        onClick={() => setShowSidebar(s => !s)}
                        className="mr-2 xl:hidden flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline">Optimize</span>
                    </button>

                    {/* Mode switch */}
                    <div className="mr-4 flex rounded-lg border border-border bg-background p-1">
                        <button
                            type="button"
                            onClick={() => setMode("write")}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === "write" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                            Write
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("review")}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === "review" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            Review
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("simulate")}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === "simulate" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            <Sparkles className="h-3.5 w-3.5 text-purple-400" aria-hidden="true" />
                            SERP &amp; AI
                        </button>
                    </div>
                </header>

                {/* ── Main workspace ── */}
                <main className="flex min-h-0 flex-1">
                    {/* Article area */}
                    <section className="min-w-0 flex-1 overflow-y-auto bg-background">
                        {mode === "write" ? (
                            <div className="mx-auto h-full w-full max-w-5xl px-6 py-8 lg:px-10">
                                <ContentEditor
                                    initialContent={editedContent}
                                    initialKeyword={liveBlog.targetKeywords?.[0] || ""}
                                    blogId={liveBlog.id}
                                    onContentChange={handleContentChange}
                                    onScoreChange={handleScoreChange}
                                />
                            </div>
                        ) : mode === "review" ? (
                            <div className="mx-auto w-full max-w-4xl px-8 py-12">
                                <article
                                    ref={previewArticleRef}
                                    className="prose prose-invert prose-emerald max-w-none prose-headings:scroll-m-20 prose-img:w-full prose-img:rounded-xl prose-img:object-cover"
                                >
                                    <h1>{liveBlog.title}</h1>
                                    <div className="not-prose mb-8 flex items-center gap-3 border-b border-border pb-5 text-xs text-muted-foreground">
                                        <span>{statusLabel}</span>
                                        <span>·</span>
                                        <span>{formatKeywordDisplay(liveBlog.targetKeywords?.[0]) || "No target keyword"}</span>
                                    </div>
                                    <ReactMarkdown
                                        rehypePlugins={[
                                            rehypeRaw,
                                            [rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] }],
                                        ]}
                                        components={{
                                            h2: ({ id, children, ...props }) => (
                                                <h2 id={id || slugifyHeading(extractReactText(children))} {...props}>
                                                    {children}
                                                </h2>
                                            ),
                                            h3: ({ id, children, ...props }) => (
                                                <h3 id={id || slugifyHeading(extractReactText(children))} {...props}>
                                                    {children}
                                                </h3>
                                            ),
                                            a: ({ href, onClick, children, ...props }) => (
                                                <a
                                                    href={href}
                                                    onClick={(e) => {
                                                        handlePreviewAnchorClick(href, e);
                                                        onClick?.(e);
                                                    }}
                                                    {...props}
                                                >
                                                    {children}
                                                </a>
                                            ),
                                        }}
                                    >
                                        {editedContent}
                                    </ReactMarkdown>
                                </article>
                            </div>
                        ) : (
                            <SerpAiSimulator
                                blog={liveBlog}
                                content={editedContent}
                                onCopy={handleCopy}
                                copiedType={copiedType}
                            />
                        )}
                    </section>

                    {/* ── Sidebar ── */}
                    <aside className={`${showSidebar ? "absolute inset-y-0 right-0 z-40 w-[360px]" : "hidden"} xl:relative xl:block w-[360px] shrink-0 overflow-y-auto border-l border-border bg-card/95 xl:bg-card/40 backdrop-blur-sm xl:backdrop-blur-none`}>
                        <div className="space-y-4 p-4">
                            <div>
                                <h2 className="text-sm font-semibold">Optimization</h2>
                                <p className="mt-1 text-xs text-muted-foreground">Review the article before publishing.</p>
                            </div>

                            {/* Surfer SEO Style Content Radar */}
                            <ScoreRadarGauge
                                score={activeScore}
                                label="Content Optimization Score"
                                size="md"
                                subScores={scoreResult?.subScores}
                                imageRecommendation={scoreResult?.imageRecommendation}
                                topOpportunities={scoreResult?.topOpportunities}
                            />

                            {citationScore !== null && citationCriteria.length > 0 ? (
                                <ReadinessCard score={citationScore} criteria={citationCriteria} />
                            ) : null}

                            {/* AI improve action */}
                            {issueCount > 0 ? (
                                <section className="rounded-xl border border-brand/20 bg-brand/[0.04] p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-xs font-semibold">Recommended improvements</h3>
                                            <ul className="mt-1.5 space-y-1">
                                                {unresolvedGateIssues.slice(0, 2).map((issue, i) => (
                                                    <li key={`g-${i}`} className="text-[11px] leading-relaxed text-rose-300 flex items-start gap-1.5">
                                                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" aria-hidden="true" />
                                                        <span>{issue}</span>
                                                    </li>
                                                ))}
                                                {failedCitationCriteria.slice(0, 2).map((c, i) => (
                                                    <li key={i} className="text-[11px] leading-relaxed text-muted-foreground flex items-start gap-1.5">
                                                        <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-rose-400" aria-hidden="true" />
                                                        <span>{c.fix}</span>
                                                    </li>
                                                ))}
                                                {scoreResult?.topOpportunities?.slice(0, 2).map((o, i) => (
                                                    <li key={`o-${i}`} className="text-[11px] leading-relaxed text-muted-foreground flex items-start gap-1.5">
                                                        <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                                                        <span>{o}</span>
                                                    </li>
                                                ))}
                                                {(() => {
                                                    const shownCount =
                                                        Math.min(unresolvedGateIssues.length, 2) +
                                                        Math.min(failedCitationCriteria.length, 2) +
                                                        Math.min(scoreResult?.topOpportunities?.length ?? 0, 2);
                                                    const remainingCount = issueCount - shownCount;
                                                    return remainingCount > 0 ? (
                                                        <li className="text-[10px] text-muted-foreground/60">
                                                            +{remainingCount} more issue{remainingCount > 1 ? "s" : ""}
                                                        </li>
                                                    ) : null;
                                                })()}
                                            </ul>
                                        </div>
                                    </div>
                                    <p className="mt-3 text-[10px] text-muted-foreground/70">
                                        AI will rewrite your content to fix these — you review a diff before applying.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleAIImprove}
                                        aria-disabled={isImproving || isPublishing}
                                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                                    >
                                        {isImproving ? (
                                            <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{improvingStep || "Improving…"}</>
                                        ) : (
                                            <><Zap className="h-3.5 w-3.5" aria-hidden="true" />Fix {issueCount} issue{issueCount !== 1 ? "s" : ""} with AI</>
                                        )}
                                    </button>
                                </section>
                            ) : !hasBlockingErrors && activeScore !== null && activeScore < 95 ? (
                                <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                                            <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-xs font-semibold text-emerald-400">Looking good!</h3>
                                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                                No critical issues found. AI can still fine-tune for a higher score.
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAIImprove}
                                        aria-disabled={isImproving || isPublishing}
                                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                                    >
                                        {isImproving ? (
                                            <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{improvingStep || "Fine-tuning…"}</>
                                        ) : (
                                            <><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Fine-tune with AI</>
                                        )}
                                    </button>
                                </section>
                            ) : null}

                            <RefreshSummaryPanel blog={liveBlog} />

                            <SerpResearchPanel
                                brief={liveBlog.serpCompetitiveBrief}
                                publicationGates={liveBlog.publicationGates}
                                validationErrors={liveBlog.validationErrors}
                                validationWarnings={liveBlog.validationWarnings}
                                onRevalidate={handleRevalidate}
                                isRevalidating={isRevalidating || isSaving}
                                onFixIssues={handleAIImprove}
                                isImproving={isImproving || isPublishing}
                            />

                            {/* Publishing checklist */}
                            <section className="rounded-xl border border-border bg-card p-4">
                                <div className="mb-3 flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                    <h3 className="text-xs font-semibold">Publishing checklist</h3>
                                </div>
                                <div className="space-y-2.5">
                                    <ChecklistItem label="Content reviewed" complete={editedContent.trim().length > 0} />
                                    <ChecklistItem
                                        label="Optimization analyzed"
                                        complete={scoreResult !== null || citationScore !== null}
                                    />
                                    <ChecklistItem label="Changes saved" complete={!hasUnsavedChanges} />
                                    <ChecklistItem label="Quality gates passed" complete={!hasBlockingErrors} />
                                    <ChecklistItem
                                        label="Citation ready"
                                        complete={activeScore !== null && activeScore >= 60}
                                    />
                                </div>
                            </section>
                        </div>
                    </aside>
                </main>

                {/* ── Footer ── */}
                <footer className="flex h-16 shrink-0 items-center justify-between border-t border-border bg-card px-5">
                    <div className="flex items-center gap-3">
                        {hasUnsavedChanges ? (
                            <span className="flex items-center gap-2 text-xs text-amber-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                                Unsaved changes
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                                All changes saved
                            </span>
                        )}

                        {mode === "write" && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleSaveEdits}
                                    aria-disabled={!hasUnsavedChanges || isSaving || isRevalidating}
                                    aria-describedby="save-draft-status"
                                    className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                    ) : (
                                        <Save className="h-3.5 w-3.5" aria-hidden="true" />
                                    )}
                                    {isSaving ? "Saving..." : "Save draft"}
                                </button>
                                <span id="save-draft-status" className="sr-only">
                                    {isSaving
                                        ? "Saving draft and re-checking quality gates"
                                        : hasUnsavedChanges
                                            ? "Save your latest edits and re-check quality gates"
                                            : "No unsaved changes to save"}
                                </span>
                            </>
                        )}

                        <button
                            type="button"
                            onClick={handleRevalidate}
                            aria-disabled={isRevalidating || isSaving || isPublishing}
                            aria-describedby="recheck-gates-help"
                            className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                        >
                            {isRevalidating ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {isRevalidating ? "Checking..." : "Re-check"}
                        </button>
                        <span id="recheck-gates-help" className="sr-only">
                            Re-runs quality gates and evidence checks{hasUnsavedChanges ? " after saving unsaved changes" : ""}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            Close
                        </button>

                        <button
                            type="button"
                            onClick={handlePublish}
                            aria-disabled={isPublishDisabled}
                            aria-describedby="publish-gate-status"
                            title={publishBlockReason ?? "Publish article"}
                            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                        >
                            {isPublishing ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Publishing...</>
                            ) : (
                                <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Publish</>
                            )}
                        </button>
                        <span id="publish-gate-status" className="sr-only">
                            {publishBlockReason ?? "All readiness and quality gate checks passed; ready to publish"}
                        </span>
                    </div>
                </footer>
            </div>

            {/* ── Notion/Lex-Style AI diff panel ── */}
            {showAiReview && aiContent && (
                <AiDiffInspector
                    originalContent={editedContent}
                    aiContent={aiContent}
                    scoreBefore={activeScore}
                    onAccept={(merged) => {
                        setEditedContent(merged);
                        setAiContent(null);
                        setShowAiReview(false);
                        setMode("write");
                        toast.success("AI changes applied to draft");
                    }}
                    onReject={rejectAiChanges}
                    title="Review AI Improvements"
                    subtitle={`Addressing ${issueCount} detected content & citation issue${issueCount !== 1 ? "s" : ""}. Review the diff below.`}
                />
            )}
        </div>
    );
}
