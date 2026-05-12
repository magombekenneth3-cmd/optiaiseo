import type { NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";

interface Props {
    overallScore: number;
    issues: NormalisedIssue[];
    categoryCount: number;
    lcp?: number | null;
    cls?: number | null;
    inp?: number | null;
}

function scoreHex(s: number) {
    if (s >= 75) return "#2ea043";
    if (s >= 50) return "#d29922";
    return "#f85149";
}

function vitalTag(metric: "lcp" | "cls" | "inp", value: number) {
    if (metric === "lcp") {
        if (value <= 2.5) return { label: `${value.toFixed(1)}s`, color: "#2ea043" };
        if (value <= 4.0) return { label: `${value.toFixed(1)}s`, color: "#d29922" };
        return { label: `${value.toFixed(1)}s`, color: "#f85149" };
    }
    if (metric === "cls") {
        if (value <= 0.1) return { label: value.toFixed(3), color: "#2ea043" };
        if (value <= 0.25) return { label: value.toFixed(3), color: "#d29922" };
        return { label: value.toFixed(3), color: "#f85149" };
    }
    if (value <= 200) return { label: `${Math.round(value)}ms`, color: "#2ea043" };
    if (value <= 500) return { label: `${Math.round(value)}ms`, color: "#d29922" };
    return { label: `${Math.round(value)}ms`, color: "#f85149" };
}

export function AuditScoreBar({ overallScore, issues, categoryCount, lcp, cls, inp }: Props) {
    const criticals = issues.filter((i) => i.severity === "critical").length;
    const highs = issues.filter((i) => i.severity === "high").length;
    const mediums = issues.filter((i) => i.severity === "medium").length;
    const lows = issues.filter((i) => i.severity === "low").length;
    const total = issues.length;
    const maxBar = Math.max(criticals, highs, mediums, lows, 1);

    const R = 30;
    const CIRC = 2 * Math.PI * R;
    const dashOffset = CIRC - (overallScore / 100) * CIRC;
    const hex = scoreHex(overallScore);

    const hasVitals = lcp != null || cls != null || inp != null;

    const bars = [
        { label: "Critical", count: criticals, color: "#f85149", textCls: "text-[#f85149]" },
        { label: "High", count: highs, color: "#d29922", textCls: "text-[#d29922]" },
        { label: "Medium", count: mediums, color: "#388bfd", textCls: "text-[#388bfd]" },
        { label: "Low", count: lows, color: "#6e7681", textCls: "text-[#6e7681]" },
    ];

    return (
        <div className="bg-[#161b22] border border-[#30363d] rounded-[10px] p-5 mb-5">
            <div className="flex items-center gap-6">
                <div className="relative w-[72px] h-[72px] shrink-0">
                    <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
                        <circle cx="36" cy="36" r={R} fill="none" stroke="#21262d" strokeWidth="6" />
                        <circle
                            cx="36" cy="36" r={R} fill="none"
                            stroke={hex} strokeWidth="6" strokeLinecap="round"
                            strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[18px] font-bold leading-none" style={{ color: hex }}>{overallScore}</span>
                        <span className="text-[9px] text-[#6e7681] font-medium uppercase tracking-[0.05em] mt-0.5">Health</span>
                    </div>
                </div>

                <div className="flex-1 flex flex-col gap-[6px]">
                    {bars.map((bar) => (
                        <div key={bar.label} className="flex items-center gap-2.5 text-[12px]">
                            <span className="w-[62px] text-[#6e7681]">{bar.label}</span>
                            <div className="flex-1 h-[5px] bg-[#21262d] rounded-[3px] overflow-hidden">
                                <div
                                    className="h-full rounded-[3px] transition-all duration-700"
                                    style={{ width: `${(bar.count / maxBar) * 100}%`, background: bar.color }}
                                />
                            </div>
                            <span className={`w-[28px] text-right font-semibold text-[12px] ${bar.textCls}`}>{bar.count}</span>
                        </div>
                    ))}
                </div>

                <div className="w-px h-[48px] bg-[#30363d] mx-2" />

                <div className="text-center px-2">
                    <div className="text-[22px] font-bold text-[#f85149] tracking-tight leading-none">{total}</div>
                    <div className="text-[11px] text-[#6e7681] font-medium mt-1">Total Issues</div>
                </div>

                <div className="w-px h-[48px] bg-[#30363d] mx-2" />

                <div className="text-center px-2">
                    <div className="text-[22px] font-bold text-[#388bfd] tracking-tight leading-none">{categoryCount}</div>
                    <div className="text-[11px] text-[#6e7681] font-medium mt-1">Categories</div>
                </div>

                {hasVitals && (
                    <>
                        <div className="w-px h-[48px] bg-[#30363d] mx-2" />
                        <div className="flex gap-4 px-2">
                            {lcp != null && (() => {
                                const v = vitalTag("lcp", lcp);
                                return (
                                    <div className="text-center">
                                        <div className="text-[9px] text-[#6e7681] font-semibold uppercase tracking-[0.08em] mb-1">LCP</div>
                                        <div className="text-[15px] font-bold font-mono leading-none" style={{ color: v.color }}>{v.label}</div>
                                    </div>
                                );
                            })()}
                            {cls != null && (() => {
                                const v = vitalTag("cls", cls);
                                return (
                                    <div className="text-center">
                                        <div className="text-[9px] text-[#6e7681] font-semibold uppercase tracking-[0.08em] mb-1">CLS</div>
                                        <div className="text-[15px] font-bold font-mono leading-none" style={{ color: v.color }}>{v.label}</div>
                                    </div>
                                );
                            })()}
                            {inp != null && (() => {
                                const v = vitalTag("inp", inp);
                                return (
                                    <div className="text-center">
                                        <div className="text-[9px] text-[#6e7681] font-semibold uppercase tracking-[0.08em] mb-1">INP</div>
                                        <div className="text-[15px] font-bold font-mono leading-none" style={{ color: v.color }}>{v.label}</div>
                                    </div>
                                );
                            })()}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
