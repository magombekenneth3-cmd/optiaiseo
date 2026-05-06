"use client";

import { useState, useEffect, useRef } from "react";
import {
    Loader2, Sparkles, X, User, Briefcase, FileText,
    Hash, MapPin, ChevronRight, BarChart, Search, TrendingUp,
    Target, Zap, Check, Bot,
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
    onClose: () => void;
    onGenerate: (author: AuthorInput) => Promise<void>;
}

export function GenerateBlogModal({
    siteId,
    siteDomain,
    pipelineType,
    onClose,
    onGenerate,
}: GenerateBlogModalProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
    const [form, setForm] = useState<AuthorInput>({
        authorName: "",
        authorRole: "",
        authorBio: "",
        realExperience: "",
        realNumbers: "",
        localContext: "",
        keyword: "",
    });
    const firstInputRef = useRef<HTMLInputElement>(null);
    const keywordRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        async function load() {
            const [authorRes, keywordsRes] = await Promise.all([
                getSiteAuthorDetails(siteId),
                getSiteKeywordSuggestions(siteId),
            ]);

            if (authorRes.success && authorRes.site) {
                setForm(prev => ({
                    ...prev,
                    authorName: authorRes.site!.authorName || "",
                    authorRole: authorRes.site!.authorRole || "",
                    authorBio: authorRes.site!.authorBio || "",
                    realExperience: authorRes.site!.realExperience || "",
                    realNumbers: authorRes.site!.realNumbers || "",
                    localContext: authorRes.site!.localContext || "",
                }));
            }

            if (keywordsRes.success) {
                setSuggestions(keywordsRes.suggestions);
            }

            setIsLoading(false);
            setTimeout(() => keywordRef.current?.focus(), 100);
        }
        load();
    }, [siteId]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.authorName.trim()) return;
        setIsGenerating(true);
        await onGenerate(form);
        setIsGenerating(false);
    };

    const set = (field: keyof AuthorInput) => (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => setForm(prev => ({ ...prev, [field]: e.target.value }));

    const selectKeyword = (kw: string) => {
        setForm(prev => ({ ...prev, keyword: kw }));
    };

    const isDataReport = pipelineType === "DATA_REPORT";

    const sourceIcon = (source: KeywordSuggestion["source"]) => {
        if (source === "gsc_gap") return <TrendingUp className="w-3 h-3 text-emerald-400" />;
        if (source === "no_content") return <Zap className="w-3 h-3 text-blue-400" />;
        return <Target className="w-3 h-3 text-orange-400" />;
    };

    const sourceLabel = (source: KeywordSuggestion["source"]) => {
        if (source === "gsc_gap") return "GSC Gap";
        if (source === "no_content") return "No Content";
        return "Competitor Gap";
    };

    const sourceBadgeCls = (source: KeywordSuggestion["source"]) => {
        if (source === "gsc_gap") return "bg-emerald-500/10 text-emerald-400";
        if (source === "no_content") return "bg-blue-500/10 text-blue-400";
        return "bg-orange-500/10 text-orange-400";
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="absolute inset-0 bg-black/80" />

            <div className="relative w-full max-w-lg bg-background border border-border rounded-2xl shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                <div className="flex items-start justify-between p-6 pb-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                            {isDataReport
                                ? <BarChart className="w-4 h-4 text-purple-400" />
                                : <Sparkles className="w-4 h-4 text-emerald-400" />
                            }
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-foreground">
                                {isDataReport ? "Data Report" : "Generate Post"}
                            </h2>
                            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{siteDomain}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">

                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                                    <span className="text-muted-foreground"><Search className="w-3.5 h-3.5" /></span>
                                    What should this post be about?
                                    <span className="text-emerald-500">*</span>
                                </label>

                                <div className="relative">
                                    <input
                                        ref={keywordRef}
                                        type="text"
                                        value={form.keyword}
                                        onChange={set("keyword")}
                                        placeholder="e.g. piggery farming Uganda, best feed for pigs, poultry farming profit…"
                                        required
                                        className={`${inputCls} pr-8`}
                                    />
                                    {form.keyword && (
                                        <button
                                            type="button"
                                            onClick={() => setForm(prev => ({ ...prev, keyword: "" }))}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>

                                {suggestions.length > 0 && (
                                    <div className="space-y-1.5">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pt-1">
                                            Keywords you&apos;re not ranking for yet
                                        </p>
                                        <div className="space-y-1">
                                            {suggestions.map((s) => (
                                                <button
                                                    key={s.keyword}
                                                    type="button"
                                                    onClick={() => selectKeyword(s.keyword)}
                                                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all group ${form.keyword === s.keyword
                                                        ? "bg-emerald-500/10 border-emerald-500/30 text-white"
                                                        : "bg-card/50 border-border hover:border-white/15 hover:bg-card text-zinc-300"
                                                        }`}
                                                >
                                                    <span className="shrink-0">{sourceIcon(s.source)}</span>
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-sm font-medium truncate">
                                                            {s.keyword}
                                                        </span>
                                                        <span className="block text-[11px] text-muted-foreground truncate mt-0.5">
                                                            {s.reason}
                                                        </span>
                                                    </span>
                                                    <span className="shrink-0 flex items-center gap-1.5">
                                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sourceBadgeCls(s.source)}`}>
                                                            {sourceLabel(s.source)}
                                                        </span>
                                                        {form.keyword === s.keyword && (
                                                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                        )}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {suggestions.length === 0 && (
                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                        No gap data found yet. Connect Google Search Console or add competitors to get suggestions.
                                    </p>
                                )}
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex-1 h-px bg-muted" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    Author details
                                </span>
                                <div className="flex-1 h-px bg-muted" />
                            </div>

                            {!form.authorName && (
                                <div className="flex gap-3 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-xl text-xs text-emerald-300/80 leading-relaxed">
                                    <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                                    <span>
                                        Real author details help your posts rank. Google rewards verifiable people — not AI personas. Saved automatically for next time.
                                    </span>
                                </div>
                            )}

                            <Field icon={<User className="w-3.5 h-3.5" />} label="Your name" required>
                                <input
                                    ref={firstInputRef}
                                    type="text"
                                    value={form.authorName}
                                    onChange={set("authorName")}
                                    placeholder="e.g. Magombe Kenneth David"
                                    required
                                    className={inputCls}
                                />
                            </Field>

                            <Field icon={<Briefcase className="w-3.5 h-3.5" />} label="Your role at this business">
                                <input
                                    type="text"
                                    value={form.authorRole}
                                    onChange={set("authorRole")}
                                    placeholder="e.g. Founder & Farm Consultant"
                                    className={inputCls}
                                />
                            </Field>

                            <Field
                                icon={<FileText className="w-3.5 h-3.5" />}
                                label="Short bio"
                                hint="2-3 sentences. Years of experience and what you specialise in."
                            >
                                <textarea
                                    value={form.authorBio}
                                    onChange={set("authorBio")}
                                    placeholder="e.g. 5 years running a piggery in Wakiso District. I help Ugandan farmers increase yields while cutting feed costs."
                                    rows={2}
                                    className={`${inputCls} resize-none`}
                                />
                            </Field>

                            <div className="flex items-center gap-3">
                                <div className="flex-1 h-px bg-muted" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    Real data — impossible to copy
                                </span>
                                <div className="flex-1 h-px bg-muted" />
                            </div>

                            {!form.realExperience && !form.realNumbers && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent("aria:open-interview", {
                                            detail: { siteId }
                                        }));
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium hover:bg-violet-500/15 transition-colors"
                                >
                                    <Bot className="w-3.5 h-3.5 shrink-0 text-violet-400" />
                                    <span>Let Aria interview you — fills these fields automatically</span>
                                    <ChevronRight className="w-3.5 h-3.5 ml-auto text-violet-400/60" />
                                </button>
                            )}

                            <Field
                                icon={<ChevronRight className="w-3.5 h-3.5" />}
                                label="A real result or experience"
                                hint="One specific thing you achieved. This becomes the case study."
                            >
                                <textarea
                                    value={form.realExperience}
                                    onChange={set("realExperience")}
                                    placeholder="e.g. Reduced pig mortality from 12% to 4% in 60 days by switching feed supplier and adding vitamin supplements at week 3"
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
                                    onChange={set("realNumbers")}
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
                                    onChange={set("localContext")}
                                    placeholder="e.g. Kampala, Uganda — two rainy seasons, April–June and Oct–Nov"
                                    className={inputCls}
                                />
                            </Field>
                        </div>

                        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-background">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>Costs <span className="font-semibold text-amber-400">15 credits</span> — deducted on submit</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm text-muted-foreground hover:text-zinc-300 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isGenerating || !form.authorName.trim() || !form.keyword.trim()}
                                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.35)]"
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Generating…
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4" />
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

const inputCls =
    "w-full bg-card border border-white/8 hover:border-white/15 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground outline-none transition-colors";

function Field({
    icon,
    label,
    hint,
    required,
    children,
}: {
    icon: React.ReactNode;
    label: string;
    hint?: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <span className="text-muted-foreground">{icon}</span>
                {label}
                {required && <span className="text-emerald-500">*</span>}
            </label>
            {children}
            {hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
        </div>
    );
}