"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Sparkles, X, User, Briefcase, FileText, Hash, MapPin, ChevronRight, BarChart } from "lucide-react";
import { getSiteAuthorDetails } from "@/app/actions/blog";

export interface AuthorInput {
    authorName: string;
    authorRole: string;
    authorBio: string;
    realExperience: string;
    realNumbers: string;
    localContext: string;
    keyword?: string;
}

interface GenerateBlogModalProps {
    siteId: string;
    siteDomain: string;
    pipelineType?: string;
    initialKeyword?: string;
    onClose: () => void;
    onGenerate: (author: AuthorInput) => Promise<void>;
}

export function GenerateBlogModal({
    siteId,
    siteDomain,
    pipelineType,
    initialKeyword,
    onClose,
    onGenerate,
}: GenerateBlogModalProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [form, setForm] = useState<AuthorInput>({
        authorName: "",
        authorRole: "",
        authorBio: "",
        realExperience: "",
        realNumbers: "",
        localContext: "",
        keyword: initialKeyword ?? "",
    });
    const firstInputRef = useRef<HTMLInputElement>(null);
    const keywordRef    = useRef<HTMLInputElement>(null);

    useEffect(() => {
        async function load() {
            const res = await getSiteAuthorDetails(siteId);
            if (res.success && res.site) {
                setForm({
                    authorName:     res.site.authorName     || "",
                    authorRole:     res.site.authorRole     || "",
                    authorBio:      res.site.authorBio      || "",
                    realExperience: res.site.realExperience || "",
                    realNumbers:    res.site.realNumbers    || "",
                    localContext:   res.site.localContext   || "",
                    keyword:        initialKeyword ?? "",
                });
            }
            setIsLoading(false);
            const focusTarget = initialKeyword ? keywordRef : firstInputRef;
            setTimeout(() => focusTarget.current?.focus(), 100);
        }
        load();
    }, [siteId, initialKeyword]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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

    const isDataReport = pipelineType === "DATA_REPORT";

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
                            <h2 className="text-base font-bold text-white">
                                {isDataReport ? "Data Report" : "Generate Post"}
                            </h2>
                            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{siteDomain}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-white transition-colors"
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
                        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

                            {!form.authorName && (
                                <div className="flex gap-3 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-xl text-xs text-emerald-300/80 leading-relaxed">
                                    <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                                    <span>
                                        Real author details make your posts rank. Google rewards content written by verifiable people — not AI personas. Your answers are saved for next time.
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
                                hint="2-3 sentences. Mention years of experience and what you specialise in."
                            >
                                <textarea
                                    value={form.authorBio}
                                    onChange={set("authorBio")}
                                    placeholder="e.g. 5 years running a piggery in Wakiso District. I help Ugandan farmers increase yields while cutting feed costs."
                                    rows={2}
                                    className={`${inputCls} resize-none`}
                                />
                            </Field>

                            <Field
                                icon={<Hash className="w-3.5 h-3.5" />}
                                label="Target keyword"
                                hint="The primary query this post should rank for. Leave blank to auto-select."
                            >
                                <input
                                    ref={keywordRef}
                                    type="text"
                                    value={form.keyword ?? ""}
                                    onChange={set("keyword")}
                                    placeholder="e.g. screaming frog alternative"
                                    className={inputCls}
                                />
                            </Field>

                            <div className="flex items-center gap-3 pt-1">
                                <div className="flex-1 h-px bg-muted" />
                                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                    Real data — makes you impossible to copy
                                </span>
                                <div className="flex-1 h-px bg-muted" />
                            </div>

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
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm text-muted-foreground hover:text-zinc-300 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isGenerating || !form.authorName.trim()}
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
            {hint && <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>}
        </div>
    );
}