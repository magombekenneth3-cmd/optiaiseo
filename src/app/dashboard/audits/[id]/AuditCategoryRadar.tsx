"use client";

import {
    RadarChart,
    Radar,
    PolarGrid,
    PolarAngleAxis,
    ResponsiveContainer,
    Tooltip,
} from "recharts";

interface Props {
    scores: Record<string, number>;
}

function scoreColor(s: number) {
    if (s >= 75) return "#2ea043";
    if (s >= 50) return "#d29922";
    return "#f85149";
}

const CustomTooltip = ({
    active,
    payload,
}: {
    active?: boolean;
    payload?: { payload: { category: string; score: number } }[];
}) => {
    if (active && payload && payload.length) {
        const d = payload[0].payload;
        return (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 shadow-xl">
                <p className="text-[11px] font-semibold text-[#e6edf3] capitalize mb-0.5">
                    {d.category.replace(/-/g, " ")}
                </p>
                <p
                    className="text-[18px] font-black leading-none"
                    style={{ color: scoreColor(d.score) }}
                >
                    {d.score}
                    <span className="text-[11px] text-[#6e7681] font-normal ml-1">/100</span>
                </p>
            </div>
        );
    }
    return null;
};

export function AuditCategoryRadar({ scores }: Props) {
    const entries = Object.entries(scores);
    if (entries.length < 3) return null;

    const data = entries.map(([cat, score]) => ({
        category: cat.replace(/-/g, " "),
        score,
        fullMark: 100,
    }));

    const avg = Math.round(data.reduce((a, b) => a + b.score, 0) / data.length);
    const avgColor = scoreColor(avg);
    const weakest = [...data].sort((a, b) => a.score - b.score)[0];
    const strongest = [...data].sort((a, b) => b.score - a.score)[0];

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#21262d] flex items-center justify-between">
                <div>
                    <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.08em]">
                        Category Breakdown
                    </p>
                    <p className="text-[12px] text-[#8b949e] mt-0.5">Spider view of all SEO categories</p>
                </div>
                <div
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full border"
                    style={{ color: avgColor, borderColor: `${avgColor}40`, background: `${avgColor}12` }}
                >
                    Avg {avg}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row items-center">
                {/* Radar chart */}
                <div className="w-full lg:w-[340px] h-[280px] px-2 py-4">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                            <defs>
                                <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
                                    <stop offset="0%" stopColor="#388bfd" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#388bfd" stopOpacity={0.05} />
                                </radialGradient>
                            </defs>
                            <PolarGrid stroke="#21262d" />
                            <PolarAngleAxis
                                dataKey="category"
                                tick={{
                                    fontSize: 10,
                                    fill: "#8b949e",
                                    fontWeight: 500,
                                }}
                                tickLine={false}
                            />
                            <Radar
                                name="Score"
                                dataKey="score"
                                stroke="#388bfd"
                                strokeWidth={2}
                                fill="url(#radarFill)"
                                dot={{ fill: "#388bfd", strokeWidth: 0, r: 3 }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>

                {/* Score list */}
                <div className="flex-1 px-5 py-4 w-full border-t lg:border-t-0 lg:border-l border-[#21262d]">
                    <div className="space-y-2.5">
                        {[...data]
                            .sort((a, b) => b.score - a.score)
                            .map((d) => {
                                const c = scoreColor(d.score);
                                return (
                                    <div key={d.category} className="flex items-center gap-3">
                                        <span className="text-[12px] capitalize text-[#8b949e] w-[110px] shrink-0 truncate">
                                            {d.category}
                                        </span>
                                        <div className="flex-1 h-[6px] bg-[#21262d] rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-700"
                                                style={{ width: `${d.score}%`, background: c }}
                                            />
                                        </div>
                                        <span
                                            className="text-[12px] font-bold w-8 text-right tabular-nums"
                                            style={{ color: c }}
                                        >
                                            {d.score}
                                        </span>
                                    </div>
                                );
                            })}
                    </div>

                    {/* Insight pills */}
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#21262d]">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Strongest: <span className="capitalize ml-1">{strongest.category}</span>
                            <span className="ml-1 opacity-70">({strongest.score})</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[11px] font-semibold text-red-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            Focus area: <span className="capitalize ml-1">{weakest.category}</span>
                            <span className="ml-1 opacity-70">({weakest.score})</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
