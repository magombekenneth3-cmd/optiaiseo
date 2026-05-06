"use client";

/**
 * KeywordSparkline — shows a mini position-over-time trend line for a single keyword.
 * Used inside keyword tracking rows. Takes an array of {date, position} points.
 * Position is inverted (lower = better rank = drawn higher).
 */

interface DataPoint { date: string; position: number; }

interface Props {
  data: DataPoint[];
  width?: number;
  height?: number;
  /** Whether rank improved overall (green) or declined (red) */
  trend?: "up" | "down" | "flat";
}

export function KeywordSparkline({ data, width = 80, height = 28, trend = "flat" }: Props) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="flex items-center justify-center text-xs text-muted-foreground/30">—</div>;
  }

  const positions = data.map(d => d.position);
  const minPos    = Math.min(...positions);
  const maxPos    = Math.max(...positions);
  const range     = maxPos - minPos || 1;

  // Map to SVG coords — lower position (better) maps to lower y (top of chart)
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.position - minPos) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const color =
    trend === "up"   ? "#10b981" :
    trend === "down" ? "#ef4444" :
                       "#6b7280";

  const latestPos = data[data.length - 1].position;
  const prevPos   = data[data.length - 2].position;
  const delta     = prevPos - latestPos; // positive = improved

  return (
    <div className="flex items-center gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <polyline
          points={points.join(" ")}
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.8"
        />
        {/* Latest position dot */}
        {(() => {
          const last = points[points.length - 1].split(",");
          return (
            <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
          );
        })()}
      </svg>
      {delta !== 0 && (
        <span className={`text-[10px] font-bold tabular-nums ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
          {delta > 0 ? "↑" : "↓"}{Math.abs(delta)}
        </span>
      )}
    </div>
  );
}
