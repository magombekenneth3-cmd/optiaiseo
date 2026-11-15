"use client";

import { useState, useEffect, useCallback, useId } from "react";
import Link from "next/link";
import {
    AlertTriangle,
    Check,
    Copy,
    ExternalLink,
    GitBranch,
    Github,
    Loader2,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Wrench,
} from "lucide-react";
import { PrReviewModal, type PrReviewPayload } from "@/components/PrReviewModal";

export interface ContextFieldInput {
    key: string;
    label: string;
    placeholder: string;
    why: string;
    required: boolean;
}

export interface ManualGuideData {
    steps: string[];
    codeSnippet?: string;
    filePath?: string;
    language?: string;
    docsUrl?: string;
}

export interface LinkedProposalSummary {
    id: string;
    status: string;
    prUrl: string | null;
    prNumber: number | null;
    filePath: string;
    deploymentStatus: string;
    createdAt: string;
}

export interface FindingFixInput {
    id: string;
    siteId: string;
    issueType: string;
    remediationType: string;
    lifecycleState: string;
    rootCause: string;
    expectedOutcome: string;
    scopeUrls: string[];
    latestProposal?: LinkedProposalSummary | null;
}

type FixFlowState =
    | { status: "idle" }
    | { status: "analyzing" }
    | { status: "needs_context"; fields: ContextFieldInput[] }
    | { status: "generating" }
    | { status: "review"; payload: PrReviewPayload }
    | { status: "pushing" }
    | { status: "done_pr"; prUrl: string }
    | { status: "done_manual"; guide: ManualGuideData; deterministic?: boolean }
    | { status: "error"; message: string };

function FindingContextForm({
    fields,
    isSubmitting,
    onSubmit,
    onSkip,
}: {
    fields: ContextFieldInput[];
    isSubmitting: boolean;
    onSubmit: (values: Record<string, string>) => void;
    onSkip: () => void;
}) {
    const formId = useId();
    const [values, setValues] = useState<Record<string, string>>({});

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        onSubmit(values);
    };

    return (
        <form
            onSubmit={handleSubmit}
            aria-labelledby={`${formId}-heading`}
            className="space-y-3 rounded-lg border border-border/60 bg-black/20 p-3.5"
        >
            <div>
                <h5 id={`${formId}-heading`} className="text-xs font-semibold text-foreground">
                    Site details needed to tailor this fix
                </h5>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                    Only you know these site-specific details. Provide what you have or skip to generate a generic template.
                </p>
            </div>

            {fields.map((field) => {
                const inputId = `${formId}-${field.key}`;
                const helpId = `${formId}-${field.key}-why`;
                return (
                    <div key={field.key} className="flex flex-col gap-1">
                        <label htmlFor={inputId} className="text-xs font-medium text-foreground">
                            {field.label}
                            {field.required && (
                                <span className="text-rose-400 ml-1" aria-hidden="true">*</span>
                            )}
                        </label>
                        {field.why && (
                            <span id={helpId} className="text-[11px] text-muted-foreground">
                                {field.why}
                            </span>
                        )}
                        <input
                            id={inputId}
                            name={field.key}
                            type="text"
                            value={values[field.key] ?? ""}
                            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            placeholder={field.placeholder}
                            required={field.required}
                            aria-describedby={field.why ? helpId : undefined}
                            autoCorrect="off"
                            spellCheck={false}
                            className="w-full min-h-9 px-3 py-1.5 text-xs rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        />
                    </div>
                );
            })}

            <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                    type="submit"
                    aria-disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    className="inline-flex items-center gap-1.5 min-h-8 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black transition-colors aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                >
                    {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                    {isSubmitting ? "Generating fix…" : "Generate Fix"}
                </button>
                <button
                    type="button"
                    onClick={() => !isSubmitting && onSkip()}
                    aria-disabled={isSubmitting}
                    className="inline-flex items-center min-h-8 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    Skip &amp; use placeholders
                </button>
            </div>
        </form>
    );
}

