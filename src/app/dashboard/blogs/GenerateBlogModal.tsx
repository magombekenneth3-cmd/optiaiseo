"use client";

import { useState, useEffect, useRef, useCallback, useId, useMemo } from "react";
import {
    Loader2,
    Sparkles,
    X,
    User,
    Briefcase,
    FileText,
    Hash,
    MapPin,
    ChevronRight,
    BarChart3,
    Search,
    TrendingUp,
    Target,
    Zap,
    Check,
    Bot,
} from "lucide-react";
import { getSiteAuthorDetails } from "@/app/actions/blog";
import { getSiteKeywordSuggestions, KeywordSuggestion } from "@/app/actions/keyword-suggest";

export interface AuthorInput {
    authorName: string;
    authorRole: string;
    authorBio: string;
    realExperience: string;
    realNumbers: string;
    localContext: string;
    keyword: string;
}

interface GenerateBlogModalProps {
    siteId: string;
    siteDomain: string;
    pipelineType?: string;
    initialKeyword?: string;
    onClose: () => void;
    onGenerate: (author: AuthorInput) => Promise<void>;
}

const inputCls =
    "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors hover:border-border/80 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20";

function Field({
    id,
    icon,
    label,
    hint,
    required,
    children,
}: {
    id: string;
    icon: React.ReactNode;
    label: string;
    hint?: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <label
                htmlFor={id}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
            >
                <span className="text-muted-foreground">{icon}</span>
                {label}
                {required && <span className="text-emerald-500">*</span>}
            </label>
            {children}
            {hint && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
            )}
        </div>
    );
}

function SourceIcon({ source }: { source: KeywordSuggestion["source"] }) {
    if (source === "gsc_gap") return <TrendingUp className="h-3 w-3 text-emerald-400" />;
    if (source === "no_content") return <Zap className="h-3 w-3 text-blue-400" />;
    return <Target className="h-3 w-3 text-orange-400" />;
}

function sourceBadgeCls(source: KeywordSuggestion["source"]) {
    if (source === "gsc_gap") return "bg-emerald-500/10 text-emerald-400";
    if (source === "no_content") return "bg-blue-500/10 text-blue-400";
    return "bg-orange-500/10 text-orange-400";
}

function sourceLabel(source: KeywordSuggestion["source"]) {
    if (source === "gsc_gap") return "GSC Gap";
    if (source === "no_content") return "No Content";
    return "Competitor Gap";
}

