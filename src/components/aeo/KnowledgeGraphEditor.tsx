"use client";

/**
 * KnowledgeGraphEditor
 *
 * Full CRUD editor for a site's Knowledge Graph brand facts.
 * Replaces the read-only KnowledgeGraphSection.
 *
 * Features:
 *  - Load facts on mount, grouped by type (toggle to flat list)
 *  - FactRow: inline edit, verify against Gemini, two-step delete
 *  - AddFactForm: 11 fact types, placeholder hints, optional source URL
 *  - JsonLdPreview: fetch /api/kg-feed on demand, render the graph
 *  - Propagate button: calls /api/kg-feed?refresh=true to bust cache
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
    Plus,
    Trash2,
    Pencil,
    Check,
    X,
    ShieldCheck,
    ShieldAlert,
    HelpCircle,
    ChevronDown,
    ChevronUp,
    RefreshCw,
    Code2,
    Loader2,
    ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandFact {
    id: string;
    factType: string;
    value: string;
    sourceUrl: string | null;
    verified: boolean;
    updatedAt: string;
}

interface VerifyResult {
    verificationStatus: "verified" | "hallucination" | "unknown";
    verified: boolean;
    aiKnows: boolean;
    explanation: string | null;
    actualValue: string | null;
}

interface KnowledgeGraphEditorProps {
    siteId: string;
    domain: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FACT_TYPES = [
    { value: "organization_name", label: "Organisation Name", placeholder: "e.g. Acme Corp" },
    { value: "service", label: "Service", placeholder: "e.g. Cloud Hosting" },
    { value: "topic", label: "Topic / Expertise", placeholder: "e.g. Machine Learning" },
    { value: "schema_type", label: "Schema Type", placeholder: "e.g. LocalBusiness" },
    { value: "founding_year", label: "Founding Year", placeholder: "e.g. 2018" },
    { value: "location", label: "Location", placeholder: "e.g. London, UK" },
    { value: "ceo", label: "CEO / Founder", placeholder: "e.g. Jane Smith" },
    { value: "product", label: "Product", placeholder: "e.g. OptiAI Pro" },
    { value: "award", label: "Award / Recognition", placeholder: "e.g. Best SEO Tool 2025" },
    { value: "social_profile", label: "Social Profile", placeholder: "e.g. https://twitter.com/acme" },
    { value: "other", label: "Other", placeholder: "Any brand fact" },
] as const;

type FactTypeValue = (typeof FACT_TYPES)[number]["value"];

function factTypeLabel(type: string): string {
    return FACT_TYPES.find((f) => f.value === type)?.label ?? type;
}

function factTypePlaceholder(type: string): string {
    return FACT_TYPES.find((f) => f.value === type)?.placeholder ?? "Enter value";
}

// ─── VerifyBadge ──────────────────────────────────────────────────────────────

function VerifyBadge({ status }: { status: "verified" | "hallucination" | "unknown" | null }) {
    if (!status) return null;
    if (status === "verified")
        return (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" /> AI Verified
            </span>
        );
    if (status === "hallucination")
        return (
            <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" /> AI Mismatch
            </span>
        );
    return (
        <span className="inline-flex items-center gap-1 text-xs text-zinc-400 font-semibold">
            <HelpCircle className="w-3.5 h-3.5" /> Unknown to AI
        </span>
    );
}

// ─── FactRow ──────────────────────────────────────────────────────────────────

function FactRow({
    fact,
    domain,
    onUpdate,
    onDelete,
}: {
    fact: BrandFact;
    domain: string;
    onUpdate: (updated: BrandFact) => void;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(fact.value);
    const [editSource, setEditSource] = useState(fact.sourceUrl ?? "");
    const [saving, setSaving] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!editValue.trim()) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/entity-panel", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: fact.id,
                    value: editValue.trim(),
                    sourceUrl: editSource.trim() || null,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Save failed");
            onUpdate(data.fact);
            setEditing(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const handleVerify = async () => {
        setVerifying(true);
        setVerifyResult(null);
        setError(null);
        try {
            const res = await fetch("/api/entity-panel/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    factId: fact.id,
                    domain,
                    factType: fact.factType,
                    value: fact.value,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Verification failed");
            setVerifyResult(data);
            // Optimistically update verified flag in parent
            if (data.verified) onUpdate({ ...fact, verified: true });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Verification failed");
        } finally {
            setVerifying(false);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        setDeleting(true);
        try {
            const res = await fetch("/api/entity-panel", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: fact.id }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error ?? "Delete failed");
            }
            onDelete(fact.id);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Delete failed");
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    return (
        <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-2">
            <div className="flex items-start gap-2">
                {/* Type badge */}
                <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {factTypeLabel(fact.factType)}
                </span>

                {/* Value / edit field */}
                <div className="flex-1 min-w-0">
                    {editing ? (
                        <div className="space-y-1.5">
                            <input
                                className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                placeholder={factTypePlaceholder(fact.factType)}
                                autoFocus
                            />
                            <input
                                className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-xs text-muted-foreground focus:outline-none focus:border-blue-500"
                                value={editSource}
                                onChange={(e) => setEditSource(e.target.value)}
                                placeholder="Source URL (optional)"
                            />
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            <p className="text-sm text-white break-words">{fact.value}</p>
                            {fact.sourceUrl && (
                                <a
                                    href={fact.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline"
                                >
                                    <ExternalLink className="w-2.5 h-2.5" /> Source
                                </a>
                            )}
                        </div>
                    )}
                </div>

                {/* Verified dot */}
                {!editing && (
                    <span
                        className={`shrink-0 mt-1.5 w-2 h-2 rounded-full ${
                            fact.verified ? "bg-emerald-400" : "bg-zinc-600"
                        }`}
                        title={fact.verified ? "Verified" : "Unverified"}
                    />
                )}

                {/* Action buttons */}
                <div className="shrink-0 flex items-center gap-1">
                    {editing ? (
                        <>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 disabled:opacity-50"
                                title="Save"
                            >
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button
                                onClick={() => { setEditing(false); setEditValue(fact.value); setEditSource(fact.sourceUrl ?? ""); }}
                                className="p-1 rounded hover:bg-zinc-700 text-muted-foreground"
                                title="Cancel"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setEditing(true)}
                                className="p-1 rounded hover:bg-zinc-700 text-muted-foreground hover:text-white"
                                title="Edit"
                            >
                                <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={handleVerify}
                                disabled={verifying}
                                className="p-1 rounded hover:bg-blue-500/20 text-blue-400 disabled:opacity-50"
                                title="Verify against AI"
                            >
                                {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                            </button>
                            {confirmDelete ? (
                                <>
                                    <button
                                        onClick={handleDelete}
                                        disabled={deleting}
                                        className="p-1 rounded bg-rose-500/20 text-rose-400 hover:bg-rose-500/40 disabled:opacity-50 text-[10px] font-bold px-1.5"
                                        title="Confirm delete"
                                    >
                                        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Yes"}
                                    </button>
                                    <button
                                        onClick={() => setConfirmDelete(false)}
                                        className="p-1 rounded hover:bg-zinc-700 text-muted-foreground text-[10px] font-bold px-1.5"
                                    >
                                        No
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={handleDelete}
                                    className="p-1 rounded hover:bg-rose-500/20 text-muted-foreground hover:text-rose-400"
                                    title="Delete"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Verify result */}
            {verifyResult && (
                <div className={`text-xs rounded p-2 border ${
                    verifyResult.verificationStatus === "verified"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                        : verifyResult.verificationStatus === "hallucination"
                        ? "bg-rose-500/10 border-rose-500/20 text-rose-300"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400"
                }`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <VerifyBadge status={verifyResult.verificationStatus} />
                    </div>
                    {verifyResult.explanation && <p>{verifyResult.explanation}</p>}
                    {verifyResult.actualValue && verifyResult.actualValue !== fact.value && (
                        <p className="mt-0.5 text-zinc-400">AI says: <span className="text-white">{verifyResult.actualValue}</span></p>
                    )}
                </div>
            )}

            {/* Error */}
            {error && (
                <p className="text-xs text-rose-400">{error}</p>
            )}
        </div>
    );
}

// ─── AddFactForm ──────────────────────────────────────────────────────────────

function AddFactForm({
    siteId,
    onAdded,
}: {
    siteId: string;
    onAdded: (fact: BrandFact) => void;
}) {
    const [open, setOpen] = useState(false);
    const [factType, setFactType] = useState<FactTypeValue>("service");
    const [value, setValue] = useState("");
    const [sourceUrl, setSourceUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const placeholder = factTypePlaceholder(factType);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!value.trim()) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/entity-panel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ siteId, factType, value: value.trim(), sourceUrl: sourceUrl.trim() || undefined }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Failed to add fact");
            onAdded(data.fact);
            setValue("");
            setSourceUrl("");
            setOpen(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to add fact");
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border hover:border-blue-500/40 text-sm text-muted-foreground hover:text-blue-400 transition-colors"
            >
                <Plus className="w-4 h-4" /> Add brand fact
            </button>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-blue-300">New brand fact</span>
                <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-white">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Type picker */}
            <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fact type</label>
                <select
                    value={factType}
                    onChange={(e) => setFactType(e.target.value as FactTypeValue)}
                    className="w-full bg-zinc-900 border border-border rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                    {FACT_TYPES.map((ft) => (
                        <option key={ft.value} value={ft.value}>{ft.label}</option>
                    ))}
                </select>
            </div>

            {/* Value */}
            <div>
                <label className="text-xs text-muted-foreground mb-1 block">Value</label>
                <input
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-zinc-900 border border-border rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
            </div>

            {/* Source URL */}
            <div>
                <label className="text-xs text-muted-foreground mb-1 block">Source URL <span className="text-zinc-600">(optional)</span></label>
                <input
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://..."
                    type="url"
                    className="w-full bg-zinc-900 border border-border rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
            </div>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <div className="flex gap-2">
                <button
                    type="submit"
                    disabled={saving || !value.trim()}
                    className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 text-white rounded text-sm font-semibold transition-colors"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add fact
                </button>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 rounded border border-border text-sm text-muted-foreground hover:text-white transition-colors"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}

// ─── JsonLdPreview ────────────────────────────────────────────────────────────

function JsonLdPreview({ domain }: { domain: string }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [json, setJson] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/kg-feed?domain=${encodeURIComponent(domain)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Failed to load KG");
            setJson(JSON.stringify(data, null, 2));
            setOpen(true);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load KG");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <button
                onClick={open ? () => setOpen(false) : load}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-zinc-600 text-sm text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
            >
                {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Code2 className="w-4 h-4" />
                )}
                {open ? "Hide" : "View"} JSON-LD
                {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
            {open && json && (
                <pre className="mt-3 p-3 rounded-lg bg-zinc-950 border border-border text-[11px] text-zinc-300 overflow-auto max-h-80 leading-relaxed">
                    {json}
                </pre>
            )}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function KnowledgeGraphEditor({ siteId, domain }: KnowledgeGraphEditorProps) {
    const [facts, setFacts] = useState<BrandFact[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [grouped, setGrouped] = useState(true);
    const [propagating, setPropagating] = useState(false);
    const [propagateMsg, setPropagateMsg] = useState<string | null>(null);
    const propagateMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Load facts ────────────────────────────────────────────────────────────
    const loadFacts = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch(`/api/entity-panel?siteId=${siteId}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Failed to load facts");
            setFacts(data.brandFacts ?? []);
        } catch (e: unknown) {
            setLoadError(e instanceof Error ? e.message : "Failed to load facts");
        } finally {
            setLoading(false);
        }
    }, [siteId]);

    useEffect(() => { loadFacts(); }, [loadFacts]);

    // ── Propagate ─────────────────────────────────────────────────────────────
    const handlePropagate = async () => {
        setPropagating(true);
        setPropagateMsg(null);
        try {
            // Bust the KG cache and rebuild
            const res = await fetch(`/api/kg-feed?domain=${encodeURIComponent(domain)}&refresh=true`);
            if (res.ok) {
                setPropagateMsg("✓ Knowledge Graph refreshed and propagated");
            } else {
                const data = await res.json();
                setPropagateMsg(`⚠ ${data.error ?? "Propagation failed"}`);
            }
        } catch {
            setPropagateMsg("⚠ Propagation failed — check your connection");
        } finally {
            setPropagating(false);
            if (propagateMsgTimer.current) clearTimeout(propagateMsgTimer.current);
            propagateMsgTimer.current = setTimeout(() => setPropagateMsg(null), 5000);
        }
    };

    // ── Mutations ─────────────────────────────────────────────────────────────
    const handleUpdate = (updated: BrandFact) => {
        setFacts((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    };

    const handleDelete = (id: string) => {
        setFacts((prev) => prev.filter((f) => f.id !== id));
    };

    const handleAdded = (fact: BrandFact) => {
        setFacts((prev) => [fact, ...prev]);
    };

    // ── Grouping ──────────────────────────────────────────────────────────────
    const groupedFacts = facts.reduce<Record<string, BrandFact[]>>((acc, f) => {
        (acc[f.factType] ??= []).push(f);
        return acc;
    }, {});

    const verifiedCount = facts.filter((f) => f.verified).length;

    return (
        <div className="card-surface p-6 border-border overflow-hidden relative">
            {/* Background glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 blur-[100px] rounded-full pointer-events-none" />

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div>
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <span className="text-blue-400">🕸️</span> AI Knowledge Graph
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Manage brand facts that feed LLM answer engines.
                    </p>
                </div>
                <span className="self-start sm:self-auto px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-bold rounded-full border border-blue-500/20">
                    2026 Engine Active
                </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="p-3 rounded-xl bg-muted border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1">Verified Facts</div>
                    <div className="text-2xl font-bold">
                        {verifiedCount}
                        <span className="text-sm font-normal text-muted-foreground ml-1">/ {facts.length}</span>
                    </div>
                </div>
                <div className="p-3 rounded-xl bg-muted border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1">Fact Types</div>
                    <div className="text-2xl font-bold">{Object.keys(groupedFacts).length}</div>
                </div>
            </div>

            {/* View toggle */}
            {facts.length > 0 && (
                <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Brand Facts</span>
                    <button
                        onClick={() => setGrouped((g) => !g)}
                        className="text-[10px] text-muted-foreground hover:text-white flex items-center gap-1 transition-colors"
                    >
                        {grouped ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                        {grouped ? "Grouped" : "Flat"}
                    </button>
                </div>
            )}

            {/* Facts list */}
            <div className="space-y-2 mb-5">
                {loading && (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading facts…
                    </div>
                )}

                {!loading && loadError && (
                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
                        {loadError}
                        <button onClick={loadFacts} className="ml-2 underline text-xs">Retry</button>
                    </div>
                )}

                {!loading && !loadError && facts.length === 0 && (
                    <div className="p-8 text-center bg-muted rounded-xl border border-dashed border-border">
                        <p className="text-sm text-muted-foreground">
                            No brand facts yet. Add your first fact below, or run an AEO audit to auto-extract them.
                        </p>
                    </div>
                )}

                {!loading && !loadError && facts.length > 0 && (
                    grouped ? (
                        Object.entries(groupedFacts).map(([type, typeFacts]) => (
                            <div key={type}>
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 mt-3 first:mt-0">
                                    {factTypeLabel(type)} ({typeFacts.length})
                                </div>
                                <div className="space-y-1.5">
                                    {typeFacts.map((fact) => (
                                        <FactRow
                                            key={fact.id}
                                            fact={fact}
                                            domain={domain}
                                            onUpdate={handleUpdate}
                                            onDelete={handleDelete}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : (
                        facts.map((fact) => (
                            <FactRow
                                key={fact.id}
                                fact={fact}
                                domain={domain}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                            />
                        ))
                    )
                )}
            </div>

            {/* Add fact form */}
            <div className="mb-5">
                <AddFactForm siteId={siteId} onAdded={handleAdded} />
            </div>

            {/* Footer actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-border">
                <JsonLdPreview domain={domain} />

                <div className="flex-1 flex flex-col items-end gap-1">
                    <button
                        onClick={handlePropagate}
                        disabled={propagating}
                        className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-blue-500/20"
                    >
                        {propagating ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <RefreshCw className="w-4 h-4" />
                        )}
                        {propagating ? "Propagating…" : "Propagate to Google"}
                    </button>
                    {propagateMsg && (
                        <p className={`text-xs ${propagateMsg.startsWith("✓") ? "text-emerald-400" : "text-amber-400"}`}>
                            {propagateMsg}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
