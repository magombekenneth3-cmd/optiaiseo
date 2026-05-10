"use client";

import { useState, useEffect } from "react";
import {
    Loader2, X, Search, TrendingUp, FileText, Sparkles, Bot,
    Check, ChevronRight, ChevronLeft, User, Briefcase, Hash,
    MapPin, BarChart,
} from "lucide-react";
import { getSiteAuthorDetails } from "@/app/actions/blog";
import { getSiteKeywordSuggestions, type KeywordSuggestion } from "@/app/actions/keyword-suggest";

// ─── AuthorInput type (was in genBlogmodal — now defined here) ──────────────
export interface AuthorInput {
    authorName:     string;
    authorRole:     string;
    authorBio:      string;
    realExperience: string;
    realNumbers:    string;
    localContext:   string;
    keyword:        string;
}

// ─── Props — identical to genBlogmodal ────────────────────────────────────
interface GenerateBlogModalProps {
    siteId: string;
    siteDomain: string;
    pipelineType?: string;
    initialKeyword?: string;
    onClose: () => void;
    onGenerate: (author: AuthorInput) => Promise<void>;
}

// ─── Step definitions ──────────────────────────────────────────────────────
const STEPS = [
    { id: "keyword",  label: "Keyword",  icon: Search },
    { id: "author",   label: "Author",   icon: User },
    { id: "generate", label: "Generate", icon: Sparkles },
    { id: "humanize", label: "Humanize", icon: Bot },
] as const;

type StepId = typeof STEPS[number]["id"];

// ─── Shared input class ────────────────────────────────────────────────────
const inputCls =
    "w-full bg-card border border-white/8 hover:border-white/15 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors";

// ─── Field wrapper (same as genBlogmodal) ─────────────────────────────────
function Field({
    icon, label, hint, required, children,
}: {
    icon: React.ReactNode;
    label: string;
    hint?: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="text-muted-foreground">{icon}</span>
                {label}
                {required && <span className="text-emerald-500">*</span>}
            </label>
            {children}
            {hint && <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>}
        </div>
    );
}

