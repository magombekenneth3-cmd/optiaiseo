/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
    ChevronDown,
    ChevronRight,
    Wrench,
    Loader2,
    Copy,
    Check,
    ExternalLink,
    GitBranch,
    AlertCircle,
    Github,
    BookOpen,
    Zap,
} from "lucide-react";
import {
    getFixRequirements,
    triggerAutoFix,
    pushAuditFixPR,
    type ContextField,
    type ManualFixGuide,
} from "@/app/actions/auditFix";
import { PrReviewModal, type PrReviewPayload } from "@/components/PrReviewModal";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";

// ── Types ─────────────────────────────────────────────────────────────────────

type FixState =
    | { status: "idle" }
    | { status: "analyzing" }
    | { status: "needs_context"; fields: ContextField[] }
    | { status: "fixing" }
    | { status: "review"; payload: PrReviewPayload }
    | { status: "pushing" }
    | { status: "done_pr"; prUrl: string }
    | { status: "done_manual"; guide: ManualFixGuide }
    | { status: "error"; message: string };

// ── Severity config ───────────────────────────────────────────────────────────

const SEV_CONFIG: Record<string, { label: string; barCls: string; badgeCls: string; dotCls: string }> = {
    error: {
        label: "Error",
        barCls: "bg-red-500",
        badgeCls: "bg-red-500/10 text-red-400 border-red-500/30",
        dotCls: "bg-red-400",
    },
    warning: {
        label: "Warning",
        barCls: "bg-yellow-500",
        badgeCls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
        dotCls: "bg-yellow-400",
    },
    info: {
        label: "Info",
        barCls: "bg-blue-500",
        badgeCls: "bg-blue-500/10 text-blue-400 border-blue-500/30",
        dotCls: "bg-blue-400",
    },
};

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-foreground transition-colors"
            title="Copy to clipboard"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
}

// ── ManualGuidePanel ──────────────────────────────────────────────────────────

function ManualGuidePanel({ guide }: { guide: ManualFixGuide }) {
    return (
        <div className="space-y-4 mt-2">
            <div>
                <h5 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                    Steps to fix
                </h5>
                <ol className="space-y-2.5">
                    {guide.steps.map((step: string, i: number) => (
                        <li key={i} className="flex gap-3 items-start">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold flex items-center justify-center mt-0.5 border border-emerald-500/20">
                                {i + 1}
                            </span>
                            <p className="text-sm text-foreground/80 leading-relaxed">{step}</p>
                        </li>
                    ))}
                </ol>
            </div>

            {guide.codeSnippet && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h5 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                            Code to copy
                        </h5>
                        {guide.filePath && (
                            <span className="text-[10px] font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border">
                                {guide.filePath}
                            </span>
                        )}
                    </div>
                    <div className="relative">
                        <pre className="text-xs text-foreground/80 bg-zinc-950/80 border border-zinc-700/60 rounded-xl p-4 pr-10 overflow-x-auto leading-relaxed font-mono">
                            <code>{guide.codeSnippet}</code>
                        </pre>
                        <CopyButton text={guide.codeSnippet} />
                    </div>
                </div>
            )}

            {guide.docsUrl && (
                <a
                    href={guide.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors hover:underline"
                >
                    <BookOpen className="w-3.5 h-3.5" />
                    Read the official documentation →
                </a>
            )}
        </div>
    );
}

// ── ContextForm ───────────────────────────────────────────────────────────────

