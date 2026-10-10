"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    Loader2,
    X,
    Search,
    TrendingUp,
    FileText,
    Sparkles,
    Check,
    ChevronRight,
    ChevronLeft,
    User,
    Briefcase,
    Hash,
    MapPin,
    BarChart,
    ShieldCheck,
    Award,
    Zap,
    Filter,
} from "lucide-react";
import { getSiteAuthorDetails } from "@/app/actions/blog";
import { getSiteKeywordSuggestions, type KeywordSuggestion } from "@/app/actions/keyword-suggest";

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
    initialAuthor?: AuthorInput;
    onClose: () => void;
    onGenerate: (author: AuthorInput) => Promise<{ success: boolean; error?: string } | void>;
}

const STEPS = [
    { id: "keyword", label: "Topic & Search Intent", icon: Search },
    { id: "author", label: "E-E-A-T Evidence", icon: ShieldCheck },
    { id: "generate", label: "Generation Engine", icon: Sparkles },
] as const;

const inputCls =
    "w-full bg-zinc-900/80 border border-white/10 hover:border-white/20 focus:border-emerald-500/60 rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-zinc-600 outline-none transition-all";

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
            <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                <span className="text-emerald-400">{icon}</span>
                {label}
                {required && <span className="text-emerald-400">*</span>}
            </label>
            {children}
            {hint && <p className="text-[11px] leading-relaxed text-zinc-400">{hint}</p>}
        </div>
    );
}

