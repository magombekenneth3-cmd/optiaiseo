"use client";
import React, { useMemo } from "react";
import { ArrowRight, CheckCircle, AlertTriangle } from "lucide-react";

interface BrandFact {
    factType: string;
    value: string;
    verified: boolean;
}

interface BrandEntityCardProps {
    brandFacts: BrandFact[];
    siteId: string;
    onViewDetails?: () => void;
}

// The entity types we surface in the card
const ENTITY_TYPES = [
    "Organization",
    "Person",
    "Product",
    "Software",
    "Industry",
    "Relationships",
] as const;

function normaliseType(factType: string): string {
    // Map raw factType strings to display names
    const map: Record<string, string> = {
        founder: "Person",
        ceo: "Person",
        person: "Person",
        organization: "Organization",
        company: "Organization",
        brand: "Organization",
        product: "Product",
        tool: "Product",
        software: "Software",
        platform: "Software",
        industry: "Industry",
        sector: "Industry",
        category: "Industry",
        competitor: "Relationships",
        partner: "Relationships",
        relationship: "Relationships",
    };
    return map[factType.toLowerCase()] ?? factType;
}

function entityStrengthLabel(score: number): string {
    if (score >= 80) return "Strong";
    if (score >= 60) return "Moderate strength";
    if (score >= 40) return "Developing";
    return "Weak";
}

function entityStrengthColor(score: number): string {
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-amber-400";
    if (score >= 40) return "text-orange-400";
    return "text-rose-400";
}

function scoreBarColor(score: number): string {
    if (score >= 80) return "bg-emerald-500";
    if (score >= 60) return "bg-amber-500";
    return "bg-rose-500";
}

export function BrandEntityCard({ brandFacts, siteId: _siteId, onViewDetails }: BrandEntityCardProps) {
    const { score, coverage, totalFacts, verifiedFacts } = useMemo(() => {
        if (brandFacts.length === 0) {
            return { score: 0, coverage: new Map<string, "found" | "partial" | "missing">(), totalFacts: 0, verifiedFacts: 0 };
        }

        // Group by normalised entity type
        const byType = new Map<string, BrandFact[]>();
        for (const f of brandFacts) {
            const t = normaliseType(f.factType);
            if (!byType.has(t)) byType.set(t, []);
            byType.get(t)!.push(f);
        }

        // Compute per-type status
        const coverage = new Map<string, "found" | "partial" | "missing">();
        for (const et of ENTITY_TYPES) {
            const facts = byType.get(et);
            if (!facts || facts.length === 0) {
                coverage.set(et, "missing");
            } else if (facts.every((f) => f.verified)) {
                coverage.set(et, "found");
            } else {
                coverage.set(et, "partial");
            }
        }

        const verified = brandFacts.filter((f) => f.verified).length;
        const total = brandFacts.length;
        // Score: verified facts weight + entity type coverage
        const typesFound = [...coverage.values()].filter((v) => v === "found").length;
        const typesPartial = [...coverage.values()].filter((v) => v === "partial").length;
        const rawScore = Math.round(
            ((verified / Math.max(total, 1)) * 0.6 + ((typesFound * 1 + typesPartial * 0.5) / ENTITY_TYPES.length) * 0.4) * 100
        );

        return { score: rawScore, coverage, totalFacts: total, verifiedFacts: verified };
    }, [brandFacts]);

    const hasData = brandFacts.length > 0;
    const label = entityStrengthLabel(score);
    const labelColor = entityStrengthColor(score);
    const barColor = scoreBarColor(score);

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400 text-sm">◈</span>
                    <p className="text-sm font-bold text-foreground">Brand Entity</p>
                </div>
                {onViewDetails && (
                    <button
                        onClick={onViewDetails}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        View details <ArrowRight className="w-3 h-3" />
                    </button>
                )}
            </div>

            {/* Score */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-end gap-2">
                    <span className={`text-3xl font-black tabular-nums ${labelColor}`}>
                        {hasData ? score : "–"}
                    </span>
                    <span className="text-sm text-muted-foreground mb-0.5">/ 100</span>
                </div>
                <p className={`text-xs font-semibold ${labelColor}`}>{hasData ? label : "Not measured"}</p>
                <p className="text-[10px] text-muted-foreground">
                    {hasData ? `${totalFacts} entities discovered` : "Run a scan to discover brand entities"}
                </p>
                {/* Score bar */}
                {hasData && (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                        <div
                            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                            style={{ width: `${score}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Entity type coverage list */}
            <div className="flex flex-col gap-2">
                {ENTITY_TYPES.map((et) => {
                    const status = hasData ? (coverage.get(et) ?? "missing") : null;
                    return (
                        <div key={et} className="flex items-center justify-between text-xs">
                            <span className="text-foreground/80">{et}</span>
                            {status === "found" ? (
                                <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                                    <CheckCircle className="w-3 h-3" /> Found
                                </span>
                            ) : status === "partial" ? (
                                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                                    <AlertTriangle className="w-3 h-3" /> Partial
                                </span>
                            ) : (
                                <span className="text-muted-foreground/50">–</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
