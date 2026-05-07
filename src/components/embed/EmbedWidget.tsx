"use client";

import { useState } from "react";
import { Search, Loader2, CheckCircle, AlertCircle } from "lucide-react";

interface ScoreBarProps { label: string; score: number; color: string; }

function ScoreBar({ label, score, color }: ScoreBarProps) {
    const pct = Math.max(0, Math.min(100, score));
    return (
        <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-28 shrink-0 capitalize">{label.replace(/-/g, " ")}</span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-xs font-semibold text-gray-700 w-8 text-right">{pct}</span>
        </div>
    );
}

interface WidgetProps {
    apiKey: string;
    brandName: string;
    accentColor: string;
    logoUrl: string;
    whiteLabel: boolean;
}

export function EmbedWidget({ apiKey, brandName, accentColor, logoUrl, whiteLabel }: WidgetProps) {
    const [url, setUrl] = useState("");
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [scores, setScores] = useState<Record<string, number> | null>(null);
    const [domain, setDomain] = useState<string | null>(null);
    const [error, setError] = useState("");

    async function handleCheck() {
        if (!url.trim()) return;
        setLoading(true); setError(""); setScores(null);
        try {
            const res = await fetch("/api/embed-audit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, leadEmail: email || undefined, embedKey: apiKey }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Analysis failed");
            setScores(data.scores);
            setDomain(data.domain);
            // notify parent of ideal height
            window.parent?.postMessage({ type: "OptiAISEO_RESIZE", height: 520 }, "*");
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    }

    const accent = accentColor.startsWith("#") ? accentColor : `#${accentColor}`;

    return (
        <div style={{ fontFamily: "system-ui,sans-serif", padding: 24, maxWidth: 480, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                {logoUrl && <img src={logoUrl} alt={brandName} style={{ height: 28, width: "auto" }} />}
                <span style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>
                    {brandName || "SEO Score"} Analyser
                </span>
            </div>

            {/* Input */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCheck()}
                    placeholder="https://yourwebsite.com"
                    id="embed-url-input"
                    style={{
                        flex: 1, padding: "10px 14px", border: "1.5px solid #e5e7eb",
                        borderRadius: 8, fontSize: 13, outline: "none",
                        color: "#111", background: "#fff",
                    }}
                />
                <button
                    id="embed-analyse-btn"
                    onClick={handleCheck}
                    disabled={loading || !url.trim()}
                    style={{
                        background: accent, color: "#fff", border: "none", borderRadius: 8,
                        padding: "0 18px", fontWeight: 600, fontSize: 13, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 6, opacity: loading ? 0.7 : 1,
                    }}
                >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                    {loading ? "Analysing…" : "Analyse"}
                </button>
            </div>

            {/* Lead email capture */}
            {!scores && (
                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Your email (to receive results)"
                    id="embed-email-input"
                    style={{
                        width: "100%", padding: "9px 14px", border: "1.5px solid #e5e7eb",
                        borderRadius: 8, fontSize: 13, outline: "none",
                        color: "#111", background: "#fff", boxSizing: "border-box",
                    }}
                />
            )}

            {/* Error */}
            {error && (
                <div style={{ display: "flex", gap: 6, padding: "10px 12px", background: "#fef2f2", borderRadius: 8, marginTop: 12, color: "#dc2626", fontSize: 13 }}>
                    <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                    {error}
                </div>
            )}

            {/* Results */}
            {scores && domain && (
                <div style={{ marginTop: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                        <CheckCircle size={16} color="#10b981" />
                        <span style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>Scores for {domain}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {Object.entries(scores)
                            .filter(([, v]) => v >= 0)
                            .map(([k, v]) => {
                                const color = v >= 70 ? "#10b981" : v >= 40 ? "#f59e0b" : "#ef4444";
                                return <ScoreBar key={k} label={k} score={v} color={color} />;
                            })
                        }
                    </div>
                </div>
            )}

            {/* Footer */}
            {!whiteLabel && (
                <div style={{ marginTop: 20, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>
                    Powered by <a href="https://optiaiseo.online" target="_blank" rel="noopener noreferrer" style={{ color: accent }}>OptiAISEO</a>
                </div>
            )}
        </div>
    );
}