function ContextForm({
    fields,
    onSubmit,
    onSkip,
    isSubmitting,
}: {
    fields: ContextField[];
    onSubmit: (data: Record<string, string>) => void;
    onSkip: () => void;
    isSubmitting: boolean;
}) {
    const [values, setValues] = useState<Record<string, string>>({});

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(values);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
            <div className="flex items-start gap-2 text-xs text-yellow-300/80 bg-yellow-500/5 border border-yellow-500/15 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-yellow-400" />
                <span>
                    To generate the best fix, the AI needs a bit more context. Fill in what you can — skip fields you&apos;re unsure about.
                </span>
            </div>

            {fields.map((field) => (
                <div key={field.key}>
                    <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                        {field.label}
                        {field.required && <span className="text-rose-400 ml-1">*</span>}
                    </label>
                    <input
                        type="text"
                        placeholder={field.placeholder}
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full bg-background/60 border border-border focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 rounded-lg px-3 py-2 text-sm transition-all text-foreground placeholder:text-muted-foreground outline-none"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">{field.why}</p>
                </div>
            ))}

            <div className="flex gap-2 pt-1">
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-foreground text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…
                        </>
                    ) : (
                        "Generate fix →"
                    )}
                </button>
                <button
                    type="button"
                    onClick={onSkip}
                    disabled={isSubmitting}
                    className="px-4 py-2 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-zinc-600 rounded-lg transition-colors"
                >
                    Skip
                </button>
            </div>
        </form>
    );
}

// ── IssueRow ──────────────────────────────────────────────────────────────────