export function FindingFixPanel({
    finding,
    hasGithub,
    triggerSeq = 0,
    onFixProgressed,
    onRequestLiveVerify,
}: {
    finding: FindingFixInput;
    hasGithub?: boolean;
    triggerSeq?: number;
    onFixProgressed?: () => void;
    onRequestLiveVerify?: () => void;
}) {
    const [fixState, setFixState] = useState<FixFlowState>({ status: "idle" });
    const [copied, setCopied] = useState(false);

    const runGenerate = useCallback(
        async (extraContext: Record<string, string>) => {
            setFixState({ status: "generating" });
            try {
                const res = await fetch(`/api/diagnostics/${finding.id}/fix`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "generate",
                        extraContext,
                        url: finding.scopeUrls?.[0],
                    }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok || body.success === false) {
                    throw new Error(body.error ?? `HTTP ${res.status}`);
                }

                if (body.mode === "review") {
                    setFixState({
                        status: "review",
                        payload: {
                            proposalId: body.proposalId,
                            readOnly: true,
                            filePath: body.filePath,
                            content: body.content,
                            language: body.language,
                            issueLabel: body.issueLabel,
                        },
                    });
                    onFixProgressed?.();
                    return;
                }

                if (body.mode === "pr" && body.prUrl) {
                    setFixState({ status: "done_pr", prUrl: body.prUrl });
                    onFixProgressed?.();
                    return;
                }

                if (body.mode === "manual" && body.guide) {
                    setFixState({
                        status: "done_manual",
                        guide: body.guide,
                        deterministic: Boolean(body.deterministic),
                    });
                    return;
                }

                throw new Error("Unexpected fix response format.");
            } catch (err) {
                setFixState({
                    status: "error",
                    message: err instanceof Error ? err.message : "Failed to generate fix.",
                });
            }
        },
        [finding.id, finding.scopeUrls, onFixProgressed],
    );

    const handleStartFix = useCallback(async () => {
        if (
            fixState.status === "analyzing" ||
            fixState.status === "generating" ||
            fixState.status === "pushing"
        ) {
            return;
        }
        setFixState({ status: "analyzing" });
        try {
            const reqRes = await fetch(`/api/diagnostics/${finding.id}/fix`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "requirements" }),
            });
            const reqBody = await reqRes.json().catch(() => ({}));
            const fields = Array.isArray(reqBody.fields) ? (reqBody.fields as ContextFieldInput[]) : [];
            if (fields.length > 0) {
                setFixState({ status: "needs_context", fields });
                return;
            }
            await runGenerate({});
        } catch (err) {
            setFixState({
                status: "error",
                message: err instanceof Error ? err.message : "Failed to inspect fix requirements.",
            });
        }
    }, [finding.id, fixState.status, runGenerate]);

    useEffect(() => {
        if (triggerSeq > 0) {
            void handleStartFix();
        }
        // Only react to external triggerSeq bumps
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerSeq]);

    const handleConfirmPR = useCallback(async () => {
        if (fixState.status !== "review" || !fixState.payload.proposalId) return;
        const proposalId = fixState.payload.proposalId;
        setFixState({ status: "pushing" });
        try {
            const res = await fetch(`/api/diagnostics/${finding.id}/fix`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "push_pr", proposalId }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.success || !body.prUrl) {
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            setFixState({ status: "done_pr", prUrl: body.prUrl });
            onFixProgressed?.();
        } catch (err) {
            setFixState({
                status: "error",
                message: err instanceof Error ? err.message : "Failed to open GitHub Pull Request.",
            });
        }
    }, [finding.id, fixState, onFixProgressed]);

    const handleCopySnippet = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard permission denied — user can still manually select <pre> text
        }
    };

    const existingPrUrl =
        fixState.status === "done_pr" ? fixState.prUrl : finding.latestProposal?.prUrl ?? null;

    const isAutoFixable =
        finding.remediationType === "DETERMINISTIC" || finding.remediationType === "AI_PATCH";
    const ctaText =
        finding.remediationType === "DETERMINISTIC"
            ? hasGithub
                ? "Generate Auto-Fix PR"
                : "Generate Exact Patch"
            : finding.remediationType === "AI_PATCH"
              ? hasGithub
                  ? "Generate AI Fix PR"
                  : "Generate AI Fix Guide"
              : "Generate Guided Fix Steps";

    const busy =
        fixState.status === "analyzing" ||
        fixState.status === "generating" ||
        fixState.status === "pushing";

    return (
        <div className="mx-4 mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                        Recommended Action
                    </h4>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                        {isAutoFixable ? (hasGithub ? "GitHub PR Ready" : "Patch / Copy Guide") : "Guided Remediation"}
                    </span>
                </div>

                {fixState.status === "idle" && (
                    <div className="flex items-center gap-2 flex-wrap">
                        {existingPrUrl && (
                            <a
                                href={existingPrUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition-colors"
                            >
                                <Github className="w-3 h-3" aria-hidden="true" />
                                View PR {finding.latestProposal?.prNumber ? `#${finding.latestProposal.prNumber}` : ""}
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </a>
                        )}
                        <button
                            type="button"
                            onClick={handleStartFix}
                            className="inline-flex items-center gap-1.5 min-h-8 px-3.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                        >
                            <Sparkles className="w-3 h-3" aria-hidden="true" />
                            {existingPrUrl ? "Regenerate Fix" : ctaText}
                        </button>
                    </div>
                )}
            </div>

            {fixState.status === "idle" && hasGithub === false && isAutoFixable && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                    No GitHub repository linked to this site—generating exact copyable patches and instructions.{" "}
                    <Link
                        href="/dashboard/sites"
                        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                    >
                        Connect GitHub for 1-click PRs
                    </Link>
                </p>
            )}

            {busy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                        {fixState.status === "analyzing"
                            ? "Checking required context for this issue…"
                            : fixState.status === "pushing"
                              ? "Opening SHA-pinned pull request on GitHub…"
                              : "Preparing fix patch & verification plan…"}
                    </span>
                </div>
            )}

            {fixState.status === "needs_context" && (
                <FindingContextForm
                    fields={fixState.fields}
                    isSubmitting={false}
                    onSubmit={runGenerate}
                    onSkip={() => runGenerate({})}
                />
            )}

            {fixState.status === "review" && (
                <PrReviewModal
                    payload={fixState.payload}
                    onConfirm={handleConfirmPR}
                    onCancel={() => setFixState({ status: "idle" })}
                />
            )}

            {fixState.status === "done_pr" && (
                <div role="status" aria-live="polite" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                        <GitBranch className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Pull request created and linked to this finding.</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Merge and deploy the PR on GitHub, then click Verify Fix Live below to run T+0 checks and schedule T+7 GSC tracking.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                        <a
                            href={fixState.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-[11px] font-semibold bg-card border border-border text-foreground hover:bg-muted transition-colors"
                        >
                            <Github className="w-3.5 h-3.5" aria-hidden="true" />
                            Review &amp; Merge PR
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                        {onRequestLiveVerify && (
                            <button
                                type="button"
                                onClick={onRequestLiveVerify}
                                className="inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 transition-colors"
                            >
                                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                                Deployed? Verify Fix Live
                            </button>
                        )}
                    </div>
                </div>
            )}

            {fixState.status === "done_manual" && (
                <div className="space-y-2.5">
                    {fixState.deterministic && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                            Deterministic exact patch
                        </span>
                    )}

                    <ol className="list-decimal list-inside space-y-1 text-xs text-foreground/90">
                        {fixState.guide.steps.map((step, idx) => (
                            <li key={idx} className="leading-relaxed">
                                {step}
                            </li>
                        ))}
                    </ol>

                    {fixState.guide.codeSnippet && (
                        <div className="rounded-lg border border-border/60 bg-black/50 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/20">
                                <span className="text-[10px] font-mono text-muted-foreground truncate">
                                    {fixState.guide.filePath ?? fixState.guide.language ?? "snippet"}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleCopySnippet(fixState.guide.codeSnippet!)}
                                    className="inline-flex items-center gap-1 min-h-7 px-2 py-0.5 rounded text-[10px] font-medium text-foreground bg-card border border-border hover:bg-muted transition-colors"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-3 h-3" aria-hidden="true" />
                                            Copy code
                                        </>
                                    )}
                                </button>
                            </div>
                            <pre className="p-3 text-[11px] font-mono text-emerald-100/90 overflow-x-auto max-h-60">
                                <code>{fixState.guide.codeSnippet}</code>
                            </pre>
                        </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap pt-1">
                        {onRequestLiveVerify && (
                            <button
                                type="button"
                                onClick={onRequestLiveVerify}
                                className="inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-black transition-colors"
                            >
                                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                                Applied? Verify Fix Live
                            </button>
                        )}
                        {fixState.guide.docsUrl && (
                            <a
                                href={fixState.guide.docsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                            >
                                Documentation
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </a>
                        )}
                        <button
                            type="button"
                            onClick={() => setFixState({ status: "idle" })}
                            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            )}

            {fixState.status === "error" && (
                <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-rose-200">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                        <span>{fixState.message}</span>
                    </div>
                    <button
                        type="button"
                        onClick={handleStartFix}
                        className="inline-flex items-center gap-1 min-h-7 px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30 transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" aria-hidden="true" />
                        Retry
                    </button>
                </div>
            )}
        </div>
    );
}