function StepIndicator({ current }: { current: number }) {
    return (
        <div className="mb-6 flex items-center gap-0 px-2">
            {STEPS.map((step, i) => {
                const done = i < current;
                const active = i === current;
                const Icon = step.icon;
                return (
                    <div
                        key={step.id}
                        className="flex items-center"
                        style={{ flex: i < STEPS.length - 1 ? "1 1 0" : "none" }}
                    >
                        <div className="flex flex-col items-center gap-1">
                            <div
                                className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300 ${
                                    done
                                        ? "border-emerald-500 bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                                        : active
                                            ? "border-purple-500/60 bg-purple-500/20 text-purple-300 shadow-md shadow-purple-500/20"
                                            : "border-white/10 bg-zinc-900 text-zinc-500"
                                }`}
                            >
                                {done ? (
                                    <Check className="h-4 w-4 stroke-[3]" />
                                ) : (
                                    <Icon className="h-4 w-4" />
                                )}
                            </div>
                            <span
                                className={`hidden text-center text-[11px] font-bold sm:block ${
                                    active ? "text-white" : done ? "text-emerald-400" : "text-zinc-500"
                                }`}
                            >
                                {step.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div
                                className={`mb-4 mx-2 h-0.5 flex-1 transition-all duration-500 ${i < current ? "bg-emerald-500" : "bg-white/10"}`}
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
    siteId: string;
    initialKeyword?: string;
    keyword: string;
    onSelect: (kw: string) => void;
    onNext: () => void;
}) {
    const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [custom, setCustom] = useState(keyword || "");
    const [filterSource, setFilterSource] = useState<"all" | "gsc_gap" | "no_content" | "competitor_gap">("all");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setFetchError(null);
        getSiteKeywordSuggestions(siteId)
            .then((res) => {
                if (cancelled) return;
                if (res.success) setSuggestions(res.suggestions);
            })
            .catch(() => {
                if (!cancelled) setFetchError("Couldn't load keyword suggestions.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [siteId]);

    const filteredSuggestions = useMemo(() => {
        if (filterSource === "all") return suggestions;
        return suggestions.filter((s) => s.source === filterSource);
    }, [suggestions, filterSource]);

    const sourceVariant = (source: KeywordSuggestion["source"]) =>
        source === "gsc_gap"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : source === "no_content"
                ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400";

    const sourceLabel = (source: KeywordSuggestion["source"]) =>
        source === "gsc_gap" ? "GSC Gap" : source === "no_content" ? "No Content" : "Competitor Gap";

    const canContinue = !!(keyword || custom.trim());

    return (
        <div>
            <div className="mb-4">
                <h3 className="text-sm font-bold text-white">What target topic should this post rank for?</h3>
                <p className="mt-1 text-xs text-zinc-400">
                    Pick a GSC search intent gap or type a custom keyword. Pulled live from your Google Search Console analytics.
                </p>
            </div>

            <div className="relative mb-4">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                    id="target-keyword"
                    aria-label="Target keyword"
                    type="text"
                    value={custom}
                    onChange={(e) => {
                        setCustom(e.target.value);
                        onSelect(e.target.value);
                    }}
                    placeholder="Type or search target keyword…"
                    className={`${inputCls} pl-10`}
                    autoFocus={!initialKeyword}
                />
            </div>

            {/* Filter Tabs */}
            <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 mr-1">
                    <Filter className="h-3 w-3" /> Filter:
                </span>
                {(
                    [
                        { id: "all", label: "All Gaps" },
                        { id: "gsc_gap", label: "GSC Gaps" },
                        { id: "no_content", label: "No Content" },
                        { id: "competitor_gap", label: "Competitor Gap" },
                    ] as const
                ).map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFilterSource(tab.id)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            filterSource === tab.id
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                                : "border-white/5 bg-zinc-900/60 text-zinc-400 hover:text-white"
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                    Fetching live GSC keyword gap metrics…
                </div>
            ) : fetchError ? (
                <p className="py-4 text-xs text-rose-400">{fetchError}</p>
            ) : filteredSuggestions.length > 0 ? (
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {filteredSuggestions.map((s) => (
                        <button
                            key={s.keyword}
                            type="button"
                            onClick={() => {
                                onSelect(s.keyword);
                                setCustom(s.keyword);
                            }}
                            className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all ${
                                keyword === s.keyword
                                    ? "border-emerald-500/60 bg-emerald-500/15 text-white shadow-md shadow-emerald-500/10"
                                    : "border-white/5 bg-zinc-900/50 hover:border-white/15"
                            }`}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="truncate text-xs font-bold text-white mr-1">{s.keyword}</p>
                                    <span
                                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${sourceVariant(
                                            s.source
                                        )}`}
                                    >
                                        {sourceLabel(s.source)}
                                    </span>
                                    {s.intent && (
                                        <span
                                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                                s.intent === "Commercial"
                                                    ? "border-purple-500/40 bg-purple-500/15 text-purple-300"
                                                    : s.intent === "Transactional"
                                                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                                        : s.intent === "Navigational"
                                                            ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                                                            : "border-zinc-500/40 bg-zinc-500/15 text-zinc-300"
                                            }`}
                                        >
                                            {s.intent}
                                        </span>
                                    )}
                                    {s.source === "competitor_gap" && s.difficulty != null && (
                                        <span
                                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                                s.difficulty <= 40
                                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                                    : s.difficulty <= 70
                                                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                                        : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                                            }`}
                                        >
                                            Diff {s.difficulty}
                                        </span>
                                    )}
                                    {s.actionType === "UPDATE_PAGE" ? (
                                        <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                                            Update Page ({s.recommendedAction || "REFRESH"})
                                        </span>
                                    ) : (
                                        <span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                                            Create Page
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                    {s.source === "competitor_gap" && s.searchVolume != null ? (
                                        <span className="font-semibold text-zinc-300">
                                            {s.searchVolume.toLocaleString()} searches/mo
                                        </span>
                                    ) : (s.gscImpressions90d != null || s.impressions > 0) ? (
                                        <span className="font-semibold text-zinc-300">
                                            {(s.gscImpressions90d ?? s.impressions).toLocaleString()} GSC impressions (90d)
                                        </span>
                                    ) : null}
                                    {s.position > 0 && (
                                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                                            GSC Rank #{s.position}
                                        </span>
                                    )}
                                    <span className="truncate">{s.reason}</span>
                                </div>
                                {s.existingPageUrl && (
                                    <p className="mt-0.5 truncate font-mono text-[10px] text-amber-400/90">
                                        Existing Page Target: {s.existingPageUrl}
                                    </p>
                                )}
                            </div>

                            {keyword === s.keyword && (
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black">
                                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            ) : (
                <p className="py-4 text-xs italic text-zinc-500">
                    No keyword gap suggestions found for this filter. You can type any target keyword above.
                </p>
            )}

            <div className="mt-6 flex justify-end">
                <button
                    type="button"
                    onClick={onNext}
                    disabled={!canContinue}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-xs font-bold text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Continue to E-E-A-T Evidence <ChevronRight className="h-4 w-4" />
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
    form: AuthorInput;
    onChangeField: (field: keyof AuthorInput, value: string) => void;
    onNext: () => void;
    onBack: () => void;
    isGenerating: boolean;
}) {
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            onChangeField(e.target.name as keyof AuthorInput, e.target.value);
        },
        [onChangeField]
    );

    // Calculate live E-E-A-T Evidence Completeness based on all captured signals
    const eeatCompleteness = useMemo(() => {
        const signals = [
            { key: "authorName", label: "Author Name", filled: !!form.authorName.trim() },
            { key: "authorRole", label: "Role / Title", filled: !!form.authorRole.trim() },
            { key: "authorBio", label: "Author Biography", filled: !!form.authorBio.trim() },
            { key: "realExperience", label: "Verbatim Case Result", filled: !!form.realExperience.trim() },
            { key: "realNumbers", label: "Real Metrics", filled: !!form.realNumbers.trim() },
            { key: "localContext", label: "Local Context", filled: !!form.localContext.trim() },
        ];
        const filledCount = signals.filter((s) => s.filled).length;
        const total = signals.length;
        const percentage = Math.round((filledCount / total) * 100);
        return { signals, filledCount, total, percentage };
    }, [form]);

    return (
        <div>
            <div className="mb-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-bold text-white">Author E-E-A-T Real-World Evidence</h3>
                        <p className="mt-1 text-xs text-zinc-400">
                            Google Search and AI engines reward verifiable real-author experience over synthetic AI personas.
                        </p>
                    </div>

                    {/* E-E-A-T Evidence Completeness Badge */}
                    <div
                        className="flex shrink-0 items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-1.5"
                        title="Percentage of author and experience fields completed. This does not verify the evidence."
                    >
                        <Award className="h-4 w-4 text-purple-400" />
                        <div>
                            <div className="text-[9px] font-bold uppercase tracking-wider text-purple-300">Details completed</div>
                            <div className="font-mono text-xs font-black text-emerald-400">
                                {eeatCompleteness.percentage}% ({eeatCompleteness.filledCount}/{eeatCompleteness.total} Signals)
                            </div>
                        </div>
                    </div>
                </div>

                {/* Signal Checklist Breakdown */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="font-semibold text-zinc-400 mr-0.5">Captured Signals:</span>
                    {eeatCompleteness.signals.map((sig) => (
                        <span
                            key={sig.key}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors ${
                                sig.filled
                                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                    : "border border-white/5 bg-zinc-900/60 text-zinc-500"
                            }`}
                        >
                            {sig.filled ? <Check className="h-3 w-3 stroke-[3]" /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />}
                            {sig.label}
                        </span>
                    ))}
                </div>
            </div>

            <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field id="author-name" icon={<User className="h-3.5 w-3.5" />} label="Author Name" required>
                        <input
                            type="text"
                            id="author-name"
                            name="authorName"
                            value={form.authorName}
                            onChange={handleChange}
                            placeholder="e.g. Magombe Kenneth"
                            required
                            autoFocus
                            className={inputCls}
                        />
                    </Field>

                    <Field id="author-role" icon={<Briefcase className="h-3.5 w-3.5" />} label="Role / Title">
                        <input
                            type="text"
                            id="author-role"
                            name="authorRole"
                            value={form.authorRole}
                            onChange={handleChange}
                            placeholder="e.g. Founder & Lead Consultant"
                            className={inputCls}
                        />
                    </Field>
                </div>

                <Field
                    id="author-bio"
                    icon={<FileText className="h-3.5 w-3.5" />}
                    label="Author Biography"
                    hint="2–3 sentences highlighting credentials and domain authority."
                >
                    <textarea
                        id="author-bio"
                            name="authorBio"
                        value={form.authorBio}
                        onChange={handleChange}
                        placeholder="e.g. 8 years leading SEO engineering & AI Search visibility strategy for growth companies."
                        rows={2}
                        className={`${inputCls} resize-none`}
                    />
                </Field>

                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                        <Award className="h-4 w-4 text-purple-400" />
                        Verbatim Experience & Statistical Evidence (High-Impact E-E-A-T)
                    </div>

                    <Field
                        id="real-experience"
                        icon={<Award className="h-3.5 w-3.5" />}
                        label="Verbatim Experience / Case Result"
                        hint="A specific result achieved. This is injected as a verifiable case study block."
                    >
                        <textarea
                            id="real-experience"
                            name="realExperience"
                            value={form.realExperience}
                            onChange={handleChange}
                            placeholder="e.g. Reduced organic rank drop from 18% to 0% by migrating to canonical AST remediation architecture."
                            rows={2}
                            className={`${inputCls} resize-none`}
                        />
                    </Field>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field
                            id="real-numbers"
                            icon={<Hash className="h-3.5 w-3.5" />}
                            label="Real Figures & Metrics"
                            hint="Costs, yields, rates used verbatim."
                        >
                            <input
                                type="text"
                                id="real-numbers"
                            name="realNumbers"
                                value={form.realNumbers}
                                onChange={handleChange}
                                placeholder="e.g. $450/mo saved, 85% CTR, 4.2s LCP"
                                className={inputCls}
                            />
                        </Field>

                        <Field
                            id="local-context"
                            icon={<MapPin className="h-3.5 w-3.5" />}
                            label="Local & Regional Context"
                            hint="Location & regional market factors."
                        >
                            <input
                                type="text"
                                id="local-context"
                            name="localContext"
                                value={form.localContext}
                                onChange={handleChange}
                                placeholder="e.g. Kampala, East Africa region"
                                className={inputCls}
                            />
                        </Field>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-400 transition-colors hover:text-white"
                >
                    <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                    type="button"
                    onClick={onNext}
                    disabled={!form.authorName.trim() || isGenerating}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-emerald-500 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-purple-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {isGenerating ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" /> Launching Pipeline…
                        </>
                    ) : (
                        <>
                            <Sparkles className="h-4 w-4" /> Launch AI Content Engine
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

function GeneratingStep({ pipelineType }: { pipelineType?: string }) {
    const isDataReport = pipelineType === "DATA_REPORT";
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);

    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const elapsedLabel = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center" aria-live="polite">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-500/15 text-purple-400 shadow-xl shadow-purple-500/20">
                {isDataReport ? (
                    <BarChart className="h-7 w-7 animate-pulse text-emerald-400" />
                ) : (
                    <Sparkles className="h-7 w-7 animate-pulse text-purple-300" />
                )}
                <span className="absolute -right-1 -top-1 h-3.5 w-3.5 animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-emerald-500" />
            </div>
            <div>
                <p className="mb-1 text-base font-bold text-white">
                    {isDataReport ? "Building Data-Journalism Report…" : "AI Research & Generation Pipeline Active"}
                </p>
                <p className="max-w-xs text-xs text-purple-300 font-semibold">
                    Background functions are assembling SERP research &amp; writing article content.
                </p>
                <p className="mx-auto mt-2 max-w-xs text-xs text-zinc-400">
                    Elapsed: <span className="font-mono font-bold text-white">{elapsedLabel}</span>.
                </p>
            </div>
            <Loader2 className="mt-2 h-6 w-6 animate-spin text-emerald-400" />
        </div>
    );
}

