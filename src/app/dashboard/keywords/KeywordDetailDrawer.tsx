"use client";

import { useEffect, useCallback, useState } from "react";
import { X, ExternalLink, ArrowRight, Sparkles } from "lucide-react";
import { KeywordSerpPanel } from "@/components/dashboard/KeywordSerpPanel";

const CTR_BENCH: Record<number, number> = {
    1: 27.6, 2: 15.8, 3: 11.0, 4: 8.4, 5: 6.3,
    6: 4.9, 7: 3.9, 8: 3.3, 9: 2.7, 10: 2.4,
};

function benchCtr(pos: number) {
    if (pos <= 10) return CTR_BENCH[pos] ?? 2.4;
    if (pos <= 20) return 1.5;
    return 0.5;
}

export interface DrawerKeyword {
    keyword: string;
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
    url: string;
    intent?: string | null;
    difficulty?: number | null;
    positionHistory?: { date: string; position: number }[];
}

function actionTag(kw: DrawerKeyword) {
    const b = benchCtr(kw.position);
    if (kw.position <= 3 && kw.ctr >= b * 0.5)
        return { label: "Performing", tone: "text-brand bg-brand/10 border-brand/30" };
    if (kw.position <= 10 && kw.ctr < b * 0.6)
        return { label: "Fix CTR", tone: "text-destructive bg-destructive/10 border-destructive/30" };
    if (kw.position <= 20)
        return { label: "Improve", tone: "text-warning bg-warning/10 border-warning/30" };
    return { label: "Create", tone: "text-info bg-info/10 border-info/30" };
}

function estImpact(kw: DrawerKeyword) {
    if (kw.position <= 3) return 0;
    const t = kw.position <= 10 ? benchCtr(kw.position) / 100 : 0.278;
    return Math.max(0, Math.round(kw.impressions * t - kw.clicks));
}

function TrendChart({ data }: { data: { date: string; position: number }[] }) {
    if (data.length < 2) return null;
    const w = 300, h = 100, px = 20, py = 16;
    const pos = data.map(d => d.position);
    const lo = Math.max(1, Math.min(...pos) - 1);
    const hi = Math.max(...pos) + 1;
    const r = hi - lo || 1;
    const pts = data.map((d, i) => ({
        x: px + (i / (data.length - 1)) * (w - px * 2),
        y: py + ((d.position - lo) / r) * (h - py * 2),
    }));
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("");
    const area = `${line}L${pts.at(-1)!.x},${h}L${pts[0].x},${h}Z`;
    const idx = data.length >= 5
        ? [0, Math.floor(data.length / 2), data.length - 1]
        : data.map((_, i) => i);

    return (
        <svg viewBox={`0 0 ${w} ${h + 16}`} className="w-full" style={{ maxHeight: 140 }}>
            <defs>
                <linearGradient id="drawer-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--info)" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="var(--info)" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill="url(#drawer-grad)" />
            <path d={line} fill="none" stroke="var(--info)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--background)" stroke="var(--info)" strokeWidth="1.5" />
            ))}
            {idx.map(i => (
                <text key={i} x={pts[i].x} y={h + 12} textAnchor="middle" fill="var(--muted-foreground)" style={{ fontSize: 9 }}>
                    {data[i].date.slice(5)}
                </text>
            ))}
        </svg>
    );
}

function whyMatters(kw: DrawerKeyword) {
    const b = benchCtr(kw.position);
    const out: string[] = [];
    if (kw.position <= 10 && kw.ctr < b * 0.6) {
        out.push(`You rank #${kw.position}, but get ${Math.round((1 - kw.ctr / b) * 100)}% fewer clicks than expected.`);
        out.push("The title and meta description aren't optimized for intent.");
    } else if (kw.position <= 20) {
        out.push(`You're ${kw.position - 10} positions from page 1.`);
        if (kw.impressions > 100) out.push(`The page received ${kw.impressions.toLocaleString()} impressions.`);
    } else if (kw.position > 20) {
        out.push(`Position #${kw.position} gets very little organic visibility.`);
        if (kw.impressions > 30) out.push(`Despite low ranking, you received ${kw.impressions.toLocaleString()} impressions.`);
    } else {
        out.push(`Position #${kw.position} is strong. Monitor for competitors.`);
    }
    return out;
}

function recAction(kw: DrawerKeyword) {
    const est = estImpact(kw);
    const b = benchCtr(kw.position);
    if (kw.position <= 10 && kw.ctr < b * 0.6)
        return { title: "Optimize existing page", potential: `+${est}–${Math.round(est * 1.5)} clicks/mo`, cta: "Run page audit" };
    if (kw.position <= 20)
        return { title: "Improve existing page", potential: `+${est}–${Math.round(est * 1.3)} clicks/mo`, cta: "Run page audit" };
    return { title: "Create supporting content", potential: `+${est}–${Math.round(est * 2)} clicks/mo`, cta: "Create content" };
}

