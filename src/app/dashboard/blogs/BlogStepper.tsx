"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    Loader2, X, Search, TrendingUp, FileText, Sparkles, Bot,
    Check, ChevronRight, ChevronLeft, User, Briefcase, Hash,
    MapPin, BarChart,
} from "lucide-react";
import { getSiteAuthorDetails } from "@/app/actions/blog";
import { generateBlog } from "@/app/actions/blog";
import { getSiteKeywordSuggestions, type KeywordSuggestion } from "@/app/actions/keyword-suggest";

export interface AuthorInput {
    authorName:     string;
    authorRole:     string;
    authorBio:      string;
    realExperience: string;
    realNumbers:    string;
    localContext:   string;
    keyword:        string;
}

interface GenerateBlogModalProps {
    siteId:          string;
    siteDomain:      string;
    pipelineType?:   string;
    initialKeyword?: string;
    onClose:         () => void;
    onGenerate:      (author: AuthorInput) => Promise<void>;
}

const STEPS = [
    { id: "keyword",  label: "Keyword",  icon: Search    },
    { id: "author",   label: "Author",   icon: User      },
    { id: "generate", label: "Generate", icon: Sparkles  },
    { id: "humanize", label: "Humanize", icon: Bot       },
] as const;

type StepId = typeof STEPS[number]["id"];
void (null as unknown as StepId);

const inputCls =
    "w-full bg-card border border-white/8 hover:border-white/15 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors";