export function GenerateBlogModal({
    siteId,
    siteDomain,
    pipelineType,
    initialKeyword,
    initialAuthor,
    onClose,
    onGenerate,
}: GenerateBlogModalProps) {
    const [step, setStep] = useState(0);
    const [keyword, setKeyword] = useState(initialAuthor?.keyword ?? initialKeyword ?? "");
    const [form, setForm] = useState<AuthorInput>(
        initialAuthor ?? {
            authorName: "",
            authorRole: "",
            authorBio: "",
            realExperience: "",
            realNumbers: "",
            localContext: "",
            keyword: initialKeyword ?? "",
        }
    );
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);

    useEffect(() => {
        if (initialAuthor) return;
        getSiteAuthorDetails(siteId).then((res) => {
            if (res.success && res.site) {
                setForm((prev) => ({
                    ...prev,
                    authorName: res.site?.authorName || "",
                    authorRole: res.site?.authorRole || "",
                    authorBio: res.site?.authorBio || "",
                    realExperience: res.site?.realExperience || "",
                    realNumbers: res.site?.realNumbers || "",
                    localContext: res.site?.localContext || "",
                }));
            }
        });
    }, [siteId, initialAuthor]);

    const isDirty = keyword.trim() !== (initialKeyword ?? "").trim() ||
        Object.values(form).some((value) => value.trim().length > 0);

    const requestClose = useCallback(() => {
        if (isDirty && !window.confirm("Discard this article draft? Your entered details will be lost.")) return;
        onClose();
    }, [isDirty, onClose]);

    const handleChangeField = useCallback(
        (field: keyof AuthorInput, value: string) => setForm((prev) => ({ ...prev, [field]: value })),
        []
    );

    const handleGenerate = useCallback(async () => {
        setGenError(null);
        setIsGenerating(true);
        setStep(2);
        try {
            const res = await onGenerate({ ...form, keyword });
            if (res && typeof res === "object" && "success" in res && res.success === false) {
                setGenError(res.error || "Generation couldn't be started. Please check your inputs and try again.");
                setStep(1);
                return;
            }
            onClose();
        } catch (err) {
            const msg = (err as Error)?.message || "Generation couldn't be started. Please check your inputs and try again.";
            setGenError(msg);
            setStep(1);
        } finally {
            setIsGenerating(false);
        }
    }, [form, keyword, onGenerate, onClose]);

    const isDataReport = pipelineType === "DATA_REPORT";

    return (
        <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
            <DialogContent className="max-h-[95dvh] w-[calc(100%-2rem)] max-w-xl overflow-hidden border-white/10 bg-zinc-950/95 p-0 text-foreground shadow-2xl backdrop-blur-2xl sm:w-full" onEscapeKeyDown={(event) => { if (isDirty) { event.preventDefault(); requestClose(); } }} onPointerDownOutside={(event) => { if (isDirty) { event.preventDefault(); requestClose(); } }}>
                <DialogHeader className="sr-only">
                    <DialogTitle>{isDataReport ? "Data Report Creator" : "Create Article Studio"}</DialogTitle>
                    <DialogDescription>Choose a topic, add author details, and create the article.</DialogDescription>
                </DialogHeader>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 bg-zinc-900/60 px-6 py-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-white">
                                {isDataReport ? "Data Report Creator" : "Create Article Studio"}
                            </h2>
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                                E-E-A-T V2
                            </span>
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-zinc-400">{siteDomain}</p>
                    </div>
                    <button
                        type="button"
                        onClick={requestClose}
                        aria-label="Close article creator"
                        className="rounded-xl p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-6">
                    <StepIndicator current={step} />

                    {genError && step === 1 && (
                        <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
                            <div>
                                <p className="font-bold">Generation failed to start</p>
                                <p className="text-[11px] text-rose-400/90">{genError}. Your inputs remain saved below.</p>
                            </div>
                            <button
                                type="button"
                                onClick={handleGenerate}
                                className="shrink-0 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-rose-400"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {step === 0 && (
                        <KeywordStep
                            siteId={siteId}
                            initialKeyword={initialKeyword}
                            keyword={keyword}
                            onSelect={(kw) => {
                                setKeyword(kw);
                                setForm((prev) => ({ ...prev, keyword: kw }));
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
                </div>

                {step === 1 && (
                    <div className="flex items-center justify-between border-t border-white/10 bg-zinc-900/80 px-6 py-3.5">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <TrendingUp className="h-4 w-4 text-amber-400" />
                            <span>
                                Credit Cost: <span className="font-bold text-amber-400">10 credits</span>
                            </span>
                        </div>
                        <span className="text-[11px] text-zinc-500 font-mono">Deducted when generation is confirmed</span>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
