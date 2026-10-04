"use client";

/**
 * Position Distribution Chart
 *
 * Renders a horizontal stacked bar showing how many keywords fall into
 * each position bucket (1-3, 4-10, 11-20, 21-50, 50+).
 * Pure CSS — no chart library required.
 */

interface GscKeyword {
    keyword: string;
    position: number;
}

const BUCKETS = [
    { label: "Top 3",   min: 1,  max: 3,   token: "brand" },
    { label: "4–10",    min: 4,  max: 10,  token: "info" },
    { label: "11–20",   min: 11, max: 20,  token: "warning" },
    { label: "21–50",   min: 21, max: 50,  token: "muted-foreground" },
    { label: "50+",     min: 51, max: 9999, token: "destructive" },
] as const;

function colorVar(token: string) {
    return `var(--${token})`;
}

export function PositionDistributionChart({ keywords }: { keywords: GscKeyword[] }) {
    const total = keywords.length || 1;
    const counts = BUCKETS.map(b => ({
        ...b,
        count: keywords.filter(k => k.position >= b.min && k.position <= b.max).length,
    }));

    return (
        <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground mb-1">Position Distribution</h3>
            <p className="text-xs text-muted-foreground mb-4">Where your {total} keywords rank</p>

            {/* Stacked horizontal bar */}
            <div className="flex h-3 rounded-full overflow-hidden gap-[1px] mb-4">
                {counts.filter(b => b.count > 0).map(b => (
                    <div
                        key={b.label}
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                            width: `${(b.count / total) * 100}%`,
                            background: colorVar(b.token),
                            minWidth: b.count > 0 ? "4px" : "0",
                        }}
                        title={`${b.label}: ${b.count} keywords (${Math.round((b.count / total) * 100)}%)`}
                    />
                ))}
            </div>

            {/* Legend grid */}
            <div className="grid grid-cols-5 gap-2">
                {counts.map(b => (
                    <div key={b.label} className="text-center">
                        <p
                            className="text-lg font-bold tabular-nums"
                            style={{ color: colorVar(b.token) }}
                        >
                            {b.count}
                        </p>
                        <p className="text-xs text-muted-foreground">{b.label}</p>
                        <p className="text-xs text-muted-foreground/60 tabular-nums">
                            {Math.round((b.count / total) * 100)}%
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}
