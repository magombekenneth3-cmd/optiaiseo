"use client";

import React, { useState } from "react";
import { PseoGeneratedPage } from "@/lib/pseo/generator";

export default function PseoBatchDashboard() {
    const [pattern, setPattern] = useState("[service] in [city]");
    const [datasetInput, setDatasetInput] = useState(
        JSON.stringify(
            [
                { service: "SEO Audit", city: "New York" },
                { service: "AEO Optimization", city: "San Francisco" },
                { service: "Content Strategy", city: "Austin" },
            ],
            null,
            2
        )
    );
    const [loading, setLoading] = useState(false);
    const [pages, setPages] = useState<PseoGeneratedPage[]>([]);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        try {
            const dataset = JSON.parse(datasetInput);
            const res = await fetch("/api/pseo/batch-generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pattern,
                    dataset,
                    siteDomain: "optiaiseo.online",
                    authorName: "OptiAISEO pSEO Engine",
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Batch generation failed");
            setPages(data.pages || []);
        } catch (err: unknown) {
            setError((err as Error).message || "Generation error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Programmatic SEO (pSEO) Engine</h1>
                <p className="text-muted-foreground mt-1">Generate thousands of unique, schema-optimized landing pages with dynamic Gemini visuals.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-semibold mb-1">Keyword Pattern</label>
                        <input
                            type="text"
                            value={pattern}
                            onChange={(e) => setPattern(e.target.value)}
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder="[service] in [city]"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold mb-1">Variable Dataset (JSON Array)</label>
                        <textarea
                            rows={8}
                            value={datasetInput}
                            onChange={(e) => setDatasetInput(e.target.value)}
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>
                    {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-xs">{error}</div>}
                    <button
                        onClick={handleGenerate}
                        disabled={loading}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                        {loading ? "Generating Batch Pages..." : "Generate pSEO Batch"}
                    </button>
                </div>

                <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <h2 className="text-lg font-semibold">Generated Batch Results ({pages.length})</h2>
                    {pages.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">No pages generated yet. Enter a pattern and dataset to run.</p>
                    ) : (
                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                            {pages.map((p, idx) => (
                                <div key={idx} className="p-4 bg-background border border-border rounded-lg space-y-2">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-bold text-sm text-emerald-400">{p.title}</h3>
                                        <span className="text-xs font-mono bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded">/{p.slug}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">{p.metaDescription}</p>
                                    <div className="border border-border/50 rounded overflow-hidden max-h-32">
                                        <div dangerouslySetInnerHTML={{ __html: p.heroVisualSvg }} />
                                    </div>
                                    <details className="text-xs text-muted-foreground">
                                        <summary className="cursor-pointer font-medium text-foreground">View JSON-LD Schema ({p.schemaJsonLd.length} nodes)</summary>
                                        <pre className="mt-2 p-2 bg-slate-900 text-slate-200 rounded text-[10px] overflow-x-auto">
                                            {JSON.stringify(p.schemaJsonLd, null, 2)}
                                        </pre>
                                    </details>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