export function GenerateBlogModal({
    siteId,
    siteDomain,
    pipelineType,
    initialKeyword,
    onClose,
    onGenerate,
}: GenerateBlogModalProps) {
    const uid = useId();
    const id = (field: string) => `${uid}-${field}`;

    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
    const [attemptedSubmit, setAttemptedSubmit] = useState(false);
    const [form, setForm] = useState<AuthorInput>({
        authorName: "",
        authorRole: "",
        authorBio: "",
        realExperience: "",
        realNumbers: "",
        localContext: "",
        keyword: initialKeyword ?? "",
    });

    const keywordRef   = useRef<HTMLInputElement>(null);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isDataReport = pipelineType === "DATA_REPORT";
    const keywordMissing = attemptedSubmit && !form.keyword.trim();
    const nameMissing = attemptedSubmit && !form.authorName.trim();

    useEffect(() => {
        let cancelled = false;

        async function load() {
            const [authorRes, keywordsRes] = await Promise.all([
                getSiteAuthorDetails(siteId),
                getSiteKeywordSuggestions(siteId),
            ]);

            if (cancelled) return;

            if (authorRes.success && authorRes.site) {
                setForm((prev) => ({
                    ...prev,
                    authorName: authorRes.site!.authorName ?? "",
                    authorRole: authorRes.site!.authorRole ?? "",
                    authorBio: authorRes.site!.authorBio ?? "",
                    realExperience: authorRes.site!.realExperience ?? "",
                    realNumbers: authorRes.site!.realNumbers ?? "",
                    localContext: authorRes.site!.localContext ?? "",
                }));
            }

            if (keywordsRes.success) {
                setSuggestions(keywordsRes.suggestions);
            }

            setIsLoading(false);
            focusTimerRef.current = setTimeout(() => keywordRef.current?.focus(), 80);
        }

        load();
        return () => {
            cancelled = true;
            if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
        };
    }, [siteId]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    const handleFieldChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            setForm((prev) => ({ ...prev, [e.target.name]: e.target.value })),
        []
    );

    const selectKeyword = useCallback((kw: string) => {
        setForm((prev) => ({ ...prev, keyword: kw }));
    }, []);

    const clearKeyword = useCallback(() => {
        setForm((prev) => ({ ...prev, keyword: "" }));
    }, []);

    // Derived — keeps keyword field in sync when cleared via button
    const keywordValue = useMemo(() => form.keyword, [form.keyword]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setAttemptedSubmit(true);
        if (!form.authorName.trim() || !form.keyword.trim()) return;
        setIsGenerating(true);
        try {
            await onGenerate(form);
        } finally {
            setIsGenerating(false);
        }
    }, [form, onGenerate]);

    const headerAccent = isDataReport
        ? "bg-purple-500/10 border-purple-500/20"
        : "bg-emerald-500/10 border-emerald-500/20";

    const headerIcon = isDataReport
        ? <BarChart3 className="h-4 w-4 text-purple-400" />
        : <Sparkles className="h-4 w-4 text-emerald-400" />;

    const pipelineLabel = isDataReport ? "Data-Journalism Report" : "Standard Post";
    const pipelineBadge = isDataReport
        ? "border-purple-500/20 bg-purple-500/10 text-purple-400"
        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onMouseDown={onClose}
                aria-hidden="true"
            />

            <div
                className="relative w-full max-w-lg animate-in fade-in zoom-in-95 overflow-hidden rounded-2xl border border-border bg-background shadow-2xl duration-150"
                role="dialog"
                aria-modal="true"
                aria-labelledby={id("title")}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${headerAccent}`}
                        >
                            {headerIcon}
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h2
                                    id={id("title")}
                                    className="text-sm font-bold text-foreground"
                                >
                                    Generate Post
                                </h2>
                                <span
                                    className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:inline-block ${pipelineBadge}`}
                                >
                                    {pipelineLabel}
                                </span>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                                {siteDomain}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} noValidate>
                        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5">
                            <Field
                                id={id("keyword")}
                                icon={<Search className="h-3.5 w-3.5" />}
                                label="What should this post be about?"
                                required
                            >
                                <div className="relative">
                                    <input
                                        ref={keywordRef}
                                        id={id("keyword")}
                                        name="keyword"
                                        type="text"
                                        value={keywordValue}
                                        onChange={handleFieldChange}
                                        placeholder="e.g. piggery farming Uganda, best feed for pigs…"
                                        aria-invalid={keywordMissing}
                                        className={`${inputCls} pr-8 ${keywordMissing ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20" : ""}`}
                                    />
                                    {form.keyword && (
                                        <button
                                            type="button"
                                            onClick={clearKeyword}
                                            aria-label="Clear keyword"
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                                {keywordMissing && (
                                    <p className="text-xs font-medium text-red-400">
                                        Please enter a keyword or topic.
                                    </p>
                                )}
                            </Field>

                            {suggestions.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                        Keywords you&apos;re not ranking for yet
                                    </p>
                                    <div className="space-y-1">
                                        {suggestions.map((s) => {
                                            const isSelected = form.keyword === s.keyword;
                                            return (
                                                <button
                                                    key={s.keyword}
                                                    type="button"
                                                    onClick={() => selectKeyword(s.keyword)}
                                                    className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-100 ${
                                                        isSelected
                                                            ? "border-emerald-500/30 bg-emerald-500/10"
                                                            : "border-border bg-card/50 hover:border-border/70 hover:bg-muted/40"
                                                    }`}
                                                >
                                                    <span className="shrink-0">
                                                        <SourceIcon source={s.source} />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-sm font-medium text-foreground">
                                                            {s.keyword}
                                                        </span>
                                                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                                            {s.reason}
                                                        </span>
                                                    </span>
                                                    <span className="flex shrink-0 items-center gap-1.5">
                                                        <span
                                                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${sourceBadgeCls(s.source)}`}
                                                        >
                                                            {sourceLabel(s.source)}
                                                        </span>
                                                        {isSelected && (
                                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                        )}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {suggestions.length === 0 && (
                                <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                                    No gap data yet — connect Google Search Console or add competitors to get keyword suggestions.
                                </p>
                            )}

                            <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-border" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    Author details
                                </span>
                                <div className="h-px flex-1 bg-border" />
                            </div>

                            {!form.authorName && (
                                <div className="flex gap-2.5 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-300/80">
                                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                    <span>
                                        Real author details help posts rank. Google rewards verifiable people — saved automatically for next time.
                                    </span>
                                </div>
                            )}

                            <Field
                                id={id("authorName")}
                                icon={<User className="h-3.5 w-3.5" />}
                                label="Your name"
                                required
                            >
                                <input
                                    id={id("authorName")}
                                    name="authorName"
                                    type="text"
                                    value={form.authorName}
                                    onChange={handleFieldChange}
                                    placeholder="e.g. Magombe Kenneth David"
                                    aria-invalid={nameMissing}
                                    className={`${inputCls} ${nameMissing ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20" : ""}`}
                                />
                                {nameMissing && (
                                    <p className="text-xs font-medium text-red-400">
                                        Author name is required.
                                    </p>
                                )}
                            </Field>

                            <Field
                                id={id("authorRole")}
                                icon={<Briefcase className="h-3.5 w-3.5" />}
                                label="Your role at this business"
                            >
                                <input
                                    id={id("authorRole")}
                                    name="authorRole"
                                    type="text"
                                    value={form.authorRole}
                                    onChange={handleFieldChange}
                                    placeholder="e.g. Founder & Farm Consultant"
                                    className={inputCls}
                                />
                            </Field>

                            <Field
                                id={id("authorBio")}
                                icon={<FileText className="h-3.5 w-3.5" />}
                                label="Short bio"
                                hint="2–3 sentences. Years of experience and your specialisation."
                            >
                                <textarea
                                    id={id("authorBio")}
                                    name="authorBio"
                                    value={form.authorBio}
                                    onChange={handleFieldChange}
                                    placeholder="e.g. 5 years running a piggery in Wakiso District. I help Ugandan farmers increase yields while cutting feed costs."
                                    rows={2}
                                    className={`${inputCls} resize-none`}
                                />
                            </Field>

                            <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-border" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    Real data — impossible to copy
                                </span>
                                <div className="h-px flex-1 bg-border" />
                            </div>

                            {!form.realExperience && !form.realNumbers && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(
                                            new CustomEvent("aria:open-interview", {
                                                detail: { siteId },
                                            })
                                        );
                                    }}
                                    className="flex w-full items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2.5 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/15"
                                >
                                    <Bot className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                                    <span>Let Aria interview you — fills these fields automatically</span>
                                    <ChevronRight className="ml-auto h-3.5 w-3.5 text-violet-400/60" />
                                </button>
                            )}

                            <Field
                                id={id("realExperience")}
                                icon={<ChevronRight className="h-3.5 w-3.5" />}
                                label="A real result or experience"
                                hint="One specific achievement — becomes the case study in your post."
                            >
                                <textarea
                                    id={id("realExperience")}
                                    name="realExperience"
                                    value={form.realExperience}
                                    onChange={handleFieldChange}
                                    placeholder="e.g. Reduced pig mortality from 12% to 4% in 60 days by switching feed supplier and adding vitamin supplements at week 3"
                                    rows={2}
                                    className={`${inputCls} resize-none`}
                                />
                            </Field>

                            <Field
                                id={id("realNumbers")}
                                icon={<Hash className="h-3.5 w-3.5" />}
                                label="Real numbers (costs, yields, rates)"
                                hint="Used verbatim — no AI can fake your actual figures."
                            >
                                <input
                                    id={id("realNumbers")}
                                    name="realNumbers"
                                    type="text"
                                    value={form.realNumbers}
                                    onChange={handleFieldChange}
                                    placeholder="e.g. Feed UGX 45,000/bag, avg yield 80kg/month, FCR 2.1"
                                    className={inputCls}
                                />
                            </Field>

                            <Field
                                id={id("localContext")}
                                icon={<MapPin className="h-3.5 w-3.5" />}
                                label="Local context"
                                hint="Location + seasonal or regional factors."
                            >
                                <input
                                    id={id("localContext")}
                                    name="localContext"
                                    type="text"
                                    value={form.localContext}
                                    onChange={handleFieldChange}
                                    placeholder="e.g. Kampala, Uganda — two rainy seasons, April–June and Oct–Nov"
                                    className={inputCls}
                                />
                            </Field>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-border bg-card/40 px-5 py-4">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Zap className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                                <span>
                                    Costs{" "}
                                    <span className="font-semibold text-amber-400">15 credits</span>{" "}
                                    — deducted on submit
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isGenerating}
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_20px_rgba(16,185,129,0.15)] transition-all hover:bg-emerald-400 hover:shadow-[0_0_28px_rgba(16,185,129,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Starting…
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="h-4 w-4" />
                                            Generate Post
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}