/**
 * UptimeCard — Surfaces live uptime data from the UptimeAlert table.
 * Shown on the main dashboard for PRO/AGENCY users.
 * Reads data passed from the server component (no client-side fetch needed).
 */
"use client";

import { Activity } from "lucide-react";

export interface UptimeCardData {
  /** Uptime % over last 7 days (0–100) */
  uptimePct: number;
  /** Average response time in ms over last 7 days */
  avgResponseMs: number | null;
  /** Whether the site is currently considered down */
  isDown: boolean;
  /** ISO string of the last downtime event, or null */
  lastDownAt: string | null;
  /** 7 data points (one per day), each true = up, false = had an incident */
  weekHistory: boolean[];
}

export function UptimeCard({ data }: { data: UptimeCardData }) {
  const color = data.isDown
    ? "text-rose-400"
    : data.uptimePct >= 99
    ? "text-emerald-400"
    : data.uptimePct >= 95
    ? "text-amber-400"
    : "text-rose-400";

  const borderColor = data.isDown
    ? "border-rose-500/30"
    : data.uptimePct >= 99
    ? "border-emerald-500/20"
    : "border-amber-500/20";

  return (
    <div className={`metric-card overflow-hidden group border ${borderColor}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Uptime (7d)
        </p>
        <div
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center border ${
            data.isDown
              ? "bg-rose-500/10 border-rose-500/20"
              : "bg-emerald-500/10 border-emerald-500/20"
          }`}
        >
          <Activity
            className={`w-4 h-4 ${data.isDown ? "text-rose-400" : "text-emerald-400"}`}
          />
        </div>
      </div>

      <div>
        <div className="flex items-end gap-1.5">
          <span className={`text-4xl font-black tracking-tight ${color}`}>
            {data.uptimePct.toFixed(1)}
          </span>
          <span className="text-base text-muted-foreground mb-1 font-bold">%</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {data.isDown ? (
            <span className="text-rose-400 font-semibold animate-pulse">⚠ Site is currently down</span>
          ) : data.avgResponseMs ? (
            `Avg ${data.avgResponseMs}ms response`
          ) : (
            "All systems operational"
          )}
        </p>
      </div>

      {/* 7-day history bar */}
      <div className="flex items-end gap-0.5 h-5 mt-2" title="Last 7 days — green = up, red = incident">
        {data.weekHistory.map((up, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-all ${
              up ? "bg-emerald-500/60 h-full" : "bg-rose-500/70 h-3/5"
            }`}
          />
        ))}
      </div>
      {data.lastDownAt && (
        <p className="text-[10px] text-muted-foreground mt-1">
          Last incident:{" "}
          {new Date(data.lastDownAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}
