"use client";

interface LlmScore {
    name: string;
    score: number;
}

interface AeoOpportunity {
    label: string;
    impact: "critical" | "high" | "medium" | "low";
}

interface Props {
    overallScore: number;
    llmScores: LlmScore[];
    opportunities: AeoOpportunity[];
}

const IMPACT_CLASS: Record<string, string> = {
    critical: "text-rose-400",
    high: "text-amber-400",
    medium: "text-blue-400",
    low: "text-emerald-400",
};

function scoreColor(score: number): string {
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-amber-400";
    return "text-rose-400";
}

export function AeoVisibilityBreakdown({ overallScore, llmScores, opportunities }: Props) {
    return (
        <div className="flex flex-col gap-5">
            <div>
                <p className="stat-value">{overallScore}</p>
                <p className="stat-label">AEO Visibility</p>
                <p className="text-xs text-muted-foreground mt-2 max-w-[280px] leading-relaxed">
                    How well your content is structured for generative search systems.
                </p>
            </div>

            {llmScores.length > 0 && (
                <>
                    <hr className="section-divider" style={{ margin: "0.5rem 0" }} />
                    <div className="flex flex-col gap-2.5">
                        {llmScores.map((llm) => (
                            <div key={llm.name} className="flex items-center justify-between">
                                <span className="text-[13px] font-medium text-foreground">{llm.name}</span>
                                <div className="flex items-center gap-2">
                                    <div className="w-20 h-1 rounded-full bg-white/5 overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{
                                                width: `${Math.min(100, llm.score)}%`,
                                                backgroundColor: llm.score >= 80 ? "#10b981" : llm.score >= 60 ? "#f59e0b" : "#f87171",
                                            }}
                                        />
                                    </div>
                                    <span className={`text-sm font-bold tabular-nums ${scoreColor(llm.score)}`}>
                                        {llm.score}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {opportunities.length > 0 && (
                <>
                    <hr className="section-divider" style={{ margin: "0.5rem 0" }} />
                    <div>
                        <p className="section-label mb-2">Top Opportunities</p>
                        <div className="flex flex-col gap-1.5">
                            {opportunities.map((opp) => (
                                <div key={opp.label} className="flex items-center justify-between">
                                    <span className="text-xs text-foreground font-medium flex items-center gap-2">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            opp.impact === "critical" ? "bg-rose-400"
                                            : opp.impact === "high" ? "bg-amber-400"
                                            : opp.impact === "medium" ? "bg-blue-400"
                                            : "bg-emerald-400"
                                        }`} />
                                        {opp.label}
                                    </span>
                                    <span className={`text-[10px] font-bold uppercase tracking-wide ${IMPACT_CLASS[opp.impact]}`}>
                                        {opp.impact}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
