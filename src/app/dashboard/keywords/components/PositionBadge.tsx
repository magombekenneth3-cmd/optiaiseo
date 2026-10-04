"use client";

const tone = (p: number) =>
  p <= 3 ? "bg-brand/10 text-brand border-brand/20"
  : p <= 10 ? "bg-info/10 text-info border-info/20"
  : p <= 20 ? "bg-warning/10 text-warning border-warning/20"
  : "bg-destructive/10 text-destructive border-destructive/20";

export function PositionBadge({ position, change }: { position: number; change?: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-2 py-0.5 rounded-md border text-xs font-semibold tabular-nums ${tone(position)}`}>#{position}</span>
      {change ? <span className={`text-xs tabular-nums ${change > 0 ? "text-brand" : "text-destructive"}`}>{change > 0 ? "▲" : "▼"}{Math.abs(change)}</span> : null}
    </span>
  );
}
