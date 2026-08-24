"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
    Zap, Plus, Trash2, Play, ChevronRight, FileText,
    CheckCircle2, Clock, AlertCircle, X, Upload, Eye,
    LayoutTemplate, Loader2, Globe,
} from "lucide-react";

interface Site { id: string; domain: string; }

interface PseoTemplate {
    id: string;
    siteId: string;
    name: string;
    pattern: string;
    status: string;
    pageCount: number;
    createdAt: string;
    site: { domain: string };
    _count: { pages: number };
}

interface PseoPage {
    id: string;
    slug: string;
    title: string;
    metaDescription: string | null;
    status: string;
    publishedUrl: string | null;
    variableData: Record<string, string>;
}

type Step = "list" | "create" | "detail";

export default function PseoDashboardClient({ sites }: { sites: Site[] }) {
    const [step, setStep]                   = useState<Step>("list");
    const [templates, setTemplates]         = useState<PseoTemplate[]>([]);
    const [selectedTemplate, setSelected]  = useState<(PseoTemplate & { pages: PseoPage[] }) | null>(null);
    const [loadingTemplates, setLoadingT]   = useState(true);
    const [generating, setGenerating]       = useState(false);
    const [deletingId, setDeletingId]       = useState<string | null>(null);

    // Create form state
    const [form, setForm] = useState({
        siteId: "",
        name: "",
        pattern: "[service] in [city]",
        datasetRaw: JSON.stringify([
            { service: "SEO Audit", city: "New York" },
            { service: "AEO Optimization", city: "San Francisco" },
            { service: "Content Strategy", city: "Austin" },
        ], null, 2),
    });
    const [formError, setFormError] = useState<string | null>(null);
    const [creating, setCreating]   = useState(false);

    const loadTemplates = useCallback(async () => {
        setLoadingT(true);
        try {
            const r = await fetch("/api/pseo/templates");
            const d = await r.json();
            setTemplates(d.templates ?? []);
        } finally {
            setLoadingT(false);
        }
    }, []);

    useEffect(() => {
        loadTemplates();
    }, [loadTemplates]);

    // ── Create template ──────────────────────────────────────────────────────
    const handleCreate = async () => {
        setFormError(null);
        let dataset: Record<string, string>[];
        try { dataset = JSON.parse(form.datasetRaw); }
        catch { setFormError("Dataset is not valid JSON"); return; }
        if (!Array.isArray(dataset) || dataset.length === 0) {
            setFormError("Dataset must be a non-empty JSON array"); return;
        }
        if (!form.siteId) { setFormError("Select a site"); return; }
        if (!form.name.trim()) { setFormError("Template name is required"); return; }

        setCreating(true);
        try {
            const r = await fetch("/api/pseo/templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ siteId: form.siteId, name: form.name, pattern: form.pattern, dataset }),
            });
            const d = await r.json();
            if (!r.ok) { setFormError(d.error ?? "Failed to create template"); return; }
            await loadTemplates();
            setStep("list");
        } finally { setCreating(false); }
    };

    // ── Generate pages ───────────────────────────────────────────────────────
    const handleGenerate = async (templateId: string) => {
        setGenerating(true);
        try {
            const r = await fetch(`/api/pseo/templates/${templateId}/generate`, { method: "POST" });
            const d = await r.json();
            if (!r.ok) { alert(d.error ?? "Generation failed"); return; }
            await loadTemplates();
            if (selectedTemplate?.id === templateId) await loadDetail(templateId);
        } finally { setGenerating(false); }
    };

    // ── Load detail ──────────────────────────────────────────────────────────
    const loadDetail = async (templateId: string) => {
        const r = await fetch(`/api/pseo/templates/${templateId}`);
        const d = await r.json();
        setSelected(d.template);
        setStep("detail");
    };

    // ── Delete ───────────────────────────────────────────────────────────────
    const handleDelete = async (templateId: string) => {
        if (!confirm("Delete this template and all its generated pages?")) return;
        setDeletingId(templateId);
        try {
            await fetch(`/api/pseo/templates/${templateId}`, { method: "DELETE" });
            if (selectedTemplate?.id === templateId) { setSelected(null); setStep("list"); }
            await loadTemplates();
        } finally { setDeletingId(null); }
    };

    // ── Parse preview from pattern ───────────────────────────────────────────
    const previewFromPattern = (pattern: string) => {
        try {
            const rows = JSON.parse(form.datasetRaw) as Record<string, string>[];
            if (!Array.isArray(rows) || rows.length === 0) return pattern;
            let p = pattern;
            for (const [k, v] of Object.entries(rows[0])) {
                p = p.replace(new RegExp(`\\[${k}\\]`, "gi"), v);
            }
            return p;
        } catch { return pattern; }
    };

    // ── Status badge ─────────────────────────────────────────────────────────
    const StatusBadge = ({ status }: { status: string }) => {
        if (status === "ACTIVE") return (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-2.5 h-2.5" /> Active
            </span>
        );
        return (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                <Clock className="w-2.5 h-2.5" /> Draft
            </span>
        );
    };

    // ════════════════════════════════════════════════════════════════════════
    // VIEWS
    // ════════════════════════════════════════════════════════════════════════

    if (step === "create") return (
        <div className="max-w-3xl mx-auto space-y-6 p-6">
            <div className="flex items-center gap-3">
                <button onClick={() => setStep("list")} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                    <X className="w-4 h-4 text-muted-foreground" />
                </button>
                <div>
                    <h1 className="text-xl font-bold tracking-tight">New pSEO Template</h1>
                    <p className="text-sm text-muted-foreground">Define a pattern + dataset to generate hundreds of landing pages</p>
                </div>
            </div>

            <div className="card-surface p-6 space-y-5">
                {/* Site */}
                <div>
                    <label className="block text-sm font-semibold mb-1.5">Site <span className="text-rose-400">*</span></label>
                    <select
                        value={form.siteId}
                        onChange={e => setForm(f => ({ ...f, siteId: e.target.value }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                        <option value="">— select site —</option>
                        {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
                    </select>
                </div>

                {/* Name */}
                <div>
                    <label className="block text-sm font-semibold mb-1.5">Template Name <span className="text-rose-400">*</span></label>
                    <input
                        type="text"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Local Service Pages"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                </div>

                {/* Pattern */}
                <div>
                    <label className="block text-sm font-semibold mb-1.5">Keyword Pattern</label>
                    <p className="text-xs text-muted-foreground mb-2">Use <code className="bg-muted px-1 rounded">[variable]</code> placeholders matching your dataset keys</p>
                    <input
                        type="text"
                        value={form.pattern}
                        onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    {form.pattern && (
                        <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1">
                            <Eye className="w-3 h-3" /> Preview: <span className="font-semibold">{previewFromPattern(form.pattern)}</span>
                        </p>
                    )}
                </div>

                {/* Dataset */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-semibold">Variable Dataset (JSON Array) <span className="text-rose-400">*</span></label>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                            <Upload className="w-3 h-3" /> Upload CSV
                            <input type="file" accept=".csv" className="hidden" onChange={async e => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const text = await file.text();
                                const lines = text.trim().split("\n");
                                const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
                                const rows = lines.slice(1).map(line => {
                                    const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
                                    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
                                });
                                setForm(f => ({ ...f, datasetRaw: JSON.stringify(rows, null, 2) }));
                            }} />
                        </label>
                    </div>
                    <textarea
                        rows={10}
                        value={form.datasetRaw}
                        onChange={e => setForm(f => ({ ...f, datasetRaw: e.target.value }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                    />
                    {(() => {
                        try {
                            const d = JSON.parse(form.datasetRaw);
                            return Array.isArray(d) ? (
                                <p className="mt-1 text-xs text-muted-foreground">{d.length} rows · will generate {d.length} pages</p>
                            ) : null;
                        } catch { return null; }
                    })()}
                </div>

                {formError && (
                    <div className="flex items-center gap-2 text-sm text-rose-400">
                        <AlertCircle className="w-4 h-4 shrink-0" />{formError}
                    </div>
                )}

                <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LayoutTemplate className="w-4 h-4" />}
                    {creating ? "Creating…" : "Create Template"}
                </button>
            </div>
        </div>
    );

    if (step === "detail" && selectedTemplate) return (
        <div className="max-w-5xl mx-auto space-y-6 p-6">
            <div className="flex items-center gap-3">
                <button onClick={() => { setStep("list"); setSelected(null); }} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                    <X className="w-4 h-4 text-muted-foreground" />
                </button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h1 className="text-xl font-bold tracking-tight truncate">{selectedTemplate.name}</h1>
                        <StatusBadge status={selectedTemplate.status} />
                    </div>
                    <p className="text-sm text-muted-foreground font-mono truncate">{selectedTemplate.pattern} · {selectedTemplate.site.domain}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => handleGenerate(selectedTemplate.id)}
                        disabled={generating}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        {generating ? "Generating…" : selectedTemplate._count?.pages > 0 ? "Re-generate" : "Generate Pages"}
                    </button>
                    <button
                        onClick={() => handleDelete(selectedTemplate.id)}
                        disabled={deletingId === selectedTemplate.id}
                        className="p-2 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {selectedTemplate.pages.length === 0 ? (
                <div className="card-surface p-10 text-center space-y-3">
                    <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">No pages generated yet. Click <strong>Generate Pages</strong> to run Gemini.</p>
                </div>
            ) : (
                <div className="card-surface overflow-hidden">
                    <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                        <span className="text-sm font-semibold">{selectedTemplate.pages.length} Generated Pages</span>
                    </div>
                    <div className="divide-y divide-border">
                        {selectedTemplate.pages.map(page => (
                            <div key={page.id} className="px-5 py-3 flex items-start gap-4">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{page.title}</p>
                                    <p className="text-xs text-muted-foreground truncate">{page.metaDescription}</p>
                                    <code className="text-[10px] text-emerald-400 font-mono">/{page.slug}</code>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {page.publishedUrl ? (
                                        <a href={page.publishedUrl} target="_blank" rel="noopener noreferrer"
                                            className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">
                                            Published ↗
                                        </a>
                                    ) : (
                                        <span className="text-[10px] font-semibold px-2 py-1 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                                            Generated
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    // ── LIST VIEW ─────────────────────────────────────────────────────────────
    return (
        <div className="max-w-5xl mx-auto space-y-6 p-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Zap className="w-6 h-6 text-emerald-400" /> Programmatic SEO
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Create templates with keyword patterns + variable datasets. Gemini generates unique, schema-rich landing pages at scale.
                    </p>
                </div>
                <button
                    onClick={() => setStep("create")}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shrink-0"
                >
                    <Plus className="w-4 h-4" /> New Template
                </button>
            </div>

            {loadingTemplates ? (
                <div className="space-y-3">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-20 skeleton rounded-xl" />)}
                </div>
            ) : templates.length === 0 ? (
                <div className="card-surface p-14 text-center space-y-4">
                    <LayoutTemplate className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                    <div>
                        <p className="font-semibold text-foreground">No templates yet</p>
                        <p className="text-sm text-muted-foreground mt-1">Create your first template to start generating location, service, or product pages at scale.</p>
                    </div>
                    <button
                        onClick={() => setStep("create")}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                    >
                        <Plus className="w-4 h-4" /> Create First Template
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {templates.map(t => (
                        <div
                            key={t.id}
                            className="card-surface p-4 flex items-center gap-4 hover:border-border/60 transition-colors"
                        >
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                <LayoutTemplate className="w-5 h-5 text-emerald-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-semibold text-sm truncate">{t.name}</span>
                                    <StatusBadge status={t.status} />
                                </div>
                                <p className="text-xs text-muted-foreground font-mono truncate">{t.pattern}</p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{t.site.domain}</span>
                                    <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{t._count.pages} pages</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={() => handleGenerate(t.id)}
                                    disabled={generating}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                >
                                    {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                    {t._count.pages > 0 ? "Re-run" : "Generate"}
                                </button>
                                <button
                                    onClick={() => loadDetail(t.id)}
                                    className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                                >
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                </button>
                                <button
                                    onClick={() => handleDelete(t.id)}
                                    disabled={deletingId === t.id}
                                    className="p-1.5 rounded-lg text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