// ─── Step indicator ────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: number }) {
    return (
        <div className="flex items-center gap-0 mb-6">
            {STEPS.map((step, i) => {
                const done   = i < current;
                const active = i === current;
                const Icon   = step.icon;
                return (
                    <div key={step.id} className="flex items-center" style={{ flex: i < STEPS.length - 1 ? 1 : "none" }}>
                        <div className="flex flex-col items-center gap-1">
                            <div
                                className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all duration-200 ${
                                    done   ? "bg-emerald-500 border-emerald-500" :
                                    active ? "bg-emerald-500/10 border-emerald-500/40" :
                                             "bg-muted border-border"
                                }`}
                            >
                                {done
                                    ? <Check className="w-3.5 h-3.5 text-black" />
                                    : <Icon className={`w-3.5 h-3.5 ${active ? "text-emerald-400" : "text-muted-foreground"}`} />
                                }
                            </div>
                            <span className={`text-xs font-medium whitespace-nowrap ${
                                active ? "text-foreground" : "text-muted-foreground"
                            }`}>
                                {step.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div
                                className="flex-1 h-px mx-1.5 mb-4 transition-colors duration-300"
                                style={{ background: i < current ? "#10b981" : "var(--border)" }}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Step 0: Keyword picker ────────────────────────────────────────────────
function KeywordStep({
    siteId,
    initialKeyword,
    keyword,
    onSelect,
    onNext,
}: {
    siteId: string;
    initialKeyword?: string;
    keyword: string;
    onSelect: (kw: string) => void;
    onNext: () => void;
}) {
    const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [custom, setCustom] = useState(keyword || "");

    useEffect(() => {
        getSiteKeywordSuggestions(siteId).then(res => {
            if (res.success) setSuggestions(res.suggestions);
            setLoading(false);
        });
    }, [siteId]);

    const sourceVariant = (source: KeywordSuggestion["source"]) =>
        source === "gsc_gap" ? "text-emerald-400" :
        source === "no_content" ? "text-blue-400" :
        "text-amber-400";

    const sourceLabel = (source: KeywordSuggestion["source"]) =>
        source === "gsc_gap" ? "GSC Gap" :
        source === "no_content" ? "No Content" :
        "Competitor";

    const canContinue = !!(keyword || custom.trim());

    return (
        <div>
            <h3 className="text-sm font-medium text-foreground mb-1">What should this post rank for?</h3>
            <p className="text-xs text-muted-foreground mb-4">
                Pick a gap keyword or type your own. We pulled these from your GSC data and competitor analysis.
            </p>

            {/* Custom keyword input */}
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
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

            {/* Suggestions */}
            {loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Fetching keyword gaps…
                </div>
            ) : suggestions.length > 0 ? (
                <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                        Keywords you're not ranking for yet
                    </p>
                    {suggestions.map(s => (
                        <button
                            key={s.keyword}
                            type="button"
                            onClick={() => { onSelect(s.keyword); setCustom(s.keyword); }}
                            className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                                keyword === s.keyword
                                    ? "bg-emerald-500/10 border-emerald-500/30"
                                    : "bg-card border-border hover:border-white/15"
                            }`}
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{s.keyword}</p>
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{s.reason}</p>
                            </div>
                            <span className={`text-xs font-semibold shrink-0 ${sourceVariant(s.source)}`}>
                                {sourceLabel(s.source)}
                            </span>
                            {keyword === s.keyword && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        </button>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">
                    No gap data found yet. Connect Google Search Console or add competitors to get suggestions.
                </p>
            )}

            <div className="flex justify-end mt-6">
                <button
                    onClick={onNext}
                    disabled={!canContinue}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-semibold rounded-lg transition-all"
                >
                    Continue <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ─── Step 1: Author details ────────────────────────────────────────────────
function AuthorStep({
    form,
    onChange,
    onNext,
    onBack,
    isGenerating,
}: {
    form: AuthorInput;
    onChange: (field: keyof AuthorInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onNext: () => void;
    onBack: () => void;
    isGenerating: boolean;
}) {
    return (
        <div>
            <h3 className="text-sm font-medium text-foreground mb-1">Author details</h3>
            <p className="text-xs text-muted-foreground mb-4">
                Real author details help your posts rank. Google rewards verifiable people — not AI personas. Saved automatically.
            </p>

            <div className="space-y-4">
                <Field icon={<User className="w-3.5 h-3.5" />} label="Your name" required>
                    <input
                        type="text"
                        value={form.authorName}
                        onChange={onChange("authorName")}
                        placeholder="e.g. Magombe Kenneth David"
                        required
                        autoFocus
                        className={inputCls}
                    />
                </Field>

                <Field icon={<Briefcase className="w-3.5 h-3.5" />} label="Your role at this business">
                    <input
                        type="text"
                        value={form.authorRole}
                        onChange={onChange("authorRole")}
                        placeholder="e.g. Founder & Farm Consultant"
                        className={inputCls}
                    />
                </Field>

                <Field
                    icon={<FileText className="w-3.5 h-3.5" />}
                    label="Short bio"
                    hint="2–3 sentences. Years of experience and what you specialise in."
                >
                    <textarea
                        value={form.authorBio}
                        onChange={onChange("authorBio")}
                        placeholder="e.g. 5 years running a piggery in Wakiso District. I help Ugandan farmers increase yields while cutting feed costs."
                        rows={2}
                        className={`${inputCls} resize-none`}
                    />
                </Field>

                <div className="flex items-center gap-3 pt-1">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Real data — impossible to copy
                    </span>
                    <div className="flex-1 h-px bg-border" />
                </div>

                <Field
                    icon={<ChevronRight className="w-3.5 h-3.5" />}
                    label="A real result or experience"
                    hint="One specific thing you achieved. This becomes the case study."
                >
                    <textarea
                        value={form.realExperience}
                        onChange={onChange("realExperience")}
                        placeholder="e.g. Reduced pig mortality from 12% to 4% in 60 days by switching feed supplier"
                        rows={2}
                        className={`${inputCls} resize-none`}
                    />
                </Field>

                <Field
                    icon={<Hash className="w-3.5 h-3.5" />}
                    label="Real numbers (costs, yields, rates)"
                    hint="Used verbatim — no AI can fake your actual figures."
                >
                    <input
                        type="text"
                        value={form.realNumbers}
                        onChange={onChange("realNumbers")}
                        placeholder="e.g. Feed UGX 45,000/bag, avg yield 80kg/month, FCR 2.1"
                        className={inputCls}
                    />
                </Field>

                <Field
                    icon={<MapPin className="w-3.5 h-3.5" />}
                    label="Local context"
                    hint="Location + any seasonal or regional factors."
                >
                    <input
                        type="text"
                        value={form.localContext}
                        onChange={onChange("localContext")}
                        placeholder="e.g. Kampala, Uganda — two rainy seasons, April–June and Oct–Nov"
                        className={inputCls}
                    />
                </Field>
            </div>

            <div className="flex items-center justify-between mt-6">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                    onClick={onNext}
                    disabled={!form.authorName.trim() || isGenerating}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-semibold rounded-lg transition-all"
                >
                    {isGenerating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                    ) : (
                        <><Sparkles className="w-4 h-4" /> Generate Post</>
                    )}
                </button>
            </div>
        </div>
    );
}

// ─── Step 2: Generating state ──────────────────────────────────────────────
function GeneratingStep({ pipelineType }: { pipelineType?: string }) {
    const isDataReport = pipelineType === "DATA_REPORT";
    return (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                {isDataReport
                    ? <BarChart className="w-5 h-5 text-emerald-400 animate-pulse" />
                    : <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse" />
                }
            </div>
            <div>
                <p className="text-sm font-medium text-foreground mb-1">
                    {isDataReport ? "Building data report…" : "Writing your post…"}
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                    Researching keywords, structuring headings, and writing with your real author details. Takes ~30 seconds.
                </p>
            </div>
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin mt-2" />
        </div>
    );
}

// ─── Step 3: Humanize ──────────────────────────────────────────────────────
function HumanizeStep({
    blogId,
    authorName,
    authorBio,
    onDone,
    onSkip,
}: {
    blogId: string;
    authorName: string;
    authorBio: string;
    onDone: () => void;
    onSkip: () => void;
}) {
    const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [errorMsg, setErrorMsg] = useState("");

    const runHumanize = async () => {
        setState("loading");
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
            setTimeout(onDone, 1200);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : "Unknown error");
            setState("error");
        }
    };

    return (
        <div>
            <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-medium text-foreground">Humanize with GPT-4o</h3>
                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    GPT-4o
                </span>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
                Claude wrote the SEO-optimised draft. GPT-4o now rewrites it in your natural voice — removing AI patterns and adding conversational flow. Your facts and numbers stay identical.
            </p>

            <div className="bg-card border border-border rounded-xl p-4 mb-5">
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-medium text-muted-foreground">Draft: Claude 4 Sonnet</span>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className="text-xs font-medium text-blue-400">Humanized: GPT-4o</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Removes: "delve into", "it's worth noting", "in conclusion", generic transitions.<br />
                    Adds: first-person voice, natural rhythm, your real story.
                </p>
            </div>

            {state === "idle" && (
                <div className="flex flex-col gap-3">
                    <button
                        onClick={runHumanize}
                        className="inline-flex items-center justify-center gap-2 w-full py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition-all"
                    >
                        <Bot className="w-4 h-4" />
                        Humanize Post
                    </button>
                    <button
                        onClick={onSkip}
                        className="text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
                    >
                        Skip — keep Claude's version
                    </button>
                </div>
            )}

            {state === "loading" && (
                <div className="flex flex-col items-center gap-3 py-6">
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    <p className="text-xs text-muted-foreground">GPT-4o is rewriting in your voice…</p>
                </div>
            )}

            {state === "done" && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                    <Check className="w-4 h-4" />
                    Post humanized — finishing up…
                </div>
            )}

            {state === "error" && (
                <div className="space-y-3">
                    <p className="text-xs text-rose-400">{errorMsg}</p>
                    <div className="flex gap-2">
                        <button
                            onClick={runHumanize}
                            className="text-xs px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg transition-all"
                        >
                            Try again
                        </button>
                        <button
                            onClick={onSkip}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-4 py-2"
                        >
                            Skip
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main export ───────────────────────────────────────────────────────────
export function GenerateBlogModal({
    siteId,
    siteDomain,
    pipelineType,
    initialKeyword,
    onClose,
    onGenerate,
}: GenerateBlogModalProps) {
    const [step, setStep] = useState(0);
    const [keyword, setKeyword] = useState(initialKeyword ?? "");
    const [form, setForm] = useState<AuthorInput>({
        authorName:     "",
        authorRole:     "",
        authorBio:      "",
        realExperience: "",
        realNumbers:    "",
        localContext:   "",
        keyword:        initialKeyword ?? "",
    });
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedBlogId, setGeneratedBlogId] = useState<string | null>(null);

    // Pre-fill author from saved site details
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

    // Escape key to close
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    const onChange = (field: keyof AuthorInput) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            setForm(prev => ({ ...prev, [field]: e.target.value }));

    // Step 1 → Step 2: fire generation
    const handleGenerate = async () => {
        setIsGenerating(true);
        setStep(2);
        try {
            // onGenerate is the existing handler in GenerateBlogButton.tsx
            // It calls generateBlog() server action — completely unchanged
            // We need the blogId back for humanize — but onGenerate() doesn't
            // currently return it. We call the action directly here instead:
            const { generateBlog } = await import("@/app/actions/blog");
            const res = await generateBlog(
                pipelineType,
                siteId,
                { ...form, keyword },
            );
            if (res.success && res.blog?.id) {
                setGeneratedBlogId(res.blog.id);
                setStep(3); // humanize step
            } else {
                // Fall back to onGenerate so error toasts still fire
                await onGenerate({ ...form, keyword });
                onClose();
            }
        } catch {
            await onGenerate({ ...form, keyword }).catch(() => null);
            onClose();
        } finally {
            setIsGenerating(false);
        }
    };

    const isDataReport = pipelineType === "DATA_REPORT";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="absolute inset-0 bg-black/80" />

            <div className="relative w-full max-w-lg bg-background border border-border rounded-2xl shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                        <h2 className="text-sm font-semibold text-foreground">
                            {isDataReport ? "Data Report" : "Generate Post"}
                        </h2>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{siteDomain}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Step content */}
                <div className="p-6 max-h-[75vh] overflow-y-auto">
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
                            onChange={onChange}
                            onNext={handleGenerate}
                            onBack={() => setStep(0)}
                            isGenerating={isGenerating}
                        />
                    )}

                    {step === 2 && (
                        <GeneratingStep pipelineType={pipelineType} />
                    )}

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

                {/* Credit note — only show on author step */}
                {step === 1 && (
                    <div className="px-6 py-3 border-t border-border bg-background flex items-center gap-2">
                        <TrendingUp className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="text-xs text-muted-foreground">
                            Costs <span className="font-semibold text-amber-400">15 credits</span> — deducted on generate
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