function Field({
    icon, label, hint, required, children,
}: {
    icon:      React.ReactNode;
    label:     string;
    hint?:     string;
    required?: boolean;
    children:  React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="text-muted-foreground">{icon}</span>
                {label}
                {required && <span className="text-emerald-500">*</span>}
            </label>
            {children}
            {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
    );
}

function StepIndicator({ current }: { current: number }) {
    return (
        <div className="mb-6 flex items-center gap-0">
            {STEPS.map((step, i) => {
                const done   = i < current;
                const active = i === current;
                const Icon   = step.icon;
                return (
                    <div
                        key={step.id}
                        className="flex items-center"
                        style={{ flex: i < STEPS.length - 1 ? "1 1 0" : "none" }}
                    >
                        <div className="flex flex-col items-center gap-1">
                            <div
                                className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200 ${
                                    done   ? "border-emerald-500 bg-emerald-500" :
                                    active ? "border-emerald-500/40 bg-emerald-500/10" :
                                             "border-border bg-muted"
                                }`}
                            >
                                {done
                                    ? <Check className="h-3.5 w-3.5 text-black" />
                                    : <Icon className={`h-3.5 w-3.5 ${active ? "text-emerald-400" : "text-muted-foreground"}`} />
                                }
                            </div>
                            <span className={`whitespace-nowrap text-xs font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>
                                {step.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div
                                className="mb-4 h-px flex-1 mx-1.5 transition-colors duration-300"
                                style={{ background: i < current ? "#10b981" : "var(--border)" }}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function KeywordStep({
    siteId,
    initialKeyword,
    keyword,
    onSelect,
    onNext,
}: {
    siteId:          string;
    initialKeyword?: string;
    keyword:         string;
    onSelect:        (kw: string) => void;
    onNext:          () => void;
}) {
    const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
    const [loading, setLoading]         = useState(true);
    const [fetchError, setFetchError]   = useState<string | null>(null);
    const [custom, setCustom]           = useState(keyword || "");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setFetchError(null);
        getSiteKeywordSuggestions(siteId)
            .then(res => {
                if (cancelled) return;
                if (res.success) setSuggestions(res.suggestions);
            })
            .catch(() => {
                if (!cancelled) setFetchError("Couldn't load keyword suggestions.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [siteId]);

    const sourceVariant = (source: KeywordSuggestion["source"]) =>
        source === "gsc_gap"    ? "text-emerald-400" :
        source === "no_content" ? "text-blue-400"    :
        "text-amber-400";

    const sourceLabel = (source: KeywordSuggestion["source"]) =>
        source === "gsc_gap"    ? "GSC Gap"    :
        source === "no_content" ? "No Content" :
        "Competitor";

    const canContinue = !!(keyword || custom.trim());

    return (
        <div>
            <h3 className="mb-1 text-sm font-medium text-foreground">What should this post rank for?</h3>
            <p className="mb-4 text-xs text-muted-foreground">
                Pick a gap keyword or type your own. We pulled these from your GSC data and competitor analysis.
            </p>

            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    type="text"
                    value={custom}
                    onChange={e => {
                        setCustom(e.target.value);
                        onSelect(e.target.value);
                    }}
                    placeholder="Type a keyword…"
                    className={`${inputCls} pl-9`}
                    autoFocus={!initialKeyword}
                />
            </div>

            {loading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Fetching keyword gaps…
                </div>
            ) : fetchError ? (
                <p className="text-xs text-rose-400">{fetchError}</p>
            ) : suggestions.length > 0 ? (
                <div className="space-y-1.5">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Keywords you're not ranking for yet
                    </p>
                    {suggestions.map(s => (
                        <button
                            key={s.keyword}
                            type="button"
                            onClick={() => { onSelect(s.keyword); setCustom(s.keyword); }}
                            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                                keyword === s.keyword
                                    ? "border-emerald-500/30 bg-emerald-500/10"
                                    : "border-border bg-card hover:border-white/15"
                            }`}
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-foreground">{s.keyword}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.reason}</p>
                            </div>
                            <span className={`shrink-0 text-xs font-semibold ${sourceVariant(s.source)}`}>
                                {sourceLabel(s.source)}
                            </span>
                            {keyword === s.keyword && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                        </button>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">
                    No gap data found yet. Connect Google Search Console or add competitors to get suggestions.
                </p>
            )}

            <div className="mt-6 flex justify-end">
                <button
                    type="button"
                    onClick={onNext}
                    disabled={!canContinue}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Continue <ChevronRight className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

function AuthorStep({
    form,
    onChangeField,
    onNext,
    onBack,
    isGenerating,
}: {
    form:          AuthorInput;
    onChangeField: (field: keyof AuthorInput, value: string) => void;
    onNext:        () => void;
    onBack:        () => void;
    isGenerating:  boolean;
}) {
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            onChangeField(e.target.name as keyof AuthorInput, e.target.value);
        },
        [onChangeField]
    );

    return (
        <div>
            <h3 className="mb-1 text-sm font-medium text-foreground">Author details</h3>
            <p className="mb-4 text-xs text-muted-foreground">
                Real author details help your posts rank. Google rewards verifiable people — not AI personas. Saved automatically.
            </p>

            <div className="space-y-4">
                <Field icon={<User className="h-3.5 w-3.5" />} label="Your name" required>
                    <input
                        type="text"
                        name="authorName"
                        value={form.authorName}
                        onChange={handleChange}
                        placeholder="e.g. Magombe Kenneth David"
                        required
                        autoFocus
                        className={inputCls}
                    />
                </Field>

                <Field icon={<Briefcase className="h-3.5 w-3.5" />} label="Your role at this business">
                    <input
                        type="text"
                        name="authorRole"
                        value={form.authorRole}
                        onChange={handleChange}
                        placeholder="e.g. Founder & Farm Consultant"
                        className={inputCls}
                    />
                </Field>

                <Field
                    icon={<FileText className="h-3.5 w-3.5" />}
                    label="Short bio"
                    hint="2–3 sentences. Years of experience and what you specialise in."
                >
                    <textarea
                        name="authorBio"
                        value={form.authorBio}
                        onChange={handleChange}
                        placeholder="e.g. 5 years running a piggery in Wakiso District. I help Ugandan farmers increase yields while cutting feed costs."
                        rows={2}
                        className={`${inputCls} resize-none`}
                    />
                </Field>

                <div className="flex items-center gap-3 pt-1">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Real data — impossible to copy
                    </span>
                    <div className="h-px flex-1 bg-border" />
                </div>

                <Field
                    icon={<ChevronRight className="h-3.5 w-3.5" />}
                    label="A real result or experience"
                    hint="One specific thing you achieved. This becomes the case study."
                >
                    <textarea
                        name="realExperience"
                        value={form.realExperience}
                        onChange={handleChange}
                        placeholder="e.g. Reduced pig mortality from 12% to 4% in 60 days by switching feed supplier"
                        rows={2}
                        className={`${inputCls} resize-none`}
                    />
                </Field>

                <Field
                    icon={<Hash className="h-3.5 w-3.5" />}
                    label="Real numbers (costs, yields, rates)"
                    hint="Used verbatim — no AI can fake your actual figures."
                >
                    <input
                        type="text"
                        name="realNumbers"
                        value={form.realNumbers}
                        onChange={handleChange}
                        placeholder="e.g. Feed UGX 45,000/bag, avg yield 80kg/month, FCR 2.1"
                        className={inputCls}
                    />
                </Field>

                <Field
                    icon={<MapPin className="h-3.5 w-3.5" />}
                    label="Local context"
                    hint="Location + any seasonal or regional factors."
                >
                    <input
                        type="text"
                        name="localContext"
                        value={form.localContext}
                        onChange={handleChange}
                        placeholder="e.g. Kampala, Uganda — two rainy seasons, April–June and Oct–Nov"
                        className={inputCls}
                    />
                </Field>
            </div>

            <div className="mt-6 flex items-center justify-between">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                    type="button"
                    onClick={onNext}
                    disabled={!form.authorName.trim() || isGenerating}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {isGenerating ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                    ) : (
                        <><Sparkles className="h-4 w-4" /> Generate Post</>
                    )}
                </button>
            </div>
        </div>
    );
}

function GeneratingStep({ pipelineType }: { pipelineType?: string }) {
    const isDataReport = pipelineType === "DATA_REPORT";
    return (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                {isDataReport
                    ? <BarChart className="h-5 w-5 animate-pulse text-emerald-400" />
                    : <Sparkles className="h-5 w-5 animate-pulse text-emerald-400" />
                }
            </div>
            <div>
                <p className="mb-1 text-sm font-medium text-foreground">
                    {isDataReport ? "Building data report…" : "Writing your post…"}
                </p>
                <p className="max-w-xs text-xs text-muted-foreground">
                    Researching keywords, structuring headings, and writing with your real author details. Takes ~30 seconds.
                </p>
            </div>
            <Loader2 className="mt-2 h-5 w-5 animate-spin text-emerald-400" />
        </div>
    );
}

function HumanizeStep({
    blogId,
    authorName,
    authorBio,
    onDone,
    onSkip,
}: {
    blogId:     string;
    authorName: string;
    authorBio:  string;
    onDone:     () => void;
    onSkip:     () => void;
}) {
    const [state, setState]     = useState<"idle" | "loading" | "done" | "error">("idle");
    const [errorMsg, setErrorMsg] = useState("");
    const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
        };
    }, []);

    const runHumanize = useCallback(async () => {
        setState("loading");
        setErrorMsg("");
        try {
            const res = await fetch(`/api/blogs/${blogId}/humanize`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-author-context": JSON.stringify({ authorName, authorBio }),
                },
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error ?? "Humanize request failed");
            }
            setState("done");
            doneTimerRef.current = setTimeout(onDone, 1200);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : "Unknown error");
            setState("error");
        }
    }, [blogId, authorName, authorBio, onDone]);

    return (
        <div>
            <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">Humanize with GPT-4o</h3>
                <span className="rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-xs font-medium text-blue-400">
                    GPT-4o
                </span>
            </div>
            <p className="mb-5 text-xs text-muted-foreground">
                Claude wrote the SEO-optimised draft. GPT-4o now rewrites it in your natural voice — removing AI patterns and adding conversational flow. Your facts and numbers stay identical.
            </p>

            <div className="mb-5 rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Draft: Claude 4 Sonnet</span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <span className="text-xs font-medium text-blue-400">Humanized: GPT-4o</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                    Removes: "delve into", "it's worth noting", "in conclusion", generic transitions.<br />
                    Adds: first-person voice, natural rhythm, your real story.
                </p>
            </div>

            {state === "idle" && (
                <div className="flex flex-col gap-3">
                    <button
                        type="button"
                        onClick={runHumanize}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-400"
                    >
                        <Bot className="h-4 w-4" />
                        Humanize Post
                    </button>
                    <button
                        type="button"
                        onClick={onSkip}
                        className="text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                        Skip — keep Claude's version
                    </button>
                </div>
            )}

            {state === "loading" && (
                <div className="flex flex-col items-center gap-3 py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                    <p className="text-xs text-muted-foreground">GPT-4o is rewriting in your voice…</p>
                </div>
            )}

            {state === "done" && (
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                    <Check className="h-4 w-4" />
                    Post humanized — finishing up…
                </div>
            )}

            {state === "error" && (
                <div className="space-y-3">
                    <p className="text-xs text-rose-400">{errorMsg}</p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={runHumanize}
                            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-emerald-400"
                        >
                            Try again
                        </button>
                        <button
                            type="button"
                            onClick={onSkip}
                            className="px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                            Skip
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function GenerateBlogModal({
    siteId,
    siteDomain,
    pipelineType,
    initialKeyword,
    onClose,
    onGenerate,
}: GenerateBlogModalProps) {
    const [step, setStep]           = useState(0);
    const [keyword, setKeyword]     = useState(initialKeyword ?? "");
    const [form, setForm]           = useState<AuthorInput>({
        authorName:     "",
        authorRole:     "",
        authorBio:      "",
        realExperience: "",
        realNumbers:    "",
        localContext:   "",
        keyword:        initialKeyword ?? "",
    });
    const [isGenerating, setIsGenerating]       = useState(false);
    const [generatedBlogId, setGeneratedBlogId] = useState<string | null>(null);

    useEffect(() => {
        getSiteAuthorDetails(siteId).then(res => {
            if (res.success && res.site) {
                setForm(prev => ({
                    ...prev,
                    authorName:     res.site!.authorName     || "",
                    authorRole:     res.site!.authorRole     || "",
                    authorBio:      res.site!.authorBio      || "",
                    realExperience: res.site!.realExperience || "",
                    realNumbers:    res.site!.realNumbers    || "",
                    localContext:   res.site!.localContext   || "",
                }));
            }
        });
    }, [siteId]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    const handleChangeField = useCallback(
        (field: keyof AuthorInput, value: string) =>
            setForm(prev => ({ ...prev, [field]: value })),
        []
    );

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setStep(2);
        try {
            const res = await generateBlog(pipelineType, siteId, { ...form, keyword });
            if (res.success && res.blog?.id) {
                setGeneratedBlogId(res.blog.id);
                setStep(3);
            } else {
                await onGenerate({ ...form, keyword });
                onClose();
            }
        } catch (err: unknown) {
            console.error("[BlogStepper] Generation failed:", err);
            try {
                await onGenerate({ ...form, keyword });
            } catch {
                // onGenerate itself failed — user already saw a toast from the action
            }
            onClose();
        } finally {
            setIsGenerating(false);
        }
    }, [pipelineType, siteId, form, keyword, onGenerate, onClose]);

    const isDataReport = pipelineType === "DATA_REPORT";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="absolute inset-0 bg-black/80" aria-hidden="true" />

            <div
                role="dialog"
                aria-modal="true"
                aria-label={isDataReport ? "Data Report" : "Generate Post"}
                className="relative w-full max-w-lg animate-in fade-in zoom-in-95 overflow-hidden rounded-2xl border border-border bg-background shadow-[0_0_80px_rgba(0,0,0,0.8)] duration-200"
            >
                <div className="flex items-center justify-between border-b border-border px-6 py-4">
                    <div>
                        <h2 className="text-sm font-semibold text-foreground">
                            {isDataReport ? "Data Report" : "Generate Post"}
                        </h2>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{siteDomain}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="max-h-[75vh] overflow-y-auto p-6">
                    <StepIndicator current={step} />

                    {step === 0 && (
                        <KeywordStep
                            siteId={siteId}
                            initialKeyword={initialKeyword}
                            keyword={keyword}
                            onSelect={kw => {
                                setKeyword(kw);
                                setForm(prev => ({ ...prev, keyword: kw }));
                            }}
                            onNext={() => setStep(1)}
                        />
                    )}

                    {step === 1 && (
                        <AuthorStep
                            form={form}
                            onChangeField={handleChangeField}
                            onNext={handleGenerate}
                            onBack={() => setStep(0)}
                            isGenerating={isGenerating}
                        />
                    )}

                    {step === 2 && <GeneratingStep pipelineType={pipelineType} />}

                    {step === 3 && generatedBlogId && (
                        <HumanizeStep
                            blogId={generatedBlogId}
                            authorName={form.authorName}
                            authorBio={form.authorBio}
                            onDone={onClose}
                            onSkip={onClose}
                        />
                    )}
                </div>

                {step === 1 && (
                    <div className="flex items-center gap-2 border-t border-border bg-background px-6 py-3">
                        <TrendingUp className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span className="text-xs text-muted-foreground">
                            Costs <span className="font-semibold text-amber-400">15 credits</span> — deducted on generate
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