export function IssueRow({
    issue,
    siteId,
    domain,
    hasGithub,
    fixStatus,
}: {
    issue: any;
    siteId: string;
    domain: string;
    hasGithub: boolean;
    fixStatus?: string;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [fixState, setFixState] = useState<FixState>({ status: "idle" });

    const sev = issue.severity ?? issue.type ?? "info";
    const meta = SEV_CONFIG[sev] ?? SEV_CONFIG.info;

    const title = issue.title ?? issue.description ?? issue.message ?? JSON.stringify(issue);
    const hasFix = !!(issue.fixSuggestion || issue.recommendation);
    const isFixRunning =
        fixState.status === "analyzing" ||
        fixState.status === "fixing" ||
        fixState.status === "pushing";

    const handleStartFix = useCallback(async () => {
        setFixState({ status: "analyzing" });
        const { fields } = await getFixRequirements(domain, issue);
        if (fields.length > 0) {
            setFixState({ status: "needs_context", fields });
        } else {
            await runFix({});
        }
    }, [domain, issue]);

    const runFix = useCallback(
        async (extraContext: Record<string, string>) => {
            setFixState({ status: "fixing" });
            try {
                const result = await triggerAutoFix(siteId, domain, issue, extraContext);
                if (!result.success) {
                    setFixState({ status: "error", message: result.error });
                    return;
                }
                if (result.mode === "review") {
                    setFixState({
                        status: "review",
                        payload: {
                            filePath: result.filePath,
                            content: result.content,
                            language: result.language,
                            issueLabel: result.issueLabel,
                        },
                    });
                } else if (result.mode === "pr") {
                    setFixState({ status: "done_pr", prUrl: result.prUrl });
                    toast.success("Pull Request opened on GitHub! 🎉");
                } else {
                    setFixState({ status: "done_manual", guide: result.guide });
                }
            } catch (e: unknown) {
                setFixState({ status: "error", message: (e as Error)?.message ?? "Unexpected error" });
            }
        },
        [siteId, domain, issue, hasGithub]
    );

    const handleConfirmPR = useCallback(
        async (editedContent: string) => {
            if (fixState.status !== "review") return;
            const { payload } = fixState;
            setFixState({ status: "pushing" });
            try {
                const result = await pushAuditFixPR(siteId, payload.filePath, editedContent, payload.issueLabel);
                if (!result.success) {
                    setFixState({ status: "error", message: result.error });
                    return;
                }
                setFixState({ status: "done_pr", prUrl: result.prUrl });
                toast.success("Pull Request opened on GitHub! 🎉");
            } catch (e: unknown) {
                setFixState({ status: "error", message: (e as Error)?.message ?? "Unexpected error" });
            }
        },
        [fixState, siteId]
    );

    return (
        <>
            {fixState.status === "review" && (
                <PrReviewModal
                    payload={fixState.payload}
                    onConfirm={handleConfirmPR}
                    onCancel={() => setFixState({ status: "idle" })}
                />
            )}

            {/* ── Row wrapper — left-border coloured by severity ── */}
            <div
                className={`border-l-2 transition-colors ${sev === "error"
                    ? "border-l-red-500"
                    : sev === "warning"
                        ? "border-l-yellow-500/60"
                        : "border-l-blue-500/40"
                    } bg-background hover:bg-card/40`}
            >
                {/* ── Main clickable row ── */}
                <div
                    className="px-5 py-3.5 flex items-start gap-4 cursor-pointer"
                    onClick={() => setIsExpanded((v) => !v)}
                >
                    {/* Severity + category badges */}
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5 flex-wrap">
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${meta.badgeCls} whitespace-nowrap`}>
                            {meta.label}
                        </span>
                        <Badge variant="neutral" className="text-[10px] font-semibold uppercase whitespace-nowrap">
                            {issue.category || "SEO"}
                        </Badge>
                    </div>

                    {/* Title + description */}
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm leading-snug">{title}</p>
                        {issue.description && issue.title && (
                            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5 line-clamp-1">
                                {issue.description}
                            </p>
                        )}
                        {/* Impact badges inline */}
                        {(issue.roiImpact > 0 || issue.aiVisibilityImpact > 0) && (
                            <div className="flex items-center gap-2 mt-1.5">
                                {issue.roiImpact > 0 && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/5 text-[10px] font-semibold text-emerald-400 whitespace-nowrap">
                                        <Zap className="w-2.5 h-2.5" />
                                        ROI {issue.roiImpact}%
                                    </span>
                                )}
                                {issue.aiVisibilityImpact > 0 && (
                                    <span className="px-1.5 py-0.5 rounded border border-blue-500/20 bg-blue-500/5 text-[10px] font-semibold text-blue-400 whitespace-nowrap">
                                        AI vis {issue.aiVisibilityImpact}%
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Fix CTA */}
                        {fixState.status === "idle" && (() => {
                            const isPending = fixStatus === "PENDING" || fixStatus === "IN_PROGRESS";
                            const isActive = fixStatus === "COMPLETED" || fixStatus == null;
                            return (
                                <button
                                    onClick={(e) => {
                                        if (!isActive) return;
                                        e.stopPropagation();
                                        setIsExpanded(true);
                                        handleStartFix();
                                    }}
                                    disabled={!isActive}
                                    title={
                                        isPending
                                            ? "Fix is already being applied"
                                            : "Get a targeted AI-generated fix for this issue"
                                    }
                                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${isActive
                                        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 active:scale-95"
                                        : "bg-zinc-500/10 border-zinc-500/20 text-muted-foreground cursor-not-allowed opacity-50"
                                        }`}
                                >
                                    <Wrench className="w-3.5 h-3.5" />
                                    Fix this
                                </button>
                            );
                        })()}

                        {/* Running spinner */}
                        {isFixRunning && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                {fixState.status === "pushing" ? "Opening PR…" : "Fixing…"}
                            </span>
                        )}

                        {/* Done */}
                        {(fixState.status === "done_pr" || fixState.status === "done_manual") && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                <Check className="w-3.5 h-3.5" /> Fixed
                            </span>
                        )}

                        {/* Expand toggle */}
                        <button
                            className="flex items-center justify-center w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded((v) => !v);
                            }}
                            title={isExpanded ? "Collapse" : "Expand details"}
                        >
                            {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </div>
                </div>

                {/* ── Expanded panel ── */}
                {isExpanded && (
                    <div className="mx-5 mb-4 space-y-3">

                        {/* Recommendation */}
                        {hasFix && fixState.status === "idle" && (
                            <div className="rounded-xl border border-border/60 bg-card/40 p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                        Recommendation
                                    </h4>
                                </div>
                                <p className="text-sm text-foreground/80 leading-relaxed">
                                    {issue.fixSuggestion || issue.recommendation}
                                </p>
                                {issue.url && (
                                    <a
                                        href={issue.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center mt-3 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                                    >
                                        <ExternalLink className="w-3 h-3" /> Read documentation
                                    </a>
                                )}
                            </div>
                        )}

                        {/* GitHub upsell */}
                        {!hasGithub && fixState.status === "idle" && (
                            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground">
                                <Github className="w-4 h-4 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-semibold text-foreground mb-0.5">No GitHub connected</p>
                                    <p>The AI will generate exact steps and copyable code — no GitHub required.</p>
                                    <Link
                                        href="/dashboard/sites"
                                        className="inline-flex items-center gap-1 mt-1 text-muted-foreground hover:text-foreground hover:underline"
                                    >
                                        Connect GitHub for 1-click auto-fix <ExternalLink className="w-3 h-3" />
                                    </Link>
                                </div>
                            </div>
                        )}

                        {/* AI Fix panel */}
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
                            <div className="flex items-center gap-2 mb-4">
                                <Wrench className="w-4 h-4 text-emerald-400" />
                                <h4 className="text-sm font-semibold text-emerald-400">AI fix assistant</h4>
                                {hasGithub && (
                                    <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-emerald-400/60">
                                        <GitBranch className="w-3 h-3" /> Auto-PR mode
                                    </span>
                                )}
                            </div>

                            {fixState.status === "idle" && (
                                <div className="flex justify-end">
                                    <button
                                        onClick={handleStartFix}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors shadow-lg shadow-emerald-500/20 active:scale-95"
                                    >
                                        Apply AI fix auto-magically 🪄
                                    </button>
                                </div>
                            )}

                            {fixState.status === "analyzing" && (
                                <div className="flex items-center gap-3 text-sm text-muted-foreground py-1">
                                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                                    <span>Analyzing what&apos;s needed to fix this issue…</span>
                                </div>
                            )}

                            {fixState.status === "needs_context" && (
                                <ContextForm
                                    fields={fixState.fields}
                                    onSubmit={runFix}
                                    onSkip={() => runFix({})}
                                    isSubmitting={false}
                                />
                            )}

                            {(fixState.status === "fixing" || fixState.status === "pushing") && (
                                <div className="flex items-center gap-3 text-sm text-muted-foreground py-1">
                                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                                    <span>
                                        {fixState.status === "pushing"
                                            ? "Opening pull request on GitHub…"
                                            : hasGithub
                                                ? "Generating code fix…"
                                                : "Generating your step-by-step fix guide…"}
                                    </span>
                                </div>
                            )}

                            {fixState.status === "done_pr" && (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-emerald-400">
                                        <Check className="w-5 h-5" />
                                        <span className="font-semibold text-sm">Pull request opened successfully!</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Review the changes on GitHub and click <strong className="text-foreground">Merge</strong> to apply the fix.
                                    </p>
                                    <div className="flex gap-2">
                                        <a
                                            href={fixState.prUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-zinc-700 border border-zinc-600 text-foreground text-xs font-bold rounded-lg transition-colors"
                                        >
                                            <Github className="w-3.5 h-3.5" /> View pull request
                                        </a>
                                        <button
                                            onClick={() => setFixState({ status: "idle" })}
                                            className="px-3 py-2 text-xs text-muted-foreground border border-border hover:border-zinc-600 rounded-lg transition-colors"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                </div>
                            )}

                            {fixState.status === "done_manual" && (
                                <div className="space-y-1">
                                    <ManualGuidePanel guide={fixState.guide} />
                                    <div className="flex justify-end pt-3 border-t border-emerald-500/10 mt-4">
                                        <button
                                            onClick={() => setFixState({ status: "idle" })}
                                            className="px-3 py-1.5 text-xs text-muted-foreground border border-border hover:border-zinc-600 rounded-lg transition-colors"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                </div>
                            )}

                            {fixState.status === "error" && (
                                <div className="space-y-3">
                                    <div className="flex items-start gap-2 text-rose-400">
                                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <p className="text-sm">{fixState.message}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleStartFix}
                                            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors"
                                        >
                                            Try again
                                        </button>
                                        <button
                                            onClick={() => setFixState({ status: "idle" })}
                                            className="px-3 py-2 text-xs text-muted-foreground border border-border hover:border-zinc-600 rounded-lg transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}