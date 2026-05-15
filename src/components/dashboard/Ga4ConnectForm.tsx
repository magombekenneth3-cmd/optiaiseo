"use client";

import { useState, useEffect } from "react";
import { BarChart3, Check, Loader2, AlertCircle } from "lucide-react";

interface Ga4Property {
    id: string;
    displayName: string;
}

export function Ga4ConnectForm({
    siteId,
    currentPropertyId,
}: {
    siteId: string;
    currentPropertyId: string | null;
}) {
    const [properties, setProperties] = useState<Ga4Property[]>([]);
    const [selected, setSelected] = useState(currentPropertyId ?? "");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        fetch(`/api/ga4/properties?siteId=${siteId}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.properties) setProperties(data.properties);
                else setError(data.error ?? "Failed to load GA4 properties");
            })
            .catch(() => setError("Failed to load GA4 properties"))
            .finally(() => setLoading(false));
    }, [siteId]);

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/ga4/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ siteId, propertyId: selected || null }),
            });
            if (!res.ok) throw new Error("Failed to save");
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError("Failed to save GA4 property");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
            <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-[#a371f7]" />
                <h3 className="text-[14px] font-semibold text-[#e6edf3]">Google Analytics 4</h3>
                {currentPropertyId && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#2ea043]/10 text-[#2ea043] border border-[#2ea043]/20">
                        Connected
                    </span>
                )}
            </div>
            <p className="text-[12px] text-[#6e7681] mb-4">
                Connect your GA4 property to see unified search + analytics data on the Keywords page.
            </p>

            {loading ? (
                <div className="flex items-center gap-2 py-3">
                    <Loader2 className="w-4 h-4 text-[#6e7681] animate-spin" />
                    <span className="text-[12px] text-[#6e7681]">Loading GA4 properties...</span>
                </div>
            ) : properties.length > 0 ? (
                <div className="flex flex-col gap-3">
                    <select
                        className="w-full px-3 py-2 text-[13px] rounded-lg bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:border-[#388bfd] outline-none"
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                    >
                        <option value="">None (disconnect)</option>
                        {properties.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.displayName} ({p.id})
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="self-start flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold rounded-lg bg-[#238636] text-white hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
                    >
                        {saving ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : saved ? (
                            <Check className="w-3 h-3" />
                        ) : null}
                        {saved ? "Saved!" : "Save"}
                    </button>
                </div>
            ) : (
                <div className="flex items-center gap-2 py-2">
                    <AlertCircle className="w-4 h-4 text-[#d29922]" />
                    <span className="text-[12px] text-[#6e7681]">
                        {error || "No GA4 properties found. Make sure your Google account has Analytics access."}
                    </span>
                </div>
            )}

            {error && properties.length > 0 && (
                <p className="text-[11px] text-[#f85149] mt-2">{error}</p>
            )}
        </div>
    );
}