function aiSuggestions(kw: DrawerKeyword) {
    const b = benchCtr(kw.position);
    if (kw.position <= 10 && kw.ctr < b * 0.6)
        return [
            { text: "Improve title", impact: "+3–5 clicks/mo" },
            { text: "Enhance meta description", impact: "+2–4 clicks/mo" },
            { text: "Add FAQ schema", impact: "+1–3 clicks/mo" },
        ];
    if (kw.position <= 20)
        return [
            { text: "Add relevant internal links", impact: "+5–10 clicks/mo" },
            { text: "Expand content depth", impact: "+3–8 clicks/mo" },
            { text: "Optimize heading structure", impact: "+2–4 clicks/mo" },
        ];
    return [
        { text: "Create dedicated landing page", impact: "+10–20 clicks/mo" },
        { text: "Build topic cluster", impact: "+5–15 clicks/mo" },
        { text: "Target related long-tail keywords", impact: "+3–8 clicks/mo" },
    ];
}

export function KeywordDetailDrawer({ keyword: kw, siteId, onClose }: {
    keyword: DrawerKeyword;
    siteId: string;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<"overview" | "serp">("overview");
    const tag = actionTag(kw);
    const b = benchCtr(kw.position);
    const est = estImpact(kw);
    const action = recAction(kw);
    const suggs = aiSuggestions(kw);
    const matters = whyMatters(kw);

    const onEsc = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
    }, [onClose]);

    useEffect(() => {
        document.addEventListener("keydown", onEsc);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onEsc);
            document.body.style.overflow = "";
        };
    }, [onEsc]);

    return (
        <>
            <style>{`@keyframes kwDrawerSlide{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div className="fixed inset-0 z-50 flex justify-end">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={onClose} />
                <div
                    className="relative w-full max-w-[420px] bg-card border-l border-border overflow-y-auto flex flex-col"
                    style={{ animation: "kwDrawerSlide .2s ease-out" }}
                >
                    <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h2 className="text-sm font-bold text-foreground truncate">{kw.keyword}</h2>
                                    <a href={kw.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-info">
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                    <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full border ${tag.tone}`}>
                                        {tag.label}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Position #{kw.position} · {kw.ctr}% CTR · {kw.impressions.toLocaleString()} impressions
                                </p>
                            </div>
                            <button onClick={onClose} className="shrink-0 p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        {kw.position <= 10 && kw.ctr < b * 0.6 && (
                            <p className="text-xs text-muted-foreground mt-2">
                                Your page ranks #{kw.position} but has below-benchmark CTR.
                            </p>
                        )}
                    </div>

                    {kw.position <= 10 && (
                        <div className="px-5 py-4 border-b border-border/60">
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div>
                                    <p className="text-xl font-bold tabular-nums text-foreground">{kw.ctr}%</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Current CTR</p>
                                </div>
                                <div>
                                    <p className="text-xl font-bold tabular-nums text-info">{b}%</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Expected CTR</p>
                                </div>
                                <div>
                                    <p className="text-xl font-bold tabular-nums text-brand">+{est}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Est. clicks/mo</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex border-b border-border">
                        {(["overview", "serp"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`flex-1 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                                    tab === t
                                        ? "border-info text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {t === "overview" ? "Overview" : "SERP Analysis"}
                            </button>
                        ))}
                    </div>

                    {tab === "overview" ? (
                        <div className="flex-1 px-5 py-4 space-y-5">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground mb-2">Why this matters</h3>
                                <ul className="space-y-1.5">
                                    {matters.map((l, i) => (
                                        <li key={i} className="text-xs text-muted-foreground flex gap-2">
                                            <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-muted-foreground" />
                                            {l}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {est > 0 && (
                                <div className="rounded-lg border border-border bg-muted p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold text-foreground">{action.title}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">Potential: {action.potential}</p>
                                        </div>
                                        <button
                                            onClick={() => setTab("serp")}
                                            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-info text-white hover:bg-info/90 transition-colors"
                                        >
                                            {action.cta}
                                            <ArrowRight className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {kw.positionHistory && kw.positionHistory.length >= 2 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground mb-2">Position trend</h3>
                                    <TrendChart data={kw.positionHistory} />
                                </div>
                            )}

                            <div>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Sparkles className="w-3.5 h-3.5 text-warning" />
                                    <h3 className="text-sm font-semibold text-foreground">AI Suggestions</h3>
                                </div>
                                <ul className="space-y-1.5">
                                    {suggs.map((s, i) => (
                                        <li key={i} className="flex items-center justify-between text-xs">
                                            <span className="text-foreground/80">• {s.text}</span>
                                            <span className="text-brand font-medium">({s.impact})</span>
                                        </li>
                                    ))}
                                </ul>
                                <button className="mt-3 flex items-center gap-1 text-xs font-medium text-info hover:text-info/80 transition-colors">
                                    View full recommendations
                                    <ArrowRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1">
                            <KeywordSerpPanel
                                keyword={kw.keyword}
                                position={kw.position}
                                impressions={kw.impressions}
                                clicks={kw.clicks}
                                landingUrl={kw.url}
                                siteId={siteId}
                            />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
